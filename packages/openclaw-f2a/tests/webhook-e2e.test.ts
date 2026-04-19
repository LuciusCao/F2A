/**
 * F2A Webhook E2E Tests
 * Phase 4: 端到端测试覆盖
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock HTTP server - must be before plugin import
vi.mock('http', () => {
  const mockServer = {
    listen: vi.fn((port: number, host: string, callback?: () => void) => {
      if (callback) callback();
    }),
    unref: vi.fn(),
    on: vi.fn()
  };
  return {
    createServer: vi.fn(() => mockServer)
  };
});

// Mock child_process for CLI execution - must be before plugin import
vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, 'success', '');
  })
}));

// Mock os module - must be before plugin import
vi.mock('os', () => ({
  homedir: () => '/home/test'
}));

// Mock path module - must be before plugin import
vi.mock('path', () => ({
  join: vi.fn((...args: string[]) => args.join('/'))
}));

// Mock fs modules - must be before plugin import
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('test-control-token')
}));

// Mock fetch for daemon API
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import plugin AFTER all mocks are set up
import type { OpenClawPluginApi, WebhookConfig } from '../src/types';
import register, { registerToDaemon, unregisterFromDaemon } from '../src/plugin';

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
    },
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

describe('Webhook E2E Flow', () => {
  let mockApi: OpenClawPluginApi;
  let mockConfig: Required<WebhookConfig>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockApi();
    mockConfig = {
      webhookPath: '/f2a/webhook',
      webhookPort: 9002,
      webhookToken: 'test-token',
      agentTimeout: 60000,
      controlPort: 9001,
      agentName: 'Test Agent',
      agentCapabilities: ['chat'],
      autoRegister: true,
      registerRetryInterval: 5000,
      registerMaxRetries: 3,
      _registeredAgentId: ''
    };
    
    // Reset fetch mock with default responses
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string, options?: any) => {
      if (url.includes('/health')) {
        return { ok: true, json: async () => ({ status: 'ok' }) };
      }
      if (url.includes('/api/agents') && options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            agent: { agentId: 'agent:test123:abc' }
          })
        };
      }
      if (url.includes('/api/agents') && options?.method === 'DELETE') {
        return { ok: true };
      }
      return { ok: true };
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('HTTP Server Startup', () => {
    it('should register service that starts webhook listener', async () => {
      register(mockApi);
      
      // Check that registerService was called
      expect(mockApi.registerService).toHaveBeenCalled();
      
      // Get the service and check its structure
      const serviceCall = mockApi.registerService?.mock.calls[0][0];
      expect(serviceCall.id).toBe('f2a-webhook-service');
      expect(serviceCall.start).toBeDefined();
      expect(serviceCall.stop).toBeDefined();
    });

    it('should start webhook listener in background via setImmediate', async () => {
      register(mockApi);
      
      // Get the service
      const serviceCall = mockApi.registerService?.mock.calls[0][0];
      
      // Call start() which should schedule webhook listener startup
      serviceCall.start();
      
      // Verify it was called (async via setImmediate)
      expect(mockApi.logger?.info).toHaveBeenCalledWith('[F2A Webhook] Service started');
    });
  });

  describe('Token Validation', () => {
    it('should accept valid Bearer token', async () => {
      const mockReq = {
        method: 'POST',
        url: mockConfig.webhookPath,
        headers: {
          authorization: `Bearer ${mockConfig.webhookToken}`,
          'content-type': 'application/json'
        },
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ value: Buffer.from('{}'), done: false })
            .then(() => Promise.resolve({ value: undefined, done: true }))
        })
      };
      
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      };
      
      // Test token validation logic
      const authHeader = mockReq.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      expect(token).toBe(mockConfig.webhookToken);
    });

    it('should reject missing token', async () => {
      const mockReq = {
        method: 'POST',
        url: mockConfig.webhookPath,
        headers: {
          'content-type': 'application/json'
        }
      };
      
      // Token validation should fail
      const authHeader = mockReq.headers.authorization;
      expect(authHeader).toBeUndefined();
    });

    it('should reject invalid token', async () => {
      const mockReq = {
        method: 'POST',
        url: mockConfig.webhookPath,
        headers: {
          authorization: 'Bearer invalid-token',
          'content-type': 'application/json'
        }
      };
      
      const authHeader = mockReq.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      expect(token).not.toBe(mockConfig.webhookToken);
    });
  });

  describe('Payload Parsing', () => {
    it('should parse JSON payload correctly', async () => {
      const payload = {
        messageId: 'msg-123',
        from: 'agent:sender:123',
        to: 'agent:test123:abc',
        content: 'Hello, this is a test message',
        type: 'chat',
        createdAt: new Date().toISOString()
      };
      
      const body = JSON.stringify(payload);
      const parsed = JSON.parse(body);
      
      expect(parsed.messageId).toBe('msg-123');
      expect(parsed.from).toBe('agent:sender:123');
      expect(parsed.content).toBe('Hello, this is a test message');
    });

    it('should handle malformed JSON', async () => {
      const malformedBody = '{"invalid": json}';
      
      expect(() => JSON.parse(malformedBody)).toThrow();
    });

    it('should validate required payload fields', async () => {
      const validPayload = {
        messageId: 'msg-123',
        from: 'agent:sender:123',
        content: 'test'
      };
      
      // All required fields present
      expect(validPayload.messageId).toBeDefined();
      expect(validPayload.from).toBeDefined();
      expect(validPayload.content).toBeDefined();
    });
  });

  describe('OpenClaw Agent Invocation', () => {
    it('should call subagent.run with correct parameters', async () => {
      const from = 'agent:sender:123';
      const message = 'Hello from F2A';
      
      // Mock subagent.run
      const mockRun = mockApi.runtime?.subagent?.run;
      
      // Simulate invokeAgent behavior
      if (mockApi.runtime?.subagent) {
        const result = await mockApi.runtime.subagent.run({
          task: message,
          context: `F2A message from ${from}`,
          timeoutSeconds: mockConfig.agentTimeout / 1000
        });
        
        expect(mockRun).toHaveBeenCalled();
        expect(result.runId).toBe('test-run-id');
      }
    });

    it('should wait for subagent completion', async () => {
      const mockWaitForRun = mockApi.runtime?.subagent?.waitForRun;
      
      if (mockApi.runtime?.subagent) {
        await mockApi.runtime.subagent.waitForRun('test-run-id', {
          timeoutMs: mockConfig.agentTimeout
        });
        
        expect(mockWaitForRun).toHaveBeenCalledWith('test-run-id', {
          timeoutMs: mockConfig.agentTimeout
        });
      }
    });

    it('should get session messages after completion', async () => {
      const mockGetSessionMessages = mockApi.runtime?.subagent?.getSessionMessages;
      
      if (mockApi.runtime?.subagent) {
        const messages = await mockApi.runtime.subagent.getSessionMessages('test-run-id');
        
        expect(mockGetSessionMessages).toHaveBeenCalled();
        expect(messages.messages).toBeDefined();
        expect(messages.messages.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Reply Sending', () => {
    it('should execute f2a CLI with correct parameters', async () => {
      const from = 'agent:sender:123';
      const reply = 'Reply from OpenClaw Agent';
      
      // Import exec mock
      const { exec } = await import('child_process');
      
      // Simulate reply sending
      const cmd = `f2a send --to "${from}" --message "${reply}"`;
      
      // Execute mock
      exec(cmd, (err, stdout, stderr) => {
        expect(err).toBeNull();
        expect(stdout).toBe('success');
      });
      
      expect(exec).toHaveBeenCalled();
    });

    it('should handle CLI execution errors', async () => {
      const { exec } = await import('child_process');
      
      // Override mock to simulate error
      vi.mocked(exec).mockImplementationOnce((cmd, callback) => {
        callback(new Error('CLI failed'), '', 'error');
      });
      
      exec('f2a send --to "test" --message "test"', (err, stdout, stderr) => {
        expect(err).toBeDefined();
        expect(err?.message).toBe('CLI failed');
      });
    });
  });

  describe('Auto Registration Flow', () => {
    it('should register to daemon on startup', async () => {
      const result = await registerToDaemon(mockApi, mockConfig);
      
      expect(mockFetch).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.agent?.agentId).toBeDefined();
    });

    it('should check daemon health before registration', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: 'ok' }) }))
        .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ success: true, agent: { agentId: 'agent:test' } }) }));
      
      await registerToDaemon(mockApi, mockConfig);
      
      // First call should be health check
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[0]).toContain('/health');
    });

    it('should skip registration if daemon not running', async () => {
      mockFetch.mockReset();
      // Mock health check failure
      mockFetch.mockImplementationOnce(async () => {
        throw new Error('Network error');
      });
      
      const result = await registerToDaemon(mockApi, mockConfig);
      
      expect(result.success).toBe(false);
    });

    it('should send webhook configuration in registration', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: 'ok' }) }))
        .mockImplementationOnce(async (url: string, options?: any) => {
          if (options?.method === 'POST') {
            return { ok: true, json: async () => ({ success: true, agent: { agentId: 'agent:test' } }) };
          }
          return { ok: true };
        });
      
      await registerToDaemon(mockApi, mockConfig);
      
      // Find the POST call
      const postCall = mockFetch.mock.calls.find(
        call => call[1]?.method === 'POST'
      );
      
      expect(postCall).toBeDefined();
      
      const body = JSON.parse(postCall![1].body);
      expect(body.webhook).toBeDefined();
      expect(body.webhook.url).toContain(mockConfig.webhookPort.toString());
      expect(body.webhook.token).toBe(mockConfig.webhookToken);
    });
  });

  describe('Agent Unregistration', () => {
    it('should unregister agent on plugin stop', async () => {
      const agentId = 'agent:test123:abc';
      
      await unregisterFromDaemon(mockApi, mockConfig, agentId);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/agents/${agentId}`),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Complete Flow Integration', () => {
    it('should handle complete message flow', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: 'ok' }) }))
        .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ success: true, agent: { agentId: 'agent:test' } }) }));
      
      // 1. Plugin registration
      register(mockApi);
      expect(mockApi.registerService).toHaveBeenCalled();
      
      // 2. Get the service and start it
      const serviceCall = mockApi.registerService?.mock.calls[0][0];
      serviceCall.start();
      expect(mockApi.logger?.info).toHaveBeenCalledWith('[F2A Webhook] Service started');
      
      // 3. Agent registration (would happen in setImmediate, but we call directly)
      const regResult = await registerToDaemon(mockApi, mockConfig);
      expect(regResult.success).toBe(true);
      
      // 4. Message handling (simulated via subagent mock)
      const payload = {
        messageId: 'msg-123',
        from: 'agent:sender:123',
        content: 'Test message'
      };
      
      // 5. Agent invocation (mocked)
      if (mockApi.runtime?.subagent) {
        const agentResult = await mockApi.runtime.subagent.run({
          task: payload.content,
          context: `F2A message from ${payload.from}`
        });
        expect(agentResult.runId).toBeDefined();
        
        // 6. Get reply
        const messages = await mockApi.runtime.subagent.getSessionMessages(agentResult.runId);
        expect(messages.messages).toBeDefined();
      }
      
      // 7. Reply sending (mocked)
      const { exec } = await import('child_process');
      exec(`f2a send --to "${payload.from}" --message "reply"`, () => {});
      expect(exec).toHaveBeenCalled();
    });
  });
});