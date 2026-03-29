import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkTopology } from './NetworkTopology';
import type { AgentInfo } from '../types';

describe('NetworkTopology', () => {
  const mockPeers: AgentInfo[] = [
    {
      peerId: '12D3KooWMockPeer123456789',
      displayName: 'TestPeer',
      agentType: 'openclaw',
      capabilities: [],
      lastSeen: Date.now(),
      multiaddrs: ['/ip4/192.168.1.1/tcp/9001'],
    },
    {
      peerId: '12D3KooWMockPeer987654321',
      displayName: 'TestPeer2',
      agentType: 'custom',
      capabilities: [{ name: 'test-cap', description: 'Test' }],
      lastSeen: Date.now() - 60000,
      multiaddrs: ['/ip4/192.168.1.2/tcp/9001'],
    },
  ];

  const localPeerId = '12D3KooWLocalNode11111111';

  it('renders the component', () => {
    render(<NetworkTopology localPeerId={localPeerId} peers={mockPeers} />);
    expect(screen.getByText('Network Topology')).toBeInTheDocument();
  });

  it('displays mock data - total nodes count', () => {
    render(<NetworkTopology localPeerId={localPeerId} peers={mockPeers} />);
    // Total nodes = local + peers
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('displays connected peers count', () => {
    render(<NetworkTopology localPeerId={localPeerId} peers={mockPeers} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders legend items', () => {
    render(<NetworkTopology localPeerId={localPeerId} peers={mockPeers} />);
    expect(screen.getByText('Local Node')).toBeInTheDocument();
    expect(screen.getByText('Remote Peer')).toBeInTheDocument();
  });

  it('renders with empty peers list', () => {
    render(<NetworkTopology localPeerId={localPeerId} peers={[]} />);
    expect(screen.getByText('Network Topology')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // Only local node
    expect(screen.getByText('0')).toBeInTheDocument(); // No connected peers
  });
});
