/**
 * F2A CLI 配置管理
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// ============================================================================
// 常量
// ============================================================================

/**
 * Agent 名称过滤正则
 * 只允许字母、数字、连字符和下划线
 */
export const AGENT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Multiaddr 格式正则
 * 支持 /ip4/..., /ip6/..., /dns/..., /dns4/..., /dns6/..., /dnsaddr/... 等格式
 * 必须包含 /p2p/<peer-id> 或 /ipfs/<peer-id>
 */
export const MULTIADDR_REGEX = /^\/(ip4|ip6|dns|dns4|dns6|dnsaddr)(\/[a-zA-Z0-9.\-:]+)+\/(p2p|ipfs)\/[a-zA-Z0-9]+$/;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 调试日志（仅在 DEBUG 模式下输出详细信息）
 */
function debugLog(message: string, data?: unknown): void {
  if (process.env.F2A_DEBUG === 'true') {
    console.warn(`[F2A DEBUG] ${message}`, data !== undefined ? data : '');
  }
}

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

/**
 * 验证 multiaddr 格式
 */
export function validateMultiaddr(addr: string): { valid: boolean; error?: string } {
  if (!addr || typeof addr !== 'string') {
    return { valid: false, error: 'Invalid multiaddr: empty or not a string' };
  }
  if (!MULTIADDR_REGEX.test(addr)) {
    return { valid: false, error: 'Invalid multiaddr format. Expected: /ip4|ip6|dns|dns4|dns6|dnsaddr/<host>/p2p/<peer-id>' };
  }
  return { valid: true };
}

/**
 * 验证路径安全性
 * 禁止路径遍历（..）和危险字符
 */
export function validatePath(path: string): { valid: boolean; error?: string } {
  if (!path || typeof path !== 'string') {
    return { valid: false, error: 'Invalid path: empty or not a string' };
  }
  if (path.includes('..')) {
    return { valid: false, error: 'Invalid path: path traversal (..) is not allowed' };
  }
  // 检查是否为绝对路径或有效的相对路径
  // 允许字母、数字、连字符、下划线、斜杠、点（但不能连续）、波浪号
  if (!/^[a-zA-Z0-9_./\-~]+$/.test(path)) {
    return { valid: false, error: 'Invalid path: contains disallowed characters' };
  }
  return { valid: true };
}

/**
 * 清理旧备份文件，保留最近 N 个
 */
function cleanupOldBackups(configDir: string, keepCount: number = 5): void {
  try {
    const backupFiles = readdirSync(configDir)
      .filter((f) => f.startsWith('config.json.backup-'))
      .map((f) => ({
        name: f,
        path: join(configDir, f),
        time: statSync(join(configDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // 删除超出保留数量的备份
    for (let i = keepCount; i < backupFiles.length; i++) {
      try {
        unlinkSync(backupFiles[i].path);
        debugLog('Removed old backup', backupFiles[i].name);
      } catch {
        // 删除失败不阻止保存
      }
    }
  } catch {
    // 清理失败不阻止保存
  }
}

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
    /** 引导节点列表 - 必须是有效的 multiaddr 格式 */
    bootstrapPeers: z.array(z.string()).default([]).refine(
      (peers) => peers.every((peer) => validateMultiaddr(peer).valid),
      { message: 'Invalid bootstrap peer format. Expected multiaddr: /ip4|ip6|dns*/<host>/p2p/<peer-id>' }
    ),
    /** 引导节点指纹映射 - key为multiaddr，value为预期的PeerID */
    bootstrapPeerFingerprints: z.record(z.string(), z.string()).optional(),
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
  dataDir: z.string()
    .refine(
      (val) => val.startsWith('/'),
      'dataDir must be an absolute path'
    )
    .refine(
      (val) => !val.includes('..') && !/[<>:"|?*\x00-\x1f]/.test(val),
      'dataDir contains forbidden characters or path traversal patterns'
    )
    .optional(),
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
  /** 消息处理 URL - 收到自由消息时调用 */
  messageHandlerUrl: z.string().url().optional().or(z.literal('')),
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
      bootstrapPeerFingerprints: {},
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
      // 仅输出通用提示，详细错误写入调试日志
      console.warn('[F2A] Invalid config file format, using defaults. Please run "f2a init" to reconfigure.');
      debugLog('Config validation failed', result.error.issues);
      return getDefaultConfig();
    }
    
    return result.data;
  } catch (error) {
    // 仅输出通用提示，详细错误写入调试日志
    console.warn('[F2A] Failed to read config file, using defaults. Please check file permissions and format.');
    debugLog('Config load error', error instanceof Error ? error.message : String(error));
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
    // 仅输出简化错误信息，详细错误写入调试日志
    debugLog('Config validation failed', result.error.issues);
    throw new Error('Configuration validation failed. Please check your configuration values.');
  }
  
  // 备份现有配置文件
  if (existsSync(configFile)) {
    const backupFile = join(configDir, `config.json.backup-${Date.now()}`);
    try {
      copyFileSync(configFile, backupFile);
      // 清理旧备份文件，保留最近 5 个
      cleanupOldBackups(configDir, 5);
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
 * 验证所有 Schema（Required + Advanced + Expert）
 * 返回 { valid: boolean, missing: string[]; errors: string[] }
 */
export function validateConfig(config: F2AConfig): { valid: boolean; missing: string[]; errors: string[] } {
  const errors: string[] = [];
  const missing: string[] = [];
  
  // 验证必需配置
  const requiredResult = RequiredConfigSchema.safeParse(config);
  if (!requiredResult.success) {
    for (const issue of requiredResult.error.issues) {
      const path = issue.path.join('.');
      if (issue.code === 'invalid_type' && issue.expected === 'string') {
        missing.push(path);
      }
      errors.push(`${path}: ${issue.message}`);
    }
  }
  
  // 验证进阶配置（如果存在相关字段）
  const advancedFields = ['controlPort', 'p2pPort', 'enableMDNS', 'enableDHT', 'logLevel'];
  const hasAdvancedFields = advancedFields.some(field => field in config);
  if (hasAdvancedFields) {
    const advancedResult = AdvancedConfigSchema.safeParse(config);
    if (!advancedResult.success) {
      for (const issue of advancedResult.error.issues) {
        const path = issue.path.join('.');
        errors.push(`${path}: ${issue.message}`);
      }
    }
  }
  
  // 验证专家配置（如果存在相关字段）
  const expertFields = ['dataDir', 'security', 'rateLimit'];
  const hasExpertFields = expertFields.some(field => field in config);
  if (hasExpertFields) {
    const expertResult = ExpertConfigSchema.safeParse(config);
    if (!expertResult.success) {
      for (const issue of expertResult.error.issues) {
        const path = issue.path.join('.');
        errors.push(`${path}: ${issue.message}`);
      }
    }
  }
  
  // 额外的 dataDir 路径安全验证（使用 validatePath 函数）
  if (config.dataDir) {
    const pathValidation = validatePath(config.dataDir);
    if (!pathValidation.valid) {
      errors.push(`dataDir: ${pathValidation.error}`);
    }
    // 必须是绝对路径
    if (!config.dataDir.startsWith('/')) {
      errors.push('dataDir: Must be an absolute path');
    }
  }
  
  const valid = errors.length === 0 && missing.length === 0;
  return { valid, missing, errors };
}