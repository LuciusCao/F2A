/**
 * F2A Connector 辅助函数
 * 
 * 提供验证、错误处理、路径安全等工具函数。
 */

import { existsSync, readFileSync, realpathSync } from 'fs';
import { join, resolve, relative } from 'path';
import { randomBytes } from 'crypto';
import type { F2ANodeConfig, Result, F2APluginConfig, AgentInfo } from './types.js';

// ============================================================================
// 常量
// ============================================================================

/** 消息最大长度 */
export const MAX_MESSAGE_LENGTH = 1024 * 1024;

/** libp2p Peer ID 正则 */
export const PEER_ID_REGEX = /^12D3KooW[A-Za-z1-9]{44}$/;

/** 路径遍历模式 */
export const PATH_TRAVERSAL_PATTERNS = [
  '../',
  '..\\',
  '%2e%2e%2f',
  '%2e%2e/',
  '..%2f',
  '%2e%2e%5c',
  '%2e%2e\\',
  '..%5c',
];

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证 Peer ID 格式
 * 
 * Peer ID 格式：12D3KooW + 44 个 Base58 字符 = 52 字符
 */
export function isValidPeerId(peerId: string | undefined | null): peerId is string {
  if (typeof peerId !== 'string' || peerId.length === 0) {
    return false;
  }
  return PEER_ID_REGEX.test(peerId);
}

/**
 * 检查路径是否安全
 * 
 * P2-1 修复：实现 allowedRoot 验证逻辑
 * 
 * 允许绝对路径，但拒绝包含路径遍历字符的路径。
 * 如果提供了 allowedRoot，则路径必须在该根目录范围内。
 */
export function isPathSafe(path: string | undefined | null, options?: { 
  /** 允许的根目录（路径必须在此目录下） */
  allowedRoot?: string;
  /** 是否检查符号链接（需要文件系统访问） */
  checkSymlinks?: boolean;
}): path is string {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  
  // 允许绝对路径（workspace 配置通常是绝对路径）
  
  // 拒绝包含路径遍历字符
  if (path.includes('..') || path.includes('\0')) {
    return false;
  }
  
  // 拒绝以 ~ 开头的路径（用户目录展开）
  if (path.startsWith('~')) {
    return false;
  }
  
  // 检查 URL 编码的路径遍历模式
  const lowerPath = path.toLowerCase();
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      return false;
    }
  }
  
  // 解码 URL 编码后再次检查
  try {
    const decodedPath = decodeURIComponent(path);
    if (decodedPath.includes('..') || decodedPath.includes('\0')) {
      return false;
    }
  } catch {
    // 解码失败可能是恶意构造，拒绝
    return false;
  }
  
  // P2-1 修复：实现 allowedRoot 验证逻辑
  if (options?.allowedRoot) {
    // 规范化路径（解析为绝对路径）
    const absolutePath = resolve(path);
    const absoluteRoot = resolve(options.allowedRoot);
    
    // 计算相对路径，检查是否在允许范围内
    const relativePath = relative(absoluteRoot, absolutePath);
    
    // 如果相对路径以 '..' 开头或为绝对路径，说明不在允许范围内
    if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
      return false;
    }
    
    // 如果配置了检查符号链接，验证符号链接不指向外部
    if (options.checkSymlinks) {
      try {
        // 获取真实路径（解析符号链接）
        const realPath = realpathSync(absolutePath);
        const realRoot = realpathSync(absoluteRoot);
        
        const realRelative = relative(realRoot, realPath);
        if (realRelative.startsWith('..') || realRelative.startsWith('/')) {
          return false;
        }
      } catch {
        // 文件不存在时无法验证符号链接，保持谨慎
        // 如果文件不存在，路径仍然可能是安全的（用于创建新文件）
        // 但我们仍然检查前面的遍历限制
      }
    }
  }
  
  return true;
}

// ============================================================================
// 错误处理
// ============================================================================

/**
 * 提取错误消息
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return String(error);
}

// ============================================================================
// Agent 信息
// ============================================================================

/**
 * 从 IDENTITY.md 读取 Agent 名称
 */
export function readAgentNameFromIdentity(workspace: string | undefined): string | null {
  if (!workspace) return null;
  
  const identityPath = join(workspace, 'IDENTITY.md');
  if (!existsSync(identityPath)) return null;
  
  try {
    const content = readFileSync(identityPath, 'utf-8');
    
    // 尝试从 markdown 提取 name
    // 格式: - **Name:** AgentName
    const nameMatch = content.match(/-\s*\*?\*?Name:?\*?\*?\s*(.+)/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      // 清理 markdown 格式
      return name.replace(/\*\*/g, '').trim();
    }
    
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// 配置
// ============================================================================

/**
 * 合并配置
 */
export function mergeConfig(config: Record<string, unknown> & { _api?: unknown }): F2APluginConfig {
  const api = config._api as any;
  const workspace = api?.config?.agents?.defaults?.workspace;
  
  return {
    autoStart: (config.autoStart as boolean) ?? true,
    webhookPort: (config.webhookPort as number) ?? 9002,
    webhookToken: config.webhookToken as string | undefined,
    agentName: (config.agentName as string) ?? 'OpenClaw Agent',
    capabilities: (config.capabilities as string[]) ?? [],
    f2aPath: config.f2aPath as string | undefined,
    controlPort: config.controlPort as number | undefined,
    controlToken: config.controlToken as string | undefined,
    p2pPort: config.p2pPort as number | undefined,
    enableMDNS: config.enableMDNS as boolean | undefined,
    bootstrapPeers: config.bootstrapPeers as string[] | undefined,
    dataDir: config.dataDir as string | undefined,
    maxQueuedTasks: (config.maxQueuedTasks as number) ?? 100,
    pollInterval: config.pollInterval as number | undefined,
    webhookPush: config.webhookPush as any,
    reputation: config.reputation as any,
    security: config.security as any,
    handshake: config.handshake as any,
  };
}

/**
 * 生成随机 Token
 * 
 * P1-1 修复：使用 crypto.randomBytes() 替代 Math.random()
 * 确保生成加密安全的随机 Token
 */
export function generateToken(): string {
  const bytes = randomBytes(24); // 24 bytes = 32 base64 字符（去掉填充）
  // 使用 Base64 编码，去掉填充字符（=），得到 32 字符的 token
  return bytes.toString('base64').replace(/[+/=]/g, (char) => {
    // 将 base64 的 +/ 替换为字母，去掉 =
    if (char === '+') return 'A';
    if (char === '/') return 'B';
    return ''; // 移除 '='
  }).slice(0, 32);
}

// ============================================================================
// Node 管理
// ============================================================================

/**
 * 检查 F2A Node 是否已安装
 */
export function checkF2AInstalled(nodePath: string): boolean {
  return existsSync(nodePath);
}

// ============================================================================
// 结果格式化
// ============================================================================

/**
 * 格式化广播结果
 */
export function formatBroadcastResults(results: Array<{ peerId: string; name?: string; success: boolean; error?: string }>): string {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  let output = '';
  
  if (successful.length > 0) {
    output += `✅ 成功: ${successful.length} 个\n`;
    for (const r of successful) {
      output += `   ${r.name || r.peerId.slice(0, 20)}...\n`;
    }
  }
  
  if (failed.length > 0) {
    output += `\n❌ 失败: ${failed.length} 个\n`;
    for (const r of failed) {
      output += `   ${r.name || r.peerId.slice(0, 20)}...\n`;
      output += `      错误: ${r.error || '未知错误'}\n`;
    }
  }
  
  return output;
}

/**
 * 解析 Agent 引用
 * 
 * 支持：
 * - Peer ID（完整或前缀）
 * - Agent 名称（精确或模糊匹配）
 * - #索引格式（如 #1, #2）
 */
export async function resolveAgent(
  agentRef: string,
  discoverAgents: () => Promise<{ success: boolean; data?: AgentInfo[] }>
): Promise<AgentInfo | null> {
  const result = await discoverAgents();
  if (!result?.success) return null;

  const agents = result.data || [];

  // #索引格式
  if (agentRef.startsWith('#')) {
    const index = parseInt(agentRef.slice(1)) - 1;
    return agents[index] || null;
  }

  // 精确匹配
  const exact = agents.find((a: AgentInfo) => 
    a.peerId === agentRef || 
    a.displayName === agentRef
  );
  if (exact) return exact;

  // 模糊匹配
  const fuzzy = agents.find((a: AgentInfo) => 
    a.peerId.startsWith(agentRef) ||
    (a.displayName?.toLowerCase().includes(agentRef.toLowerCase()) ?? false)
  );

  return fuzzy || null;
}