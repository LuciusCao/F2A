/**
 * F2A CLI - Agent Init 命令
 * f2a agent init --name <name> [--caller-config <path>]
 * 
 * RFC008 Phase 2: 生成密钥对、计算 AgentId、保存身份文件
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { AgentIdentityKeypair, RFC008IdentityFile, Ed25519Keypair } from '@f2a/network';

/**
 * Caller 配置文件格式
 * 
 * RFC008 第 413-430 行定义
 */
export interface CallerConfig {
  /** Agent ID (公钥指纹) */
  agentId: string;
  /** Caller 名称 */
  callerName?: string;
  /** Caller 类型 (hermes, openclaw, etc.) */
  callerType?: string;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 默认 F2A 数据目录
 */
export const F2A_DATA_DIR = join(homedir(), '.f2a');

/**
 * 默认 Caller 配置路径
 */
export const DEFAULT_CALLER_CONFIG = join(F2A_DATA_DIR, 'current-agent.json');

/**
 * 身份文件存储目录
 */
export const AGENTS_DIR = join(F2A_DATA_DIR, 'agents');

/**
 * 初始化 Agent 身份
 * 
 * 按照 RFC008 规范：
 * 1. 生成 Ed25519 密钥对
 * 2. 计算公钥指纹作为 AgentId
 * 3. 保存身份文件到 ~/.f2a/agents/agent:{fingerprint}.json
 * 4. 可选保存 Caller 配置到指定路径
 * 
 * @param options 初始化选项
 * @returns 创建结果
 */
export async function initAgentIdentity(options: {
  name: string;
  callerConfig?: string;
  capabilities?: Array<{ name: string; version: string }>;
  webhook?: { url: string };
  force?: boolean;
}): Promise<{
  success: boolean;
  agentId?: string;
  identityFile?: string;
  callerConfigFile?: string;
  error?: string;
}> {
  const { name, callerConfig, capabilities, webhook, force } = options;

  // name 必填
  if (!name) {
    return {
      success: false,
      error: '缺少 --name 参数'
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
    if (!existsSync(AGENTS_DIR)) {
      mkdirSync(AGENTS_DIR, { recursive: true });
    }

    // 身份文件路径
    const identityFilePath = join(AGENTS_DIR, `${agentId}.json`);

    // 检查是否已存在
    if (existsSync(identityFilePath) && !force) {
      return {
        success: false,
        agentId,
        error: `身份文件已存在: ${identityFilePath}。使用 --force 强制重新创建`
      };
    }

    // 4. 创建身份文件结构
    const identityFile: RFC008IdentityFile = keypairManager.createIdentityFile(keypair, {
      name,
      capabilities,
      webhook,
      privateKeyEncrypted: false,
    });

    // 5. 保存身份文件 (权限 600)
    writeFileSync(identityFilePath, JSON.stringify(identityFile, null, 2), { mode: 0o600 });

    // 6. 保存 Caller 配置
    const callerConfigPath = callerConfig || DEFAULT_CALLER_CONFIG;
    const callerConfigDir = dirname(callerConfigPath);

    if (!existsSync(callerConfigDir)) {
      mkdirSync(callerConfigDir, { recursive: true });
    }

    const callerConfigData: CallerConfig = {
      agentId,
      callerName: name,
      createdAt: new Date().toISOString(),
    };

    // 如果 callerConfigPath 不是默认路径，尝试推断 callerType
    if (callerConfig) {
      if (callerConfig.includes('.hermes')) {
        callerConfigData.callerType = 'hermes';
      } else if (callerConfig.includes('.openclaw')) {
        callerConfigData.callerType = 'openclaw';
      }
    }

    // 检查 Caller 配置是否已存在
    if (existsSync(callerConfigPath) && !force) {
      const existingConfig = JSON.parse(readFileSync(callerConfigPath, 'utf-8'));
      if (existingConfig.agentId !== agentId) {
        console.log(`⚠️  Caller 配置已存在，指向不同的 Agent: ${existingConfig.agentId}`);
        console.log(`   使用 --force 强制更新`);
        // 不返回失败，因为身份文件已创建成功
      }
    }

    if (!existsSync(callerConfigPath) || force) {
      writeFileSync(callerConfigPath, JSON.stringify(callerConfigData, null, 2), { mode: 0o600 });
    }

    return {
      success: true,
      agentId,
      identityFile: identityFilePath,
      callerConfigFile: callerConfigPath,
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
 * 读取 Caller 配置
 * 
 * @param callerConfigPath Caller 配置路径（可选，默认使用 F2A_IDENTITY 环境变量或默认路径）
 * @returns Caller 配置或 null
 */
export function readCallerConfig(callerConfigPath?: string): CallerConfig | null {
  const configPath = callerConfigPath 
    || process.env.F2A_IDENTITY 
    || DEFAULT_CALLER_CONFIG;

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return config as CallerConfig;
  } catch {
    return null;
  }
}

/**
 * 读取 Agent 身份文件
 * 
 * @param agentId Agent ID
 * @returns 身份文件内容或 null
 */
export function readIdentityFile(agentId: string): RFC008IdentityFile | null {
  const identityFilePath = join(AGENTS_DIR, `${agentId}.json`);

  if (!existsSync(identityFilePath)) {
    return null;
  }

  try {
    const identity = JSON.parse(readFileSync(identityFilePath, 'utf-8'));
    return identity as RFC008IdentityFile;
  } catch {
    return null;
  }
}

/**
 * CLI 入口：init 命令
 * 
 * f2a agent init --name <name> [--caller-config <path>] [--capability <cap>]... [--webhook <url>] [--force]
 */
export async function cliInitAgent(options: {
  name: string;
  callerConfig?: string;
  capabilities?: string[];
  webhook?: string;
  force?: boolean;
}): Promise<void> {
  // 解析 capabilities
  const parsedCapabilities = options.capabilities?.map(name => ({
    name,
    version: '1.0.0'
  }));

  // 解析 webhook
  const parsedWebhook = options.webhook ? { url: options.webhook } : undefined;

  const result = await initAgentIdentity({
    name: options.name,
    callerConfig: options.callerConfig,
    capabilities: parsedCapabilities,
    webhook: parsedWebhook,
    force: options.force,
  });

  if (result.success) {
    console.log('✅ Agent 身份已创建');
    console.log(`   AgentId: ${result.agentId}`);
    console.log(`   Identity file: ${result.identityFile}`);
    if (result.callerConfigFile) {
      console.log(`   Caller config: ${result.callerConfigFile}`);
    }
    console.log('');
    console.log('下一步: 使用 f2a agent register 注册到 Daemon');
  } else {
    console.error(`❌ 初始化失败: ${result.error}`);
    if (result.agentId) {
      console.error(`   AgentId: ${result.agentId}`);
    }
    console.error('');
    console.error('用法: f2a agent init --name <name> [--caller-config <path>] [--force]');
    process.exit(1);
  }
}

/**
 * 显示 Agent 身份状态
 * 
 * f2a agent status [--caller-config <path>]
 */
export async function showAgentStatus(callerConfigPath?: string): Promise<void> {
  const callerConfig = readCallerConfig(callerConfigPath);

  if (!callerConfig) {
    console.log('❌ 未找到 Caller 配置');
    console.log('请先运行: f2a agent init --name <name>');
    return;
  }

  const identity = readIdentityFile(callerConfig.agentId);

  if (!identity) {
    console.log('❌ 未找到身份文件');
    console.log(`   AgentId: ${callerConfig.agentId}`);
    console.log(`   Expected: ${join(AGENTS_DIR, `${callerConfig.agentId}.json`)}`);
    return;
  }

  console.log('=== Agent Identity Status ===');
  console.log('');
  console.log(`AgentId: ${identity.agentId}`);
  console.log(`Name: ${identity.name || 'N/A'}`);
  console.log(`Public Key: ${identity.publicKey.slice(0, 24)}...`);
  console.log(`Private Key Encrypted: ${identity.privateKeyEncrypted ? 'Yes' : 'No'}`);
  
  if (identity.nodeSignature) {
    console.log(`Node Signature: ✅ 已签发`);
    console.log(`Node PeerId: ${identity.nodePeerId || 'N/A'}`);
  } else {
    console.log(`Node Signature: ⚪ 未签发`);
    console.log('   使用 f2a agent register 获取 Node 签名');
  }

  if (identity.capabilities && identity.capabilities.length > 0) {
    console.log(`Capabilities: ${identity.capabilities.map((c: { name: string; version: string }) => c.name).join(', ')}`);
  }

  if (identity.webhook) {
    console.log(`Webhook: ${identity.webhook.url}`);
  }

  console.log(`Created: ${identity.createdAt}`);
  console.log(`Last Active: ${identity.lastActiveAt || 'N/A'}`);
}