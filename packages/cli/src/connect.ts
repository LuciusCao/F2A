/**
 * Agent-first connect CLI flow.
 *
 * 将一个 runtime-hosted agent slot 绑定到 F2A AgentIdentity，并注册到 daemon。
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { sendRequest } from './http-client.js';
import {
  F2A_DATA_DIR,
  getAgentIdentitiesDir,
  initAgentIdentity,
  readIdentityByAgentId
} from './init.js';
import {
  loadRuntimeBinding,
  saveRuntimeBinding,
  type RuntimeAgentBinding,
  type RuntimeType
} from './runtime-bindings.js';
import { isJsonMode, outputError, outputJson } from './output.js';
import type { AgentIdentityFile } from '@f2a/network';

export interface ConnectAgentOptions {
  dataDir?: string;
  runtimeType: RuntimeType;
  runtimeId: string;
  runtimeAgentId: string;
  name: string;
  agentId?: string;
  capabilities?: string[];
  webhook?: string;
  force?: boolean;
}

export interface ConnectAgentResult {
  success: boolean;
  agentId?: string;
  binding?: RuntimeAgentBinding;
  alreadyConnected?: boolean;
  error?: string;
}

function updateIdentityAfterRegistration(
  dataDir: string,
  identity: AgentIdentityFile,
  nodeSignature?: string,
  nodeId?: string,
  webhook?: { url: string }
): void {
  if (nodeSignature) {
    identity.nodeSignature = nodeSignature;
  }
  if (nodeId) {
    identity.nodeId = nodeId;
  }
  if (webhook) {
    identity.webhook = webhook;
  }
  identity.lastActiveAt = new Date().toISOString();

  const identityPath = join(getAgentIdentitiesDir(dataDir), `${identity.agentId}.json`);
  writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
}

async function resolveIdentity(options: Required<Pick<ConnectAgentOptions, 'dataDir' | 'name'>> & ConnectAgentOptions): Promise<AgentIdentityFile> {
  if (options.agentId) {
    const existing = readIdentityByAgentId(options.agentId, options.dataDir);
    if (!existing) {
      throw new Error(`Identity file not found for ${options.agentId}`);
    }
    return existing;
  }

  const created = await initAgentIdentity({
    dataDir: options.dataDir,
    name: options.name,
    capabilities: options.capabilities?.map(name => ({ name, version: '1.0.0' })),
    webhook: options.webhook,
    force: options.force,
  });

  if (!created.success || !created.agentId) {
    throw new Error(created.error || 'Failed to create Agent identity');
  }

  const identity = readIdentityByAgentId(created.agentId, options.dataDir);
  if (!identity) {
    throw new Error(`Created identity could not be loaded for ${created.agentId}`);
  }
  return identity;
}

export async function connectAgent(options: ConnectAgentOptions): Promise<ConnectAgentResult> {
  const dataDir = options.dataDir || F2A_DATA_DIR;
  const existingBinding = await loadRuntimeBinding(dataDir, {
    runtimeType: options.runtimeType,
    runtimeId: options.runtimeId,
    runtimeAgentId: options.runtimeAgentId
  });

  if (existingBinding && !options.force) {
    return {
      success: true,
      agentId: existingBinding.agentId,
      binding: existingBinding,
      alreadyConnected: true
    };
  }

  try {
    const identity = await resolveIdentity({ ...options, dataDir });
    const webhook = options.webhook ? { url: options.webhook } : identity.webhook;
    const capabilities = (options.capabilities || identity.capabilities?.map(c => c.name) || []).map(name => ({
      name,
      version: '1.0.0',
      description: ''
    }));

    const result = await sendRequest('POST', '/api/v1/agents', {
      agentId: identity.agentId,
      publicKey: identity.publicKey,
      selfSignature: identity.selfSignature,
      name: options.name || identity.name || options.runtimeAgentId,
      capabilities,
      webhook,
    });

    if (!result.success) {
      return {
        success: false,
        agentId: identity.agentId,
        error: String(result.error || 'Registration failed')
      };
    }

    const nodeSignature = result.nodeSignature as string | undefined;
    const nodeId = result.nodeId as string | undefined;
    updateIdentityAfterRegistration(dataDir, identity, nodeSignature, nodeId, webhook);

    const now = new Date().toISOString();
    const binding: RuntimeAgentBinding = {
      agentId: identity.agentId,
      runtimeType: options.runtimeType,
      runtimeId: options.runtimeId,
      runtimeAgentId: options.runtimeAgentId,
      webhook,
      nodeSignature,
      nodeId,
      status: 'registered',
      createdAt: existingBinding?.createdAt || now,
      lastSeenAt: now
    };
    await saveRuntimeBinding(dataDir, binding);

    return {
      success: true,
      agentId: identity.agentId,
      binding
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function cliConnectAgent(options: Omit<ConnectAgentOptions, 'dataDir'>): Promise<void> {
  const result = await connectAgent(options);

  if (!result.success) {
    if (isJsonMode()) {
      outputError(result.error || 'Connect failed', 'CONNECT_FAILED');
      return;
    }
    console.error(`❌ Connect failed: ${result.error || 'unknown error'}`);
    process.exit(1);
  }

  if (isJsonMode()) {
    outputJson({
      connected: true,
      alreadyConnected: !!result.alreadyConnected,
      agentId: result.agentId,
      binding: result.binding || null
    });
    return;
  }

  console.log(result.alreadyConnected ? '✅ Agent already connected.' : '✅ Agent connected successfully.');
  console.log(`   AgentId: ${result.agentId}`);
  if (result.binding) {
    console.log(`   Runtime: ${result.binding.runtimeType}/${result.binding.runtimeId}/${result.binding.runtimeAgentId}`);
    if (result.binding.webhook?.url) {
      console.log(`   Webhook: ${result.binding.webhook.url}`);
    }
  }
}
