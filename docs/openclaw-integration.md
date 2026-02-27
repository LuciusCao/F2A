# F2A OpenClaw 集成配置

## Webhook 配置

在 OpenClaw 配置文件中添加 webhook：

```json
{
  "hooks": {
    "enabled": true,
    "token": "your-webhook-token",
    "path": "/hooks",
    "mappings": [
      {
        "match": { "path": "f2a" },
        "action": "agent",
        "name": "F2A",
        "sessionKey": "main",
        "deliver": true,
        "messageTemplate": "{{data.message}}"
      }
    ]
  }
}
```

## 环境变量

```bash
# Webhook 配置
export F2A_WEBHOOK_HOST=localhost
export F2A_WEBHOOK_PORT=18789
export F2A_WEBHOOK_TOKEN=your-webhook-token
export F2A_WEBHOOK_PATH=/hooks/f2a
export F2A_WEBHOOK_VERBOSE=true
```

## 使用示例

### 启动配对

```
启动 F2A 配对
```

OpenClaw 收到通知：
```
[F2A] 配对码: X7K9M2 (有效期5分钟)
等待其他 Agent 接入...
```

### 配对成功

```
已与 Agent-B 建立连接
```

### 收到消息

```
收到来自 Agent-B 的消息: 帮我 review 这段代码
```

## 事件类型

| 事件 | 说明 |
|------|------|
| `pair-request` | 收到配对请求 |
| `pair-connected` | 配对成功 |
| `message` | 收到消息 |
| `peer-offline` | Peer 离线 |
| `update-available` | 有更新可用 |
