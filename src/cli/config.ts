/**
 * Agent 名称过滤正则
 * 只允许字母、数字、连字符和下划线
 */
const AGENT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * 验证 Agent 名称格式
 */
export function validateAgentName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Agent name cannot be empty' };
  }
  if (name.length > 50) {
    return { valid: false, error: 'Agent name cannot exceed 50 characters' };
  }
  if (!AGENT_NAME_REGEX.test(name)) {
    return { valid: false, error: 'Agent name can only contain letters, numbers, hyphens, and underscores' };
  }
  return { valid: true };
}

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, copyFileSync } from 'fs';
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
  agentName: z.string()
    .min(1, 'Agent name cannot be empty')
    .max(50, 'Agent name cannot exceed 50 characters')
    .regex(AGENT_NAME_REGEX, 'Agent name can only contain letters, numbers, hyphens, and underscores'),
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

/**
 * 获取配置目录路径
 * 支持通过环境变量 F2A_CONFIG_DIR 注入测试目录
 */
function getConfigDir(): string {
  return process.env.F2A_CONFIG_DIR || join(homedir(), '.f2a');
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * 确保配置目录存在
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
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
  const configFile = getConfigPath();
  if (!existsSync(configFile)) {
    return getDefaultConfig();
  }

  try {
    const content = readFileSync(configFile, 'utf-8');
    const rawConfig = JSON.parse(content);
    
    // 合并默认配置
    const mergedConfig = {
      ...getDefaultConfig(),
      ...rawConfig,
    };
    
    // 验证配置
    const result = F2AConfigSchema.safeParse(mergedConfig);
    
    if (!result.success) {
      console.warn('[F2A] Invalid config file format, using defaults:', result.error.message);
      return getDefaultConfig();
    }
    
    return result.data;
  } catch (error) {
    console.warn('[F2A] Failed to read config file:', error instanceof Error ? error.message : String(error));
    return getDefaultConfig();
  }
}

/**
 * 保存配置文件
 * 会自动备份旧配置并设置安全权限
 */
export function saveConfig(config: F2AConfig): void {
  ensureConfigDir();
  
  const configFile = getConfigPath();
  const configDir = getConfigDir();
  
  // 验证配置
  const result = F2AConfigSchema.safeParse(config);
  
  if (!result.success) {
    throw new Error(`Configuration validation failed: ${result.error.message}`);
  }
  
  // 备份现有配置文件
  if (existsSync(configFile)) {
    const backupFile = join(configDir, `config.json.backup-${Date.now()}`);
    try {
      copyFileSync(configFile, backupFile);
      // 保留最近 5 个备份文件（可选清理逻辑）
    } catch {
      // 备份失败不阻止保存
    }
  }
  
  // 写入配置文件
  writeFileSync(configFile, JSON.stringify(result.data, null, 2), 'utf-8');
  
  // 设置文件权限为 600 (仅所有者可读写)
  try {
    chmodSync(configFile, 0o600);
  } catch {
    // 权限设置失败不阻止保存
  }
}

/**
 * 深度合并两个对象
 * 对于嵌套对象，递归合并而不是覆盖
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = target[key];
      
      if (
        sourceValue !== undefined &&
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        targetValue !== undefined &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        // 递归合并嵌套对象
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[Extract<keyof T, string>];
      } else {
        // 直接赋值（包括数组和基本类型）
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }
  
  return result;
}

/**
 * 更新部分配置
 * 支持深度合并嵌套对象（network, security, rateLimit）
 */
export function updateConfig(partial: Partial<F2AConfig>): F2AConfig {
  const current = loadConfig();
  const updated = deepMerge(current, partial);
  
  saveConfig(updated);
  return updated;
}

/**
 * 检查配置是否存在
 */
export function configExists(): boolean {
  return existsSync(getConfigPath());
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