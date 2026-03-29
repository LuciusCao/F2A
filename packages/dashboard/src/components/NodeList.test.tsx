import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodeList } from './NodeList';
import type { AgentInfo } from '../types';

describe('NodeList', () => {
  const mockPeers: AgentInfo[] = [
    {
      peerId: '12D3KooWMockPeer123456789abcdef0',
      displayName: 'TestPeer1',
      agentType: 'openclaw',
      capabilities: [{ name: 'code-generation', description: '代码生成' }],
      lastSeen: Date.now() - 30000,
      multiaddrs: ['/ip4/192.168.1.100/tcp/9001'],
    },
    {
      peerId: '12D3KooWMockPeer987654321fedcba9',
      displayName: 'TestPeer2',
      agentType: 'custom',
      capabilities: [],
      lastSeen: Date.now() - 3600000,
      multiaddrs: ['/ip4/192.168.1.200/tcp/9001'],
    },
  ];

  const localPeerId = '12D3KooWLocalNode1111111111111111';
  const localMultiaddrs = ['/ip4/127.0.0.1/tcp/9001'];

  it('renders the component', () => {
    render(<NodeList localPeerId={localPeerId} localMultiaddrs={localMultiaddrs} peers={mockPeers} />);
    expect(screen.getByText('Node List')).toBeInTheDocument();
  });

  it('displays mock data - local node', () => {
    render(<NodeList localPeerId={localPeerId} localMultiaddrs={localMultiaddrs} peers={mockPeers} />);
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('displays mock data - peer nodes', () => {
    render(<NodeList localPeerId={localPeerId} localMultiaddrs={localMultiaddrs} peers={mockPeers} />);
    // Use getAllByText since there are multiple "Online" elements
    const onlineElements = screen.getAllByText('Online');
    expect(onlineElements.length).toBe(2);
  });

  it('extracts IP from multiaddrs', () => {
    render(<NodeList localPeerId={localPeerId} localMultiaddrs={localMultiaddrs} peers={mockPeers} />);
    expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.200')).toBeInTheDocument();
  });

  it('renders with empty peers list', () => {
    render(<NodeList localPeerId={localPeerId} localMultiaddrs={localMultiaddrs} peers={[]} />);
    expect(screen.getByText('Node List')).toBeInTheDocument();
    expect(screen.getByText('No remote peers connected. Waiting for peer discovery...')).toBeInTheDocument();
  });

  it('displays table headers', () => {
    render(<NodeList localPeerId={localPeerId} localMultiaddrs={localMultiaddrs} peers={mockPeers} />);
    expect(screen.getByText('Peer ID')).toBeInTheDocument();
    expect(screen.getByText('IP Address')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Last Active')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
  });
});