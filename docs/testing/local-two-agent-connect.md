# Local Two-Agent Connect Verification

This guide verifies the Agent-first connect flow on one machine with two local runtime-hosted Agents.

The scenario uses `runtime=other` so it does not require OpenClaw or Hermes to be installed. It proves the F2A core behavior that OpenClaw/Hermes adapters will use:

```text
runtime other/local-test/agent-a -> F2A Agent A
runtime other/local-test/agent-b -> F2A Agent B
Agent A sends a message to Agent B
Agent B can read the message from its queue
```

## 1. Build

```bash
npm run build
```

## 2. Start Daemon

```bash
node packages/cli/dist/main.js daemon start
```

For foreground debugging:

```bash
node packages/cli/dist/main.js daemon foreground
```

## 3. Connect Agent A

```bash
node packages/cli/dist/main.js --json agent connect \
  --runtime other \
  --runtime-id local-test \
  --runtime-agent-id agent-a \
  --name "Local Agent A" \
  --webhook http://127.0.0.1:9101/f2a/webhook \
  --capability chat
```

Record the returned `data.agentId` as `AGENT_A`.

## 4. Connect Agent B

```bash
node packages/cli/dist/main.js --json agent connect \
  --runtime other \
  --runtime-id local-test \
  --runtime-agent-id agent-b \
  --name "Local Agent B" \
  --webhook http://127.0.0.1:9102/f2a/webhook \
  --capability chat
```

Record the returned `data.agentId` as `AGENT_B`.

## 5. Confirm Runtime Bindings

```bash
find ~/.f2a/runtime-bindings -type f -name '*.json' -maxdepth 5
```

Expected files:

```text
~/.f2a/runtime-bindings/other/local-test/agent-a.json
~/.f2a/runtime-bindings/other/local-test/agent-b.json
```

## 6. Send A Message From A To B

```bash
node packages/cli/dist/main.js message send \
  --agent-id "$AGENT_A" \
  --to "$AGENT_B" \
  --expect-reply \
  "hello from Agent A"
```

## 7. Read Agent B Queue

```bash
node packages/cli/dist/main.js message list --agent-id "$AGENT_B"
```

Expected result:

- The command succeeds.
- Agent B's queue contains the message from Agent A.

## Notes

- The webhook URLs do not need live HTTP servers for this queue-level verification. They are required by daemon registration because HTTP-registered Agents need a delivery endpoint for later push-based delivery.
- To test automatic replies, run local webhook receivers on ports `9101` and `9102`, then let each webhook call `f2a message send` with its own `--agent-id`.
