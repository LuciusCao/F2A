/**
 * F2A Rendezvous Server
 * 
 * 功能：
 * 1. Agent A 注册配对码，等待连接
 * 2. Agent B 通过配对码查询，获取 A 的连接信息
 * 3. 交换双方地址，建立 P2P 连接
 * 4. UDP 自动发现服务（局域网内自动发现）
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');

// 配置
const PORT = process.env.PORT || 8765;
const DISCOVERY_PORT = process.env.DISCOVERY_PORT || 8766;
const PAIR_CODE_TTL = 5 * 60 * 1000; // 5分钟过期
const CLEANUP_INTERVAL = 60 * 1000; // 每分钟清理过期码

// 存储：配对码 -> { agentA, agentB, createdAt, wsA, wsB }
const pendingPairs = new Map();

// 获取本机 IP 地址
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过内部地址和非 IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 生成6位随机配对码
function generatePairCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// 清理过期配对码
function cleanupExpiredPairs() {
  const now = Date.now();
  for (const [code, data] of pendingPairs) {
    if (now - data.createdAt > PAIR_CODE_TTL) {
      // 关闭连接
      if (data.wsA && data.wsA.readyState === WebSocket.OPEN) {
        data.wsA.close(1000, 'Pair code expired');
      }
      if (data.wsB && data.wsB.readyState === WebSocket.OPEN) {
        data.wsB.close(1000, 'Pair code expired');
      }
      pendingPairs.delete(code);
      console.log(`[Cleanup] Expired pair code: ${code}`);
    }
  }
}

// 启动清理定时器
setInterval(cleanupExpiredPairs, CLEANUP_INTERVAL);

// 创建 HTTP server（用于健康检查）
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      pendingPairs: pendingPairs.size,
      uptime: process.uptime()
    }));
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

// 创建 WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  console.log(`[Connection] ${path} from ${req.socket.remoteAddress}`);
  
  // Agent A 注册配对码: /register
  if (path === '/register') {
    handleAgentA(ws);
    return;
  }
  
  // Agent B 加入配对: /pair/:code
  const pairMatch = path.match(/^\/pair\/([A-F0-9]{6})$/i);
  if (pairMatch) {
    const pairCode = pairMatch[1].toUpperCase();
    handleAgentB(ws, pairCode);
    return;
  }
  
  // 未知路径
  ws.close(1002, 'Invalid path');
});

// Agent A 处理：生成配对码，等待 B
function handleAgentA(ws) {
  const pairCode = generatePairCode();
  
  pendingPairs.set(pairCode, {
    agentA: null, // 将在收到消息后填充
    agentB: null,
    wsA: ws,
    wsB: null,
    createdAt: Date.now(),
    status: 'waiting' // waiting | paired | completed
  });
  
  console.log(`[AgentA] Registered with pair code: ${pairCode}`);
  
  // 发送配对码给 A
  ws.send(JSON.stringify({
    type: 'pair_code',
    code: pairCode,
    ttl: PAIR_CODE_TTL,
    expiresAt: Date.now() + PAIR_CODE_TTL
  }));
  
  // 等待 A 发送身份信息
  ws.once('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'identity') {
        const pair = pendingPairs.get(pairCode);
        if (pair) {
          pair.agentA = {
            publicKey: msg.publicKey,
            agentId: msg.agentId,
            metadata: msg.metadata || {}
          };
          console.log(`[AgentA] Identity received: ${msg.agentId}`);
        }
      }
    } catch (err) {
      console.error('[AgentA] Invalid message:', err.message);
    }
  });
  
  // 清理
  ws.on('close', () => {
    const pair = pendingPairs.get(pairCode);
    if (pair && pair.status !== 'completed') {
      pendingPairs.delete(pairCode);
      console.log(`[AgentA] Disconnected, removed pair code: ${pairCode}`);
    }
  });
}

// Agent B 处理：通过配对码加入
function handleAgentB(ws, pairCode) {
  const pair = pendingPairs.get(pairCode);
  
  if (!pair) {
    ws.close(1008, 'Invalid or expired pair code');
    return;
  }
  
  if (pair.status !== 'waiting') {
    ws.close(1008, 'Pair code already used');
    return;
  }
  
  pair.wsB = ws;
  pair.status = 'paired';
  
  console.log(`[AgentB] Joined pair: ${pairCode}`);
  
  // 等待 B 发送身份信息
  ws.once('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'identity') {
        pair.agentB = {
          publicKey: msg.publicKey,
          agentId: msg.agentId,
          metadata: msg.metadata || {}
        };
        console.log(`[AgentB] Identity received: ${msg.agentId}`);
        
        // 交换身份信息
        completePairing(pairCode);
      }
    } catch (err) {
      console.error('[AgentB] Invalid message:', err.message);
    }
  });
  
  ws.on('close', () => {
    if (pair.status !== 'completed') {
      pair.status = 'waiting';
      pair.wsB = null;
      pair.agentB = null;
      console.log(`[AgentB] Disconnected, pair ${pairCode} back to waiting`);
    }
  });
}

// 完成配对，交换双方信息
function completePairing(pairCode) {
  const pair = pendingPairs.get(pairCode);
  if (!pair || !pair.agentA || !pair.agentB) return;
  
  pair.status = 'completed';
  
  // 给 A 发送 B 的信息
  if (pair.wsA.readyState === WebSocket.OPEN) {
    pair.wsA.send(JSON.stringify({
      type: 'peer_connected',
      peer: {
        agentId: pair.agentB.agentId,
        publicKey: pair.agentB.publicKey,
        metadata: pair.agentB.metadata
      },
      // 如果 B 有公网地址，也告诉 A
      peerAddress: pair.wsB._socket?.remoteAddress
    }));
  }
  
  // 给 B 发送 A 的信息
  if (pair.wsB.readyState === WebSocket.OPEN) {
    pair.wsB.send(JSON.stringify({
      type: 'peer_connected',
      peer: {
        agentId: pair.agentA.agentId,
        publicKey: pair.agentA.publicKey,
        metadata: pair.agentA.metadata
      },
      peerAddress: pair.wsA._socket?.remoteAddress
    }));
  }
  
  console.log(`[Pairing] Completed: ${pair.agentA.agentId} <-> ${pair.agentB.agentId}`);
  
  // 延迟清理（给双方时间建立直接连接）
  setTimeout(() => {
    pendingPairs.delete(pairCode);
    console.log(`[Cleanup] Removed completed pair: ${pairCode}`);
  }, 30000); // 30秒后清理
}

// 启动 server
server.listen(PORT, () => {
  console.log(`[F2A Rendezvous Server] Running on port ${PORT}`);
  console.log(`[Config] Pair code TTL: ${PAIR_CODE_TTL / 1000}s`);
  
  // 启动 UDP 发现服务
  startDiscoveryService();
});

// UDP 自动发现服务
function startDiscoveryService() {
  const udpServer = dgram.createSocket('udp4');
  
  udpServer.on('message', (msg, rinfo) => {
    const message = msg.toString();
    
    if (message === 'F2A_DISCOVER') {
      // 响应发现请求
      const localIP = getLocalIP();
      const response = JSON.stringify({
        type: 'F2A_HERE',
        server: `ws://${localIP}:${PORT}`,
        version: '1.0.0',
        uptime: Math.floor(process.uptime()),
        pendingPairs: pendingPairs.size
      });
      
      udpServer.send(response, rinfo.port, rinfo.address, (err) => {
        if (err) {
          console.error('[Discovery] Send error:', err.message);
        } else {
          console.log(`[Discovery] Responded to ${rinfo.address}:${rinfo.port}`);
        }
      });
    }
  });
  
  udpServer.on('error', (err) => {
    console.error('[Discovery] UDP error:', err.message);
  });
  
  udpServer.bind(DISCOVERY_PORT, () => {
    console.log(`[Discovery] UDP service running on port ${DISCOVERY_PORT}`);
  });
  
  return udpServer;
}

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM received, closing connections...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
