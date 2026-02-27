---
name: f2a-network
description: F2A P2P networking skill for OpenClaw. Enables agents to discover and connect with each other using temporary pairing codes, exchange public keys, and establish trusted peer relationships for skill sharing, messaging, file transfer, and collaborative tasks with end-to-end encryption and WebRTC support.
license: MIT
compatibility: Requires Node.js 18+, network access to rendezvous server, WebSocket support, and optional wrtc package for WebRTC.
metadata:
  author: f2a-project
  version: "0.2.0"
  rendezvous-server: "ws://localhost:8765"
---

# F2A

> 💡 **名字由来**: F2A = **F2** (选中所有单位) + **A** (A过去)，灵感来自星际争霸中神族的"卡拉"心灵连接——让所有 Agent 像神族战士一样连接成一个整体，然后一起"A过去"解决问题！

本 skill 让 OpenClaw Agent 能够：

1. **自动发现服务器** — 局域网内自动找到 F2A Server，无需手动配置
2. **生成配对码** — 暴露限时配对码（默认5分钟），等待其他 Agent 连接
3. **加入配对** — 通过配对码发现并连接其他 Agent
4. **交换身份** — 安全地交换公钥和 Agent ID，建立信任关系
5. **消息通信** — 端到端加密的消息传输 💬
6. **技能调用** — 查询和远程执行 peer 的技能 🛠️
7. **文件分享** — 安全的文件传输 📁
8. **WebRTC 直连** — NAT 穿透，P2P 直连 🔗

## 新特性 (v0.2.0)

### 🔐 端到端加密
- 使用 ECDH (X25519) 密钥交换
- AES-256-GCM 对称加密
- 自动密钥派生和管理

### 🔗 WebRTC 直连
- 自动尝试 P2P 直连
- STUN/TURN 服务器支持
- 失败自动回退到 WebSocket

### 💬 Agent 协作
- 实时消息通信
- 技能查询和远程调用
- 文件分块传输

## 快速开始

```javascript
const { F2A } = require('./scripts');

// 初始化（默认启用加密和 WebRTC）
const f2a = new F2A();
await f2a.initialize();

// 连接到 peer
await f2a.connect(peerId, 'ws://192.168.1.100:9000');

// 查看连接类型
console.log(f2a.getConnectionType(peerId)); // 'webrtc' 或 'websocket'

// 发送加密消息
await f2a.sendMessage(peerId, 'Hello!');

// 查询技能
const skills = await f2a.querySkills(peerId);

// 调用技能
const result = await f2a.invokeSkill(peerId, 'weather', { location: '北京' });

// 发送文件
await f2a.sendFile(peerId, './document.pdf');

// 创建群组
const groupId = f2a.createGroup('开发讨论组');

// 邀请成员
await f2a.inviteToGroup(groupId, peerB);
await f2a.inviteToGroup(groupId, peerC);

// 发送群消息
f2a.sendGroupMessage(groupId, '大家好！');

// 监听群消息
f2a.on('group_message', ({ groupId, groupName, from, content }) => {
  console.log(`[${groupName}] ${from}: ${content}`);
});
```

## 配置选项

```javascript
const f2a = new F2A({
  useWebRTC: true,      // 启用 WebRTC 直连（默认 true）
  useEncryption: true,  // 启用端到端加密（默认 true）
  
  webrtc: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  },
  
  p2p: {
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000
  }
});
```

## 核心概念

### Rendezvous Server

会合服务器，帮助 Agent 发现彼此。Agent A 和 B 通过 rendezvous server 交换连接信息，然后建立直接连接。

默认配置：`ws://localhost:8765`

### 自动发现

F2A Skill 支持自动发现局域网内的服务器：
- 启动时自动广播 UDP 发现请求
- 自动连接到第一个发现的服务器
- 无需手动配置服务器地址

### Pairing Code

6位大写字母数字组合（如 `A3B7C9`），有效期5分钟。用于一次性配对。

### Peer

已建立信任关系的 Agent。包含：
- `agentId`: 唯一标识
- `publicKey`: Ed25519 公钥（用于验证身份）
- `metadata`: 可选元数据（名称、描述等）
- `connectedAt`: 首次连接时间

## 使用方法

### 1. 自动发现服务器（推荐）

```
启动 F2A 配对
```

Agent 会：
1. 🔍 自动搜索局域网内的 F2A Server
2. ✅ 连接到发现的服务器
3. 🎯 生成配对码
4. ⏳ 等待其他 Agent 加入

**输出示例**：
```
🔍 正在搜索 F2A Server...
✅ 自动发现服务器: ws://192.168.1.100:8765
🎯 配对码: X7K9M2 (有效期5分钟)
等待其他 Agent 接入...
```

### 2. 启动配对（指定服务器）

如果自动发现失败或需要连接特定服务器：

```
设置 F2A rendezvous server 为 ws://your-server.com:8765
启动 F2A 配对
```

### 3. 加入配对

```
加入 F2A 配对，配对码是 X7K9M2
```

Agent 会：
1. 🔍 自动发现或连接到配置的 Server
2. 🔗 使用配对码加入
3. 💱 交换身份信息
4. 💾 保存 peer 到 `memory/f2a/peers.json`

### 4. 查看已连接的 Peers

```
列出我的 F2A peers
```

## 自动发现机制

### 发现流程

```
Agent                          局域网                    F2A Server
   |                              |                           |
   |-- UDP广播 "F2A_DISCOVER" --->|                           |
   |                              |---- "发现请求" ----------->|
   |                              |                           |
   |                              |<--- {"type":"F2A_HERE", -----|
   |                              |      "server":"ws://..."}  |
   |<-- 收到服务器地址 -----------|                           |
   |                              |                           |
   |-- WebSocket 连接到服务器 -------------------------------->|
```

### 发现顺序

1. **UDP广播发现** — 向局域网广播发现请求
2. **候选服务器** — 尝试连接预设的常用地址
3. **环境变量** — 使用 `F2A_RENDEZVOUS` 指定的地址
4. **默认本地** — 连接 `ws://localhost:8765`

### 测试发现功能

```bash
cd f2a-skill/scripts
node discover.js
```

输出：
```
🔍 正在搜索 F2A Server...
[Discovery] Broadcasting...
[Discovery] Found server: ws://192.168.1.100:8765 (from 192.168.1.100)
✅ 自动发现服务器: ws://192.168.1.100:8765

🎯 Result: ws://192.168.1.100:8765
```

## 存储结构

Peers 存储在 `memory/f2a/peers.json`：

```json
{
  "peers": [
    {
      "agentId": "agent-uuid-1",
      "publicKey": "base64-public-key",
      "metadata": {
        "name": "Home Agent",
        "description": "Running on home server"
      },
      "connectedAt": "2024-01-15T08:30:00Z",
      "lastSeenAt": "2024-01-15T10:00:00Z"
    }
  ],
  "myAgentId": "my-uuid",
  "myKeyPair": {
    "publicKey": "base64-public-key",
    "privateKey": "encrypted-private-key"
  }
}
```

## 故障排查

### 无法发现服务器

检查：
1. F2A Server 是否运行
2. 防火墙是否放行 UDP 8766（发现端口）
3. Agent 和 Server 是否在同一个局域网

**手动指定服务器**：
```
设置 F2A rendezvous server 为 ws://192.168.1.100:8765
```

### 无法连接到 rendezvous server

检查：
1. server 是否运行
2. 地址和端口是否正确
3. 防火墙是否放行 TCP 8765（WebSocket 端口）

### 配对码无效

可能原因：
1. 配对码已过期（5分钟限制）
2. 配对码已被使用
3. 输入错误（区分大小写）

### Peer 连接失败

检查网络：
1. 双方都能访问 rendezvous server
2. 如果跨网络，可能需要 relay

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `F2A_RENDEZVOUS` | 指定服务器地址 | `ws://192.168.1.100:8765` |
| `F2A_AUTO_UPDATE` | 启用自动更新 | `true` |

## 自更新

F2A skill 支持从 GitHub 自动更新：

```bash
# 检查更新
node scripts/update.js check

# 检查并应用更新
node scripts/update.js update
```

设置环境变量启用启动时自动检查：
```bash
export F2A_AUTO_UPDATE=true
```

## 相关文件

- [scripts/discover.js](scripts/discover.js) — 自动发现服务器
- [scripts/pair.js](scripts/pair.js) — 配对逻辑实现
- [scripts/peers.js](scripts/peers.js) — Peer 管理
- [scripts/update.js](scripts/update.js) — 自更新机制
- [scripts/messaging.js](scripts/messaging.js) — 消息通信
- [scripts/skills.js](scripts/skills.js) — 技能管理
- [scripts/files.js](scripts/files.js) — 文件传输
- [scripts/group.js](scripts/group.js) — 群聊功能
- [scripts/crypto.js](scripts/crypto.js) — 端到端加密
- [scripts/webrtc.js](scripts/webrtc.js) — WebRTC 直连
- [scripts/index.js](scripts/index.js) — 主入口模块
- [references/protocol.md](references/protocol.md) — F2A 协议详细规范

---

## 群聊使用指南

### 创建群组

```javascript
const groupId = f2a.createGroup('开发讨论组', {
  metadata: { topic: 'general' }
});
console.log(`群组创建成功: ${groupId}`);
```

### 邀请成员

```javascript
// 邀请已连接的 peer
await f2a.inviteToGroup(groupId, peerId);
```

### 发送群消息

```javascript
f2a.sendGroupMessage(groupId, '大家好，我是新成员！');
```

### 接收群消息

```javascript
f2a.on('group_message', ({ groupId, groupName, from, content, timestamp }) => {
  console.log(`[${groupName}] ${from}: ${content}`);
});
```

### 获取群组列表

```javascript
// 所有群组
const allGroups = f2a.getAllGroups();

// 我加入的群组
const myGroups = f2a.getMyGroups();

// 获取特定群组信息
const groupInfo = f2a.getGroupInfo(groupId);
console.log(groupInfo);
// { id, name, creator, members: [], memberCount, createdAt }
```

### 离开群组

```javascript
f2a.leaveGroup(groupId);
```

### 处理群组邀请

```javascript
f2a.on('group_invite', ({ groupId, groupName, creator, members }) => {
  console.log(`收到群组邀请: ${groupName}`);
  console.log(`创建者: ${creator}`);
  console.log(`成员数: ${members.length}`);
});
```
