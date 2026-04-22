/**
 * F2A CLI Node Commands Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendRequest } from './http-client.js';
import { isJsonMode, setJsonMode, outputJson, outputError } from './output.js';
import { nodeStatus, nodePeers, nodeHealth, nodeDiscover } from './node.js';

// Mock process.exit to prevent tests from exiting
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

// Mock http-client
vi.mock('./http-client.js', () => ({
  sendRequest: vi.fn(),
}));

// Mock output module
vi.mock('./output.js', () => ({
  isJsonMode: vi.fn(),
  setJsonMode: vi.fn(),
  outputJson: vi.fn(),
  outputError: vi.fn(() => { throw new Error('exit'); }),
}));

describe('Node Commands', () => {
  const mockSendRequest = sendRequest as ReturnType<typeof vi.fn>;
  const mockIsJsonMode = isJsonMode as ReturnType<typeof vi.fn>;
  const mockOutputJson = outputJson as ReturnType<typeof vi.fn>;
  const mockOutputError = outputError as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy.mockClear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('nodeStatus', () => {
    describe('human-readable output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(false);
      });

      it('should display node status successfully', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peerId: 'QmPeerId123456789abcdef',
          multiaddrs: ['/ip4/127.0.0.1/tcp/9000/p2p/QmPeerId'],
          agentInfo: {
            displayName: 'TestAgent',
            nodeId: 'node123'
          }
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodeStatus();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('F2A Node Status'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('QmPeerId12345678'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('TestAgent'));
        consoleSpy.mockRestore();
      });

      it('should handle status without agentInfo', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peerId: 'QmPeerId123456789abcdef',
          multiaddrs: ['/ip4/127.0.0.1/tcp/9000']
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodeStatus();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('F2A Node Status'));
        consoleSpy.mockRestore();
      });

      it('should handle failed status request', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          error: 'Node not initialized'
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await expect(nodeStatus()).rejects.toThrow('exit');
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get status'));
        consoleErrorSpy.mockRestore();
      });

      it('should handle connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await expect(nodeStatus()).rejects.toThrow('exit');
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot connect'));
        consoleErrorSpy.mockRestore();
      });
    });

    describe('JSON output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(true);
      });

      it('should output JSON for successful status', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peerId: 'QmPeerId123456789abcdef',
          multiaddrs: ['/ip4/127.0.0.1/tcp/9000'],
          agentInfo: { displayName: 'TestAgent', nodeId: 'node123' }
        });

        await nodeStatus();

        expect(mockOutputJson).toHaveBeenCalledWith({
          peerId: 'QmPeerId123456789abcdef',
          multiaddrs: ['/ip4/127.0.0.1/tcp/9000'],
          agentInfo: { displayName: 'TestAgent', nodeId: 'node123' }
        });
      });

      it('should output JSON error for failed status', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          error: 'Node not initialized'
        });

        await expect(nodeStatus()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('Node not initialized', 'STATUS_FAILED');
      });

      it('should output JSON error for connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        await expect(nodeStatus()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('Connection refused', 'DAEMON_NOT_RUNNING');
      });
    });
  });

  describe('nodePeers', () => {
    describe('human-readable output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(false);
      });

      it('should display connected peers', async () => {
        mockSendRequest.mockResolvedValue([
          { peerId: 'QmPeer1', connected: true, multiaddrs: ['/ip4/127.0.0.1/tcp/9000'] },
          { peerId: 'QmPeer2', connected: false, multiaddrs: ['/ip4/127.0.0.1/tcp/9001'] }
        ]);

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodePeers();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('P2P Peers'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('QmPeer1'));
        consoleSpy.mockRestore();
      });

      it('should handle no peers', async () => {
        mockSendRequest.mockResolvedValue([]);

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodePeers();

        expect(consoleSpy).toHaveBeenCalledWith('No connected peers');
        consoleSpy.mockRestore();
      });

      it('should handle peers in object format', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peers: [
            { peerId: 'QmPeer1' },
            { peerId: 'QmPeer2' }
          ]
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodePeers();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('P2P Peers (2)'));
        consoleSpy.mockRestore();
      });

      it('should handle failed peers request', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          error: 'Failed to get peers'
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await expect(nodePeers()).rejects.toThrow('exit');
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get peers'));
        consoleErrorSpy.mockRestore();
      });
    });

    describe('JSON output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(true);
      });

      it('should output JSON for peers array', async () => {
        mockSendRequest.mockResolvedValue([
          { peerId: 'QmPeer1', connected: true, multiaddrs: ['/ip4/127.0.0.1/tcp/9000'] },
          { peerId: 'QmPeer2', connected: false, multiaddrs: [] }
        ]);

        await nodePeers();

        expect(mockOutputJson).toHaveBeenCalledWith({
          peers: [
            { peerId: 'QmPeer1', connected: true, multiaddrs: ['/ip4/127.0.0.1/tcp/9000'] },
            { peerId: 'QmPeer2', connected: false, multiaddrs: [] }
          ]
        });
      });

      it('should output JSON for peers object format', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peers: [
            { peerId: 'QmPeer1' },
            { id: 'QmPeer2' }
          ]
        });

        await nodePeers();

        expect(mockOutputJson).toHaveBeenCalledWith({
          peers: [
            { peerId: 'QmPeer1', connected: true, multiaddrs: [] },
            { peerId: 'QmPeer2', connected: true, multiaddrs: [] }
          ]
        });
      });

      it('should output JSON error for failed request', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          error: 'Failed to get peers'
        });

        await expect(nodePeers()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('Failed to get peers', 'PEERS_FAILED');
      });

      it('should output JSON error for connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        await expect(nodePeers()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('Connection refused', 'DAEMON_NOT_RUNNING');
      });
    });
  });

  describe('nodeHealth', () => {
    describe('human-readable output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(false);
      });

      it('should display healthy status', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peerId: 'QmPeerId123456789abcdef'
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodeHealth();

        expect(consoleSpy).toHaveBeenCalledWith('Daemon is healthy');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('QmPeerId12345678'));
        consoleSpy.mockRestore();
      });

      it('should display unhealthy status', async () => {
        mockSendRequest.mockResolvedValue({
          success: false
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await expect(nodeHealth()).rejects.toThrow('exit');
        
        expect(consoleSpy).toHaveBeenCalledWith('Daemon is unhealthy');
        consoleSpy.mockRestore();
      });

      it('should handle connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await expect(nodeHealth()).rejects.toThrow('exit');
        
        expect(consoleSpy).toHaveBeenCalledWith('Cannot connect to F2A Daemon');
        consoleSpy.mockRestore();
      });
    });

    describe('JSON output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(true);
      });

      it('should output JSON for healthy daemon', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          peerId: 'QmPeerId123456789abcdef'
        });

        await nodeHealth();

        expect(mockOutputJson).toHaveBeenCalledWith({
          healthy: true,
          peerId: 'QmPeerId123456789abcdef'
        });
      });

      it('should output JSON for unhealthy daemon', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          peerId: undefined
        });

        await nodeHealth();

        expect(mockOutputJson).toHaveBeenCalledWith({
          healthy: false,
          peerId: undefined
        });
      });

      it('should output JSON error for connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        await expect(nodeHealth()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('Cannot connect to F2A Daemon', 'DAEMON_NOT_RUNNING');
      });
    });
  });

  describe('nodeDiscover', () => {
    describe('human-readable output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(false);
      });

      it('should display discovered agents', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          agents: [
            {
              agentId: 'agent-123',
              displayName: 'TestAgent',
              peerId: 'QmPeerId123456789abcdef',
              capabilities: [{ name: 'chat' }, { name: 'code' }],
              agentType: 'assistant'
            }
          ]
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodeDiscover();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Discovered 1 agent(s)'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('TestAgent'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('chat, code'));
        consoleSpy.mockRestore();
      });

      it('should handle no agents discovered', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          agents: []
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodeDiscover();

        expect(consoleSpy).toHaveBeenCalledWith('No agents discovered');
        consoleSpy.mockRestore();
      });

      it('should filter by capability', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          agents: []
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await nodeDiscover('chat');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('capability: chat'));
        consoleSpy.mockRestore();
      });

      it('should handle discovery failure', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          error: 'DHT not ready'
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await expect(nodeDiscover()).rejects.toThrow('exit');
        
        expect(consoleSpy).toHaveBeenCalledWith('Discovery failed:', 'DHT not ready');
        consoleSpy.mockRestore();
      });

      it('should handle connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await expect(nodeDiscover()).rejects.toThrow('exit');
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot connect'));
        consoleErrorSpy.mockRestore();
      });
    });

    describe('JSON output', () => {
      beforeEach(() => {
        mockIsJsonMode.mockReturnValue(true);
      });

      it('should output JSON for discovered agents', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          agents: [
            {
              agentId: 'agent-123',
              displayName: 'TestAgent',
              peerId: 'QmPeerId123456789abcdef',
              capabilities: [{ name: 'chat' }, { name: 'code' }],
              agentType: 'assistant'
            }
          ]
        });

        await nodeDiscover();

        expect(mockOutputJson).toHaveBeenCalledWith({
          agents: [
            {
              agentId: 'agent-123',
              displayName: 'TestAgent',
              peerId: 'QmPeerId123456789abcdef',
              capabilities: ['chat', 'code']
            }
          ]
        });
      });

      it('should output JSON for empty agents list', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          agents: []
        });

        await nodeDiscover();

        expect(mockOutputJson).toHaveBeenCalledWith({
          agents: []
        });
      });

      it('should output JSON error for discovery failure', async () => {
        mockSendRequest.mockResolvedValue({
          success: false,
          error: 'DHT not ready'
        });

        await expect(nodeDiscover()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('DHT not ready', 'DISCOVER_FAILED');
      });

      it('should output JSON error for connection error', async () => {
        mockSendRequest.mockRejectedValue(new Error('Connection refused'));

        await expect(nodeDiscover()).rejects.toThrow('exit');

        expect(mockOutputError).toHaveBeenCalledWith('Connection refused', 'DAEMON_NOT_RUNNING');
      });

      it('should pass capability parameter to request', async () => {
        mockSendRequest.mockResolvedValue({
          success: true,
          agents: []
        });

        await nodeDiscover('chat');

        expect(mockSendRequest).toHaveBeenCalledWith('POST', '/control', {
          action: 'discover',
          capability: 'chat'
        });
      });
    });
  });
});