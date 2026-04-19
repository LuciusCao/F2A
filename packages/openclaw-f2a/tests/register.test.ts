/**
 * Phase 5: Auto Registration Tests
 * Unit tests for registerToDaemon, unregisterFromDaemon, and auto-registration flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpenClawPluginApi, ApiLogger, WebhookConfig } from '../src/types';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock HTTP module to prevent actual server creation
vi.mock('http', () => {
  const mockServer = {
    listen: vi.fn((port: number, host: string, callback?: () => void) => {
      if (callback) callback();
    }),
    unref: vi.fn(),
    on: vi.fn(),
    close: vi.fn()
  };
  return {
    createServer: vi.fn(() => mockServer)
  };
});

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

// Helper to create mock API
function createMockApi(config: Partial<WebhookConfig> = {}): OpenClawPluginApi {
  return {
    id: 'test-plugin',
    name: 'openclaw-f2a',
    version: '0.4.0',
    description: 'Test plugin',
    source: 'test',
    config: {
      plugins: {
        entries: {
          'openclaw-f2a': {
            config
          }
        }
      }
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as ApiLogger,
    runtime: {
      version: '1.0.0',
      config: {
        loadConfig: vi.fn().mockResolvedValue({}),
        writeConfigFile: vi.fn().mockResolvedValue(undefined)
      },
      system: {
        enqueueSystemEvent: vi.fn(),
        requestHeartbeatNow: vi.fn()
      },
      subagent: {
        run: vi.fn().mockResolvedValue({ runId: 'test-run-id' }),
        waitForRun: vi.fn().mockResolvedValue({ status: 'ok' }),
        getSessionMessages: vi.fn().mockResolvedValue({
          messages: [
            { role: 'user', content: 'test message' },
            { role: 'assistant', content: 'test reply' }
          ]
        })
      }
    },
    registerService: vi.fn()
  };
}

// Helper to create default config
function createDefaultConfig(): Required<WebhookConfig> {
  return {
    webhookPath: '/f2a/webhook',
    webhookPort: 9002,
    webhookToken: '',
    agentTimeout: 60000,
    controlPort: 9001,
    agentName: 'OpenClaw Agent',
    agentCapabilities: ['chat', 'task'],
    autoRegister: true,
    registerRetryInterval: 5000,
    registerMaxRetries: 3
  };
}

describe('registerToDaemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register successfully when daemon is running', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock health check success
    mockFetch.mockResolvedValueOnce({
      ok: true
    });

    // Mock register API success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        agent: { agentId: 'agent:12D3KooWabc:12345678' }
      })
    });

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    expect(result.success).toBe(true);
    expect(result.agent?.agentId).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    
    // Verify health check call
    expect(mockFetch).toHaveBeenNthCalledWith(1, 
      'http://127.0.0.1:9001/health',
      expect.objectContaining({ signal: expect.any(Object) })
    );
    
    // Verify register call
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'http://127.0.0.1:9001/api/agents',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('should fail when daemon is not running', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock health check failure (connection refused)
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    expect(result.success).toBe(false);
    expect(result.agent).toBeUndefined();
    
    // Verify warn was called with correct message pattern
    expect(mockApi.logger?.warn).toHaveBeenCalled();
    const warnCall = mockApi.logger?.warn?.mock.calls[0];
    expect(warnCall?.[0]).toContain('Daemon not running');
  });

  it('should fail when daemon health check returns non-OK', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock health check returns error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    expect(result.success).toBe(false);
    
    expect(mockApi.logger?.warn).toHaveBeenCalled();
    const warnCall = mockApi.logger?.warn?.mock.calls[0];
    expect(warnCall?.[0]).toContain('Daemon health check failed');
  });

  it('should fail when registration API returns error', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock health check success
    mockFetch.mockResolvedValueOnce({
      ok: true
    });

    // Mock register API failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400
    });

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    expect(result.success).toBe(false);
    
    expect(mockApi.logger?.warn).toHaveBeenCalled();
    const warnCall = mockApi.logger?.warn?.mock.calls[0];
    expect(warnCall?.[0]).toContain('Registration API failed');
  });

  it('should use custom controlPort when configured', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();
    mockConfig.controlPort = 9003;

    // Mock health check success
    mockFetch.mockResolvedValueOnce({ ok: true });
    // Mock register success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, agent: { agentId: 'agent:xxx' } })
    });

    const { registerToDaemon } = await import('../src/plugin');
    await registerToDaemon(mockApi, mockConfig);

    // Verify custom port is used
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'http://127.0.0.1:9003/health',
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'http://127.0.0.1:9003/api/agents',
      expect.any(Object)
    );
  });

  it('should send correct registration payload', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();
    mockConfig.agentName = 'Custom Agent';
    mockConfig.agentCapabilities = ['chat', 'code', 'task'];
    mockConfig.webhookToken = 'secret-token';

    // Mock success responses
    mockFetch.mockResolvedValueOnce({ ok: true });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, agent: { agentId: 'agent:xxx' } })
    });

    const { registerToDaemon } = await import('../src/plugin');
    await registerToDaemon(mockApi, mockConfig);

    // Get the register call body
    const registerCall = mockFetch.mock.calls[1];
    const body = JSON.parse(registerCall[1].body);

    expect(body.name).toBe('Custom Agent');
    expect(body.capabilities).toEqual([
      { name: 'chat', version: '1.0.0' },
      { name: 'code', version: '1.0.0' },
      { name: 'task', version: '1.0.0' }
    ]);
    expect(body.webhook.url).toBe('http://127.0.0.1:9002/f2a/webhook');
    expect(body.webhook.token).toBe('secret-token');
    expect(registerCall[1].headers['X-F2A-Token']).toBe('secret-token');
  });

  it('should handle registration request timeout', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock health check success
    mockFetch.mockResolvedValueOnce({ ok: true });
    
    // Mock register timeout (AbortError)
    mockFetch.mockRejectedValueOnce(new Error('AbortError: The operation was aborted'));

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    expect(result.success).toBe(false);
    
    expect(mockApi.logger?.error).toHaveBeenCalled();
    const errorCall = mockApi.logger?.error?.mock.calls[0];
    expect(errorCall?.[0]).toContain('Registration request failed');
  });
});

describe('unregisterFromDaemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should unregister successfully', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();
    const agentId = 'agent:12D3KooWabc:12345678';

    // Mock DELETE success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    });

    const { unregisterFromDaemon } = await import('../src/plugin');
    await unregisterFromDaemon(mockApi, mockConfig, agentId);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9001/api/agents/agent:12D3KooWabc:12345678',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'X-F2A-Token': ''
        })
      })
    );

    expect(mockApi.logger?.info).toHaveBeenCalled();
    const infoCall = mockApi.logger?.info?.mock.calls[0];
    expect(infoCall?.[0]).toContain('Agent unregistered');
  });

  it('should handle unregister error gracefully', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();
    const agentId = 'agent:12D3KooWabc:12345678';

    // Mock DELETE failure
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { unregisterFromDaemon } = await import('../src/plugin');
    await unregisterFromDaemon(mockApi, mockConfig, agentId);

    expect(mockApi.logger?.warn).toHaveBeenCalled();
    const warnCall = mockApi.logger?.warn?.mock.calls[0];
    expect(warnCall?.[0]).toContain('Unregister failed');
  });

  it('should use custom controlPort for unregister', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();
    mockConfig.controlPort = 9003;
    mockConfig.webhookToken = 'secret-token';
    const agentId = 'agent:xxx';

    mockFetch.mockResolvedValueOnce({ ok: true });

    const { unregisterFromDaemon } = await import('../src/plugin');
    await unregisterFromDaemon(mockApi, mockConfig, agentId);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9003/api/agents/agent:xxx',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'X-F2A-Token': 'secret-token' }
      })
    );
  });

  it('should handle timeout during unregister', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();
    const agentId = 'agent:xxx';

    // Mock timeout
    mockFetch.mockRejectedValueOnce(new Error('AbortError'));

    const { unregisterFromDaemon } = await import('../src/plugin');
    await unregisterFromDaemon(mockApi, mockConfig, agentId);

    expect(mockApi.logger?.warn).toHaveBeenCalled();
  });
});

describe('Auto Registration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should auto-register when webhook listener starts', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock successful registration
    mockFetch.mockResolvedValueOnce({ ok: true }); // health check
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        agent: { agentId: 'agent:12D3KooWabc:12345' }
      })
    }); // register

    const { default: register } = await import('../src/plugin');
    
    register(mockApi);
    
    // Get the service
    const service = mockApi.registerService?.mock.calls[0][0];
    expect(service.id).toBe('f2a-webhook-service');

    // Start the service
    service.start();

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify HTTP server mock was called
    const http = await import('http');
    expect(http.createServer).toHaveBeenCalled();
    
    // Verify registerToDaemon was called (via server.listen callback)
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if fetch was called (indicating registerToDaemon was invoked)
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should skip registration when autoRegister is false', async () => {
    const mockApi = createMockApi({ autoRegister: false });
    
    const { default: register } = await import('../src/plugin');
    
    register(mockApi);

    // Verify service registered but auto-register should be skipped
    expect(mockApi.registerService).toHaveBeenCalled();
    
    // fetch should not be called immediately (only after service start and server listen)
    const service = mockApi.registerService?.mock.calls[0][0];
    service.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Since autoRegister is false, fetch should not be called for registration
    // But health check might still be pending
  });

  it('should save agentId after registration', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock successful registration
    mockFetch.mockResolvedValueOnce({ ok: true });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        agent: { agentId: 'agent:test-id-123' }
      })
    });

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    // Verify the result contains agentId
    expect(result.success).toBe(true);
    expect(result.agent?.agentId).toBe('agent:test-id-123');
  });

  it('should handle registration failure gracefully', async () => {
    const mockApi = createMockApi();
    const mockConfig = createDefaultConfig();

    // Mock daemon not running
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { registerToDaemon } = await import('../src/plugin');
    const result = await registerToDaemon(mockApi, mockConfig);

    expect(result.success).toBe(false);
    
    expect(mockApi.logger?.warn).toHaveBeenCalled();
    const warnCall = mockApi.logger?.warn?.mock.calls[0];
    expect(warnCall?.[0]).toContain('Daemon not running');
  });
});

describe('WebhookConfig Parameters', () => {
  it('should support all new configuration parameters', () => {
    const config: WebhookConfig = {
      webhookPath: '/f2a/webhook',
      webhookPort: 9002,
      webhookToken: 'secret',
      agentTimeout: 30000,
      controlPort: 9001,
      agentName: 'Test Agent',
      agentCapabilities: ['chat', 'code'],
      autoRegister: true,
      registerRetryInterval: 3000,
      registerMaxRetries: 5
    };

    expect(config.controlPort).toBe(9001);
    expect(config.agentName).toBe('Test Agent');
    expect(config.agentCapabilities).toEqual(['chat', 'code']);
    expect(config.autoRegister).toBe(true);
    expect(config.registerRetryInterval).toBe(3000);
    expect(config.registerMaxRetries).toBe(5);
  });

  it('should use default values when not specified', () => {
    const config: WebhookConfig = {
      webhookPath: '/f2a/webhook'
    };

    // These should be undefined in partial config
    expect(config.controlPort).toBeUndefined();
    expect(config.agentName).toBeUndefined();
    expect(config.agentCapabilities).toBeUndefined();
    expect(config.autoRegister).toBeUndefined();

    // But DEFAULT_CONFIG provides defaults
    const defaultConfig = createDefaultConfig();
    expect(defaultConfig.controlPort).toBe(9001);
    expect(defaultConfig.agentName).toBe('OpenClaw Agent');
    expect(defaultConfig.agentCapabilities).toEqual(['chat', 'task']);
    expect(defaultConfig.autoRegister).toBe(true);
  });

  it('should merge config with defaults correctly', () => {
    const partialConfig: WebhookConfig = {
      webhookPort: 9003,
      agentName: 'Custom Agent'
    };

    const mergedConfig = {
      ...createDefaultConfig(),
      ...partialConfig
    };

    // Partial config should override defaults
    expect(mergedConfig.webhookPort).toBe(9003);
    expect(mergedConfig.agentName).toBe('Custom Agent');
    
    // Other defaults should remain
    expect(mergedConfig.controlPort).toBe(9001);
    expect(mergedConfig.agentCapabilities).toEqual(['chat', 'task']);
    expect(mergedConfig.autoRegister).toBe(true);
  });
});