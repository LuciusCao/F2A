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
| `webhookToken` | string | - | Auth token for webhook requests |
| `controlPort` | number | 9001 | F2A daemon control port |
| `controlToken` | string | - | F2A daemon token (auto-loaded from ~/.f2a/control-token) |
| `agentTimeout` | number | 60000 | Agent response timeout (ms) |

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