---
name: f2a-network
description: Activate when the user wants to discover, connect, or communicate with other OpenClaw Agents in the local network. Use for P2P networking, messaging between agents, invoking skills on remote agents, file sharing, or group chat. Triggers include phrases like "find other agents", "connect to peer", "send message to agent", "call skill on remote agent", "share file with agent", or "create group chat".
---

# F2A Agent 使用指南

## 何时使用

当用户需要：
- 发现局域网内的其他 Agent
- 连接到特定 Agent
- 发送消息给其他 Agent
- 在其他 Agent 上执行技能
- 分享文件给其他 Agent
- 创建群组聊天

## 核心工具

### 1. 启动 P2P 网络

**用户说**: "启动 F2A" / "开始 P2P 网络"

**执行**:
```javascript
const { ServerlessP2P } = require('./scripts/serverless');
const crypto = require('crypto');

// 生成或使用已有身份
const keyPair = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const p2p = new ServerlessP2P({
  myAgentId: process.env.F2A_AGENT_ID || crypto.randomUUID(),
  myPublicKey: keyPair.publicKey,
  myPrivateKey: keyPair.privateKey,
  p2pPort: process.env.F2A_PORT || 9000,
  security: {
    level: 'medium',
    requireConfirmation: true
  }
});

await p2p.start();

// 监听发现事件
p2p.on('agent_discovered', ({ agentId, address, port }) => {
  notifyUser(`发现 Agent: ${agentId.slice(0, 8)}... 在 ${address}:${port}`);
});

// 监听连接确认
p2p.on('confirmation_required', ({ agentId, accept, reject }) => {
  askUser(`是否允许 ${agentId.slice(0, 8)}... 连接?`, {
    onYes: () => accept(),
    onNo: () => reject()
  });
});
```

### 1.1 启动后台服务（推荐）

**用户说**: "启动 F2A 后台服务" / "让 F2A 持续运行"

**执行**:
```bash
# 使用 nohup 启动后台服务（推荐方式）
nohup node start-daemon.js start > /dev/null 2>&1 &

# 或使用环境变量指定配置
F2A_AGENT_ID="my-agent" F2A_PORT=9000 nohup node start-daemon.js start > /dev/null 2>&1 &

# 查看状态
node start-daemon.js status

# 停止服务
node start-daemon.js stop
```

**或使用 npm 命令**:
```bash
npm run daemon:start   # 启动（需要配合 nohup 使用）
npm run daemon:status  # 查看状态
npm run daemon:stop    # 停止
```

**Node.js 方式**:
```javascript
const { spawn, execSync } = require('child_process');

// 启动后台进程（使用 nohup 确保进程在后台持续运行）
const daemon = spawn('nohup', ['node', 'start-daemon.js', 'start'], {
  detached: true,
  stdio: 'ignore'
});

daemon.unref();
tellUser('F2A 后台服务已启动');

// 查看状态
const status = execSync('node start-daemon.js status').toString();
tellUser(status);

// 停止服务
execSync('node start-daemon.js stop');
tellUser('F2A 后台服务已停止');
```

### 2. 发现 Agents

**用户说**: "发现其他 Agent" / "搜索局域网内的 Agent"

**执行**:
```javascript
const agents = p2p.getDiscoveredAgents();
if (agents.length === 0) {
  tellUser("未发现其他 Agent，请确保其他 Agent 已启动并在同一局域网");
} else {
  tellUser(`发现 ${agents.length} 个 Agent:`);
  agents.forEach(a => {
    tellUser(`- ${a.agentId.slice(0, 8)}... 在 ${a.address}:${a.port}`);
  });
}
```

### 3. 连接到 Agent

**用户说**: "连接到 [agent-id]" / "连接第一个发现的 Agent"

**执行**:
```javascript
// 通过 ID 连接
await p2p.connectToAgent(agentId, address, port);
tellUser(`已连接到 ${agentId.slice(0, 8)}...`);

// 或连接第一个发现的
const agents = p2p.getDiscoveredAgents();
if (agents.length > 0) {
  const first = agents[0];
  await p2p.connectToAgent(first.agentId, first.address, first.port);
}
```

### 4. 发送消息

**用户说**: "发送消息给 [agent-id]: [内容]"

**执行**:
```javascript
p2p.sendToPeer(agentId, {
  type: 'message',
  content: messageContent,
  timestamp: Date.now()
});
tellUser(`消息已发送给 ${agentId.slice(0, 8)}...`);
```

### 5. 调用远程技能

**用户说**: "在 [agent-id] 上执行 [skill-name]" / "调用 [agent] 的 [skill]"

**执行**:
```javascript
// 先查询技能
const skills = await querySkills(agentId);
tellUser(`该 Agent 有 ${skills.length} 个技能: ${skills.map(s => s.name).join(', ')}`);

// 调用特定技能
const result = await invokeSkill(agentId, skillName, parameters);
tellUser(`执行结果: ${JSON.stringify(result)}`);
```

### 6. 分享文件

**用户说**: "发送文件 [path] 给 [agent-id]"

**执行**:
```javascript
const fileId = await sendFile(agentId, filePath);
tellUser(`文件发送中，ID: ${fileId}`);

// 监听进度
p2p.on('file_progress', ({ fileId, progress }) => {
  tellUser(`文件传输进度: ${Math.round(progress * 100)}%`);
});
```

### 7. 创建群聊

**用户说**: "创建群组 [name]" / "创建群聊"

**执行**:
```javascript
const groupId = createGroup(groupName);
tellUser(`群组 "${groupName}" 创建成功，ID: ${groupId.slice(0, 8)}...`);

// 邀请成员
connectedPeers.forEach(peerId => {
  inviteToGroup(groupId, peerId);
  tellUser(`已邀请 ${peerId.slice(0, 8)}...`);
});
```

### 8. 发送群消息

**用户说**: "在群组 [group-id] 发送: [内容]"

**执行**:
```javascript
sendGroupMessage(groupId, messageContent);
tellUser(`消息已发送到群组`);
```

## 事件处理

当收到消息时，通知用户：

```javascript
p2p.on('message', ({ peerId, message }) => {
  if (message.type === 'message') {
    tellUser(`收到来自 ${peerId.slice(0, 8)}... 的消息: ${message.content}`);
  } else if (message.type === 'skill_result') {
    tellUser(`技能执行结果: ${JSON.stringify(message.result)}`);
  }
});

p2p.on('group_message', ({ groupId, groupName, from, content }) => {
  tellUser(`[${groupName}] ${from.slice(0, 8)}...: ${content}`);
});
```

## 安全提示

- 新连接默认需要用户确认
- 只接受已验证身份的 Agent
- 所有通信自动端到端加密
- 可配置白名单/黑名单

## 环境变量

- `F2A_AGENT_ID` - 指定 Agent ID
- `F2A_PORT` - 指定 P2P 端口 (默认 9000)
- `F2A_SECURITY_LEVEL` - 安全等级 (low/medium/high)
