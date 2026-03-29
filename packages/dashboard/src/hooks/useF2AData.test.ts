import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useF2AData } from './useF2AData';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useF2AData', () => {
  const mockApiUrl = 'http://localhost:9000';
  const mockToken = 'test-token';

  const mockHealthResponse = {
    status: 'ok',
    peerId: '12D3KooWMockNode123',
  };

  const mockStatusResponse = {
    nodeId: '12D3KooWMockNode123',
    uptime: 100,
    connections: 2,
    messagesReceived: 42,
    messagesSent: 38,
  };

  const mockPeersResponse = [
    {
      peerId: '12D3KooWMockPeer123456789',
      displayName: '本机节点',
      agentType: 'openclaw',
      capabilities: [{ name: 'code-generation', description: '代码生成' }],
      lastSeen: Date.now(),
      multiaddrs: ['/ip4/127.0.0.1/tcp/9001'],
    },
    {
      peerId: '12D3KooWMockPeer987654321',
      displayName: 'CatPi',
      agentType: 'openclaw',
      capabilities: [{ name: 'file-operation', description: '文件操作' }],
      lastSeen: Date.now() - 60000,
      multiaddrs: ['/ip4/192.168.1.100/tcp/9001'],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHealthResponse),
        });
      }
      if (url.endsWith('/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStatusResponse),
        });
      }
      if (url.endsWith('/peers')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockPeersResponse),
        });
      }
      return Promise.resolve({ ok: false });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial loading state', () => {
    const { result } = renderHook(() => 
      useF2AData({ apiBaseUrl: mockApiUrl, controlToken: mockToken })
    );
    
    expect(result.current.loading).toBe(true);
  });

  it('fetches and displays data successfully', async () => {
    const { result } = renderHook(() => 
      useF2AData({ apiBaseUrl: mockApiUrl, controlToken: mockToken })
    );
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.health).toEqual(mockHealthResponse);
    expect(result.current.status).toEqual(mockStatusResponse);
    expect(result.current.peers).toEqual(mockPeersResponse);
    expect(result.current.error).toBeNull();
  });

  it('mock data contains expected peers', async () => {
    const { result } = renderHook(() => 
      useF2AData({ apiBaseUrl: mockApiUrl, controlToken: mockToken })
    );
    
    await waitFor(() => {
      expect(result.current.peers.length).toBeGreaterThan(0);
    });
    
    expect(result.current.peers).toContainEqual(
      expect.objectContaining({
        displayName: '本机节点',
      })
    );
  });

  it('provides refresh function', () => {
    const { result } = renderHook(() => 
      useF2AData({ apiBaseUrl: mockApiUrl, controlToken: mockToken })
    );
    
    expect(result.current.refresh).toBeDefined();
    expect(typeof result.current.refresh).toBe('function');
  });

  it('refresh function updates data', async () => {
    const { result } = renderHook(() => 
      useF2AData({ apiBaseUrl: mockApiUrl, controlToken: mockToken })
    );
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      result.current.refresh();
    });
    
    await waitFor(() => {
      expect(result.current.lastUpdated).not.toBeNull();
    });
  });

  it('handles fetch errors', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));
    
    const { result } = renderHook(() => 
      useF2AData({ apiBaseUrl: mockApiUrl, controlToken: mockToken })
    );
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.error).toBe('Network error');
  });
});