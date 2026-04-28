# Agent-First Connect Design

> Date: 2026-04-27
> Status: Draft for review
> Related: RFC 006, RFC 008, RFC 011, RFC 014

## Summary

F2A should model the connect flow around the Agent, not around a host runtime such as OpenClaw or Hermes. OpenClaw, Hermes, and other callers are runtime containers that can carry one or many Agents. They help an Agent come online, receive messages, and execute work, but they are not the owner of the Agent identity.

This design refines RFC 014 with a product-level rule:

```text
Agent is the F2A user.
Runtime is the host/container.
Node is the network infrastructure.
RuntimeAgentBinding is the relationship between one Agent and one runtime-hosted agent slot.
```

## Goals

- Define Agent identity, profile, and runtime binding as separate concepts.
- Support OpenClaw multi-agent configuration through `agents.list[]`.
- Support Hermes default profile and named profiles without forcing users to create `profiles/`.
- Avoid the current behavior where OpenClaw picks the latest local identity from `~/.f2a/agent-identities/`.
- Keep the first implementation small enough to build after this design is approved.

## Non-Goals

- Full daemon/private-key storage separation. This remains a follow-up security hardening task.
- Public trust network, invitations, or reputation inheritance.
- Cross-device identity sync.
- A complete Hermes plugin implementation. This document defines the binding model and expected configuration behavior.

## Core Concepts

### AgentIdentity

`AgentIdentity` answers: "Can this Agent prove it is `agent:<fingerprint>`?"

It contains the cryptographic identity:

```json
{
  "agentId": "agent:abc123...",
  "publicKey": "Base64Ed25519PublicKey",
  "privateKey": "Base64Ed25519PrivateKey",
  "privateKeyEncrypted": false,
  "selfSignature": "Base64Signature",
  "createdAt": "2026-04-27T00:00:00.000Z"
}
```

The identity belongs to the Agent. A runtime may store or use it, but the product semantics should never call it an OpenClaw identity or Hermes identity.

### AgentProfile

`AgentProfile` answers: "What does this Agent claim to be able to do?"

It should be keyed by `agentId` and signed by the Agent identity. The signature makes the profile an Agent-authored declaration rather than a random local label.

```json
{
  "agentId": "agent:abc123...",
  "displayName": "Research Agent",
  "kind": "researcher",
  "capabilities": ["research", "summarize"],
  "description": "I help with research tasks.",
  "metadata": {},
  "updatedAt": "2026-04-27T00:00:00.000Z",
  "profileSignature": "Base64Signature"
}
```

Initial implementation can store profile fields in the existing identity file for compatibility, but the CLI/API should treat profile as a separate logical object.

### Runtime

`Runtime` answers: "What host environment is running Agent work?"

Supported runtime types:

```text
openclaw
hermes
other
```

A runtime can host multiple Agents. Therefore `runtimeType` alone is never enough to identify the F2A actor.

### RuntimeAgentBinding

`RuntimeAgentBinding` answers: "Which F2A Agent is bound to this runtime-hosted agent slot?"

```json
{
  "agentId": "agent:abc123...",
  "runtimeType": "openclaw",
  "runtimeId": "local-openclaw",
  "runtimeAgentId": "research",
  "webhook": {
    "url": "http://127.0.0.1:18789/f2a/webhook/agent:abc123"
  },
  "nodeId": "12D3...",
  "nodeSignature": "Base64NodeSignature",
  "status": "registered",
  "createdAt": "2026-04-27T00:00:00.000Z",
  "lastSeenAt": "2026-04-27T00:00:00.000Z"
}
```

The stable F2A address is `agentId`. The stable runtime-local slot is `runtimeAgentId`.

## Storage Model

Preferred local layout:

```text
~/.f2a/
  agents/
    agent:abc123/
      identity.json
      profile.json
      bindings/
        openclaw-local-openclaw-research.json
        hermes-default-default.json
```

Compatibility layout for the first implementation:

```text
~/.f2a/
  agent-identities/
    agent:abc123.json
  runtime-bindings/
    openclaw/
      local-openclaw/
        research.json
    hermes/
      default/
        default.json
```

The compatibility layout avoids a large migration while still preventing runtime adapters from selecting "latest identity" globally.

## OpenClaw Configuration

OpenClaw has a native multi-agent model:

- `agents.list[]` defines OpenClaw agent ids.
- `bindings[]` routes channels/accounts/peers to specific OpenClaw agents.
- Plugin configuration lives under `plugins.entries["openclaw-f2a"].config`.
- Plugin configuration is validated by `openclaw.plugin.json`.

F2A should map:

```text
runtimeType = "openclaw"
runtimeId = configured gateway id, or "local-openclaw" by default
runtimeAgentId = agents.list[].id
```

Proposed plugin configuration:

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "config": {
          "autoRegister": true,
          "controlPort": 9001,
          "webhookPath": "/f2a/webhook",
          "runtimeId": "local-openclaw",
          "agents": [
            {
              "openclawAgentId": "research",
              "f2aAgentId": "agent:abc123...",
              "name": "Research Agent",
              "capabilities": ["research", "summarize"]
            },
            {
              "openclawAgentId": "coding",
              "name": "Coding Agent",
              "capabilities": ["code", "review"]
            }
          ]
        }
      }
    }
  }
}
```

Rules:

- If `agents[]` is configured, each entry becomes one F2A connect target.
- If `f2aAgentId` is provided, bind that existing Agent identity.
- If `f2aAgentId` is omitted, create a new F2A Agent for that OpenClaw agent.
- If `agents[]` is omitted, the plugin may use the OpenClaw default agent as a single compatibility target, but it must not scan and reuse the latest F2A identity.
- Webhooks should be agent-specific when possible: `/f2a/webhook/agent:<agentId>`.

Message delivery:

```text
F2A Daemon
  -> POST /f2a/webhook/agent:<agentId>
  -> openclaw-f2a resolves agentId to openclawAgentId
  -> api.runtime.subagent.run({ agentId: openclawAgentId, ... }) when supported
```

If the current OpenClaw subagent API does not support `agentId` targeting, the plugin should preserve the binding metadata and route through the closest available session mechanism, then document the limitation.

## Hermes Configuration

Hermes differs from OpenClaw. Its multi-agent model is based on profiles:

- The default profile uses `HERMES_HOME=~/.hermes`.
- Named profiles use `HERMES_HOME=~/.hermes/profiles/<profileName>`.
- A local install with only one Agent may not have a `profiles/` directory.
- Each profile has its own `config.yaml`, `.env`, `SOUL.md`, memory, sessions, skills, gateway state, and logs.

F2A should map:

```text
runtimeType = "hermes"
runtimeId = "local-hermes" by default
runtimeAgentId =
  "default" when HERMES_HOME is ~/.hermes or unset
  <profileName> when HERMES_HOME is ~/.hermes/profiles/<profileName>
  explicit --runtime-agent-id for custom HERMES_HOME paths
```

Binding storage:

```text
~/.hermes/
  f2a-binding.json

~/.hermes/profiles/coder/
  f2a-binding.json

~/.hermes/profiles/research/
  f2a-binding.json
```

Optional `config.yaml` representation:

```yaml
f2a:
  enabled: true
  agent_id: agent:abc123...
  name: Coder Agent
  capabilities:
    - code
    - review
  runtime_id: local-hermes
  control_port: 9001
  webhook_path: /f2a/webhook
```

Rules:

- Do not require `~/.hermes/profiles/` to exist.
- Treat `~/.hermes` as the default Hermes runtime agent.
- Named profile bindings are scoped to their profile home.
- If a profile has no F2A binding and first uses F2A, create a new F2A Agent for that profile.
- Explicit `agent_id` or `--agent-id` binds an existing F2A Agent to that Hermes profile.

## Other Runtime Configuration

Other runtimes must provide a stable runtime-local agent id:

```bash
f2a agent connect \
  --runtime other \
  --runtime-id my-runtime \
  --runtime-agent-id worker-1 \
  --name "Worker 1" \
  --webhook http://127.0.0.1:9100/f2a/webhook/worker-1
```

If a runtime cannot provide a stable id, F2A should refuse automatic connect unless the user explicitly passes one.

## CLI Design

New command:

```bash
f2a agent connect \
  --runtime <openclaw|hermes|other> \
  --runtime-id <id> \
  --runtime-agent-id <id> \
  --name <display-name> \
  --capability <capability> \
  --webhook <url> \
  [--agent-id <existing-agent-id>] \
  [--force]
```

Behavior:

1. Resolve existing binding by `(runtimeType, runtimeId, runtimeAgentId)`.
2. If a binding exists and `--force` is not set, verify/register it and return it.
3. If `--agent-id` is provided, load that Agent identity.
4. If no Agent identity is provided, create a new `AgentIdentity`.
5. Create or update `AgentProfile`.
6. Register with daemon using `publicKey` and `selfSignature`.
7. Store `RuntimeAgentBinding`.

Existing commands remain:

- `f2a agent init` for low-level identity creation.
- `f2a agent register` for low-level daemon registration.
- `f2a agent status` for local identity inspection.

## Daemon/API Design

The daemon should continue accepting `POST /api/v1/agents` for compatibility. A future API can add:

```http
POST /api/v1/agents/connect
```

The request should include logical identity, profile, and runtime binding sections:

```json
{
  "identity": {
    "agentId": "agent:abc123...",
    "publicKey": "Base64PublicKey",
    "selfSignature": "Base64Signature"
  },
  "profile": {
    "name": "Research Agent",
    "capabilities": ["research", "summarize"]
  },
  "runtime": {
    "type": "openclaw",
    "id": "local-openclaw",
    "runtimeAgentId": "research",
    "webhook": {
      "url": "http://127.0.0.1:18789/f2a/webhook/agent:abc123"
    }
  }
}
```

Daemon startup recovery must validate:

- `agentId` matches `publicKey`.
- `selfSignature` is valid.
- `nodeSignature` is valid when present and a verifier is available.

Invalid identities or bindings must be skipped with a warning.

## Migration From Current OpenClaw Plugin

Current behavior:

- Reads latest identity from `~/.f2a/agent-identities/`.
- Registers a single plugin-level Agent using `agentName` and `agentCapabilities`.
- Uses one global webhook path plus partial support for agent-specific paths.

Migration path:

1. Add `agents[]` to `openclaw.plugin.json` schema.
2. Preserve `agentName` and `agentCapabilities` as deprecated single-agent compatibility fields.
3. On startup, resolve configured `agents[]`.
4. If no `agents[]` exists, create one compatibility target from default OpenClaw agent context.
5. Remove latest-identity selection and replace it with binding lookup.

## Security Notes

- A runtime binding is not proof of Agent ownership. Agent ownership is proven by the Agent private key.
- Updating a binding to point at an existing `agentId` should require local private key access or Challenge-Response.
- Daemon should not accept profile claims without matching identity verification.
- The first implementation may continue storing private keys under `~/.f2a`, but daemon-side use should move toward public registry data only.

## Open Questions

- Does the OpenClaw `runtime.subagent.run` API support selecting a target `agents.list[].id` directly in the installed version used by this project?
- Should Hermes binding be written only to `f2a-binding.json`, only to `config.yaml`, or both?
- Should AgentProfile be introduced as a new file immediately, or first as a logical section in the existing identity JSON for migration simplicity?

## External References

- OpenClaw configuration: `~/.openclaw/openclaw.json`, `agents.list[]`, and routing `bindings[]`.
- OpenClaw plugin setup: plugin config under `plugins.entries.<plugin-id>.config` and schema validation through `openclaw.plugin.json`.
- Hermes profiles: default profile at `~/.hermes`, named profiles under `~/.hermes/profiles/<profileName>`, and `HERMES_HOME` based isolation.
- Hermes configuration: per-profile `config.yaml`, `.env`, `SOUL.md`, memory, sessions, skills, gateway state, and logs.

## Recommended Implementation Order

1. Add runtime binding types and storage helpers.
2. Add `f2a agent connect`.
3. Update OpenClaw plugin config schema to support `agents[]`.
4. Replace OpenClaw latest-identity selection with binding lookup.
5. Add Hermes binding resolver for default profile and named profiles.
6. Add daemon startup verification for restored identities.
7. Add follow-up plan for public-only daemon registry storage.
