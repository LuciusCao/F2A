#!/usr/bin/env node
// 测试双向通信 - Mac-mini 发送消息并等待回复
import { F2A } from './dist/core/f2a.js';
import { homedir } from 'os';
import { join } from 'path';

const agentName = 'Mac-mini';
const dataDir = join(homedir(), '.f2a-chat-test');

console.log(`\n🐱 Mac-mini P2P Chat Test\n`);

const f2a = await F2A.create({
    displayName: agentName,
    dataDir: dataDir,
    network: { enableMDNS: true, enableDHT: false }
});

// 监听回复
f2a.on('message', (msg) => {
    console.log('\n🎉 收到回复！');
    console.log('   来自: ' + (msg.metadata?.from || msg.from.slice(0, 20)));
    console.log('   内容: ' + msg.content);
    console.log('');
});

f2a.on('peer:connected', (e) => console.log('🤝 连接到: ' + e.peerId.slice(0, 20)));

await f2a.start();
console.log('✅ 已启动: ' + f2a.peerId.slice(0, 30));

// 发现节点
console.log('\n⏳ 发现节点...');
await f2a.discoverAgents();
await new Promise(r => setTimeout(r, 3000));

const peers = f2a.getConnectedPeers();
console.log('📊 已连接: ' + peers.length + ' 个节点');

if (peers.length > 0) {
    const target = peers.find(p => p.displayName === 'CatPi') || peers[0];
    console.log('\n📤 发送消息给 ' + target.displayName + '...');
    
    const result = await f2a.sendMessage(
        target.peerId, 
        '🐱 喵喵！Mac-mini 呼叫 CatPi！你能收到吗？收到请回复！', 
        { type: 'chat', from: agentName }
    );
    
    if (result.success) {
        console.log('✅ 消息已发送！等待回复...\n');
        
        // 等待回复
        console.log('👂 等待回复 (30秒)...');
        await new Promise(r => setTimeout(r, 30000));
    } else {
        console.log('❌ 发送失败: ' + result.error);
    }
} else {
    console.log('❌ 没有连接的节点');
}

console.log('\n🛑 停止...');
await f2a.stop();
console.log('👋 完成！');