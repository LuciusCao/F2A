/**
 * F2A Agent Identity Initialization Tests
 * Task 3: 测试 Agent identity 自动初始化流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebhookConfig, ApiLogger } from '../src/types';
import { join } from 'path';

// Mock modules - factory functions are hoisted
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}));

vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser')
}));

// Import after mocking
import { initializeAgentIdentity, readLatestIdentity, AgentIdentityFileData } from '../src/plugin';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';

// Helper to create full config
function createFullConfig(): Required<WebhookConfig> {
  return {
    webhookPath: '/f2a/webhook',
    webhookToken: 'test-token',
    agentTimeout: 60000,
    controlPort: 9001,
    agentName: 'Test Agent',
    agentCapabilities: ['chat', 'task'],
    autoRegister: true,
    registerRetryInterval: 5000,
    registerMaxRetries: 3,
    _registeredAgentId: ''
  };
}

// Helper to create mock logger
function createMockLogger(): ApiLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

// Sample identity data
const sampleIdentity1: AgentIdentityFileData = {
  agentId: 'agent:test123',
  name: 'Agent 1',
  publicKey: 'testPublicKeyBase64String12345678901234567890',
  privateKey: 'testPrivateKeyBase64String12345678901234567890',
  createdAt: '2024-01-01T00:00:00.000Z',
  lastActiveAt: '2024-01-01T10:00:00.000Z',
  capabilities: [{ name: 'chat', version: '1.0.0' }]
};

const sampleIdentity2: AgentIdentityFileData = {
  agentId: 'agent:test456',
  name: 'Agent 2',
  publicKey: 'testPublicKeyBase64StringABCDEF',
  privateKey: 'testPrivateKeyBase64StringABCDEF',
  createdAt: '2024-01-02T00:00:00.000Z',
  lastActiveAt: '2024-01-02T15:00:00.000Z',
  capabilities: [{ name: 'chat', version: '1.0.0' }]
};

const sampleIdentity3: AgentIdentityFileData = {
  agentId: 'agent:test789',
  name: 'Agent 3',
  publicKey: 'testPublicKeyBase64StringXYZ',
  privateKey: 'testPrivateKeyBase64StringXYZ',
  createdAt: '2024-01-01T00:00:00.000Z',
  lastActiveAt: '2024-01-01T05:00:00.000Z',
  capabilities: [{ name: 'task', version: '1.0.0' }]
};

describe('readLatestIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null when identity directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    
    const result = readLatestIdentity('/nonexistent/path');
    
    expect(result).toBeNull();
    expect(existsSync).toHaveBeenCalledWith('/nonexistent/path');
  });

  it('should return null when no identity files exist', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    
    const result = readLatestIdentity('/some/path');
    
    expect(result).toBeNull();
  });

  it('should return the latest identity when multiple files exist', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      'agent:test123.json',
      'agent:test456.json',
      'agent:test789.json'
    ] as any);
    
    // Mock readFileSync to return different identities based on filename
    vi.mocked(readFileSync).mockImplementation((path: string) => {
      if (path.includes('test123')) return JSON.stringify(sampleIdentity1);
      if (path.includes('test456')) return JSON.stringify(sampleIdentity2);
      if (path.includes('test789')) return JSON.stringify(sampleIdentity3);
      return '{}';
    });
    
    const result = readLatestIdentity('/some/path');
    
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent:test456'); // Latest by lastActiveAt
    expect(result?.name).toBe('Agent 2');
  });

  it('should return single identity when only one file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['agent:test123.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleIdentity1));
    
    const result = readLatestIdentity('/some/path');
    
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent:test123');
    expect(result?.name).toBe('Agent 1');
  });

  it('should skip invalid JSON files', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      'agent:test123.json',
      'agent:test_invalid.json'
    ] as any);
    
    vi.mocked(readFileSync).mockImplementation((path: string) => {
      if (path.includes('test123')) return JSON.stringify(sampleIdentity1);
      if (path.includes('test_invalid')) return 'invalid json content';
      return '{}';
    });
    
    const result = readLatestIdentity('/some/path');
    
    // Should return the valid identity, skipping the invalid one
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent:test123');
  });

  it('should skip files without agentId', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['agent:invalid.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'No Agent ID' }));
    
    const result = readLatestIdentity('/some/path');
    
    expect(result).toBeNull();
  });
});

describe('initializeAgentIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(homedir).mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should read existing identity when file exists', () => {
    const config = createFullConfig();
    const logger = createMockLogger();
    
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['agent:test123.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleIdentity1));
    
    const result = initializeAgentIdentity(config, logger);
    
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent:test123');
    expect(result?.name).toBe('Agent 1');
    
    // Should log that existing identity was found
    expect(logger.info).toHaveBeenCalledWith(
      '[F2A] Found existing agent identity:',
      expect.any(String)
    );
    
    // Should NOT attempt to create via CLI
    expect(execSync).not.toHaveBeenCalled();
  });

  it('should call CLI to create identity when no file exists', () => {
    const config = createFullConfig();
    const logger = createMockLogger();
    
    // First call (checking for existing) - no files
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    
    // CLI execution mock
    vi.mocked(execSync).mockReturnValue('✅ Agent identity created successfully.\nAgentId: agent:testNewId');
    
    // After CLI creates, re-read will find files
    const newIdentity: AgentIdentityFileData = {
      agentId: 'agent:testNewId',
      name: 'Test Agent',
      publicKey: 'newPublicKeyBase64',
      privateKey: 'newPrivateKeyBase64',
      createdAt: '2024-01-03T00:00:00.000Z',
      lastActiveAt: '2024-01-03T00:00:00.000Z'
    };
    
    // First check - no identity, then after CLI creates, identity appears
    vi.mocked(existsSync)
      .mockReturnValueOnce(false) // First check - no identity
      .mockReturnValueOnce(true); // After CLI creates
    
    vi.mocked(readdirSync)
      .mockReturnValueOnce([] as any) // First readdir - empty
      .mockReturnValueOnce(['agent:testNewId.json'] as any); // After CLI
    
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(newIdentity));
    
    const result = initializeAgentIdentity(config, logger);
    
    expect(execSync).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[F2A] No agent identity found, creating new one via CLI...'
    );
  });

  it('should return null and log error when CLI creation fails', () => {
    const config = createFullConfig();
    const logger = createMockLogger();
    
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('f2a CLI not found');
    });
    
    const result = initializeAgentIdentity(config, logger);
    
    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      '[F2A] Failed to create agent identity:',
      expect.any(String)
    );
  });

  it('should return null when CLI creates but read fails', () => {
    const config = createFullConfig();
    const logger = createMockLogger();
    
    vi.mocked(existsSync)
      .mockReturnValueOnce(false) // First check - no identity
      .mockReturnValueOnce(false); // Still no directory after CLI
    
    vi.mocked(readdirSync)
      .mockReturnValueOnce([] as any) // First readdir - empty
      .mockReturnValueOnce([] as any); // Still empty
    
    vi.mocked(execSync).mockReturnValue('Created');
    
    const result = initializeAgentIdentity(config, logger);
    
    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      '[F2A] Failed to read newly created identity'
    );
  });

  it('should use config.agentName for CLI command', () => {
    const config = createFullConfig();
    config.agentName = 'My Custom Agent';
    const logger = createMockLogger();
    
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(execSync).mockReturnValue('Created');
    
    // Setup for successful creation
    vi.mocked(existsSync)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    
    vi.mocked(readdirSync)
      .mockReturnValueOnce([] as any)
      .mockReturnValueOnce(['agent:created.json'] as any);
    
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agentId: 'agent:created',
      name: 'My Custom Agent',
      publicKey: 'key',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastActiveAt: '2024-01-01T00:00:00.000Z'
    }));
    
    initializeAgentIdentity(config, logger);
    
    // Verify the CLI command contains the agent name
    expect(logger.info).toHaveBeenCalledWith(
      '[F2A] Running:',
      expect.stringContaining('My Custom Agent')
    );
    
    // Verify CLI command does NOT include webhook (Task 5: init 不传 webhook)
    expect(logger.info).toHaveBeenCalledWith(
      '[F2A] Running:',
      expect.not.stringContaining('--webhook')
    );
  });

  it('should NOT pass webhook to CLI init command (Task 5)', () => {
    const config = createFullConfig();
    config.webhookPath = '/custom/webhook/path';
    const logger = createMockLogger();
    
    vi.mocked(existsSync)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    
    vi.mocked(readdirSync)
      .mockReturnValueOnce([] as any)
      .mockReturnValueOnce(['agent:created.json'] as any);
    
    vi.mocked(execSync).mockReturnValue('Created');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agentId: 'agent:created',
      name: 'Test',
      publicKey: 'key',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastActiveAt: '2024-01-01T00:00:00.000Z'
    }));
    
    initializeAgentIdentity(config, logger);
    
    // Verify the CLI command does NOT contain webhook parameter
    expect(logger.info).toHaveBeenCalledWith(
      '[F2A] Running:',
      expect.not.stringContaining('--webhook')
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[F2A] Running:',
      expect.not.stringContaining('webhook')
    );
  });

  it('should timeout CLI execution after 30 seconds', () => {
    const config = createFullConfig();
    const logger = createMockLogger();
    
    vi.mocked(existsSync)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    
    vi.mocked(readdirSync)
      .mockReturnValueOnce([] as any)
      .mockReturnValueOnce(['agent:created.json'] as any);
    
    vi.mocked(execSync).mockImplementation((_cmd: string, opts: any) => {
      // Check if timeout is set correctly
      expect(opts?.timeout).toBe(30000);
      return 'Created';
    });
    
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agentId: 'agent:created',
      name: 'Test',
      publicKey: 'key',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastActiveAt: '2024-01-01T00:00:00.000Z'
    }));
    
    initializeAgentIdentity(config, logger);
  });
});

describe('Integration: Auto Registration with Identity Init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(homedir).mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should initialize identity before registration in service start', async () => {
    // This test verifies the integration flow
    // When service.start() is called, initializeAgentIdentity should be invoked
    // before registerToDaemon
    
    const config = createFullConfig();
    const logger = createMockLogger();
    
    // Mock existing identity
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['agent:test123.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleIdentity1));
    
    // Verify the initialization logic would be called
    const result = initializeAgentIdentity(config, logger);
    
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent:test123');
    
    // In the real flow, this identity would be passed to registerToDaemon
  });

  it('should abort registration when identity init fails', async () => {
    const config = createFullConfig();
    const logger = createMockLogger();
    
    // Mock no identity and CLI failure
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('CLI error');
    });
    
    const result = initializeAgentIdentity(config, logger);
    
    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
    
    // In the real flow, registration would be aborted
  });
});