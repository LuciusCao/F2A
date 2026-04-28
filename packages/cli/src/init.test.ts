import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getAgentIdentitiesDir,
  initAgentIdentity,
  readIdentityByAgentId
} from './init.js';

describe('agent init helpers', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'f2a-init-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('resolves agent identities directory from custom dataDir', () => {
    expect(getAgentIdentitiesDir(dataDir)).toBe(join(dataDir, 'agent-identities'));
  });

  it('creates and reads identity from custom dataDir', async () => {
    const result = await initAgentIdentity({
      dataDir,
      name: 'Test Agent',
      capabilities: [{ name: 'chat', version: '1.0.0' }]
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^agent:[0-9a-f]{16}$/);
    expect(result.identityFile?.startsWith(getAgentIdentitiesDir(dataDir))).toBe(true);
    expect(existsSync(result.identityFile!)).toBe(true);

    const identity = readIdentityByAgentId(result.agentId!, dataDir);
    expect(identity?.agentId).toBe(result.agentId);
    expect(identity?.name).toBe('Test Agent');
    expect(identity?.capabilities).toEqual([{ name: 'chat', version: '1.0.0' }]);
  });
});
