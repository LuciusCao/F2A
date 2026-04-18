/**
 * F2A Webhook Plugin Tests
 * Unit tests for webhook handling scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpenClawPluginApi, ApiLogger, WebhookConfig } from '../src/types';

// Mock child_process and http modules
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

// Create a mock request that supports async iteration
function createMockRequest(body: string): any {
  const chunks = [Buffer.from(body), Buffer.alloc(0)]; // body + end signal
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

vi.mock('http', () => {
  const mockServer = {
    listen: vi.fn((port: number, host: string, callback?: () => void) => {
      if (callback) callback();
    }),
    unref: vi.fn()
  };
  return {
    createServer: vi.fn(() => mockServer)
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('test-control-token')
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test')
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

describe('F2A Webhook Plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP Server Startup', () => {
    it('should start HTTP server on configured port', async () => {
      const mockApi = createMockApi({ webhookPort: 9002 });
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      // registerService should be called
      expect(mockApi.registerService).toHaveBeenCalled();

      const service = mockApi.registerService?.mock.calls[0][0];
      expect(service.id).toBe('f2a-webhook-service');

      // Start the service
      service.start();

      // Wait for async setImmediate
      await new Promise(resolve => setTimeout(resolve, 10));

      // HTTP server should be created and listening
      const http = await import('http');
      expect(http.createServer).toHaveBeenCalled();

      const server = http.createServer.mock.results[0].value;
      expect(server.listen).toHaveBeenCalledWith(9002, '127.0.0.1', expect.any(Function));
      expect(server.unref).toHaveBeenCalled();
    });

    it('should use default port 9002 if not configured', async () => {
      const mockApi = createMockApi({});
      const { default: register } = await import('../src/plugin');

      register(mockApi);

      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const server = http.createServer.mock.results[0].value;

      expect(server.listen).toHaveBeenCalledWith(9002, '127.0.0.1', expect.any(Function));
    });
  });

  describe('Token Validation', () => {
    it('should reject requests without valid token', async () => {
      const mockApi = createMockApi({ webhookToken: 'secure-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      // Create mock request without auth
      const mockReq = {
        method: 'POST',
        url: '/f2a/webhook',
        headers: {}
      } as any;

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      // Simulate request handling
      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(401);
      expect(mockRes.end).toHaveBeenCalledWith('Unauthorized');
    });

    it('should accept requests with valid Bearer token', async () => {
      const mockApi = createMockApi({ webhookToken: 'secure-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      // Create mock request with valid Bearer token
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: { authorization: 'Bearer secure-token' }
        }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should not return 401
      expect(mockRes.writeHead).not.toHaveBeenCalledWith(401);
    });

    it('should accept requests with valid x-f2a-token header', async () => {
      const mockApi = createMockApi({ webhookToken: 'secure-token' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        {
          method: 'POST',
          url: '/f2a/webhook',
          headers: { 'x-f2a-token': 'secure-token' }
        }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).not.toHaveBeenCalledWith(401);
    });
  });

  describe('Payload Parsing', () => {
    it('should reject invalid JSON payload', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest('invalid json'),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(400);
      expect(mockRes.end).toHaveBeenCalledWith('Invalid JSON');
    });

    it('should reject payload missing from field', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ content: 'hello without sender' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(400);
      expect(mockRes.end).toHaveBeenCalledWith('Missing from or content');
    });

    it('should reject payload missing content field', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(400);
      expect(mockRes.end).toHaveBeenCalledWith('Missing from or content');
    });

    it('should accept valid payload with from and content', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true }));
    });

    it('should accept fromAgentId as alternative to from', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ fromAgentId: 'test-agent-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    });

    it('should accept from as object with agentId and name (MessageRouter format)', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      // Payload with from as object {agentId, name}
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: { agentId: 'agent:12d3k00wtest', name: 'TestAgent' },
          content: 'hello from object'
        })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should return 200 success
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      // Should extract agentId from the from object for session key
      // sessionKey = 'f2a-webhook-' + fromAgentId.slice(0, 16)
      // fromAgentId = 'agent:12d3k00wtest', slice(0,16) = 'agent:12d3k00wte'
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hello from object',
          sessionKey: 'f2a-webhook-agent:12d3k00wte'
        })
      );
    });

    it('should accept message field as alternative to content (MessageRouter format)', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      // Payload with message field instead of content
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: 'test-peer-id',
          message: 'hello via message field'
        })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should return 200 success
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      // Should use message field as the content
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hello via message field'
        })
      );
    });

    it('should accept combined format with from object and message field', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      // Payload with both from object and message field
      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({
          from: { agentId: 'agent:abc123xyz789', name: 'RemoteAgent' },
          message: 'combined format message'
        })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should return 200 success
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      // Should correctly extract both from object's agentId and message field
      // sessionKey = 'f2a-webhook-' + fromAgentId.slice(0, 16)
      // fromAgentId = 'agent:abc123xyz789', slice(0,16) = 'agent:abc123xyz7'
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'combined format message',
          sessionKey: 'f2a-webhook-agent:abc123xyz7'
        })
      );
    });
  });

  describe('Agent-Specific Webhook Path', () => {
    it('should accept agent-specific webhook path /f2a/webhook/agent:<id>', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook/agent:12d3k00w', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    });

    it('should use agent ID prefix as session key for agent-specific webhook', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook/agent:12d3k00w', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should use agent ID prefix in session key
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith({
        sessionKey: 'f2a-webhook-12d3k00w',
        message: 'hello',
        deliver: true,
        idempotencyKey: expect.any(String)
      });
    });

    it('should reject invalid agent webhook path format', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook/agent-invalid', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
    });

    it('should reject agent webhook path with non-hex ID', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook/agent:xyz123!', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
    });

    it('should log agent ID prefix in webhook type', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook/agent:abc123def', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should log with agent ID prefix
      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('agent:abc123def')
      );
    });

    it('should use from prefix as session key for global webhook', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: '12d3k00wtest123456789', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should use from prefix in session key (first 16 chars)
      // from = '12d3k00wtest123456789' -> slice(0,16) = '12d3k00wtest1234'
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith({
        sessionKey: 'f2a-webhook-12d3k00wtest1234',
        message: 'hello',
        deliver: true,
        idempotencyKey: expect.any(String)
      });
    });
  });

  describe('Agent Invocation', () => {
    it('should invoke subagent API to generate reply', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should call subagent.run
      expect(mockApi.runtime.subagent?.run).toHaveBeenCalledWith({
        sessionKey: expect.stringContaining('f2a-webhook'),
        message: 'hello',
        deliver: true,
        idempotencyKey: expect.any(String)
      });

      // Should call waitForRun
      expect(mockApi.runtime.subagent?.waitForRun).toHaveBeenCalledWith({
        runId: 'test-run-id',
        timeoutMs: 60000
      });

      // Should call getSessionMessages
      expect(mockApi.runtime.subagent?.getSessionMessages).toHaveBeenCalledWith({
        sessionKey: expect.stringContaining('f2a-webhook'),
        limit: 10
      });
    });

    it('should handle Agent timeout gracefully', async () => {
      const mockApi = createMockApi({ webhookToken: '', agentTimeout: 5000 });
      mockApi.runtime.subagent!.waitForRun = vi.fn().mockResolvedValue({ status: 'timeout' });

      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // Should log timeout warning
      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('Agent timeout')
      );
    });

    it('should handle Agent error gracefully', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      mockApi.runtime.subagent!.waitForRun = vi.fn().mockResolvedValue({
        status: 'error',
        error: 'Agent failed'
      });

      const { default: register } = await import('../src/plugin');

      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockApi.logger?.error).toHaveBeenCalledWith(
        expect.stringContaining('Agent error')
      );
    });
  });

  describe('CLI Send', () => {
    it('should send reply via f2a CLI', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');
      const childProcess = await import('child_process');
      
      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();
      
      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // exec should be called with f2a send command
      expect(childProcess.exec).toHaveBeenCalledWith(
        expect.stringContaining('f2a send'),
        expect.objectContaining({ timeout: 10000 })
      );
    });

    it('should log success when reply sent', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      const { default: register } = await import('../src/plugin');
      
      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();
      
      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('Reply sent')
      );
    });

    it('should not send reply if Agent returns nothing', async () => {
      const mockApi = createMockApi({ webhookToken: '' });
      mockApi.runtime.subagent!.getSessionMessages = vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'hello' }] // No assistant reply
      });
      
      const { default: register } = await import('../src/plugin');
      const childProcess = await import('child_process');
      
      register(mockApi);
      const service = mockApi.registerService?.mock.calls[0][0];
      service.start();
      
      await new Promise(resolve => setTimeout(resolve, 10));

      const http = await import('http');
      const mockRequestHandler = http.createServer.mock.calls[0][0];

      const mockReq = Object.assign(
        createMockRequest(JSON.stringify({ from: 'test-peer-id', content: 'hello' })),
        { method: 'POST', url: '/f2a/webhook', headers: {} }
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as any;

      await mockRequestHandler(mockReq, mockRes);

      // exec should NOT be called when no reply
      expect(childProcess.exec).not.toHaveBeenCalled();
    });
  });
});