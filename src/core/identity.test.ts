import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IdentityManager } from './identity';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('IdentityManager', () => {
  let testDir: string;
  let im: IdentityManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `f2a-test-${Date.now()}`);
    im = new IdentityManager({ configDir: testDir });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it('should create new identity', () => {
    const identity = im.getOrCreateIdentity('TestAgent');
    
    expect(identity.isNew).toBe(true);
    expect(identity.agentId).toBeDefined();
    expect(identity.publicKey).toBeDefined();
    expect(identity.privateKey).toBeDefined();
    expect(identity.displayName).toBe('TestAgent');
  });

  it('should load existing identity', () => {
    const identity1 = im.getOrCreateIdentity();
    const identity2 = im.getOrCreateIdentity();
    
    expect(identity1.isNew).toBe(true);
    expect(identity2.isNew).toBe(false);
    expect(identity1.agentId).toBe(identity2.agentId);
  });

  it('should return identity info', () => {
    im.getOrCreateIdentity('TestAgent');
    const info = im.getIdentityInfo();
    
    expect(info).toBeDefined();
    expect(info?.agentId).toBeDefined();
    expect(info?.displayName).toBe('TestAgent');
  });
});