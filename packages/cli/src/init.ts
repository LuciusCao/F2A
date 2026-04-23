/**
 * F2A CLI - Agent Init 命令
 * f2a agent init --name <name> [--webhook <url>]
 * 
 * 自动生成密钥对、计算 AgentId、保存到 ~/.f2a/agent-identities/<agentId>.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AgentIdentityKeypair, AgentIdentityFile, Ed25519Keypair } from '@f2a/network';
import { isJsonMode, outputJson, outputError } from './output.js';

/**
 * 默认 F2A 数据目录
 */
export const F2A_DATA_DIR = join(homedir(), '.f2a');

/**
 * 身份文件存储目录
 */
export const AGENT_IDENTITIES_DIR = join(F2A_DATA_DIR, 'agent-identities');

/**
 * 初始化 Agent 身份
 * 
 * 自动保存到 ~/.f2a/agent-identities/<agentId>.json
 * 
 * @param options 初始化选项
 * @returns 创建结果
 */
export async function initAgentIdentity(options: {
  name: string;
  /** Webhook URL（可选，用于接收消息） */
  webhook?: string;
  capabilities?: Array<{ name: string; version: string }>;
  force?: boolean;
}): Promise<{
  success: boolean;
  agentId?: string;
  identityFile?: string;
  error?: string;
}> {
  const { name, webhook, capabilities, force } = options;

  if (!name) {
    return { success: false, error: 'Missing required --name parameter. The agent name is required for identity creation.' };
  }

  try {
    const keypairManager = new AgentIdentityKeypair();
    const keypair: Ed25519Keypair = keypairManager.generateKeypair();
    const agentId = keypairManager.computeAgentId(keypair.publicKey);

    // 确保目录存在
    if (!existsSync(AGENT_IDENTITIES_DIR)) {
      mkdirSync(AGENT_IDENTITIES_DIR, { recursive: true });
    }

    // 身份文件路径: ~/.f2a/agent-identities/<agentId>.json
    const identityPath = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);

    // 检查是否已存在
    if (existsSync(identityPath) && !force) {
      return {
        success: false,
        agentId,
        error: `Identity file already exists at: ${identityPath}. Use --force to overwrite and recreate.`
      };
    }

    // 创建身份文件
    const identityFile: AgentIdentityFile = keypairManager.createIdentityFile(keypair, {
      name,
      capabilities,
      webhook: webhook ? { url: webhook } : undefined,
      privateKeyEncrypted: false,
    });

    // 保存（权限 600）
    writeFileSync(identityPath, JSON.stringify(identityFile, null, 2), { mode: 0o600 });

    return {
      success: true,
      agentId,
      identityFile: identityPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Initialization failed: ${message}` };
  }
}

/**
 * 列出所有本地身份文件
 */
export function listLocalIdentities(): Array<{ agentId: string; name: string; path: string }> {
  if (!existsSync(AGENT_IDENTITIES_DIR)) {
    return [];
  }

  const files = readdirSync(AGENT_IDENTITIES_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('agent:'));

  const identities: Array<{ agentId: string; name: string; path: string }> = [];

  for (const file of files) {
    try {
      const path = join(AGENT_IDENTITIES_DIR, file);
      const content = JSON.parse(readFileSync(path, 'utf-8'));
      identities.push({
        agentId: content.agentId,
        name: content.name || 'unnamed',
        path,
      });
    } catch {
      // 忽略解析失败的文件
    }
  }

  return identities;
}

/**
 * 按 AgentId 读取身份文件
 * 
 * @param agentId Agent ID (格式: agent:xxx)
 * @returns 身份文件内容或 null
 */
export function readIdentityByAgentId(agentId: string): AgentIdentityFile | null {
  if (!agentId) {
    return null;
  }

  const identityPath = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);

  if (!existsSync(identityPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(identityPath, 'utf-8')) as AgentIdentityFile;
  } catch {
    return null;
  }
}

/**
 * CLI 入口：init 命令
 * 
 * f2a agent init --name <name> [--webhook <url>] [--capability <cap>]... [--force]
 */
export async function cliInitAgent(options: {
  name: string;
  webhook?: string;
  capabilities?: string[];
  force?: boolean;
}): Promise<void> {
  const parsedCapabilities = options.capabilities?.map(name => ({
    name,
    version: '1.0.0'
  }));

  const result = await initAgentIdentity({
    name: options.name,
    webhook: options.webhook,
    capabilities: parsedCapabilities,
    force: options.force,
  });

  if (result.success) {
    if (isJsonMode()) {
      outputJson({
        agentId: result.agentId,
        name: options.name,
        webhook: options.webhook || null,
        capabilities: parsedCapabilities || [],
        identityPath: result.identityFile
      });
    } else {
      console.log('✅ Agent identity created successfully.');
      console.log('');
      console.log(`   AgentId: ${result.agentId}`);
      console.log(`   Name: ${options.name}`);
      if (options.webhook) {
        console.log(`   Webhook: ${options.webhook}`);
      }
      console.log('');
      console.log('📝 Please save the following information for your records:');
      console.log('   AgentId: ' + result.agentId);
      console.log('   Identity: ' + result.identityFile);
      console.log('');
      console.log('💡 Use the F2A CLI with the F2A-AgentId parameter:');
      console.log('   f2a agent register --agent-id <F2A-AgentId>');
      console.log('   f2a message send --agent-id <F2A-AgentId> --to <target> "content"');
    }
  } else {
    if (isJsonMode()) {
      outputError(result.error || 'Initialization failed', 'AGENT_INIT_FAILED');
    } else {
      console.error(`❌ Initialization failed: ${result.error}`);
      console.error('');
      console.error('Usage: f2a agent init --name <name> [--webhook <url>] [--force]');
      process.exit(1);
    }
  }
}

/**
 * 显示 Agent 身份状态
 * 
 * f2a agent status --agent-id <agentId>
 * 或 f2a agent status（列出所有本地身份）
 */
export async function showAgentStatus(agentId?: string): Promise<void> {
  if (!agentId) {
    // 列出所有本地身份
    const identities = listLocalIdentities();

    if (identities.length === 0) {
      if (isJsonMode()) {
        outputJson([]);
      } else {
        console.log('📭 No local identity files found.');
        console.log('Please run: f2a agent init --name <name>');
      }
      return;
    }

    if (isJsonMode()) {
      outputJson(identities);
    } else {
      console.log(`📋 Local identity files (${identities.length}):`);
      console.log('');
      for (const id of identities) {
        const statusMark = id.name ? '🔹' : '⚪';
        console.log(`${statusMark} ${id.name}`);
        console.log(`   AgentId: ${id.agentId}`);
        console.log(`   Path: ${id.path}`);
        console.log('');
      }
      console.log('Use --agent-id <id> to view details.');
    }
    return;
  }

  const identity = readIdentityByAgentId(agentId);

  if (!identity) {
    if (isJsonMode()) {
      outputError(`Identity file not found for agent: ${agentId}`, 'AGENT_NOT_FOUND');
    } else {
      console.log('❌ Identity file not found.');
      console.log(`   AgentId: ${agentId}`);
      console.log(`   Expected: ${join(AGENT_IDENTITIES_DIR, `${agentId}.json`)}`);
    }
    return;
  }

  if (isJsonMode()) {
    outputJson({
      agentId: identity.agentId,
      name: identity.name || null,
      nodeId: identity.nodeId || null,
      registered: !!identity.nodeSignature,
      webhook: identity.webhook?.url || null,
      capabilities: identity.capabilities || []
    });
  } else {
    console.log('=== Agent Status ===');
    console.log('');
    console.log(`AgentId: ${identity.agentId}`);
    console.log(`Name: ${identity.name || 'N/A'}`);
    console.log(`Public Key: ${identity.publicKey.slice(0, 24)}...`);
    
    if (identity.nodeSignature) {
      console.log(`Node Signature: ✅ Issued`);
      console.log(`Node ID: ${identity.nodeId || 'N/A'}`);
    } else {
      console.log(`Node Signature: ⚪ Not issued`);
      console.log('   Use f2a agent register to register with Daemon');
    }

    if (identity.capabilities && identity.capabilities.length > 0) {
      console.log(`Capabilities: ${identity.capabilities.map((c: { name: string }) => c.name).join(', ')}`);
    }

    if (identity.webhook) {
      console.log(`Webhook: ${identity.webhook.url}`);
    }

    console.log(`Created: ${identity.createdAt}`);
    console.log(`Last Active: ${identity.lastActiveAt || 'N/A'}`);
  }
}