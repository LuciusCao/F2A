import { useState } from 'react';
import { useF2AData } from './hooks/useF2AData';
import { NetworkTopology } from './components/NetworkTopology';
import { NodeList } from './components/NodeList';

// Get API URL from environment or default to proxy
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

function App() {
  const [controlToken, setControlToken] = useState<string>(() => {
    return localStorage.getItem('f2a_control_token') || '';
  });

  const { health, status, peers, loading, error, lastUpdated, refresh } = useF2AData({
    apiBaseUrl: API_BASE_URL,
    controlToken: controlToken || undefined,
    refreshInterval: 5000,
  });

  const handleTokenChange = (token: string) => {
    setControlToken(token);
    localStorage.setItem('f2a_control_token', token);
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      {/* Header */}
      <header className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">F2A Dashboard</h1>
              <p className="text-sm text-slate-400">Friend-to-Agent Network Visualization</p>
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-4">
            {loading && (
              <span className="text-sm text-slate-400 animate-pulse">Loading...</span>
            )}
            {error && (
              <span className="text-sm text-red-400">Error: {error}</span>
            )}
            {lastUpdated && !error && (
              <span className="text-sm text-slate-500">
                Updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={refresh}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-slate-300 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Connection status */}
        <div className="mt-4 flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
            health?.status === 'ok' 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-red-500/20 text-red-400'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'
            }`} />
            {health?.status === 'ok' ? 'Connected' : 'Disconnected'}
          </div>

          {health?.peerId && (
            <span className="text-sm text-slate-500 font-mono">
              Peer: {health.peerId.slice(0, 16)}...
            </span>
          )}
        </div>
      </header>

      {/* Token input (if needed) */}
      {error?.includes('Unauthorized') && (
        <div className="max-w-6xl mx-auto mb-6">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <h3 className="text-amber-400 font-medium mb-2">Authentication Required</h3>
            <p className="text-sm text-slate-400 mb-3">
              Enter your F2A control token to access peer information.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={controlToken}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="Enter control token"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={refresh}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Network Topology */}
          <div className="lg:col-span-1">
            <NetworkTopology
              localPeerId={status?.peerId || health?.peerId || ''}
              peers={peers}
            />
          </div>

          {/* Node List */}
          <div className="lg:col-span-2">
            <NodeList
              localPeerId={status?.peerId || health?.peerId || ''}
              localMultiaddrs={status?.multiaddrs || []}
              peers={peers}
            />
          </div>
        </div>

        {/* Capabilities Section */}
        {peers.some(p => p.capabilities && p.capabilities.length > 0) && (
          <div className="mt-6 bg-slate-800 rounded-xl p-6 shadow-lg">
            <h2 className="text-lg font-semibold mb-4 text-slate-100">Network Capabilities</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {peers
                .filter(p => p.capabilities && p.capabilities.length > 0)
                .flatMap(peer => 
                  peer.capabilities!.map((cap, i) => (
                    <div 
                      key={`${peer.peerId}-${i}`}
                      className="bg-slate-700/50 rounded-lg p-4 border border-slate-600"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-white">{cap.name}</h3>
                        <span className="text-xs text-slate-500">
                          {peer.peerId.slice(0, 8)}...
                        </span>
                      </div>
                      <p className="text-sm text-slate-400">{cap.description}</p>
                      {cap.tools && cap.tools.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {cap.tools.map((tool, j) => (
                            <span 
                              key={j}
                              className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs"
                            >
                              {tool}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto mt-8 text-center text-sm text-slate-600">
        F2A Network Dashboard • {new Date().getFullYear()}
      </footer>
    </div>
  );
}

export default App;