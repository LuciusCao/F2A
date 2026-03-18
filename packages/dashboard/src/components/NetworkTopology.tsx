import type { AgentInfo } from '../types';

interface NetworkTopologyProps {
  localPeerId: string;
  peers: AgentInfo[];
}

export function NetworkTopology({ localPeerId, peers }: NetworkTopologyProps) {
  // Calculate positions for nodes in a circle
  const centerX = 200;
  const centerY = 200;
  const radius = 120;

  const allNodes = [
    { peerId: localPeerId, isLocal: true },
    ...peers.map(p => ({ peerId: p.peerId, isLocal: false }))
  ];

  const getNodePosition = (index: number, total: number) => {
    if (total === 1) {
      return { x: centerX, y: centerY };
    }
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 shadow-lg">
      <h2 className="text-lg font-semibold mb-4 text-slate-100">Network Topology</h2>
      
      <svg viewBox="0 0 400 400" className="w-full max-w-md mx-auto">
        {/* Connection lines */}
        {allNodes.slice(1).map((node, index) => {
          const pos = getNodePosition(index + 1, allNodes.length);
          return (
            <line
              key={`line-${node.peerId}`}
              x1={centerX}
              y1={centerY}
              x2={pos.x}
              y2={pos.y}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray={node.isLocal ? "0" : "5,5"}
              opacity="0.5"
            />
          );
        })}

        {/* Nodes */}
        {allNodes.map((node, index) => {
          const pos = getNodePosition(index, allNodes.length);
          const shortId = node.peerId.slice(0, 8);
          
          return (
            <g key={node.peerId}>
              {/* Node circle */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={node.isLocal ? 24 : 20}
                fill={node.isLocal ? "#3b82f6" : "#22c55e"}
                stroke={node.isLocal ? "#60a5fa" : "#4ade80"}
                strokeWidth="3"
                className="transition-all duration-300"
              />
              
              {/* Node label */}
              <text
                x={pos.x}
                y={pos.y + 40}
                textAnchor="middle"
                className="fill-slate-300 text-xs font-mono"
              >
                {node.isLocal ? "Local" : shortId}
              </text>

              {/* Status indicator */}
              <circle
                cx={pos.x + 16}
                cy={pos.y - 16}
                r="4"
                fill={node.isLocal ? "#22c55e" : "#22c55e"}
                stroke="#0f172a"
                strokeWidth="2"
              />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-sm text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span>Local Node</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Remote Peer</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-700">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-400">{allNodes.length}</div>
          <div className="text-xs text-slate-500">Total Nodes</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">{peers.length}</div>
          <div className="text-xs text-slate-500">Connected Peers</div>
        </div>
      </div>
    </div>
  );
}