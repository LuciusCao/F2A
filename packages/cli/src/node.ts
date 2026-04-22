/**
 * F2A Node CLI Commands
 *
 * Phase 1.1 + 1.2: P2P Node management commands
 * - init: Initialize node identity
 * - status: Show node status
 * - peers: List connected P2P peers
 * - health: Health check
 * - discover: Discover agents on the network
 */

import { sendRequest } from './http-client.js';
import { initIdentity } from './identity.js';
import { isJsonMode, outputJson, outputError } from './output.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { NodeIdentityManager } from '@f2a/network';

const DEFAULT_DATA_DIR = '.f2a';

/**
 * Initialize node identity
 * Supports --json output mode
 */
export async function nodeInit(options: { force?: boolean }): Promise<void> {
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);

  if (isJsonMode()) {
    // JSON mode: return structured output
    try {
      const result = {
        dataDir,
        dataDirCreated: false,
        nodeIdentityCreated: false,
        nodeIdentityExists: false,
        nodeId: undefined as string | undefined,
        configCreated: false,
        configExists: false,
        tokenCreated: false,
        success: true
      };

      // 1. Ensure ~/.f2a directory exists
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
        result.dataDirCreated = true;
      }

      // 2. Check/Create Node Identity
      const nodeIdentityPath = join(dataDir, 'node-identity.json');
      const nodeExists = existsSync(nodeIdentityPath);

      if (nodeExists && !options?.force) {
        result.nodeIdentityExists = true;
        const nodeManager = new NodeIdentityManager({ dataDir });
        const loadResult = await nodeManager.loadOrCreate();
        if (loadResult.success && loadResult.data) {
          result.nodeId = loadResult.data.nodeId;
        }
      } else {
        const nodeManager = new NodeIdentityManager({ dataDir });
        const loadResult = await nodeManager.loadOrCreate();
        if (loadResult.success && loadResult.data) {
          result.nodeIdentityCreated = true;
          result.nodeId = loadResult.data.nodeId;
        } else {
          outputError(loadResult.error?.message || 'Failed to create node identity', 'INIT_FAILED');
          return;
        }
      }

      // 3. Check/create config.json
      const configPath = join(dataDir, 'config.json');
      if (!existsSync(configPath)) {
        const defaultConfig = {
          network: {
            bootstrapPeers: [],
            bootstrapPeerFingerprints: {}
          },
          autoStart: false,
          enableMDNS: true,
          enableDHT: false
        };
        writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        result.configCreated = true;
      } else {
        result.configExists = true;
      }

      // 4. Create control-token (if not exists)
      const tokenPath = join(dataDir, 'control-token');
      if (!existsSync(tokenPath)) {
        const randomToken = Buffer.from(Array.from({ length: 32 }, () =>
          Math.floor(Math.random() * 256)
        ))
          .toString('hex')
          .slice(0, 32);
        writeFileSync(tokenPath, randomToken);
        result.tokenCreated = true;
      }

      outputJson(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputError(message, 'INIT_FAILED');
    }
  } else {
    // Human mode: use existing initIdentity function
    await initIdentity(options);
  }
}

/**
 * Show node status (GET /status)
 */
export async function nodeStatus(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/status');

    if (isJsonMode()) {
      if (result.success) {
        outputJson({
          peerId: result.peerId,
          multiaddrs: result.multiaddrs,
          agentInfo: result.agentInfo
        });
      } else {
        outputError(result.error as string || 'Failed to get status', 'STATUS_FAILED');
      }
    } else {
      if (result.success) {
        console.log('=== F2A Node Status ===');
        console.log('');
        const peerId = result.peerId as string | undefined;
        console.log(`Node ID: ${peerId?.slice(0, 16) || 'N/A'}...`);
        if (result.multiaddrs) {
          console.log(`Multiaddrs: ${(result.multiaddrs as string[]).join(', ')}`);
        }
        if (result.agentInfo) {
          console.log('');
          console.log('Agent Info:');
          const info = result.agentInfo as { displayName?: string; nodeId?: string };
          console.log(`  Name: ${info.displayName || 'N/A'}`);
          console.log(`  Node ID: ${info.nodeId?.slice(0, 8) || 'N/A'}...`);
        }
      } else {
        console.error(`Error: Failed to get status - ${result.error}`);
        process.exit(1);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(message, 'DAEMON_NOT_RUNNING');
    } else {
      console.error(`Error: Cannot connect to F2A Daemon - ${message}`);
      console.error('Please ensure Daemon is running: f2a daemon start');
      process.exit(1);
    }
  }
}

/**
 * List connected P2P peers (GET /peers)
 */
export async function nodePeers(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/peers');

    if (isJsonMode()) {
      let peers: Array<{ peerId?: string; id?: string; connected?: boolean; multiaddrs?: string[] }> = [];

      if (Array.isArray(result)) {
        // GET /peers returns peer array
        peers = result as Array<{ peerId?: string; id?: string; connected?: boolean; multiaddrs?: string[] }>;
      } else if (result.success && result.peers) {
        peers = result.peers as Array<{ peerId?: string; id?: string; connected?: boolean; multiaddrs?: string[] }>;
      } else {
        outputError(result.error as string || 'Failed to get peers', 'PEERS_FAILED');
        return;
      }

      outputJson({
        peers: peers.map(peer => ({
          peerId: peer.peerId || peer.id,
          connected: peer.connected ?? true,
          multiaddrs: peer.multiaddrs || []
        }))
      });
    } else {
      if (Array.isArray(result)) {
        // GET /peers returns peer array
        const peers = result as Array<{ peerId?: string; id?: string; connected?: boolean; multiaddrs?: string[] }>;
        if (peers.length === 0) {
          console.log('No connected peers');
        } else {
          console.log(`=== P2P Peers (${peers.length}) ===`);
          console.log('');
          for (const peer of peers) {
            const status = peer.connected ? 'Connected' : 'Disconnected';
            console.log(`[${status}] ${peer.peerId?.slice(0, 16) || peer.id?.slice(0, 16) || 'N/A'}...`);
            if (peer.multiaddrs && peer.multiaddrs.length > 0) {
              console.log(`   Address: ${peer.multiaddrs[0]}`);
            }
          }
        }
      } else if (result.success && result.peers) {
        const peers = result.peers as Array<{ peerId?: string; id?: string }>;
        if (peers.length === 0) {
          console.log('No connected peers');
        } else {
          console.log(`=== P2P Peers (${peers.length}) ===`);
          console.log('');
          for (const peer of peers) {
            console.log(`[Connected] ${peer.peerId?.slice(0, 16) || peer.id?.slice(0, 16) || 'N/A'}...`);
          }
        }
      } else {
        console.error(`Error: Failed to get peers - ${result.error}`);
        process.exit(1);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(message, 'DAEMON_NOT_RUNNING');
    } else {
      console.error(`Error: Cannot connect to F2A Daemon - ${message}`);
      console.error('Please ensure Daemon is running: f2a daemon start');
      process.exit(1);
    }
  }
}

/**
 * Health check (GET /health)
 */
export async function nodeHealth(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/health');

    if (isJsonMode()) {
      if (result.success) {
        outputJson({
          healthy: true,
          peerId: result.peerId
        });
      } else {
        outputJson({
          healthy: false,
          peerId: result.peerId
        });
      }
    } else {
      if (result.success) {
        console.log('Daemon is healthy');
        const peerId = result.peerId as string | undefined;
        console.log(`   Node ID: ${peerId?.slice(0, 16) || 'N/A'}...`);
      } else {
        console.log('Daemon is unhealthy');
        process.exit(1);
      }
    }
  } catch {
    if (isJsonMode()) {
      outputError('Cannot connect to F2A Daemon', 'DAEMON_NOT_RUNNING');
    } else {
      console.log('Cannot connect to F2A Daemon');
      process.exit(1);
    }
  }
}

/**
 * Discover agents on the network (POST /control {action: 'discover'})
 */
export async function nodeDiscover(capability?: string): Promise<void> {
  try {
    const result = await sendRequest('POST', '/control', {
      action: 'discover',
      capability
    }) as { success: boolean; agents?: Array<{
      displayName?: string;
      agentId?: string;
      peerId?: string;
      capabilities?: Array<{ name: string }>;
      agentType?: string;
    }>; error?: string };

    if (isJsonMode()) {
      if (result.success && result.agents) {
        outputJson({
          agents: result.agents.map(agent => ({
            agentId: agent.agentId,
            displayName: agent.displayName,
            peerId: agent.peerId,
            capabilities: agent.capabilities?.map(c => c.name) || []
          }))
        });
      } else {
        outputError(result.error || 'Discovery failed', 'DISCOVER_FAILED');
      }
    } else {
      if (result.success && result.agents) {
        const agents = result.agents;
        if (agents.length === 0) {
          console.log('No agents discovered');
          if (capability) {
            console.log(`   Search capability: ${capability}`);
          }
          return;
        }

        console.log(`Discovered ${agents.length} agent(s)${capability ? ` (capability: ${capability})` : ''}:`);
        console.log('');
        
        for (const agent of agents) {
          const displayName = agent.displayName || agent.agentId?.slice(0, 24) || 'Unknown';
          const peerId = agent.peerId?.slice(0, 16) || 'N/A';
          const capabilities = agent.capabilities?.map(c => c.name).join(', ') || 'N/A';
          
          console.log(`  [Agent] ${displayName}`);
          console.log(`     Agent ID: ${agent.agentId || 'N/A'}`);
          console.log(`     Node ID: ${peerId}...`);
          console.log(`     Capabilities: ${capabilities}`);
          console.log(`     Agent Type: ${agent.agentType || 'N/A'}`);
          console.log('');
        }
      } else {
        console.log('Discovery failed:', result.error || 'Unknown error');
        process.exit(1);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(message, 'DAEMON_NOT_RUNNING');
    } else {
      console.error(`Error: Cannot connect to Daemon - ${message}`);
      console.error('Please ensure Daemon is running: f2a daemon start');
      process.exit(1);
    }
  }
}