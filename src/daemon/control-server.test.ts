import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from './control-server';
import { TokenManager } from '../core/token-manager';

// Track mock server instances
let lastMockServer: any = null;

const TEST_TOKEN = 'test-token-12345';

vi.mock('http', () => ({
  createServer: vi.fn((handler) => {
    lastMockServer = {
      listen: vi.fn((port, callback) => {
        if (callback) callback();
        return { port };
      }),
      close: vi.fn((callback) => {
        if (callback) callback();
      }),
      on: vi.fn(),
      _handler: handler
    };
    return lastMockServer;
  })
}));

// Mock TokenManager
vi.mock('../core/token-manager', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockReturnValue(TEST_TOKEN),
    verifyToken: vi.fn((token) => token === TEST_TOKEN),
    getTokenPath: vi.fn().mockReturnValue('/mock/path')
  }))
}));

describe('ControlServer', () => {
  let mockF2A: any;
  let server: ControlServer;

  beforeEach(() => {
    vi.clearAllMocks();
    lastMockServer = null;
    
    mockF2A = {
      peerId: 'test-peer-id',
      agentInfo: { displayName: 'Test Agent' },
      getConnectedPeers: vi.fn().mockReturnValue([
        { peerId: 'peer1', displayName: 'Peer 1' }
      ]),
      discoverAgents: vi.fn().mockResolvedValue([
        { peerId: 'agent1', displayName: 'Agent 1' }
      ])
    };
    
    server = new ControlServer(mockF2A, 9001);
  });

  afterEach(() => {
    server.stop();
  });

  describe('start/stop', () => {
    it('should start server on specified port', async () => {
      await server.start();
      expect(lastMockServer).not.toBeNull();
      expect(lastMockServer.listen).toHaveBeenCalledWith(9001, expect.any(Function));
    });

    it('should stop server gracefully', async () => {
      await server.start();
      server.stop();
      expect(lastMockServer.close).toHaveBeenCalled();
    });
  });

  describe('request handling', () => {
    const createMockReq = (method: string, body?: object, headers?: Record<string, string>) => ({
      method,
      headers: {
        'x-f2a-token': TEST_TOKEN,
        ...headers
      },
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn((event, callback) => {
        if (event === 'data' && body) {
          callback(Buffer.from(JSON.stringify(body)));
        }
        if (event === 'end') {
          callback();
        }
      })
    });

    const createMockRes = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    });

    it('should handle OPTIONS request for CORS', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('OPTIONS');
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });

    it('should reject non-POST methods', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('GET');
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(405);
    });

    it('should handle status command', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'status' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.peerId).toBe('test-peer-id');
    });

    it('should handle peers command', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'peers' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.peers).toHaveLength(1);
    });

    it('should handle discover command', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'discover', capability: 'test' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
    });

    it('should handle unknown commands', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'unknown' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
    });

    it('should handle invalid JSON', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = {
        method: 'POST',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('invalid json'));
          }
          if (event === 'end') {
            callback();
          }
        })
      };
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
    });
  });
});
