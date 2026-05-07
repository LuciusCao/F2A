# Runtime Installers Design

## Context

Agent-first onboarding should not make `f2a agent connect` install plugins, rewrite runtime configuration, or start runtime services. Similar installer patterns, such as the Lark OpenClaw installer, keep runtime preparation in a dedicated install command and leave daily identity commands focused.

F2A will use the same split:

- Runtime installer: prepares OpenClaw or Hermes integration.
- F2A CLI: creates or reuses Agent identity and runtime binding.
- Setup orchestrator: provides a one-command onboarding path for Agents by calling the installers and then `f2a agent connect`.

## Packages

### `@f2a/openclaw-f2a`

The existing OpenClaw plugin package will add a bin:

```bash
openclaw-f2a install
openclaw-f2a doctor
```

It owns OpenClaw-specific setup because it is the OpenClaw integration package.

### `@f2a/hermes-f2a`

New package for Hermes webhook setup:

```bash
hermes-f2a install
hermes-f2a doctor
```

Hermes has a built-in webhook platform instead of an external plugin, so this package configures Hermes webhook routes rather than installing a plugin.

### `@f2a/setup`

New top-level onboarding orchestrator:

```bash
f2a-setup install --runtime openclaw ...
f2a-setup install --runtime hermes ...
```

It calls the runtime installer and then calls `f2a agent connect`.

## OpenClaw Installer

Inputs:

- `--config <path>` or `OPENCLAW_CONFIG`
- `--runtime-id <id>` default `local-openclaw`
- `--runtime-agent-id <id>` optional
- `--name <name>` optional
- `--capability <name>` repeatable
- `--json`

Behavior:

1. Locate OpenClaw Gateway JSON config.
2. Ensure `plugins.entries["openclaw-f2a"]`.
3. Set `enabled: true`.
4. Preserve existing config.
5. Set defaults:
   - `webhookPath: "/f2a/webhook"`
   - `runtimeId`
   - `autoRegister: false`
   - `agents: []`
6. If `runtimeAgentId` is passed, ensure `agents[]` contains that `openclawAgentId`.
7. Return `webhookUrl = http://127.0.0.1:18789/f2a/webhook/agents/<runtimeAgentId>`.

`doctor` is read-only and reports whether the config is ready.

## Hermes Installer

Inputs:

- `--home <path>` or `HERMES_HOME`
- `--profile <name>`
- `--route <name>` default `f2a`
- `--port <port>` default `8644`
- `--json`

Behavior:

1. Resolve Hermes home:
   - `--home` wins.
   - `--profile coder` uses `~/.hermes/profiles/coder`.
   - `HERMES_HOME` wins over default.
   - default is `~/.hermes`.
2. Resolve `runtimeAgentId`:
   - profile name when `--profile` is used or home is under `profiles/<name>`.
   - otherwise `default`.
3. Ensure `config.yaml` contains Hermes webhook platform route `f2a`.
4. Return `webhookUrl = http://127.0.0.1:<port>/webhooks/<route>`.

Hermes HMAC auth is out of scope for this first version. The installer uses `INSECURE_NO_AUTH` for local onboarding only and documents that it must not be exposed publicly.

## Setup Orchestrator

`f2a-setup install` accepts runtime-specific options, invokes the matching installer, then runs:

```bash
f2a agent connect --runtime <runtime> --runtime-id <runtimeId> --runtime-agent-id <runtimeAgentId> --name <name> --webhook <webhookUrl> --json
```

It returns one JSON object containing:

- runtime installer result
- connect result
- commands executed

## Non-Goals

- Make `f2a agent connect` modify runtime config.
- Implement Hermes HMAC webhook signing.
- Guess arbitrary OpenClaw config locations beyond explicit config, env var, and common current-directory names.
