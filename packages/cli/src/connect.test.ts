import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connectAgent } from './connect.js';
import { loadRuntimeBinding } from './runtime-bindings.js';
import { sendRequest } from './http-client.js';

vi.mock('./http-client.js', () => ({
  sendRequest: vi.fn(async () => ({
    success: true,
    agent: { agentId: 'agent:mocked' },
    nodeSignature: 'node-sig',
    nodeId: 'node-1',
    token: 'agent-token'
  }))
}));

describe('connectAgent', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'f2a-connect-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates identity, registers it, and stores runtime binding', async () => {
    const result = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      name: 'Agent A',
      capabilities: ['chat'],
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^agent:[0-9a-f]{16}$/);
    expect(sendRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/agents',
      expect.objectContaining({
        agentId: result.agentId,
        name: 'Agent A',
        publicKey: expect.any(String),
        selfSignature: expect.any(String),
        capabilities: [{ name: 'chat', version: '1.0.0', description: '' }],
        webhook: { url: 'http://127.0.0.1:9101/f2a/webhook' }
      })
    );

    const binding = await loadRuntimeBinding(dataDir, {
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a'
    });
    expect(binding?.agentId).toBe(result.agentId);
    expect(binding?.status).toBe('registered');
    expect(binding?.webhook?.url).toBe('http://127.0.0.1:9101/f2a/webhook');
    expect(binding?.nodeId).toBe('node-1');
    expect(binding?.nodeSignature).toBe('node-sig');
  });

  it('returns existing binding without creating a new agent when not forced', async () => {
    const first = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      name: 'Agent A',
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    vi.mocked(sendRequest).mockClear();

    const second = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      name: 'Agent A',
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    expect(second.agentId).toBe(first.agentId);
    expect(second.alreadyConnected).toBe(true);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid existing agentId before reading identity paths', async () => {
    const result = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      agentId: '../agent:bad',
      name: 'Agent A',
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid agentId format');
    expect(sendRequest).not.toHaveBeenCalled();
  });
});
