#!/usr/bin/env node
/**
 * F2A Pairing Script
 * 
 * 功能：
 * - 模式 A: 生成配对码，等待其他 Agent 连接
 * - 模式 B: 使用配对码加入，连接其他 Agent
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { autoDiscover, selectServer } = require('./discover');
const { WebhookBridge } = require('./webhook');

const F2A_DIR = path.join(process.env.HOME || '/root', '.openclaw/workspace/memory/f2a');
const PEERS_FILE = path.join(F2A_DIR, 'peers.json');

// 初始化 Webhook
const webhook = new WebhookBridge({
  openclawHost: process.env.F2A_WEBHOOK_HOST || 'localhost',
  openclawPort: process.env.F2A_WEBHOOK_PORT || 18789,
  token: process.env.F2A_WEBHOOK_TOKEN || '',
  hookPath: process.env.F2A_WEBHOOK_PATH || '/hooks/f2a',
  verbose: process.env.F2A_WEBHOOK_VERBOSE === 'true'
});

// 获取 Rendezvous Server 地址
async function getRendezvousServer() {
  // 1. 环境变量优先
  if (process.env.F2A_RENDEZVOUS) {
    return process.env.F2A_RENDEZVOUS;
  }
  
  // 2. 尝试自动发现
  const discovered = await autoDiscover();
  if (discovered) {
    return selectServer(discovered);
  }
  
  // 3. 使用默认值
  return 'ws://localhost:8765';
}

// 确保目录存在
async function ensureDir() {
  try {
    await fs.mkdir(F2A_DIR, { recursive: true });
  } catch (err) {
    // 忽略已存在错误
  }
}

// 加载或创建身份
async function loadIdentity() {
  await ensureDir();
  
  try {
    const data = await fs.readFile(PEERS_FILE, 'utf-8');
    const peersData = JSON.parse(data);
    
    if (peersData.myAgentId && peersData.myKeyPair) {
      return {
        agentId: peersData.myAgentId,
        publicKey: peersData.myKeyPair.publicKey,
        privateKey: peersData.myKeyPair.privateKey
      };
    }
  } catch (err) {
    // 文件不存在或损坏，创建新身份
  }
  
  // 生成新的 Ed25519 密钥对
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  const agentId = crypto.randomUUID();
  const keyPair = {
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(privateKey).toString('base64')
  };
  
  // 保存
  const peersData = {
    myAgentId: agentId,
    myKeyPair: keyPair,
    peers: []
  };
  
  await fs.writeFile(PEERS_FILE, JSON.stringify(peersData, null, 2));
  
  return {
    agentId,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey
  };
}

// 保存 peer
async function savePeer(peerInfo) {
  await ensureDir();
  
  let peersData;
  try {
    const data = await fs.readFile(PEERS_FILE, 'utf-8');
    peersData = JSON.parse(data);
  } catch (err) {
    peersData = { peers: [] };
  }
  
  // 检查是否已存在
  const existingIndex = peersData.peers.findIndex(p => p.agentId === peerInfo.agentId);
  
  const peerRecord = {
    agentId: peerInfo.agentId,
    publicKey: peerInfo.publicKey,
    metadata: peerInfo.metadata || {},
    connectedAt: existingIndex >= 0 
      ? peersData.peers[existingIndex].connectedAt 
      : new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
  
  if (existingIndex >= 0) {
    peersData.peers[existingIndex] = peerRecord;
  } else {
    peersData.peers.push(peerRecord);
  }
  
  await fs.writeFile(PEERS_FILE, JSON.stringify(peersData, null, 2));
  
  return peerRecord;
}

// 模式 A: 生成配对码，等待连接
async function startPairing(rendezvousUrl) {
  const identity = await loadIdentity();
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${rendezvousUrl}/register`);
    let pairCode = null;
    let timeout = null;
    
    ws.on('open', () => {
      console.log('[F2A] Connected to rendezvous server');
    });
    
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        
        if (msg.type === 'pair_code') {
          pairCode = msg.code;
          console.log(`[F2A] Pair code generated: ${pairCode}`);
          console.log(`[F2A] Expires at: ${new Date(msg.expiresAt).toLocaleString()}`);
          console.log('[F2A] Waiting for peer to join...');
          
          // 发送身份信息
          ws.send(JSON.stringify({
            type: 'identity',
            agentId: identity.agentId,
            publicKey: identity.publicKey,
            metadata: {
              name: process.env.F2A_AGENT_NAME || 'OpenClaw Agent',
              hostname: require('os').hostname()
            }
          }));
        }
        
        if (msg.type === 'peer_connected') {
          console.log('[F2A] Peer connected!');
          console.log(`[F2A] Agent ID: ${msg.peer.agentId}`);
          console.log(`[F2A] Metadata: ${JSON.stringify(msg.peer.metadata)}`);
          
          // 保存 peer
          const savedPeer = await savePeer(msg.peer);
          
          // 清理
          clearTimeout(timeout);
          ws.close();
          
          resolve({
            success: true,
            mode: 'host',
            pairCode,
            peer: savedPeer
          });
        }
      } catch (err) {
        console.error('[F2A] Error processing message:', err.message);
      }
    });
    
    ws.on('error', (err) => {
      console.error('[F2A] WebSocket error:', err.message);
      reject(err);
    });
    
    ws.on('close', (code, reason) => {
      if (code !== 1000) {
        console.log(`[F2A] Connection closed: ${code} ${reason}`);
      }
      if (!pairCode) {
        reject(new Error('Connection closed before pairing'));
      }
    });
    
    // 6分钟超时（比 server 的 5 分钟多留缓冲）
    timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Pairing timeout'));
    }, 6 * 60 * 1000);
  });
}

// 模式 B: 使用配对码加入
async function joinPairing(pairCode, rendezvousUrl) {
  const identity = await loadIdentity();
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${rendezvousUrl}/pair/${pairCode.toUpperCase()}`);
    let timeout = null;
    
    ws.on('open', () => {
      console.log('[F2A] Connected to rendezvous server');
      
      // 发送身份信息
      ws.send(JSON.stringify({
        type: 'identity',
        agentId: identity.agentId,
        publicKey: identity.publicKey,
        metadata: {
          name: process.env.F2A_AGENT_NAME || 'OpenClaw Agent',
          hostname: require('os').hostname()
        }
      }));
    });
    
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        
        if (msg.type === 'peer_connected') {
          console.log('[F2A] Successfully paired!');
          console.log(`[F2A] Agent ID: ${msg.peer.agentId}`);
          console.log(`[F2A] Metadata: ${JSON.stringify(msg.peer.metadata)}`);
          
          // 保存 peer
          const savedPeer = await savePeer(msg.peer);
          
          // 通知 OpenClaw
          await webhook.notifyPairConnected({
            agentId: msg.peer.agentId,
            publicKey: msg.peer.publicKey,
            metadata: msg.peer.metadata,
            address: msg.peerAddress
          });
          
          // 清理
          clearTimeout(timeout);
          ws.close();
          
          resolve({
            success: true,
            mode: 'join',
            pairCode: pairCode.toUpperCase(),
            peer: savedPeer
          });
        }
      } catch (err) {
        console.error('[F2A] Error processing message:', err.message);
      }
    });
    
    ws.on('error', (err) => {
      console.error('[F2A] WebSocket error:', err.message);
      reject(err);
    });
    
    ws.on('close', (code, reason) => {
      if (code !== 1000 && code !== 1008) {
        console.log(`[F2A] Connection closed: ${code} ${reason}`);
      }
    });
    
    // 2分钟超时
    timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Join timeout'));
    }, 2 * 60 * 1000);
  });
}

// 默认 rendezvous 服务器地址
const RENDEZVOUS_DEFAULT = 'ws://localhost:8765';

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // 获取 rendezvous URL：环境变量 > 自动发现 > 默认值
  let rendezvousUrl = process.env.F2A_RENDEZVOUS;
  if (!rendezvousUrl) {
    const discovered = await autoDiscover();
    if (discovered) {
      rendezvousUrl = Array.isArray(discovered) ? discovered[0].address : discovered;
      console.log(`[F2A] Auto-discovered server: ${rendezvousUrl}`);
    } else {
      rendezvousUrl = RENDEZVOUS_DEFAULT;
      console.log(`[F2A] Using default server: ${rendezvousUrl}`);
    }
  }
  
  try {
    if (command === 'host') {
      // 启动配对
      const result = await startPairing(rendezvousUrl);
      console.log('\n[F2A] Pairing completed successfully!');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } 
    else if (command === 'join' && args[1]) {
      // 加入配对
      const result = await joinPairing(args[1], rendezvousUrl);
      console.log('\n[F2A] Joined successfully!');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
    else {
      console.log('Usage:');
      console.log('  node pair.js host                    # Generate pair code and wait');
      console.log('  node pair.js join <PAIR_CODE>        # Join with pair code');
      console.log('');
      console.log('Environment variables:');
      console.log('  F2A_RENDEZVOUS=ws://host:port        # Rendezvous server URL');
      console.log('  F2A_AGENT_NAME="My Agent"            # Agent display name');
      process.exit(1);
    }
  } catch (err) {
    console.error('[F2A] Error:', err.message);
    process.exit(1);
  }
}

main();
