/**
 * F2A 配置管理
 * 支持分层配置：必需 -> 进阶 -> 专家
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// ============================================================================
// 配置 Schema
// ============================================================================

/**
 * 必需配置（仅 3 项）
 */
const RequiredConfigSchema = z.object({
  /** Agent 名称 */
  agentName: z.string().min(1).max(50),
  /** 网络配置 */
  network: z.object({
    /** 引导节点列表 */
    bootstrapPeers: z.array(z.string()).default([]),
  }),
  /** 是否自动启动 */
  autoStart: z.boolean().default(false),
});

/**
 * 进阶配置（可选）
 */
const AdvancedConfigSchema = z.object({
  /** 控制端口 */
  controlPort: z.number().int().min(1024).max(65535).default(9001),
  /** P2P 端口 (0 = 随机分配) */
  p2pPort: z.number().int().min(0).max(65535).default(0),
  /** 是否启用 MDNS 本地发现 */
  enableMDNS: z.boolean().default(true),
  /** 是否启用 DHT */
  enableDHT: z.boolean().default(true),
  /** 日志级别 */
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
});

/**
 * 专家配置（极少需要）
 */
const ExpertConfigSchema = z.object({
  /** 数据目录 */
  dataDir: z.string().optional(),
  /** 安全级别 */
  security: z.object({
    level: z.enum(['low', 'medium', 'high']).default('medium'),
    requireConfirmation: z.boolean().default(true),
  }).optional(),
  /** 速率限制 */
  rateLimit: z.object({
    maxRequests: z.number().default(100),
    windowMs: z.number().default(60000),
  }).optional(),
});

/**
 * 完整配置 Schema
 */
export const F2AConfigSchema = RequiredConfigSchema.merge(AdvancedConfigSchema).merge(ExpertConfigSchema);

export type F2AConfig = z.infer<typeof F2AConfigSchema>;

// ============================================================================
// 配置管理器
// ============================================================================

const CONFIG_DIR = join(homedir(), '.f2a');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * 确保配置目录存在
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 获取默认配置
 */
export function getDefaultConfig(): F2AConfig {
  return {
    agentName: 'my-agent',
    network: {
      bootstrapPeers: [],
    },
    autoStart: false,
    controlPort: 9001,
    p2pPort: 0,
    enableMDNS: true,
    enableDHT: true,
    logLevel: 'INFO',
  };
}

/**
 * 加载配置文件
 * 如果文件不存在，返回默认配置
 */
export function loadConfig(): F2AConfig {
  if (!existsSync(CONFIG_FILE)) {
    return getDefaultConfig();
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const rawConfig = JSON.parse(content);
    
    // 合并默认配置
    const mergedConfig = {
      ...getDefaultConfig(),
      ...rawConfig,
    };
    
    // 验证配置
    const result = F2AConfigSchema.safeParse(mergedConfig);
    
    if (!result.success) {
      console.warn('[F2A] 配置文件格式错误，使用默认配置:', result.error.message);
      return getDefaultConfig();
    }
    
    return result.data;
  } catch (error) {
    console.warn('[F2A] 无法读取配置文件:', error instanceof Error ? error.message : String(error));
    return getDefaultConfig();
  }
}

/**
 * 保存配置文件
 */
export function saveConfig(config: F2AConfig): void {
  ensureConfigDir();
  
  // 验证配置
  const result = F2AConfigSchema.safeParse(config);
  
  if (!result.success) {
    throw new Error(`配置验证失败: ${result.error.message}`);
  }
  
  writeFileSync(CONFIG_FILE, JSON.stringify(result.data, null, 2), 'utf-8');
}

/**
 * 更新部分配置
 */
export function updateConfig(partial: Partial<F2AConfig>): F2AConfig {
  const current = loadConfig();
  const updated = {
    ...current,
    ...partial,
    network: {
      ...current.network,
      ...partial.network,
    },
  };
  
  saveConfig(updated);
  return updated;
}

/**
 * 检查配置是否存在
 */
export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

// ============================================================================
// 配置验证
// ============================================================================

/**
 * 验证配置完整性
 * 返回 { valid: boolean, missing: string[] }
 */
export function validateConfig(config: F2AConfig): { valid: boolean; missing: string[]; errors: string[] } {
  const result = RequiredConfigSchema.safeParse(config);
  
  if (result.success) {
    return { valid: true, missing: [], errors: [] };
  }
  
  const errors: string[] = [];
  const missing: string[] = [];
  
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (issue.code === 'invalid_type' && issue.expected === 'string') {
      missing.push(path);
    }
    errors.push(`${path}: ${issue.message}`);
  }
  
  return { valid: false, missing, errors };
}