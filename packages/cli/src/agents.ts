/**
 * F2A CLI - Agent 管理命令
 * f2a agent register / list / unregister
 * 
 * Challenge-Response 注册流程
 * - 按 agentId 查找本地身份文件
 * - 发送 publicKey 到 Daemon
 * - 接收 nodeSignature 并保存
 */

import { sendRequest } from './http-client.js';
import { sendWithChallengeResponse } from './challenge-helper.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { readIdentityByAgentId, AGENT_IDENTITIES_DIR } from './init.js';
import type { AgentIdentityFile, Challenge, ChallengeResponse } from '@f2a/network';
import { signChallenge } from '@f2a/network';
import { isJsonMode, outputJson, outputError } from './output.js';

/**
 * 更新身份文件（添加 nodeSignature 和 webhook）
 */
function updateIdentityWithNodeSignature(
  agentId: string,
  identity: AgentIdentityFile,
  nodeSignature: string,
  nodeId: string,
  webhook?: { url: string }
): boolean {
  try {
    identity.nodeSignature = nodeSignature;
    identity.nodeId = nodeId;
    identity.lastActiveAt = new Date().toISOString();
    if (webhook) {
      identity.webhook = webhook;
    }
    
    const identityPath = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 注册 Agent
 * f2a agent register --agent-id <agentId> [--webhook <url>] [--force]
 * 
 * Challenge-Response 注册流程：
 * - 按 agentId 查找本地身份文件
 * - 发送 publicKey 到 Daemon 进行注册
 * - 接收 nodeSignature 并保存
 */
export async function registerAgent(options: {
  /** Agent ID（必填） */
  agentId: string;
  force?: boolean;
  /** Webhook URL（必填） */
  webhook?: string;
}): Promise<void> {
  if (!options.agentId) {
    if (isJsonMode()) {
      outputError('Missing required parameter: --agent-id', 'MISSING_AGENT_ID');
    } else {
      console.error('❌ Error: Missing required parameter --agent-id. The agent ID is required for registration.');
      console.error('Usage: f2a agent register --agent-id <agentId> --webhook <url>');
      process.exit(1);
    }
    return;
  }

  const identity = readIdentityByAgentId(options.agentId);

  if (!identity) {
    if (isJsonMode()) {
      outputError('Identity file not found', 'AGENT_NOT_FOUND');
      return;
    }
    console.error('❌ Error: Identity file not found.');
    console.error(`   AgentId: ${options.agentId}`);
    console.error('Please run: f2a agent init --name <name>');
    console.error('         or: f2a agent register --agent-id <agentId> --webhook <url>');
    process.exit(1);
  }

  // webhook 优先级：CLI 参数 > identity 文件
  // Issue #143: register 必须有 webhook，用于 daemon 消息推送
  const webhookToUse = options.webhook 
    ? { url: options.webhook } 
    : identity.webhook;

  if (!webhookToUse?.url) {
    if (isJsonMode()) {
      outputError('Missing required parameter: --webhook. Register requires a webhook URL for daemon to push messages.', 'MISSING_WEBHOOK');
      return;
    }
    console.error('❌ Error: Missing required parameter --webhook.');
    console.error('   Register requires a webhook URL for daemon to push messages to the agent.');
    console.error('Usage: f2a agent register --agent-id <agentId> --webhook <url>');
    console.error('Example: f2a agent register --agent-id agent:abc123 --webhook http://localhost:3000/f2a/webhook');
    process.exit(1);
  }

  // 检查是否已注册
  if (identity.nodeSignature && !options.force) {
    if (isJsonMode()) {
      outputJson({
        alreadyRegistered: true,
        agentId: identity.agentId,
        nodeId: identity.nodeId || null
      });
      return;
    }
    console.log('✅ Success: Agent is already registered.');
    console.log(`   AgentId: ${identity.agentId}`);
    console.log(`   Node ID: ${identity.nodeId || 'N/A'}`);
    console.log('   Use --force to re-register.');
    return;
  }

  try {
    const capabilities = (identity.capabilities || []).map((c: { name: string; version: string } | string) => ({
      name: typeof c === 'string' ? c : c.name,
      version: '1.0.0',
      description: ''
    }));

    const requestBody = {
      agentId: identity.agentId,
      publicKey: identity.publicKey,
      name: identity.name || 'unnamed',
      capabilities,
      webhook: webhookToUse,
    };

    const result = await sendRequest('POST', '/api/v1/agents', requestBody);

    if (result.success) {
      const nodeSignature = result.nodeSignature as string | undefined;
      const nodeId = result.nodeId as string | undefined;

      if (nodeSignature && nodeId) {
        updateIdentityWithNodeSignature(options.agentId, identity, nodeSignature, nodeId, webhookToUse);
      }

      if (isJsonMode()) {
        outputJson({
          registered: true,
          agentId: identity.agentId,
          name: identity.name || null,
          capabilities: capabilities.map((c: { name: string }) => c.name),
          webhook: webhookToUse?.url || null,
          nodeId: nodeId || null
        });
        return;
      }

      console.log('✅ Success: Agent registered successfully.');
      console.log(`   AgentId: ${identity.agentId}`);
      console.log(`   Name: ${identity.name || 'N/A'}`);
      if (capabilities.length > 0) {
        console.log(`   Capabilities: ${capabilities.map((c: { name: string }) => c.name).join(', ')}`);
      }
      if (webhookToUse) {
        console.log(`   Webhook: ${webhookToUse.url}`);
      }
      if (nodeId) {
        console.log(`   Node: ${nodeId.slice(0, 24)}...`);
      }
    } else {
      if (isJsonMode()) {
        outputError(`Registration failed: ${result.error}`, 'REGISTRATION_FAILED');
        return;
      }
      console.error(`❌ Error: Registration failed: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(`Unable to connect to Daemon: ${message}`, 'DAEMON_NOT_RUNNING');
      return;
    }
    console.error(`❌ Error: Unable to connect to Daemon: ${message}`);
    console.error('Please ensure Daemon is running: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 列出已注册的 Agent（从 Daemon）
 * f2a agent list
 */
export async function listAgents(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/api/v1/agents');

    if (!result.success) {
      if (isJsonMode()) {
        outputError(result.error as string, 'LIST_FAILED');
      } else {
        console.error(`❌ Error: Failed to get agent list: ${result.error}`);
        console.error('Please ensure Daemon is running: f2a daemon start');
        process.exit(1);
      }
      return;
    }

    if (result.agents) {
      const agents = result.agents as Array<{
        agentId: string;
        name: string;
        capabilities?: Array<{ name: string }>;
        webhookUrl?: string;
        lastActiveAt?: string;
      }>;

      if (isJsonMode()) {
        outputJson({
          agents: agents.map(agent => ({
            agentId: agent.agentId,
            name: agent.name,
            capabilities: agent.capabilities || [],
            webhookUrl: agent.webhookUrl,
            lastActiveAt: agent.lastActiveAt
          }))
        });
      } else {
        if (agents.length === 0) {
          console.log('📭 No registered agents found.');
          return;
        }

        console.log(`🤖 Registered Agents (${agents.length}):`);
        console.log('');

        for (const agent of agents) {
          const lastActive = agent.lastActiveAt
            ? new Date(agent.lastActiveAt).toLocaleString('zh-CN')
            : 'never';

          console.log(`🔹 ${agent.name}`);
          console.log(`   ID: ${agent.agentId}`);
          if (agent.capabilities && agent.capabilities.length > 0) {
            console.log(`   Capabilities: ${agent.capabilities.map(c => c.name).join(', ')}`);
          }
          if (agent.webhookUrl) {
            console.log(`   Webhook: ${agent.webhookUrl}`);
          }
          console.log(`   Last Active: ${lastActive}`);
          console.log('');
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(message, 'DAEMON_NOT_RUNNING');
    } else {
      console.error(`❌ Error: Unable to connect to Daemon: ${message}`);
      console.error('Please ensure Daemon is running: f2a daemon start');
      process.exit(1);
    }
  }
}

/**
 * 更新 Agent 配置（Challenge-Response 验证）
 * f2a agent update --agent-id <agentId> [--name <name>]
 * 
 * 流程：
 * 1. 发送 PATCH 请求到 Daemon
 * 2. 如果返回 challenge，用私钥签名
 * 3. 发送带签名的请求完成更新
 * 4. 同时更新本地身份文件
 * 
 * 注意：webhook 更新请使用 register 命令（可重复调用）
 */
export async function updateAgent(options: {
  agentId: string;
  name?: string;
}): Promise<void> {
  if (!options.agentId) {
    if (isJsonMode()) {
      outputError('Missing required parameter: --agent-id', 'MISSING_AGENT_ID');
    } else {
      console.error('❌ Error: Missing required parameter --agent-id. The agent ID is required for updating agent configuration.');
      console.error('Usage: f2a agent update --agent-id <agentId> [--name <name>]');
      process.exit(1);
    }
    return;
  }

  const identity = readIdentityByAgentId(options.agentId);

  if (!identity) {
    if (isJsonMode()) {
      outputError('Identity file not found', 'AGENT_NOT_FOUND');
      return;
    }
    console.error('❌ Error: Identity file not found.');
    console.error(`   AgentId: ${options.agentId}`);
    console.error('Please run: f2a agent init --name <name> --webhook <url>');
    process.exit(1);
  }

  if (!identity.privateKey) {
    if (isJsonMode()) {
      outputError('Identity file missing private key. Cannot sign for verification', 'MISSING_PRIVATE_KEY');
      return;
    }
    console.error('❌ Error: Identity file missing private key. Cannot sign for verification.');
    console.error(`   AgentId: ${options.agentId}`);
    console.error('Please ensure the identity file is complete, or recreate it.');
    process.exit(1);
  }

  // 检查是否有要更新的内容
  if (!options.name) {
    if (isJsonMode()) {
      outputError('Nothing to update. Please provide --name parameter', 'INVALID_PARAMETER');
    } else {
      console.log('⚠️  Warning: Nothing to update.');
      console.error('Please provide --name parameter.');
      console.error('Hint: To update webhook, use: f2a agent register --agent-id <agentId> --webhook <url>');
      process.exit(1);
    }
    return;
  }

  try {
    // 构造更新 payload
    const updatePayload: Record<string, unknown> = {
      publicKey: identity.publicKey,
      name: options.name,
    };

    // 1. 发送 PATCH 请求
    const initialResult = await sendRequest('PATCH', `/api/v1/agents/${options.agentId}`, updatePayload);

    // 2. 处理 Challenge-Response
    if (initialResult.challenge) {
      const challenge = initialResult.challenge as Challenge;
      const response: ChallengeResponse = signChallenge(challenge, identity.privateKey);
      
      const finalPayload = {
        ...updatePayload,
        challengeResponse: response,
      }; 
      
      const finalResult = await sendRequest('PATCH', `/api/v1/agents/${options.agentId}`, finalPayload);
      handleUpdateResult(finalResult, identity, options);
    } else {
      handleUpdateResult(initialResult, identity, options);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(`Unable to connect to Daemon: ${message}`, 'DAEMON_NOT_RUNNING');
      return;
    }
    console.error(`❌ Error: Unable to connect to Daemon: ${message}`);
    console.error('Please ensure Daemon is running: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 处理更新结果（更新本地文件）
 */
function handleUpdateResult(
  result: Record<string, unknown>,
  identity: AgentIdentityFile,
  options: { agentId: string; name?: string }
): void {
  if (result.success) {
    // 更新本地身份文件
    if (options.name) {
      identity.name = options.name;
    }
    identity.lastActiveAt = new Date().toISOString();
    
    const identityPath = join(AGENT_IDENTITIES_DIR, `${options.agentId}.json`);
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });

    if (isJsonMode()) {
      outputJson({
        updated: true,
        agentId: options.agentId,
        name: options.name || identity.name || null
      });
      return;
    }

    console.log('✅ Success: Agent updated successfully.');
    console.log(`   AgentId: ${options.agentId}`);
    if (options.name) {
      console.log(`   Name: ${options.name}`);
    }
    console.log('');
    console.log('💡 Daemon and local identity file have been synchronized.');
  } else {
    if (isJsonMode()) {
      outputError(`Update failed: ${result.error}`, (result.code as string) || 'UPDATE_FAILED');
      return;
    }
    console.error(`❌ Error: Update failed: ${result.error}`);
    if (result.code === 'AGENT_NOT_FOUND') {
      console.error('Hint: Agent not registered. Please register first.');
      console.error('      f2a agent register --agent-id ' + options.agentId);
    } else if (result.code === 'CHALLENGE_FAILED') {
      console.error('Hint: Authentication failed. Please check if the identity file is complete.');
    }
    process.exit(1);
  }
}

/**
 * 注销 Agent
 * f2a agent unregister --agent-id <agentId>
 */
export async function unregisterAgent(agentId: string): Promise<void> {
  if (!agentId || agentId.startsWith('--')) {
    if (isJsonMode()) {
      outputError('Missing required parameter: --agent-id', 'MISSING_AGENT_ID');
    } else {
      console.error('❌ Error: Missing required parameter --agent-id. The agent ID is required for unregistration.');
      console.error('Usage: f2a agent unregister --agent-id <agentId>');
      process.exit(1);
    }
    return;
  }

  // 读取身份文件（Challenge-Response 需要）
  const identity = readIdentityByAgentId(agentId);
  if (!identity) {
    if (isJsonMode()) {
      outputError('Identity file not found', 'AGENT_NOT_FOUND');
      return;
    }
    console.error('❌ Error: Identity file not found.');
    console.error(`   AgentId: ${agentId}`);
    console.error('Please run: f2a agent init --name <name> --webhook <url>');
    process.exit(1);
  }

  if (!identity.privateKey) {
    if (isJsonMode()) {
      outputError('Identity file missing private key. Cannot sign for verification', 'MISSING_PRIVATE_KEY');
      return;
    }
    console.error('❌ Error: Identity file missing private key. Cannot sign for verification.');
    console.error('Please ensure the identity file is complete.');
    process.exit(1);
  }

  try {
    // Challenge-Response 认证
    const result = await sendWithChallengeResponse(
      'DELETE',
      `/api/v1/agents/${agentId}`, 
      { agentId },
      identity
    );

    if (result.success) {
      if (isJsonMode()) {
        outputJson({
          unregistered: true,
          agentId: agentId
        });
        return;
      }
      console.log('✅ Success: Agent unregistered successfully.');
      console.log(`   AgentId: ${agentId}`);
      console.log('   Identity file retained, can re-register.');
    } else {
      if (isJsonMode()) {
        outputError(`Unregistration failed: ${result.error}`, (result.code as string) || 'UNREGISTRATION_FAILED');
        return;
      }
      console.error(`❌ Error: Unregistration failed: ${result.error}`);
      if (result.code === 'CHALLENGE_FAILED') {
        console.error('Hint: Authentication failed. Please check the identity file.');
      }
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(`Unable to connect to Daemon: ${message}`, 'DAEMON_NOT_RUNNING');
      return;
    }
    console.error(`❌ Error: Unable to connect to Daemon: ${message}`);
    console.error('Please ensure Daemon is running: f2a daemon start');
    process.exit(1);
  }
}