#!/usr/bin/env node
/**
 * F2A Peers Management Script
 * 
 * 功能：
 * - 列出已保存的 peers
 * - 查看 peer 详情
 * - 删除 peer
 */

const fs = require('fs').promises;
const path = require('path');

const F2A_DIR = path.join(process.env.HOME || '/root', '.openclaw/workspace/memory/f2a');
const PEERS_FILE = path.join(F2A_DIR, 'peers.json');

// 加载 peers 数据
async function loadPeersData() {
  try {
    const data = await fs.readFile(PEERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return { myAgentId: null, myKeyPair: null, peers: [] };
  }
}

// 保存 peers 数据
async function savePeersData(data) {
  await fs.mkdir(F2A_DIR, { recursive: true });
  await fs.writeFile(PEERS_FILE, JSON.stringify(data, null, 2));
}

// 列出所有 peers
async function listPeers() {
  const data = await loadPeersData();
  
  console.log('=== F2A Peers ===\n');
  
  if (data.myAgentId) {
    console.log(`My Agent ID: ${data.myAgentId}`);
    console.log(`Total peers: ${data.peers.length}\n`);
  } else {
    console.log('No identity configured. Run pairing first.\n');
    return;
  }
  
  if (data.peers.length === 0) {
    console.log('No peers connected yet.');
    console.log('Use "f2a pair host" to start pairing.');
    return;
  }
  
  data.peers.forEach((peer, index) => {
    const name = peer.metadata?.name || 'Unknown';
    const hostname = peer.metadata?.hostname || 'unknown-host';
    const lastSeen = new Date(peer.lastSeenAt).toLocaleString();
    
    console.log(`${index + 1}. ${name} (${hostname})`);
    console.log(`   Agent ID: ${peer.agentId}`);
    console.log(`   Last seen: ${lastSeen}`);
    console.log(`   Connected since: ${new Date(peer.connectedAt).toLocaleString()}`);
    console.log('');
  });
}

// 查看特定 peer 详情
async function showPeer(agentId) {
  const data = await loadPeersData();
  const peer = data.peers.find(p => p.agentId === agentId);
  
  if (!peer) {
    console.error(`Peer not found: ${agentId}`);
    process.exit(1);
  }
  
  console.log('=== Peer Details ===\n');
  console.log(`Agent ID: ${peer.agentId}`);
  console.log(`Public Key: ${peer.publicKey.substring(0, 50)}...`);
  console.log(`Connected at: ${new Date(peer.connectedAt).toLocaleString()}`);
  console.log(`Last seen at: ${new Date(peer.lastSeenAt).toLocaleString()}`);
  console.log('\nMetadata:');
  console.log(JSON.stringify(peer.metadata, null, 2));
}

// 删除 peer
async function removePeer(agentId) {
  const data = await loadPeersData();
  const initialCount = data.peers.length;
  
  data.peers = data.peers.filter(p => p.agentId !== agentId);
  
  if (data.peers.length === initialCount) {
    console.error(`Peer not found: ${agentId}`);
    process.exit(1);
  }
  
  await savePeersData(data);
  console.log(`Removed peer: ${agentId}`);
}

// 显示我的身份信息
async function showIdentity() {
  const data = await loadPeersData();
  
  if (!data.myAgentId) {
    console.log('No identity configured.');
    console.log('Run pairing to generate identity.');
    return;
  }
  
  console.log('=== My F2A Identity ===\n');
  console.log(`Agent ID: ${data.myAgentId}`);
  console.log(`Public Key: ${data.myKeyPair?.publicKey?.substring(0, 50)}...`);
  console.log(`Total peers: ${data.peers.length}`);
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'list':
      case undefined:
        await listPeers();
        break;
        
      case 'show':
        if (!args[1]) {
          console.error('Usage: node peers.js show <AGENT_ID>');
          process.exit(1);
        }
        await showPeer(args[1]);
        break;
        
      case 'remove':
      case 'rm':
        if (!args[1]) {
          console.error('Usage: node peers.js remove <AGENT_ID>');
          process.exit(1);
        }
        await removePeer(args[1]);
        break;
        
      case 'identity':
      case 'id':
        await showIdentity();
        break;
        
      default:
        console.log('Usage:');
        console.log('  node peers.js list              # List all peers');
        console.log('  node peers.js show <AGENT_ID>   # Show peer details');
        console.log('  node peers.js remove <AGENT_ID> # Remove a peer');
        console.log('  node peers.js identity          # Show my identity');
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
