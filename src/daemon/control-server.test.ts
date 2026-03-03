import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from './control-server';

// Mock http module
const mockListen = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();

vi.mock('http', () => ({
  createServer: vi.fn(() => ({
    listen: mockListen,
    close: mockClose,
    on: mockOn
  }))
}));

describe('ControlServer', () => {
  let mockF2A: any;
  let server: ControlServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockImplementation((port, callback) => callback && callback());
    
    mockF2A = {
      peerId: 'test-peer-id',
      agentInfo: { displayName: 'Test Agent' },
      getConnectedPeers: vi.fn().mockReturnValue([]),
      discoverAgents: vi.fn().mockResolvedValue([])
    };
    
    server = new ControlServer(mockF2A, 9001);
  });

  afterEach(() => {
    server.stop();
  });

  describe('start/stop', () => {
    it('should start server on specified port', async () => {
      await server.start();
      expect(mockListen).toHaveBeenCalledWith(9001, expect.any(Function));
    });

    it('should stop server gracefully', async () => {
      await server.start();
      server.stop();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle start errors', async () => {
      mockListen.mockImplementation(() => {
        throw new Error('Port in use');
      });
      
      await expect(server.start()).rejects.toThrow('Port in use');
    });
  });

  describe('request handling', () => {
    it('should create server', async () => {
      await server.start();
      
      // Verify server was created by checking if listen was called
      expect(mockListen).toHaveBeenCalled();
    });

    it('should handle server creation', async () => {
      await server.start();
      
      // Verify server was started
      expect(mockListen).toHaveBeenCalledWith(9001, expect.any(Function));
    });
  });
});
