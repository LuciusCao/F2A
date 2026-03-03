import { describe, it, expect, vi } from 'vitest';
import { ControlServer } from './control-server';
import { F2A } from '../core/f2a';

// Mock http module
vi.mock('http', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((port, callback) => callback()),
    close: vi.fn(),
    on: vi.fn()
  })),
  request: vi.fn()
}));

describe('ControlServer', () => {
  let mockF2A: any;

  beforeEach(() => {
    mockF2A = {
      peerId: 'test-peer-id',
      agentInfo: { displayName: 'Test Agent' },
      getConnectedPeers: vi.fn().mockReturnValue([]),
      discoverAgents: vi.fn().mockResolvedValue([])
    };
  });

  describe('start/stop', () => {
    it('should start server on specified port', async () => {
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      expect(server).toBeDefined();
    });

    it('should stop server gracefully', async () => {
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      server.stop();
      expect(server).toBeDefined();
    });
  });
});
