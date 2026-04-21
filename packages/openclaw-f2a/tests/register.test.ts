/**
 * F2A Registration Tests (Refactored per Issue #140)
 * 
 * Changes:
 * - Updated API paths to /api/v1/
 * - Updated webhook URL to use Gateway URL (18789, not 9002)
 * - Updated service ID to 'f2a-daemon-registration'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerToDaemon, unregisterFromDaemon } from '../src/plugin';
import type { OpenClawPluginApi, ApiLogger, WebhookConfig } from '../src/types';

// Helper to create mock API
function createMockApi(config: Partial<WebhookConfig> = {}): OpenClawPluginApi {
  return {
    id: 'test-plugin',
    name: 'openclaw-f2a',
    version: '0.5.0',
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
      gatewayBaseUrl: 'http://127.0.0.1:18789',
      subagent: {
        run: vi.fn().mockResolvedValue({ runId: 'test-run-id' }),
        waitForRun: vi.fn().mockResolvedValue({ status: 'ok' }),
        getSessionMessages: vi.fn().mockResolvedValue({
          messages: []
        })
      }
    },
    registerService: vi.fn(),
    registerHttpRoute: vi.fn()
  };
}

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

describe('registerToDaemon (Issue #140 Refactored)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register successfully when daemon is running', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();

    // Mock successful health check
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true } as any;
      }
      if (url.includes('/api/v1/agents')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            agent: { agentId: 'agent:test123' },
            token: 'test-token'
          })
        } as any;
      }
      return { ok: false } as any;
    });

    const result = await registerToDaemon(mockApi, config);

    expect(result.success).toBe(true);
    expect(result.agent?.agentId).toBe('agent:test123');
    expect(result.token).toBe('test-token');

    // Verify health check call
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9001/health',
      expect.any(Object)
    );

    // Verify registration call (Issue #140: uses /api/v1/agents)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9001/api/v1/agents',
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
    const config = createFullConfig();

    // Mock failed health check
    (global.fetch as any).mockImplementation(async () => {
      throw new Error('Connection refused');
    });

    const result = await registerToDaemon(mockApi, config);

    expect(result.success).toBe(false);
    expect(mockApi.logger?.warn).toHaveBeenCalled();
  });

  it('should fail when daemon health check returns non-OK', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: false } as any;
      }
      return { ok: false } as any;
    });

    const result = await registerToDaemon(mockApi, config);

    expect(result.success).toBe(false);
  });

  it('should fail when registration API returns error', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true } as any;
      }
      if (url.includes('/api/v1/agents')) {
        return { ok: false, status: 500 } as any;
      }
      return { ok: false } as any;
    });

    const result = await registerToDaemon(mockApi, config);

    expect(result.success).toBe(false);
  });

  it('should use custom controlPort when configured', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();
    config.controlPort = 9003;

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true } as any;
      }
      if (url.includes('/api/v1/agents')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            agent: { agentId: 'agent:test' },
            token: 'token'
          })
        } as any;
      }
      return { ok: false } as any;
    });

    await registerToDaemon(mockApi, config);

    // Verify custom control port is used (Issue #140: /api/v1/)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9003/health',
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9003/api/v1/agents',
      expect.any(Object)
    );
  });

  it('should send correct registration payload', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();
    config.webhookToken = 'secret-token';
    config.agentName = 'My Custom Agent';
    config.agentCapabilities = ['chat', 'code', 'file'];

    (global.fetch as any).mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/health')) {
        return { ok: true } as any;
      }
      if (url.includes('/api/v1/agents')) {
        // Verify payload
        const body = JSON.parse(opts?.body || '{}');
        
        // Issue #140: Webhook URL uses Gateway URL (18789), not webhookPort (9002)
        expect(body.webhook.url).toBe('http://127.0.0.1:18789/f2a/webhook');
        expect(body.webhook.token).toBe('secret-token');
        expect(body.name).toBe('My Custom Agent');
        expect(body.capabilities).toEqual([
          { name: 'chat', version: '1.0.0' },
          { name: 'code', version: '1.0.0' },
          { name: 'file', version: '1.0.0' }
        ]);
        
        return {
          ok: true,
          json: async () => ({
            success: true,
            agent: { agentId: 'agent:test' },
            token: 'token'
          })
        } as any;
      }
      return { ok: false } as any;
    });

    const result = await registerToDaemon(mockApi, config);

    expect(result.success).toBe(true);
  });

  it('should handle registration request timeout', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true } as any;
      }
      // Simulate timeout by throwing AbortError
      if (url.includes('/api/v1/agents')) {
        const err = new Error('Timeout');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: false } as any;
    });

    const result = await registerToDaemon(mockApi, config);

    expect(result.success).toBe(false);
    expect(mockApi.logger?.error).toHaveBeenCalled();
  });
});

describe('unregisterFromDaemon (Issue #140 Refactored)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should unregister successfully', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();
    const agentId = 'agent:12D3KooWabc:12345678';

    (global.fetch as any).mockImplementation(async () => ({
      ok: true
    } as any));

    await unregisterFromDaemon(mockApi, config, agentId);

    // Issue #140: Uses /api/v1/agents path
    expect(global.fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9001/api/v1/agents/${agentId}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'X-F2A-Token': 'test-token'
        })
      })
    );
    
    expect(mockApi.logger?.info).toHaveBeenCalledWith(
      '[F2A] Agent unregistered:',
      expect.any(String)
    );
  });

  it('should handle unregister error gracefully', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();
    const agentId = 'agent:test-id';

    (global.fetch as any).mockImplementation(async () => {
      throw new Error('Connection refused');
    });

    await unregisterFromDaemon(mockApi, config, agentId);

    expect(mockApi.logger?.warn).toHaveBeenCalledWith(
      '[F2A] Unregister failed:',
      expect.any(String)
    );
  });

  it('should use custom controlPort for unregister', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();
    config.controlPort = 9003;
    config.webhookToken = 'secret-token';
    const agentId = 'agent:xxx';

    (global.fetch as any).mockImplementation(async () => ({
      ok: true
    } as any));

    await unregisterFromDaemon(mockApi, config, agentId);

    // Issue #140: Uses /api/v1/ path with custom port
    expect(global.fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9003/api/v1/agents/${agentId}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'X-F2A-Token': 'secret-token'
        })
      })
    );
  });

  it('should handle timeout during unregister', async () => {
    const mockApi = createMockApi();
    const config = createFullConfig();
    const agentId = 'agent:test-id';

    (global.fetch as any).mockImplementation(async () => {
      const err = new Error('Timeout');
      err.name = 'AbortError';
      throw err;
    });

    await unregisterFromDaemon(mockApi, config, agentId);

    expect(mockApi.logger?.warn).toHaveBeenCalled();
  });
});

describe('Auto Registration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should auto-register when service starts', async () => {
    const mockApi = createMockApi({ autoRegister: true });
    
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true } as any;
      }
      if (url.includes('/api/v1/agents')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            agent: { agentId: 'agent:auto-register-test' },
            token: 'test-token'
          })
        } as any;
      }
      return { ok: false } as any;
    });

    const { default: register } = await import('../src/plugin');

    register(mockApi);

    // Get the service (Issue #140: ID changed to 'f2a-daemon-registration')
    const service = mockApi.registerService?.mock.calls[0][0];
    expect(service.id).toBe('f2a-daemon-registration');

    // Start the service
    service.start();

    // Run setImmediate
    vi.runAllTimersAsync();

    // Wait for async operations
    await vi.waitFor(() => {
      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('Registered successfully')
      );
    }, { timeout: 1000 });
  });

  it('should skip registration when autoRegister is false', async () => {
    const mockApi = createMockApi({ autoRegister: false });
    
    const { default: register } = await import('../src/plugin');

    register(mockApi);

    const service = mockApi.registerService?.mock.calls[0][0];
    service.start();

    vi.runAllTimersAsync();

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should not call fetch for registration
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/agents'),
      expect.any(Object)
    );
  });

  it('should handle registration failure gracefully', async () => {
    const mockApi = createMockApi({ autoRegister: true });
    
    (global.fetch as any).mockImplementation(async () => {
      throw new Error('Daemon not running');
    });

    const { default: register } = await import('../src/plugin');

    register(mockApi);

    const service = mockApi.registerService?.mock.calls[0][0];
    service.start();

    vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('Registration failed')
      );
    }, { timeout: 1000 });
  });
});

describe('WebhookConfig Parameters', () => {
  it('should support all configuration parameters', async () => {
    const mockApi = createMockApi({
      webhookPath: '/custom/webhook',
      webhookToken: 'custom-token',
      agentTimeout: 30000,
      controlPort: 9005,
      agentName: 'Custom Agent',
      agentCapabilities: ['chat'],
      autoRegister: false,
      registerRetryInterval: 1000,
      registerMaxRetries: 5
    });
    
    (global.fetch as any).mockImplementation(async () => ({ ok: true } as any));

    const { default: register } = await import('../src/plugin');

    register(mockApi);

    // Verify all config values are used
    const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
    expect(routeCall.path).toBe('/custom/webhook');
  });

  it('should use default values when not specified', async () => {
    const mockApi = createMockApi({});  // Empty config
    
    (global.fetch as any).mockImplementation(async () => ({ ok: true } as any));

    const { default: register } = await import('../src/plugin');

    register(mockApi);

    const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
    expect(routeCall.path).toBe('/f2a/webhook');  // Default path
  });
});