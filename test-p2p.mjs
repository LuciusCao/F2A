#!/usr/bin/env node
// P2P 消息和任务委托测试
// 用法: node test-p2p.mjs [discover|send|delegate]

import { F2A } from './dist/core/f2a.js';
import { homedir } from 'os';
import { join } from 'path';

const CATPI_PEER_ID = '12D3KooWBGeTvTxA54X2rebUsdV5KQUCuUtvWz5Y127SHeb9tejH';
const MACMINI_PEER_ID = '12D3KooWGovjTGt1ecwtxxE7zxfzhUM4J71jSaBaojgHzhoQpgjT';

const mode = process.argv[2] || 'discover';

async function main() {
    const isCatPi = process.env.HOSTNAME?.includes('CatPi') || process.env.USER === 'lucius' && process.platform !== 'darwin';
    const agentName = isCatPi ? 'CatPi' : 'Mac-mini';
    const dataDir = join(homedir(), '.f2a-test-' + Date.now());
    
    console.log(`\n🐱 Starting F2A P2P Test`);
    console.log(`   Agent: ${agentName}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Data: ${dataDir}\n`);
    
    const f2a = await F2A.create({
        displayName: agentName,
        dataDir: dataDir,
        network: {
            enableMDNS: true,
            enableDHT: false,
        }
    });
    
    // 注册 echo 能力
    f2a.registerCapability({
        name: 'echo',
        description: 'Echo back the input message',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string' }
            },
            required: ['message']
        }
    }, async (params) => {
        console.log(`\n📨 [echo] Received: "${params.message}"`);
        return { 
            echoed: params.message, 
            from: agentName,
            timestamp: new Date().toISOString()
        };
    });
    
    console.log('✅ Registered capability: echo');
    
    // 监听事件
    f2a.on('peer:discovered', (event) => {
        console.log(`🔍 Peer discovered: ${event.peerId.slice(0, 20)}...`);
    });
    
    f2a.on('peer:connected', (event) => {
        console.log(`🤝 Peer connected: ${event.peerId.slice(0, 20)}...`);
    });
    
    f2a.on('peer:disconnected', (event) => {
        console.log(`👋 Peer disconnected: ${event.peerId.slice(0, 20)}...`);
    });
    
    const result = await f2a.start();
    if (!result.success) {
        console.error('❌ Failed to start:', result.error);
        process.exit(1);
    }
    
    console.log(`\n✅ F2A started`);
    console.log(`   PeerId: ${f2a.peerId}\n`);
    
    // 等待发现和连接
    console.log('⏳ Discovering peers (15s)...');
    await f2a.discoverPeers(15000);
    
    const peers = f2a.getConnectedPeers();
    console.log(`\n📊 Connected peers: ${peers.length}`);
    peers.forEach(p => {
        console.log(`   - ${p.displayName || 'unknown'} (${p.peerId.slice(0, 20)}...)`);
    });
    
    if (mode === 'discover') {
        console.log('\n✅ Discovery complete. Use "send" or "delegate" mode for messaging.');
    }
    
    if (mode === 'send' && !isCatPi) {
        // Mac-mini 发送消息给 CatPi
        if (peers.length > 0) {
            const targetPeer = peers.find(p => p.displayName === 'CatPi') || peers[0];
            console.log(`\n📤 Sending message to ${targetPeer.displayName}...`);
            
            const sendResult = await f2a.sendMessage(targetPeer.peerId, 
                '🐱 喵喵！我是 Mac-mini 上的猫猫助手！收到请回复！', 
                { type: 'greeting', from: agentName }
            );
            
            if (sendResult.success) {
                console.log('✅ Message sent successfully!');
            } else {
                console.log('❌ Failed to send:', sendResult.error);
            }
        } else {
            console.log('❌ No peers connected, cannot send message');
        }
    }
    
    if (mode === 'delegate' && !isCatPi) {
        // Mac-mini 委托任务给 CatPi
        if (peers.length > 0) {
            const targetPeer = peers.find(p => p.displayName === 'CatPi') || peers[0];
            console.log(`\n📤 Delegating echo task to ${targetPeer.displayName}...`);
            
            const taskResult = await f2a.delegateTask({
                capability: 'echo',
                description: 'Test echo from Mac-mini',
                parameters: { message: 'Hello CatPi! 🐱 这是一条测试消息！' },
                timeout: 30000,
            });
            
            if (taskResult.success) {
                console.log('\n✅ Task completed!');
                console.log('   Result:', JSON.stringify(taskResult.data, null, 2));
            } else {
                console.log('❌ Task failed:', taskResult.error);
            }
        } else {
            console.log('❌ No peers connected, cannot delegate task');
        }
    }
    
    if (isCatPi || mode === 'listen') {
        // CatPi 保持运行，等待消息
        console.log('\n👂 Listening for messages (60s)...');
        await new Promise(r => setTimeout(r, 60000));
    }
    
    console.log('\n🛑 Stopping...');
    await f2a.stop();
    console.log('👋 Done!');
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});