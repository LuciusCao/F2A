import type { AgentInfo } from '../types';

interface NodeListProps {
  localPeerId: string;
  localMultiaddrs: string[];
  peers: AgentInfo[];
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function extractIP(multiaddrs: string[]): string {
  if (!multiaddrs || multiaddrs.length === 0) return 'N/A';
  
  for (const addr of multiaddrs) {
    // Try to extract IP from multiaddr format like /ip4/192.168.1.1/tcp/1234
    const ipMatch = addr.match(/\/ip4\/([^/]+)/);
    if (ipMatch) return ipMatch[1];
    
    // Try IPv6
    const ip6Match = addr.match(/\/ip6\/([^/]+)/);
    if (ip6Match) return ip6Match[1];
  }
  
  return 'N/A';
}

function NodeRow({ node, isLocal }: { node: AgentInfo; isLocal: boolean }) {
  const ip = extractIP(node.multiaddrs);
  const shortId = node.peerId.slice(0, 16);
  
  return (
    <tr className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <div 
            className={`w-2 h-2 rounded-full ${isLocal ? 'bg-blue-500' : 'bg-green-500'}`}
            title={isLocal ? 'Local Node' : 'Connected Peer'}
          />
          <code className="text-sm text-slate-300 font-mono">{shortId}...</code>
        </div>
      </td>
      <td className="py-3 px-4 text-sm text-slate-400">{ip}</td>
      <td className="py-3 px-4">
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          isLocal 
            ? 'bg-blue-500/20 text-blue-400' 
            : 'bg-green-500/20 text-green-400'
        }`}>
          {isLocal ? 'Local' : 'Online'}
        </span>
      </td>
      <td className="py-3 px-4 text-sm text-slate-400">
        {isLocal ? '-' : formatTimeAgo(node.lastSeen)}
      </td>
      <td className="py-3 px-4 text-sm text-slate-400">
        {node.agentType || 'custom'}
      </td>
      <td className="py-3 px-4 text-sm text-slate-400">
        {node.capabilities?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {node.capabilities.slice(0, 3).map((cap: { name: string }, i: number) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-slate-700 text-xs">
                {cap.name}
              </span>
            ))}
            {node.capabilities.length > 3 && (
              <span className="text-xs text-slate-500">+{node.capabilities.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-slate-500">-</span>
        )}
      </td>
    </tr>
  );
}

export function NodeList({ localPeerId, localMultiaddrs, peers }: NodeListProps) {
  const localNode: AgentInfo = {
    peerId: localPeerId,
    agentType: 'openclaw',
    version: '1.0.0',
    capabilities: [],
    protocolVersion: 'f2a/1.0',
    lastSeen: Date.now(),
    multiaddrs: localMultiaddrs,
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 shadow-lg">
      <h2 className="text-lg font-semibold mb-4 text-slate-100">Node List</h2>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
              <th className="py-2 px-4">Peer ID</th>
              <th className="py-2 px-4">IP Address</th>
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4">Last Active</th>
              <th className="py-2 px-4">Type</th>
              <th className="py-2 px-4">Capabilities</th>
            </tr>
          </thead>
          <tbody>
            <NodeRow node={localNode} isLocal={true} />
            {peers.map((peer) => (
              <NodeRow key={peer.peerId} node={peer} isLocal={false} />
            ))}
          </tbody>
        </table>
      </div>

      {peers.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          No remote peers connected. Waiting for peer discovery...
        </div>
      )}
    </div>
  );
}