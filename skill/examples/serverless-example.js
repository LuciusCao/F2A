/**
 * F2A Serverless Example
 * 
 * 无 Server 模式使用示例
 */

const { ServerlessP2P } = require('./serverless');
const { E2ECrypto } = require('./crypto');
const crypto = require('crypto');

// 生成身份
function generateIdentity() {
  const keyPair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  return {
    agentId: crypto.randomUUID(),
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey
  };
}

async function main() {
  // 创建身份
  const identity = generateIdentity();
  console.log(`Agent ID: ${identity.agentId}`);
  console.log(`Public Key: ${identity.publicKey.slice(0, 50)}...`);
  
  // 创建 Serverless P2P 实例
  const p2p = new ServerlessP2P({
    myAgentId: identity.agentId,
    myPublicKey: identity.publicKey,
    myPrivateKey: identity.privateKey,
    p2pPort: 9000,  // 监听端口
    security: {
      level: 'medium',  // low | medium | high
      requireConfirmation: true,  // 新连接需要手动确认
      whitelist: [],  // 预配置的信任列表
      rateLimit: { maxRequests: 10, windowMs: 60000 }
    }
  });
  
  // 事件监听
  p2p.on('started', ({ port }) => {
    console.log(`\n🚀 Serverless P2P started on port ${port}`);
    console.log('Waiting for peers...\n');
  });
  
  p2p.on('agent_discovered', ({ agentId, address, port }) => {
    console.log(`🔍 Discovered: ${agentId.slice(0, 8)}... at ${address}:${port}`);
  });
  
  p2p.on('peer_connected', ({ agentId }) => {
    console.log(`✅ Peer connected: ${agentId.slice(0, 8)}...`);
  });
  
  p2p.on('peer_disconnected', ({ agentId }) => {
    console.log(`❌ Peer disconnected: ${agentId.slice(0, 8)}...`);
  });
  
  p2p.on('confirmation_required', ({ agentId, accept, reject }) => {
    console.log(`\n⚠️  Connection request from: ${agentId.slice(0, 8)}...`);
    console.log('Auto-accepting in 5 seconds... (Ctrl+C to reject)');
    
    // 实际应用中这里应该显示 UI 对话框
    setTimeout(() => {
      accept();
      console.log('Accepted!\n');
    }, 5000);
  });
  
  p2p.on('message', ({ peerId, message }) => {
    console.log(`\n💬 Message from ${peerId.slice(0, 8)}...:`);
    console.log(JSON.stringify(message, null, 2));
  });
  
  // 启动
  await p2p.start();
  
  // 命令行交互
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('\nCommands:');
  console.log('  /list          - List discovered agents');
  console.log('  /peers         - List connected peers');
  console.log('  /connect <id>  - Connect to agent by ID');
  console.log('  /msg <id> <text> - Send message to peer');
  console.log('  /broadcast <text> - Broadcast to all peers');
  console.log('  /quit          - Exit\n');
  
  rl.on('line', (line) => {
    const [cmd, ...args] = line.trim().split(' ');
    
    switch (cmd) {
      case '/list':
        const agents = p2p.getDiscoveredAgents();
        console.log(`\nDiscovered agents (${agents.length}):`);
        agents.forEach(a => {
          console.log(`  ${a.agentId.slice(0, 8)}... at ${a.address}:${a.port}`);
        });
        console.log();
        break;
        
      case '/peers':
        const peers = p2p.getConnectedPeers();
        console.log(`\nConnected peers (${peers.length}):`);
        peers.forEach(id => {
          console.log(`  ${id.slice(0, 8)}...`);
        });
        console.log();
        break;
        
      case '/connect':
        if (args[0]) {
          const agent = p2p.getDiscoveredAgents().find(a => a.agentId.startsWith(args[0]));
          if (agent) {
            console.log(`Connecting to ${agent.agentId.slice(0, 8)}...`);
            p2p.connectToAgent(agent.agentId, agent.address, agent.port)
              .then(() => console.log('Connected!'))
              .catch(err => console.log('Failed:', err.message));
          } else {
            console.log('Agent not found');
          }
        }
        break;
        
      case '/msg':
        if (args.length >= 2) {
          const peerId = args[0];
          const text = args.slice(1).join(' ');
          const fullPeerId = p2p.getConnectedPeers().find(id => id.startsWith(peerId));
          if (fullPeerId) {
            p2p.sendToPeer(fullPeerId, { type: 'chat', content: text });
            console.log('Sent!');
          } else {
            console.log('Peer not connected');
          }
        }
        break;
        
      case '/broadcast':
        if (args.length > 0) {
          const text = args.join(' ');
          p2p.broadcast({ type: 'chat', content: text });
          console.log('Broadcasted!');
        }
        break;
        
      case '/quit':
        p2p.stop();
        rl.close();
        process.exit(0);
        break;
        
      default:
        if (line.trim()) {
          console.log('Unknown command');
        }
    }
  });
}

main().catch(console.error);
