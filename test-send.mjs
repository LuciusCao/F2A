#!/usr/bin/env node
// P2P 发送脚本 - 在 Mac-mini 上运行
import { F2A } from './dist/core/f2a.js';
import { homedir } from 'os';
import { join } from 'path';

const agentName = 'Mac-mini';
const dataDir = join(homedir(), '.f2a-test-' + Date.now());

console.log(`\n🐱 Starting F2A P2P Test on ${agentName}`);

const f2a = await F2A.create({
    displayName: agentName,
    dataDir: dataDir,
    network: { enableMDNS: true, enableDHT: false }
});

// 注册 echo 能力
f2a.registerCapability({
    name: 'echo',
    description: 'Echo',
    parameters: { type: 'object', properties: { message: { type: 'string' } } }
}, async (params) => {
    console.log(`\n📨 [echo] Received: ${params.message}`);
    return { echoed: params.message, from: agentName };
});

// 监听事件
f2a.on('peer:connected', (e) => console.log(`🤝 Connected: ${e.peerId.slice(0, 20)}`));
f2a.on('peer:discovered', (e) => console.log(`🔍 Discovered: ${e.peerId.slice(0, 20)}`));

await f2a.start();
console.log(`✅ Started: ${f2a.peerId.slice(0, 30)}`);

// 发现 peers
console.log('\n⏳ Discovering peers (20s)...');
const agents = await f2a.discoverAgents();
console.log(`📊 Discovered ${agents.length} agents`);

// 等待连接建立
await new Promise(r => setTimeout(r, 5000));

const peers = f2a.getConnectedPeers();
console.log(`📊 Connected: ${peers.length} peers`);
peers.forEach(p => console.log(`   - ${p.displayName} (${p.peerId.slice(0, 20)}...)`));

if (peers.length > 0) {
    const target = peers.find(p => p.displayName === 'CatPi') || peers[0];
    console.log(`\n📤 Sending message to ${target.displayName}...`);
    
    const sendResult = await f2a.sendMessage(target.peerId, 
        '🐱 喵喵！我是 Mac-mini 上的猫猫助手！收到请回复！', 
        { type: 'greeting', from: agentName }
    );
    
    if (sendResult.success) {
        console.log('✅ Message sent!');
    } else {
        console.log('❌ Send failed:', sendResult.error);
    }
    
    // 等待一下再委托
    await new Promise(r => setTimeout(r, 2000));
    
    console.log(`\n📤 Delegating echo task to ${target.displayName}...`);
    const taskResult = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test from Mac-mini',
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
    console.log('❌ No peers connected');
}

console.log('\n🛑 Stopping...');
await f2a.stop();
console.log('👋 Done!');