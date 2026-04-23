/**
 * F2A CLI Init command tests
 *
 * Tests for agent init functionality including --no-webhook mode
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_HOME = join(tmpdir(), `f2a-init-test-${Date.now()}`);

vi.doMock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => TEST_HOME,
  };
});

let initAgentIdentity: typeof import('./init.js').initAgentIdentity;
let cliInitAgent: typeof import('./init.js').cliInitAgent;
let setJsonMode: typeof import('./output.js').setJsonMode;

beforeAll(async () => {
  const initMod = await import('./init.js');
  initAgentIdentity = initMod.initAgentIdentity;
  cliInitAgent = initMod.cliInitAgent;
  const outputMod = await import('./output.js');
  setJsonMode = outputMod.setJsonMode;
});

// Mock process.exit to prevent tests from exiting
const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit called with code ${code}`);
});

describe('CLI Init Commands', () => {
  beforeEach(() => {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
    mkdirSync(TEST_HOME, { recursive: true });
    setJsonMode?.(false);
    processExitSpy.mockClear();
  });

  afterEach(() => {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
    setJsonMode?.(false);
  });

  describe('initAgentIdentity', () => {
    it('should create identity without webhook when --no-webhook is used', async () => {
      const result = await initAgentIdentity({ name: 'KimiCoder' });

      expect(result.success).toBe(true);
      expect(result.agentId).toBeDefined();
      expect(result.identityFile).toBeDefined();
      expect(existsSync(result.identityFile!)).toBe(true);

      const identityFile = JSON.parse(readFileSync(result.identityFile!, 'utf-8'));
      expect(identityFile.name).toBe('KimiCoder');
      expect(identityFile.webhook).toBeUndefined();
      expect(identityFile.agentId).toMatch(/^agent:/);
      expect(identityFile.publicKey).toBeDefined();
      expect(identityFile.privateKey).toBeDefined();
    });

    it('should create identity with webhook when --webhook is provided', async () => {
      const result = await initAgentIdentity({
        name: 'TestAgent',
        webhook: 'http://localhost:3000/webhook',
      });

      expect(result.success).toBe(true);
      expect(result.identityFile).toBeDefined();

      const identityFile = JSON.parse(readFileSync(result.identityFile!, 'utf-8'));
      expect(identityFile.name).toBe('TestAgent');
      expect(identityFile.webhook).toEqual({ url: 'http://localhost:3000/webhook' });
    });

    it('should fail when name is missing', async () => {
      const result = await initAgentIdentity({ name: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('--name');
    });

    it('should not fail when webhook is missing', async () => {
      const result = await initAgentIdentity({ name: 'NoWebhookAgent' });

      expect(result.success).toBe(true);
    });

    it('should create identity with capabilities', async () => {
      const result = await initAgentIdentity({
        name: 'CapAgent',
        capabilities: [{ name: 'chat', version: '1.0.0' }],
      });

      expect(result.success).toBe(true);

      const identityFile = JSON.parse(readFileSync(result.identityFile!, 'utf-8'));
      expect(identityFile.capabilities).toEqual([{ name: 'chat', version: '1.0.0' }]);
    });
  });

  describe('cliInitAgent', () => {
    it('should create identity without webhook and print success', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await cliInitAgent({ name: 'KimiCoder' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('KimiCoder');
      expect(output).not.toContain('Webhook:');

      consoleSpy.mockRestore();
    });

    it('should create identity with webhook and print webhook info', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await cliInitAgent({ name: 'TestAgent', webhook: 'http://example.com/webhook' });

      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Webhook: http://example.com/webhook');

      consoleSpy.mockRestore();
    });

    it('should output JSON when json mode is enabled without webhook', async () => {
      setJsonMode(true);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await cliInitAgent({ name: 'JsonAgent' });

      const jsonCall = consoleSpy.mock.calls.find(
        (call) => {
          try {
            JSON.parse(call[0] as string);
            return true;
          } catch {
            return false;
          }
        }
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0] as string);
      expect(parsed.success).toBe(true);
      expect(parsed.data.name).toBe('JsonAgent');
      expect(parsed.data.webhook).toBeNull();

      consoleSpy.mockRestore();
      setJsonMode(false);
    });

    it('should output JSON when json mode is enabled with webhook', async () => {
      setJsonMode(true);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await cliInitAgent({ name: 'JsonAgent', webhook: 'http://hook.test' });

      const jsonCall = consoleSpy.mock.calls.find(
        (call) => {
          try {
            JSON.parse(call[0] as string);
            return true;
          } catch {
            return false;
          }
        }
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0] as string);
      expect(parsed.data.webhook).toBe('http://hook.test');

      consoleSpy.mockRestore();
      setJsonMode(false);
    });

    it('should print error and exit when name is missing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await cliInitAgent({ name: '' });
      } catch {
        // process.exit throws
      }

      expect(processExitSpy).toHaveBeenCalledWith(1);
      consoleErrorSpy.mockRestore();
    });

    it('should not exit when webhook is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await cliInitAgent({ name: 'NoWebhookAgent' });

      expect(processExitSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should create identity with capabilities', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await cliInitAgent({ name: 'CapAgent', capabilities: ['chat', 'code'] });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
      consoleSpy.mockRestore();
    });
  });
});
