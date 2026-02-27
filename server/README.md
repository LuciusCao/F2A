# F2A Server

F2A (Friend-to-Agent) 网络的会合服务器，帮助 Agent 建立 P2P 连接。

> 💡 **名字由来**: F2A = **F2** (选中所有单位) + **A** (A过去)，灵感来自星际争霸中神族的"卡拉"心灵连接——让所有 Agent 像神族战士一样连接成一个整体，然后一起"A过去"解决问题！

## 功能

- Agent A 生成限时配对码（默认5分钟）
- Agent B 通过配对码加入，双方交换身份信息
- 支持公钥指纹交换，建立信任关系
- **UDP 自动发现** — 局域网内 Agent 可自动找到服务器

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 或使用自定义端口
PORT=8080 npm start
```

启动后会看到：
```
[F2A Rendezvous Server] Running on port 8765
[Config] Pair code TTL: 300s
[Discovery] UDP service running on port 8766
```

## 自动发现

F2A Server 内置 UDP 自动发现服务（端口 8766）：

- 局域网内的 Agent 启动时会自动广播发现请求
- Server 响应并告知自己的 WebSocket 地址
- Agent 无需手动配置服务器地址

### 发现流程

```
Agent (UDP广播)          Server
    |                       |
    |-- "F2A_DISCOVER" ---> |
    |                       |
    |<-- {"type":"F2A_HERE", |
    |      "server":"ws://..."}
    |                       |
Agent 自动连接到服务器
```

## API

### WebSocket 端点

#### Agent A 注册配对
```
WS /register
```

连接后，服务器返回：
```json
{
  "type": "pair_code",
  "code": "A3B7C9",
  "ttl": 300000,
  "expiresAt": 1709000000000
}
```

然后 Agent A 发送身份信息：
```json
{
  "type": "identity",
  "agentId": "agent-a-uuid",
  "publicKey": "base64-encoded-public-key",
  "metadata": { "name": "Agent A" }
}
```

#### Agent B 加入配对
```
WS /pair/:code
```

例如：`WS /pair/A3B7C9`

连接后，Agent B 发送身份信息（格式同上）。

配对成功后，双方收到：
```json
{
  "type": "peer_connected",
  "peer": {
    "agentId": "...",
    "publicKey": "...",
    "metadata": {}
  },
  "peerAddress": "192.168.x.x"
}
```

### HTTP 端点

#### 健康检查
```
GET /health
```

返回：
```json
{
  "status": "ok",
  "pendingPairs": 3,
  "uptime": 3600
}
```

## 部署

### 使用 PM2

```bash
npm install -g pm2
pm2 start server.js --name f2a-rendezvous
pm2 save
pm2 startup
```

### 使用 Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8765 8766
CMD ["node", "server.js"]
```

```bash
docker build -t f2a-rendezvous .
docker run -p 8765:8765 -p 8766:8766/udp f2a-rendezvous
```

注意：需要同时暴露 TCP 8765（WebSocket）和 UDP 8766（发现服务）

### 使用 Nginx 反向代理（HTTPS）

```nginx
server {
    listen 443 ssl;
    server_name rendezvous.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8765` | WebSocket 服务端口 |
| `DISCOVERY_PORT` | `8766` | UDP 发现服务端口 |
| `PAIR_CODE_TTL` | `300000` | 配对码过期时间（毫秒） |

## 协议流程

```
Agent A                              Rendezvous Server                           Agent B
   |                                         |                                       |
   |-- WS /register ----------------------->|                                       |
   |<-- { type: "pair_code", code: "X7K9M2" }|                                       |
   |                                         |                                       |
   |-- { type: "identity", ... } ---------->|                                       |
   |                                         |                                       |
   |                                         |<-- WS /pair/X7K9M2 ------------------|
   |                                         |<-- { type: "identity", ... } ---------|
   |                                         |                                       |
   |<-- { type: "peer_connected", peer: B }-|--> { type: "peer_connected", peer: A }|
   |                                         |                                       |
   |<=================== 建立 P2P 连接 ================================>|
```

## License

MIT
