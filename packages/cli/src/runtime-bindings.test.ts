import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  saveRuntimeBinding,
  loadRuntimeBinding,
  resolveHermesRuntimeAgentId,
  type RuntimeAgentBinding
} from './runtime-bindings.js';

describe('runtime-bindings', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'f2a-bindings-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('saves and loads binding by runtime tuple', async () => {
    const binding: RuntimeAgentBinding = {
      agentId: 'agent:abc123',
      runtimeType: 'openclaw',
      runtimeId: 'local-openclaw',
      runtimeAgentId: 'research',
      webhook: { url: 'http://127.0.0.1:18789/f2a/webhook/agent:abc123' },
      status: 'registered',
      createdAt: '2026-04-27T00:00:00.000Z',
      lastSeenAt: '2026-04-27T00:00:00.000Z'
    };

    await saveRuntimeBinding(dataDir, binding);

    await expect(loadRuntimeBinding(dataDir, {
      runtimeType: 'openclaw',
      runtimeId: 'local-openclaw',
      runtimeAgentId: 'research'
    })).resolves.toEqual(binding);
  });

  it('keeps separate runtime-agent slots under one runtime', async () => {
    await saveRuntimeBinding(dataDir, {
      agentId: 'agent:aaa111',
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      status: 'registered',
      createdAt: '2026-04-27T00:00:00.000Z',
      lastSeenAt: '2026-04-27T00:00:00.000Z'
    });
    await saveRuntimeBinding(dataDir, {
      agentId: 'agent:bbb222',
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-b',
      status: 'registered',
      createdAt: '2026-04-27T00:00:00.000Z',
      lastSeenAt: '2026-04-27T00:00:00.000Z'
    });

    const agentA = await loadRuntimeBinding(dataDir, {
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a'
    });
    const agentB = await loadRuntimeBinding(dataDir, {
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-b'
    });

    expect(agentA?.agentId).toBe('agent:aaa111');
    expect(agentB?.agentId).toBe('agent:bbb222');
  });

  it('uses default Hermes runtime agent when HERMES_HOME is unset or ~/.hermes', () => {
    expect(resolveHermesRuntimeAgentId(undefined, '/Users/alice')).toBe('default');
    expect(resolveHermesRuntimeAgentId('/Users/alice/.hermes', '/Users/alice')).toBe('default');
  });

  it('uses Hermes profile name when HERMES_HOME points at profiles directory', () => {
    expect(resolveHermesRuntimeAgentId('/Users/alice/.hermes/profiles/coder', '/Users/alice')).toBe('coder');
  });
});
