# Changelog

All notable changes to @f2a/openclaw-f2a will be documented in this file.

## [0.4.0] - 2026-04-15

### Phase 4: Clean-up and Validation

- ✅ Added webhook-e2e.test.ts with 19 end-to-end tests
- ✅ All 59 tests passing (register.test.ts + webhook.test.ts + webhook-e2e.test.ts)
- ✅ Updated README.md with Phase 5-7 configuration documentation
- ✅ Simplified architecture: 3 files, ~600 lines (from 30+ files, ~5000 lines)

### Phase 5: Auto Registration

- Added `autoRegister` configuration option
- Added automatic registration to F2A daemon on plugin startup
- Added retry mechanism for daemon connection (configurable retries and interval)
- Added automatic unregister on plugin stop

### Phase 6: Agent Identity Persistence

- Agent identity persisted in `~/.f2a/agent-identities/<agentId>.json`
- Plugin reads saved agentId on restart
- Supports identity restoration via daemon API

### Phase 7: Challenge-Response Verification

- Challenge-response mechanism for identity verification
- Node private key signing for nonce validation
- Session token generation on successful verification

### Configuration Changes

New configuration options added:
- `webhookPort`: Webhook listener port (default: 9002)
- `agentName`: Agent display name (default: "OpenClaw Agent")
- `agentCapabilities`: Agent capability list (default: ['chat', 'task'])
- `autoRegister`: Enable auto-registration (default: true)
- `registerRetryInterval`: Retry interval in ms (default: 5000)
- `registerMaxRetries`: Max retry attempts (default: 3)

### Breaking Changes

- Removed `controlToken` configuration (now loaded automatically from F2A daemon)
- Changed default webhook port from gateway port to 9002

### Architecture

- `plugin.ts`: OpenClaw plugin entry point (~600 lines)
- `types.ts`: TypeScript type definitions
- `index.ts`: Public exports

### Test Coverage

- register.test.ts: 18 tests (Agent registration flow)
- webhook.test.ts: 22 tests (Webhook handling)
- webhook-e2e.test.ts: 19 tests (End-to-end flow)

Total: 59 tests passing

## [0.3.0] - 2026-04-14

### RFC004 Implementation

- Initial webhook plugin refactoring
- Removed P2P network code (now in f2a daemon)
- Removed tools, reputation, tasks, contacts code
- Simplified to webhook-only handling

## [0.2.0] - Before RFC004

### Legacy Architecture

- 30+ files, ~5000 lines
- Built-in P2P network
- Multiple tools and services
- Complex agent management

## [0.1.0] - Initial Release

- First OpenClaw F2A plugin version