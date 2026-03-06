import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookServer, WebhookHandler } from './webhook-server';
import { AgentCapability } from './types';

// Mock http module
vi.mock('http', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((port, callback) => callback()),
    close: vi.fn((callback) => callback && callback()),
    on: vi.fn(),
  })),
}));

describe('WebhookServer', () => {
  let server: WebhookServer;
  let mockHandler: WebhookHandler;

  const mockCapabilities: AgentCapability[] = [
    {
      name: 'file-operation',
      description: 'File operations',
      tools: ['read', 'write'],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandler = {
      onDiscover: vi.fn().mockResolvedValue({
        capabilities: mockCapabilities,
        reputation: 80,
      }),
      onDelegate: vi.fn().mockResolvedValue({
        accepted: true,
        taskId: 'task-123',
      }),
      onStatus: vi.fn().mockResolvedValue({
        status: 'available',
        load: 0.5,
      }),
    };
    server = new WebhookServer(9002, mockHandler);
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('start', () => {
    it('should start server successfully', async () => {
      await expect(server.start()).resolves.not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop server gracefully', async () => {
      await server.start();
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should not throw when stopping unstarted server', async () => {
      await expect(server.stop()).resolves.not.toThrow();
    });
  });
});
