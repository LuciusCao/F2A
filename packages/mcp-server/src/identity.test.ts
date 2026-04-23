import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getIdentityFile,
  getDefaultAgentId,
  getAgentToken,
  listLocalIdentities,
} from './identity.js';

// ESM 模式下使用 vi.mock 模拟 fs 模块
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/home/testuser'),
  };
});

import { existsSync, readFileSync, readdirSync } from 'fs';

describe('identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getIdentityFile', () => {
    it('should read valid identity file', () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('agent:abc.json')
      );
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ agentId: 'agent:abc', name: 'Test Agent', token: 'tok123' })
      );

      const result = getIdentityFile('agent:abc');
      expect(result).toEqual({ agentId: 'agent:abc', name: 'Test Agent', token: 'tok123' });
    });

    it('should return null when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getIdentityFile('agent:missing');
      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid json');

      const result = getIdentityFile('agent:bad');
      expect(result).toBeNull();
    });

    it('should return null for empty agentId', () => {
      const result = getIdentityFile('');
      expect(result).toBeNull();
    });
  });

  describe('getDefaultAgentId', () => {
    it('should return the first identity agentId', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'agent:abc.json',
        'agent:def.json',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockImplementation((p) => {
        if (String(p).includes('agent:abc')) {
          return JSON.stringify({ agentId: 'agent:abc', name: 'Agent A' });
        }
        return JSON.stringify({ agentId: 'agent:def', name: 'Agent B' });
      });

      const result = getDefaultAgentId();
      expect(result).toBe('agent:abc');
    });

    it('should return null when directory does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getDefaultAgentId();
      expect(result).toBeNull();
    });

    it('should return null when directory is empty', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      const result = getDefaultAgentId();
      expect(result).toBeNull();
    });
  });

  describe('getAgentToken', () => {
    it('should return token from identity file', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ agentId: 'agent:abc', token: 'secret-token' })
      );

      const result = getAgentToken('agent:abc');
      expect(result).toBe('secret-token');
    });

    it('should return null when token does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ agentId: 'agent:abc' })
      );

      const result = getAgentToken('agent:abc');
      expect(result).toBeNull();
    });

    it('should return null when identity file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getAgentToken('agent:missing');
      expect(result).toBeNull();
    });
  });

  describe('listLocalIdentities', () => {
    it('should list multiple valid identities', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'agent:abc.json',
        'agent:def.json',
        'invalid.txt',
        'not-agent.json',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockImplementation((p) => {
        if (String(p).includes('agent:abc')) {
          return JSON.stringify({ agentId: 'agent:abc', name: 'Agent A' });
        }
        if (String(p).includes('agent:def')) {
          return JSON.stringify({ agentId: 'agent:def', name: 'Agent B' });
        }
        return '{}';
      });

      const result = listLocalIdentities();
      expect(result).toEqual([
        { agentId: 'agent:abc', name: 'Agent A' },
        { agentId: 'agent:def', name: 'Agent B' },
      ]);
    });

    it('should filter out invalid JSON files', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'agent:bad.json',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue('not json');

      const result = listLocalIdentities();
      expect(result).toEqual([]);
    });

    it('should filter out files without agentId', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'agent:no-id.json',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'No ID' }));

      const result = listLocalIdentities();
      expect(result).toEqual([]);
    });

    it('should use default name when name is missing', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'agent:noname.json',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ agentId: 'agent:noname' }));

      const result = listLocalIdentities();
      expect(result).toEqual([{ agentId: 'agent:noname', name: 'unnamed' }]);
    });
  });
});
