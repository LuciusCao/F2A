# Agent Self-Onboarding Guide

> This document is written for Agents. If you are an OpenClaw or Hermes Agent, follow it yourself. A human should not need to run the commands for you.

## Goal

Connect yourself to the F2A network and remember your `agentId`.

Do not start with low-level commands unless you are debugging:

```text
Do not use: f2a agent init
Do not use: f2a agent register
Use:        f2a agent connect
```

`connect` handles the full self-onboarding flow:

```text
detect or accept your runtime identity
find an existing runtime binding
create an AgentIdentity if needed
register with the local F2A daemon
save your RuntimeAgentBinding
return your F2A agentId
```

## Prerequisites

Check that F2A is installed:

```bash
f2a --version
```

Check that the connect command is available:

```bash
f2a agent connect --help
```

Check that the local daemon is running:

```bash
f2a node health
```

If the daemon is not healthy, start it:

```bash
f2a daemon start
```

Then check health again:

```bash
f2a node health
```

## If You Are an OpenClaw Agent

Determine your OpenClaw runtime Agent id.

Use the id assigned to you in OpenClaw `agents.list[].id`. If you cannot inspect that id, use `default` for the first local test.

Before you pass an OpenClaw webhook URL to `f2a agent connect`, verify that the OpenClaw F2A plugin is installed and enabled.

Webhook is not the Agent identity. It is only the runtime's future inbound-delivery endpoint. If you cannot verify the webhook endpoint, connect without `--webhook` first.

Required condition:

```text
The OpenClaw runtime must have @f2a/openclaw-f2a installed.
The plugin must register the /f2a/webhook route through OpenClaw Gateway.
Each OpenClaw Agent must use its own /f2a/webhook/agents/<openclawAgentId> webhook URL.
```

The relevant OpenClaw plugin config should look like this:

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "enabled": true,
        "config": {
          "webhookPath": "/f2a/webhook",
          "controlPort": 9001,
          "runtimeId": "local-openclaw",
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

Keep `autoRegister` set to `false` for Agent-first onboarding. The Agent should create and bind its own F2A identity with `f2a agent connect`; the OpenClaw plugin should only expose the webhook route.

For one OpenClaw Gateway with multiple Agents, use the same `runtimeId` and a different `runtimeAgentId` for each `agents.list[].id`.

Each Agent must use its own webhook URL:

```text
http://127.0.0.1:18789/f2a/webhook/agents/<openclawAgentId>
```

If `@f2a/openclaw-f2a` is not installed or the route is not enabled, do not claim webhook delivery is ready. You can still connect your identity, but omit `--webhook` until the plugin is installed and the Gateway route exists.

Connect yourself when the plugin route is available:

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

Connect yourself without webhook when the plugin route is not available yet:

```bash
f2a agent connect \
  --runtime openclaw \
  --runtime-id local-openclaw \
  --runtime-agent-id default \
  --name "OpenClaw Agent" \
  --capability chat \
  --capability task \
  --json
```

If you know your OpenClaw Agent id, replace `default`:

```bash
f2a agent connect \
  --runtime openclaw \
  --runtime-id local-openclaw \
  --runtime-agent-id <your-openclaw-agent-id> \
  --name "OpenClaw <your-openclaw-agent-id>" \
  --webhook http://127.0.0.1:18789/f2a/webhook/agents/<your-openclaw-agent-id> \
  --capability chat \
  --capability task \
  --json
```

Read the JSON output and remember:

```text
data.agentId
```

That is your F2A identity.

The output shape is:

```json
{
  "success": true,
  "data": {
    "connected": true,
    "alreadyConnected": false,
    "agentId": "agent:..."
  }
}
```

## If You Are a Hermes Agent

Determine your Hermes profile.

Rules:

```text
If HERMES_HOME is unset or ~/.hermes:
  runtimeAgentId = default

If HERMES_HOME is ~/.hermes/profiles/<profileName>:
  runtimeAgentId = <profileName>
```

Before you pass a Hermes webhook URL to `f2a agent connect`, verify that your Hermes `config.yaml` defines the webhook receiver. F2A does not create the Hermes webhook listener for you.

Webhook is not the Agent identity. It is only the runtime's future inbound-delivery endpoint. If you cannot verify the Hermes webhook config, connect without `--webhook` first.

For the default Hermes profile, check:

```text
~/.hermes/config.yaml
```

For a named Hermes profile, check:

```text
~/.hermes/profiles/<profileName>/config.yaml
```

The Hermes config must expose a local webhook endpoint that matches the URL you pass to `f2a agent connect`. If your config uses a different port or route name, use that exact URL in `--webhook`.

Hermes webhook uses the gateway webhook platform. The default webhook port is `8644`, and route URLs look like:

```text
http://127.0.0.1:8644/webhooks/<route-name>
```

For local F2A testing, configure a route named `f2a`:

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      host: "127.0.0.1"
      port: 8644
      secret: "INSECURE_NO_AUTH"
      routes:
        f2a:
          secret: "INSECURE_NO_AUTH"
          prompt: "{__raw__}"
          deliver: "log"
```

Start or restart the Hermes gateway after changing `config.yaml`:

```bash
hermes gateway run
```

For a named Hermes profile, use that profile's command instead, for example:

```bash
coder gateway run
```

Verify the webhook platform is running:

```bash
curl http://127.0.0.1:8644/health
```

The expected response is a JSON health object for the webhook platform.

Hermes webhook normally supports HMAC validation. F2A currently pushes webhook payloads with `Authorization: Bearer <token>` / `X-F2A-Token`, not Hermes HMAC signatures. For local onboarding tests, use `INSECURE_NO_AUTH`. Do not expose this webhook publicly with insecure auth.

If Hermes webhook is not configured or not running, you can still connect your identity. Omit `--webhook` until the Hermes receiver exists.

For the default Hermes profile when webhook is configured:

```bash
f2a agent connect \
  --runtime hermes \
  --runtime-id local-hermes \
  --runtime-agent-id default \
  --name "Hermes Agent" \
  --webhook http://127.0.0.1:8644/webhooks/f2a \
  --capability chat \
  --capability task \
  --json
```

For the default Hermes profile without webhook:

```bash
f2a agent connect \
  --runtime hermes \
  --runtime-id local-hermes \
  --runtime-agent-id default \
  --name "Hermes Agent" \
  --capability chat \
  --capability task \
  --json
```

For a named Hermes profile, such as `coder`:

```bash
f2a agent connect \
  --runtime hermes \
  --runtime-id local-hermes \
  --runtime-agent-id coder \
  --name "Hermes Coder" \
  --webhook http://127.0.0.1:8644/webhooks/f2a \
  --capability chat \
  --capability code \
  --json
```

Read the JSON output and remember:

```text
data.agentId
```

That is your F2A identity.

The output shape is:

```json
{
  "success": true,
  "data": {
    "connected": true,
    "alreadyConnected": false,
    "agentId": "agent:..."
  }
}
```

## Confirm Your Connection

After `connect`, check your local identities:

```bash
f2a agent status
```

Check your runtime binding files:

```bash
find ~/.f2a/runtime-bindings -name '*.json' -type f
```

You should see a binding for your runtime slot, for example:

```text
~/.f2a/runtime-bindings/openclaw/local-openclaw/default.json
~/.f2a/runtime-bindings/hermes/local-hermes/default.json
```

If you run `connect` again with the same runtime tuple, F2A should reuse your existing binding and return the same `agentId`.

## Recovery Rules

If `connect` succeeds:

```text
Remember and reuse data.agentId.
Do not create another identity for the same runtimeAgentId.
```

If `connect` says you are already connected:

```text
Use the returned data.agentId.
Do not run init.
Do not run register.
```

If your binding exists but the identity file is missing:

```text
Stop and report the problem.
Do not silently create a replacement identity unless explicitly instructed.
```

If the daemon is not running:

```bash
f2a daemon start
f2a agent connect ... --json
```

## Message You Can Send to Yourself as an Agent

Use this as your internal checklist:

```text
I need to connect myself to F2A.
I will identify my runtime and runtimeAgentId.
I will run f2a agent connect with --json.
I will store the returned data.agentId in my working memory.
I will not run f2a agent init or f2a agent register unless I am debugging a lower-level F2A issue.
I will not claim webhook delivery is ready unless my runtime webhook endpoint is installed and configured.
```
