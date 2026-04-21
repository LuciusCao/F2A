/**
 * F2A CLI - Agent Init 命令
 * f2a agent init --name <name> --agent-identity <path> --webhook <url>
 * 
 * 生成密钥对、计算 AgentId、保存身份文件
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { AgentIdentityKeypair, RFC008IdentityFile, Ed25519Keypair } from '@f2a/network';

/**
 * 默认 F2A 数据目录
 */
export const F2A_DATA_DIR = join(homedir(), '.f2a');

/**
 * 身份文件存储目录（可选，用于默认存放位置）
 */
export const AGENT_IDENTITIES_DIR = join(F2A_DATA_DIR, 'agent-identities');

/**
 * 初始化 Agent 身份
 * 
 * 1. 生成 Ed25519 密钥对
 * 2. 计算公钥指纹作为 AgentId
 * 3. 保存身份文件到指定路径
 * 
 * @param options 初始化选项
 * @returns 创建结果
 */
export async function initAgentIdentity(options: {
  name: string;
  /** 身份文件保存路径（必填） */
  agentIdentity: string;
  /** Webhook URL（必填，用于接收消息） */
  webhook: string;
  capabilities?: Array<{ name: string; version: string }>;
  force?: boolean;
}): Promise<{
  success: boolean;
  agentId?: string;
  identityFile?: string;
  error?: string;
}> {
  const { name, agentIdentity, webhook, capabilities, force } = options;

  // name 必填
  if (!name) {
    return {
      success: false,
      error: '缺少 --name 参数'
    };
  }

  // agentIdentity 必填
  if (!agentIdentity) {
    return {
      success: false,
      error: '缺少 --agent-identity 参数'
    };
  }

  // webhook 必填（Agent 需要接收消息）
  if (!webhook) {
    return {
      success: false,
      error: '缺少 --webhook 参数。Agent 需要 webhook URL 来接收消息'
    };
  }

  try {
    // 创建密钥管理器
    const keypairManager = new AgentIdentityKeypair();

    // 1. 生成 Ed25519 密钥对
    const keypair: Ed25519Keypair = keypairManager.generateKeypair();

    // 2. 计算 AgentId (公钥指纹)
    const agentId = keypairManager.computeAgentId(keypair.publicKey);

    // 3. 确保目录存在
    const identityDir = dirname(agentIdentity);
    if (!existsSync(identityDir)) {
      mkdirSync(identityDir, { recursive: true });
    }

    // 4. 创建身份文件结构
    const identityFile: RFC008IdentityFile = keypairManager.createIdentityFile(keypair, {
      name,
      capabilities,
      webhook: { url: webhook },
      privateKeyEncrypted: false,
    });

    // 5. 检查是否已存在
    if (existsSync(agentIdentity) && !force) {
      return {
        success: false,
        agentId,
        error: `身份文件已存在: ${agentIdentity}。使用 --force 强制重新创建`
      };
    }

    // 6. 保存身份文件 (权限 600)
    writeFileSync(agentIdentity, JSON.stringify(identityFile, null, 2), { mode: 0o600 });

    return {
      success: true,
      agentId,
      identityFile: agentIdentity,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `初始化失败: ${message}`
    };
  }
}

/**
 * 读取 Agent 身份文件
 * 
 * @param identityPath 身份文件路径（必填）
 * @returns 身份文件内容或 null
 */
export function readIdentityFile(identityPath: string): RFC008IdentityFile | null {
  if (!identityPath) {
    return null;
  }

  if (!existsSync(identityPath)) {
    return null;
  }

  try {
    const identity = JSON.parse(readFileSync(identityPath, 'utf-8'));
    return identity as RFC008IdentityFile;
  } catch {
    return null;
  }
}

/**
 * CLI 入口：init 命令
 * 
 * f2a agent init --name <name> --agent-identity <path> --webhook <url> [--capability <cap>]... [--force]
 */
export async function cliInitAgent(options: {
  name: string;
  agentIdentity: string;
  webhook: string;
  capabilities?: string[];
  force?: boolean;
}): Promise<void> {
  // 解析 capabilities
  const parsedCapabilities = options.capabilities?.map(name => ({
    name,
    version: '1.0.0'
  }));

  const result = await initAgentIdentity({
    name: options.name,
    agentIdentity: options.agentIdentity,
    webhook: options.webhook,
    capabilities: parsedCapabilities,
    force: options.force,
  });

  if (result.success) {
    console.log('✅ Agent 身份已创建');
    console.log(`   AgentId: ${result.agentId}`);
    console.log(`   Identity: ${result.identityFile}`);
    console.log(`   Webhook: ${options.webhook}`);
    console.log('');
    console.log('下一步: f2a agent register --agent-identity <path>');
  } else {
    console.error(`❌ 初始化失败: ${result.error}`);
    if (result.agentId) {
      console.error(`   AgentId: ${result.agentId}`);
    }
    console.error('');
    console.error('用法: f2a agent init --name <name> --agent-identity <path> --webhook <url> [--force]');
    process.exit(1);
  }
}

/**
 * 显示 Agent 身份状态
 * 
 * f2a agent status --agent-identity <path>
 */
export async function showAgentStatus(identityPath: string): Promise<void> {
  if (!identityPath) {
    console.log('❌ 缺少 --agent-identity 参数');
    console.log('用法: f2a agent status --agent-identity <path>');
    return;
  }

  const identity = readIdentityFile(identityPath);

  if (!identity) {
    console.log('❌ 未找到身份文件');
    console.log(`   Path: ${identityPath}`);
    return;
  }

  console.log('=== Agent Status ===');
  console.log('');
  console.log(`Identity: ${identityPath}`);
  console.log(`AgentId: ${identity.agentId}`);
  console.log(`Name: ${identity.name || 'N/A'}`);
  console.log(`Public Key: ${identity.publicKey.slice(0, 24)}...`);
  
  if (identity.nodeSignature) {
    console.log(`Node Signature: ✅ 已签发`);
    console.log(`Node PeerId: ${identity.nodePeerId || 'N/A'}`);
  } else {
    console.log(`Node Signature: ⚪ 未签发`);
    console.log('   使用 f2a agent register 注册到 Daemon');
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