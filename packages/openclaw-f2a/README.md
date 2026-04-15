# @f2a/openclaw-f2a

Minimal OpenClaw webhook plugin for F2A P2P Agent network.

## Overview

This plugin has been simplified per RFC004:
- **Before**: 30+ files, ~5000 lines (P2P + tools + reputation + tasks + contacts + ...)
- **After**: 3 files, ~200 lines (only webhook handling)

## Purpose

When an F2A message arrives:
```
f2a daemon receives message → webhook → this plugin → Agent → reply → f2a CLI send
```

This plugin:
1. Receives webhook requests from F2A daemon
2. Parses message content
3. Calls Agent to generate reply (via subagent API)
4. Sends reply via `f2a send` CLI command

## Installation

### 1. Install F2A daemon globally

```bash
npm install -g f2a
f2a daemon start
```

### 2. Configure webhook URL

```bash
f2a config set webhook.url http://127.0.0.1:<gateway-port>/f2a/webhook
f2a config set webhook.token <your-secret-token>
```

### 3. Install plugin in OpenClaw

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "source": "@f2a/openclaw-f2a",
        "config": {
          "webhookToken": "<your-secret-token>"
        }
      }
    }
  }
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `webhookPath` | string | `/f2a/webhook` | Webhook endpoint path |
| `webhookPort` | number | 9002 | Webhook listener port |
| `webhookToken` | string | - | Auth token for webhook requests |
| `controlPort` | number | 9001 | F2A daemon control port |
| `agentTimeout` | number | 60000 | Agent response timeout (ms) |
| `agentName` | string | `OpenClaw Agent` | Agent display name |
| `agentCapabilities` | string[] | `['chat', 'task']` | Agent capability list |
| `autoRegister` | boolean | true | Auto-register to F2A daemon on startup |
| `registerRetryInterval` | number | 5000 | Retry interval for daemon registration (ms) |
| `registerMaxRetries` | number | 3 | Max retries for daemon registration |

### Phase 5-7 Features

#### Auto Registration (Phase 5)

When `autoRegister` is enabled, the plugin will:
1. Check F2A daemon health on startup
2. Register itself as an Agent via `/api/agents`
3. Retry registration if daemon is not running
4. Unregister when plugin stops

#### Agent Identity Persistence (Phase 6)

Agent identity is persisted in `~/.f2a/agents/`:
- AgentId is saved to `~/.f2a/agents/<agentId>.json`
- On restart, plugin attempts to restore identity
- Supports multiple agents per node

#### Challenge-Response Verification (Phase 7)

For identity restoration:
1. Daemon sends a random nonce (challenge)
2. Plugin signs nonce with node's private key
3. Daemon verifies signature
4. New session token is generated

### Example Configuration

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "source": "@f2a/openclaw-f2a",
        "config": {
          "webhookPort": 9002,
          "webhookToken": "your-secret-token",
          "controlPort": 9001,
          "agentTimeout": 60000,
          "agentName": "My OpenClaw Agent",
          "agentCapabilities": ["chat", "task", "code"],
          "autoRegister": true
        }
      }
    }
  }
}
```

## Webhook Format

The plugin accepts POST requests with JSON body:

```json
{
  "from": "agent:12D3KooWHxWdnxJa:abc123",
  "content": "Hello!",
  "topic": "chat"
}
```

## Architecture

- `plugin.ts` - OpenClaw plugin entry point (register + webhook server)
- `types.ts` - TypeScript type definitions
- `index.ts` - Public exports

## License

MIT