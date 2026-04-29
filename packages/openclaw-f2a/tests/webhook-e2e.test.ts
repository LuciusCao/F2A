/**
 * F2A Webhook E2E Tests (Refactored per Issue #140)
 * 
 * End-to-end flow tests for webhook handling
 * Changes:
 * - Removed HTTP server tests (no self-built server)
 * - Updated service ID to 'f2a-daemon-registration'
 * - Updated webhook URL to use Gateway URL (18789)
 * - Updated API paths to /api/v1/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpenClawPluginApi, ApiLogger, WebhookConfig } from '../src/types';
import { registerToDaemon, unregisterFromDaemon } from '../src/plugin';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

// Create mock request that supports async iteration
function createMockRequest(body: string): any {
  const chunks = [Buffer.from(body), Buffer.alloc(0)];
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (index < chunks.length) {
            return Promise.resolve({ value: chunks[index++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
}

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
          messages: [
            { role: 'user', content: 'test message' },
            { role: 'assistant', content: 'test reply from agent' }
          ]
        })
      }
    },
    registerService: vi.fn(),
    registerHttpRoute: vi.fn()
  };
}

describe('Webhook E2E Flow (Issue #140 Refactored)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP Route Registration', () => {
    it('should register HTTP route on plugin load', async () => {
      const mockApi = createMockApi();
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      // Issue #140: Uses registerHttpRoute instead of HTTP server
      expect(mockApi.registerHttpRoute).toHaveBeenCalled();

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      expect(routeCall.path).toBe('/f2a/webhook');
      expect(routeCall.handler).toBeDefined();
      expect(routeCall.auth).toBe('plugin');
    });
  });

  describe('Token Validation', () => {
    it('should accept valid Bearer token', async () => {
      const mockApi = createMockApi({ webhookToken: 'secure-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: { authorization: 'Bearer secure-token' }
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);
    });

    it('should reject missing token', async () => {
      const mockApi = createMockApi({ webhookToken: 'required-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(401);
      expect(mockRes.end).toHaveBeenCalledWith('Unauthorized');
    });

    it('should reject invalid token', async () => {
      const mockApi = createMockApi({ webhookToken: 'secure-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: { authorization: 'Bearer wrong-token' }
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(401);
    });
  });

  describe('Payload Parsing', () => {
    it('should parse JSON payload correctly', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test-peer', content: 'hello world' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);
      
      // Verify agent was invoked with correct message
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hello world'
        })
      );
    });

    it('should handle malformed JSON', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest('not valid json'),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalledWith('Invalid JSON');
    });

    it('should validate required payload fields', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      // Missing content
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalledWith('Missing from or content');
    });
  });

  describe('OpenClaw Agent Invocation', () => {
    it('should call subagent.run with correct parameters', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:12D3KooWtest', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: expect.stringContaining('f2a-webhook'),
          message: 'hello',
          deliver: true
        })
      );
    });

    it('should wait for subagent completion', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockApi.runtime.subagent?.waitForRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'test-run-id',
          timeoutMs: 60000
        })
      );
    });

    it('should get session messages after completion', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockApi.runtime.subagent?.getSessionMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: expect.any(String),
          limit: 10
        })
      );
    });
  });

  describe('Reply Sending', () => {
    it('should execute f2a CLI with correct parameters', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test-peer-id', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      // Wait for async CLI call
      await new Promise(resolve => setTimeout(resolve, 10));

      const { exec } = await import('child_process');
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/f2a send --to "agent:test-peer-id"/),
        expect.any(Object)
      );
    });

    it('should handle CLI execution errors', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      // Mock exec to throw error
      const { exec } = await import('child_process');
      (exec as any).mockImplementation(() => {
        throw new Error('CLI not found');
      });

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      // Should still return 200 (webhook accepted, reply send is async)
      expect(mockRes.statusCode).toBe(200);
    });
  });

  describe('Auto Registration Flow', () => {
    it('should check daemon health before registration', async () => {
      const mockApi = createMockApi({ autoRegister: true, controlPort: 9001 });

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

      const result = await registerToDaemon(mockApi, {
        webhookPath: '/f2a/webhook',
        webhookToken: 'test',
        agentTimeout: 60000,
        controlPort: 9001,
        agentName: 'Test',
        agentCapabilities: ['chat'],
        autoRegister: true,
        registerRetryInterval: 5000,
        registerMaxRetries: 3,
        _registeredAgentId: ''
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9001/health',
        expect.any(Object)
      );
    });

    it('should skip registration if daemon not running', async () => {
      const mockApi = createMockApi({ autoRegister: true });

      (global.fetch as any).mockImplementation(async () => {
        throw new Error('Daemon not running');
      });

      const result = await registerToDaemon(mockApi, {
        webhookPath: '/f2a/webhook',
        webhookToken: 'test',
        agentTimeout: 60000,
        controlPort: 9001,
        agentName: 'Test',
        agentCapabilities: ['chat'],
        autoRegister: true,
        registerRetryInterval: 5000,
        registerMaxRetries: 3,
        _registeredAgentId: ''
      });

      expect(result.success).toBe(false);
    });

    it('should send webhook configuration in registration (Issue #140)', async () => {
      const mockApi = createMockApi({ 
        autoRegister: true, 
        webhookPath: '/f2a/webhook',
        webhookToken: 'test-token'
      });

      let capturedBody: any = null;

      (global.fetch as any).mockImplementation(async (url: string, opts?: any) => {
        if (url.includes('/health')) {
          return { ok: true } as any;
        }
        if (url.includes('/api/v1/agents')) {
          capturedBody = JSON.parse(opts?.body || '{}');
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

      await registerToDaemon(mockApi, {
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
      });

      // Agent-first webhook URL uses Gateway URL plus a runtime-local Agent route.
      expect(capturedBody.webhook).toBeDefined();
      expect(capturedBody.webhook.url).toBe('http://127.0.0.1:18789/f2a/webhook/agents/default');
      expect(capturedBody.webhook.token).toBe('test-token');
    });
  });

  describe('Agent Unregistration', () => {
    it('should unregister agent on plugin stop', async () => {
      const mockApi = createMockApi({ webhookToken: 'test-token' });
      const agentId = 'agent:test123:abc';

      (global.fetch as any).mockImplementation(async () => ({
        ok: true
      } as any));

      await unregisterFromDaemon(mockApi, {
        webhookPath: '/f2a/webhook',
        webhookToken: 'test-token',
        agentTimeout: 60000,
        controlPort: 9001,
        agentName: 'Test',
        agentCapabilities: ['chat'],
        autoRegister: true,
        registerRetryInterval: 5000,
        registerMaxRetries: 3,
        _registeredAgentId: agentId
      }, agentId);

      // Issue #140: Uses /api/v1/ path
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/agents/'),
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'X-F2A-Token': 'test-token'
          })
        })
      );
    });
  });

  describe('Complete Flow Integration', () => {
    it('should handle complete message flow', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      // Incoming message
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'agent:remote-peer-id',
          content: 'Hello from remote agent'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook/agents/default',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      // 1. Webhook response should be 200
      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true }));

      // 2. Agent should be invoked
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalled();

      // 3. Should wait for agent completion
      expect(mockApi.runtime.subagent?.waitForRun).toHaveBeenCalled();

      // 4. Should get messages
      expect(mockApi.runtime.subagent?.getSessionMessages).toHaveBeenCalled();

      // 5. Reply should be sent via CLI (async)
      await new Promise(resolve => setTimeout(resolve, 10));
      const { exec } = await import('child_process');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('f2a send'),
        expect.any(Object)
      );
    });
  });
});
