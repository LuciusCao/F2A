/**
 * F2A Webhook Plugin Tests (Refactored per Issue #140)
 * 
 * Changes:
 * - Removed HTTP server tests (no self-built server)
 * - Added registerHttpRoute tests
 * - Updated service ID to 'f2a-daemon-registration'
 * - Updated webhook URL to use Gateway URL (18789)
 * - Updated API paths to /api/v1/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpenClawPluginApi, ApiLogger, WebhookConfig } from '../src/types';

// Mock child_process module
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

// Create a mock request that supports async iteration
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
            { role: 'assistant', content: 'test reply' }
          ]
        })
      }
    },
    registerService: vi.fn(),
    registerHttpRoute: vi.fn()
  };
}

describe('F2A Webhook Plugin (Issue #140 Refactored)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock global fetch
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/health')) {
        return { ok: true, json: async () => ({ status: 'ok' }) } as any;
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP Route Registration (Issue #140)', () => {
    it('should register HTTP route with Gateway via registerHttpRoute', async () => {
      const mockApi = createMockApi({ webhookPath: '/f2a/webhook' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      // registerHttpRoute should be called
      expect(mockApi.registerHttpRoute).toHaveBeenCalled();

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      expect(routeCall.path).toBe('/f2a/webhook');
      expect(routeCall.auth).toBe('plugin');  // Plugin handles its own auth
      expect(routeCall.handler).toBeDefined();
    });

    it('should use default webhook path if not configured', async () => {
      const mockApi = createMockApi({});
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      expect(routeCall.path).toBe('/f2a/webhook');
    });

    it('should warn if registerHttpRoute not available', async () => {
      const mockApi = createMockApi({});
      // @ts-ignore - remove registerHttpRoute
      mockApi.registerHttpRoute = undefined;
      
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('registerHttpRoute not available')
      );
    });
  });

  describe('Service Registration', () => {
    it('should register daemon registration service', async () => {
      const mockApi = createMockApi({ autoRegister: false });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      expect(mockApi.registerService).toHaveBeenCalled();

      const service = mockApi.registerService?.mock.calls[0][0];
      expect(service.id).toBe('f2a-daemon-registration');  // Changed from 'f2a-webhook-service'
      expect(service.start).toBeDefined();
      expect(service.stop).toBeDefined();
    });
  });

  describe('Webhook Handler', () => {
    it('should handle POST request with valid payload', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      // Get the webhook handler
      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      // Create mock request and response
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test-peer', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',
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
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true }));
    });

    it('should reject non-POST requests', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = {
        method: 'GET',
        url: '/f2a/webhook',
        headers: {}
      } as any;

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(404);
    });

    it('should validate webhook token', async () => {
      const mockApi = createMockApi({ webhookToken: 'secret-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      // Request without token
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(401);
    });

    it('should accept valid Bearer token', async () => {
      const mockApi = createMockApi({ webhookToken: 'secret-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: { authorization: 'Bearer secret-token' }
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

    it('should reject invalid JSON payload', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest('invalid json'),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(400);
    });

    it('should reject payload missing from field', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(400);
    });

    it('should accept from as object (MessageRouter format)', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: { agentId: 'agent:12d3kooWtest', name: 'TestAgent' },
          content: 'hello from object'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook',
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
      
      // Should extract agentId from the from object
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hello from object',
          sessionKey: expect.stringContaining('agent:12d3kooWte')
        })
      );
    });

    it('should accept message field as alternative to content', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'agent:test-peer',
          message: 'hello via message field'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook',
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
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hello via message field'
        })
      );
    });

    it('should handle agent-specific webhook path', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'agent:test-peer',
          content: 'hello to specific agent'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook/agent:specific123',
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
      
      // Should use agent ID prefix as session key
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: expect.stringContaining('specific123')
        })
      );
    });
  });

  describe('Agent Invocation', () => {
    it('should invoke subagent API to generate reply', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'agent:test-peer',
          content: 'hello'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook',
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
          message: 'hello',
          sessionKey: expect.stringContaining('f2a-webhook'),
          deliver: true
        })
      );

      expect(mockApi.runtime.subagent?.waitForRun).toHaveBeenCalled();
    });

    it('should handle Agent timeout gracefully', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      mockApi.runtime.subagent!.waitForRun = vi.fn().mockResolvedValue({ status: 'timeout' });
      
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'agent:test-peer',
          content: 'hello'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: {}
        }
      );

      const mockRes = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn()
      } as any;

      await handler(mockReq, mockRes);

      expect(mockRes.statusCode).toBe(200);  // Still returns 200
    });
  });

  describe('Reply Sending', () => {
    it('should send reply via f2a CLI', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register, invokeAgent } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'agent:test-peer',
          content: 'hello'
        })),
        {
          method: 'POST',
          url: '/f2a/webhook',
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
        expect.stringContaining('f2a send'),
        expect.any(Object)
      );
    });
  });

  describe('WebhookConfig Parameters', () => {
    it('should support webhookPath configuration', async () => {
      const mockApi = createMockApi({ webhookPath: '/custom/webhook' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      expect(routeCall.path).toBe('/custom/webhook');
    });

    it('should support webhookToken configuration', async () => {
      const mockApi = createMockApi({ webhookToken: 'my-secret-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
      const handler = routeCall.handler;

      // Test with valid token
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'agent:test', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',  // Use default path
          headers: { 'x-f2a-token': 'my-secret-token' }
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
  });
});