# OpenClaw Multi-Agent Webhook Design

## Context

F2A now uses Agent-first onboarding through `f2a agent connect`. For OpenClaw, one Gateway runtime can host multiple OpenClaw Agents. F2A must therefore distinguish:

- `runtimeType`: the runtime family, always `openclaw` here.
- `runtimeId`: the OpenClaw Gateway instance, for example `local-openclaw`.
- `runtimeAgentId`: the OpenClaw Agent inside that Gateway, taken from `agents.list[].id`.
- `agentId`: the F2A Agent identity returned by `f2a agent connect`.

The current OpenClaw plugin has a global webhook path and a schema-level `agents[]` config, but runtime webhook handling does not route by `openclawAgentId`. A single `/f2a/webhook` endpoint is ambiguous when several OpenClaw Agents share one Gateway.

## Decision

OpenClaw multi-Agent webhook delivery will use a runtime-local per-Agent path:

```text
/f2a/webhook/agents/<openclawAgentId>
```

Examples:

```text
/f2a/webhook/agents/coder
/f2a/webhook/agents/researcher
```

The plugin will not keep compatibility with the old global `/f2a/webhook` or old `/f2a/webhook/agent:<prefix>` forms for Agent-first onboarding. No external users depend on those paths yet, and keeping them would preserve the ambiguity this change is meant to remove.

## Configuration

OpenClaw Gateway plugin config:

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "enabled": true,
        "config": {
          "webhookPath": "/f2a/webhook",
          "runtimeId": "local-openclaw",
          "controlPort": 9001,
          "autoRegister": false,
          "agents": [
            {
              "openclawAgentId": "coder",
              "name": "OpenClaw Coder",
              "capabilities": ["chat", "code"]
            },
            {
              "openclawAgentId": "researcher",
              "name": "OpenClaw Researcher",
              "capabilities": ["chat", "research"]
            }
          ]
        }
      }
    }
  }
}
```

`autoRegister` should be `false` for Agent-first onboarding. Each Agent creates or reuses its F2A identity by running `f2a agent connect`.

## Connect Flow

Each OpenClaw Agent connects with the same `runtimeId` and a different `runtimeAgentId`:

```bash
f2a agent connect \
  --runtime openclaw \
  --runtime-id local-openclaw \
  --runtime-agent-id coder \
  --name "OpenClaw Coder" \
  --webhook http://127.0.0.1:18789/f2a/webhook/agents/coder \
  --capability chat \
  --capability code \
  --json
```

```bash
f2a agent connect \
  --runtime openclaw \
  --runtime-id local-openclaw \
  --runtime-agent-id researcher \
  --name "OpenClaw Researcher" \
  --webhook http://127.0.0.1:18789/f2a/webhook/agents/researcher \
  --capability chat \
  --capability research \
  --json
```

This creates separate runtime bindings:

```text
~/.f2a/runtime-bindings/openclaw/local-openclaw/coder.json
~/.f2a/runtime-bindings/openclaw/local-openclaw/researcher.json
```

## Plugin Routing Behavior

The plugin registers one Gateway route at `config.webhookPath`, but accepts only nested per-Agent webhook requests under that base path:

```text
POST <webhookPath>/agents/<openclawAgentId>
```

For each request:

1. Parse `openclawAgentId` from the URL path.
2. If `config.agents` is non-empty, require a matching `agents[].openclawAgentId`.
3. Reject requests without a runtime Agent id.
4. Validate `webhookToken` when configured.
5. Parse the F2A webhook payload.
6. Invoke the matching OpenClaw Agent using the runtime-local Agent id.

The exact OpenClaw invocation API should follow the existing plugin boundary. If the runtime supports an explicit Agent target, pass `openclawAgentId`; otherwise, use it as the session key and keep the implementation isolated behind a helper so the call site can be updated when OpenClaw exposes a stronger API.

## Errors

- Non-POST requests return `404`.
- Requests outside `<webhookPath>/agents/<openclawAgentId>` return `404`.
- Unknown `openclawAgentId` returns `404` when `config.agents` is configured.
- Missing sender or content in payload returns `400`.
- Invalid JSON returns `400`.
- Invalid webhook token returns `401`.

## Documentation

`AGENT_ONBOARDING.md` must explain that:

- `runtimeId` identifies the OpenClaw Gateway.
- `runtimeAgentId` identifies one OpenClaw Agent inside the Gateway.
- Multi-Agent OpenClaw setups must use per-Agent webhook URLs.
- A single shared `/f2a/webhook` is not valid for multi-Agent onboarding.

## Tests

Add or update OpenClaw plugin tests for:

- Route registration still uses the configured base `webhookPath`.
- `/f2a/webhook/agents/coder` invokes the `coder` OpenClaw Agent path.
- Unknown configured Agent ids are rejected.
- Global `/f2a/webhook` is rejected for Agent-first webhook delivery.
- `AGENT_ONBOARDING.md` examples use per-Agent webhook URLs for OpenClaw.

## Out of Scope

- Automatically writing `f2aAgentId` back into OpenClaw config after `f2a agent connect`.
- Supporting legacy global webhook delivery for multiple Agents.
- Changing Hermes webhook behavior.
