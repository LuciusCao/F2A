#!/bin/bash
# F2A 局域网测试脚本
# 在两台设备上分别运行此脚本来测试发现和委托

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$HOME/.f2a-test-$(date +%s)"

echo "========================================"
echo "F2A Local Network Test"
echo "========================================"
echo ""
echo "Data directory: $DATA_DIR"
echo ""

# 检查是否已构建
if [ ! -d "$PROJECT_DIR/dist" ]; then
    echo "Building F2A..."
    cd "$PROJECT_DIR" && npm run build
fi

# 启动节点
echo "Starting F2A node..."
echo ""

node --input-type=module << 'EOF'
import { F2A } from './dist/core/f2a.js';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';

const dataDir = process.env.F2A_DATA_DIR || join(homedir(), '.f2a-test');
const agentName = process.env.F2A_AGENT_NAME || `agent-${Date.now().toString(36)}`;

console.log('Starting F2A node...');
console.log(`Agent name: ${agentName}`);
console.log(`Data dir: ${dataDir}`);
console.log('');

const f2a = await F2A.create({
    displayName: agentName,
    dataDir: dataDir,
    network: {
        enableMDNS: true,  // 启用 mDNS 发现
        enableDHT: false,
    }
});

// 注册一个测试能力
f2a.registerCapability({
    name: 'echo',
    description: 'Echo back the input',
    parameters: {
        type: 'object',
        properties: {
            message: { type: 'string' }
        }
    }
}, async (params) => {
    console.log(`[echo] Received: ${params.message}`);
    return { echoed: params.message, from: f2a.peerId.slice(0, 16) };
});

console.log('Registered capability: echo');

const result = await f2a.start();
if (!result.success) {
    console.error('Failed to start:', result.error);
    process.exit(1);
}

console.log('');
console.log('========================================');
console.log(`PeerId: ${f2a.peerId}`);
console.log('========================================');
console.log('');

// 定时发现其他节点
setInterval(async () => {
    const peers = f2a.getConnectedPeers();
    const allPeers = f2a.getAllPeers();
    console.log(`[Discovery] Connected: ${peers.length}, Known: ${allPeers.length}`);
    if (peers.length > 0) {
        peers.forEach(p => {
            console.log(`  - ${p.peerId.slice(0, 16)}... (${p.displayName || 'unknown'})`);
        });
    }
}, 10000);

// 监听事件
f2a.on('peer:discovered', (event) => {
    console.log(`[Event] Peer discovered: ${event.peerId.slice(0, 16)}...`);
});

f2a.on('peer:connected', (event) => {
    console.log(`[Event] Peer connected: ${event.peerId.slice(0, 16)}...`);
});

f2a.on('peer:disconnected', (event) => {
    console.log(`[Event] Peer disconnected: ${event.peerId.slice(0, 16)}...`);
});

// CLI 交互
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const showHelp = () => {
    console.log('');
    console.log('Commands:');
    console.log('  peers     - Show discovered peers');
    console.log('  delegate  - Delegate echo task to network');
    console.log('  help      - Show this help');
    console.log('  quit      - Stop and exit');
    console.log('');
};

showHelp();

rl.on('line', async (input) => {
    const cmd = input.trim().toLowerCase();
    
    if (cmd === 'quit' || cmd === 'exit') {
        console.log('Stopping...');
        await f2a.stop();
        rl.close();
        process.exit(0);
    } else if (cmd === 'peers') {
        const peers = f2a.getConnectedPeers();
        const allPeers = f2a.getAllPeers();
        console.log(`Connected peers: ${peers.length}`);
        console.log(`All known peers: ${allPeers.length}`);
        [...peers, ...allPeers.filter(p => !peers.includes(p))].forEach(p => {
            console.log(`  - ${p.peerId.slice(0, 16)}... (${p.displayName || 'unknown'})`);
        });
    } else if (cmd === 'delegate') {
        console.log('Delegating echo task...');
        const result = await f2a.delegateTask({
            capability: 'echo',
            description: 'Test echo task',
            parameters: { message: `Hello from ${agentName}!` },
            timeout: 30000,
        });
        if (result.success) {
            console.log('Delegate result:', JSON.stringify(result.data, null, 2));
        } else {
            console.log('Delegate failed:', result.error);
        }
    } else if (cmd === 'help') {
        showHelp();
    } else {
        console.log('Unknown command. Type "help" for available commands.');
    }
});

// 优雅退出
process.on('SIGINT', async () => {
    console.log('\nStopping...');
    await f2a.stop();
    process.exit(0);
});
EOF