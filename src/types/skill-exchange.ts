/**
 * 技能交换类型定义
 * 
 * 技能交换协议：
 * 1. SKILL_ANNOUNCE - 广播技能可用性
 * 2. SKILL_QUERY - 查询特定技能
 * 3. SKILL_RESPONSE - 响应技能查询
 * 4. SKILL_INVOKE - 远程调用技能
 */

import type { SkillTag } from './capability-quant.js';

// ============================================================================
// 技能定义
// ============================================================================

/**
 * 技能定义（扩展 SkillTag）
 */
export interface SkillDefinition extends SkillTag {
  /** 技能 ID（唯一标识） */
  id: string;
  /** 技能描述 */
  description: string;
  /** 输入参数 Schema (JSON Schema) */
  inputSchema: Record<string, unknown>;
  /** 输出 Schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** 技能分类 */
  category: SkillCategory;
  /** 是否需要授权 */
  requiresAuth: boolean;
  /** 定价信息 */
  pricing?: SkillPricing;
  /** 依赖的其他技能 */
  dependencies?: string[];
  /** 技能标签 */
  tags?: string[];
}

/**
 * 技能分类
 */
export type SkillCategory = 
  | 'computation'    // 计算类：数据分析、机器学习
  | 'generation'     // 生成类：文本生成、图像生成
  | 'transformation' // 转换类：格式转换、翻译
  | 'analysis'       // 分析类：代码审查、安全扫描
  | 'automation'     // 自动化类：工作流、脚本执行
  | 'communication'  // 通信类：消息转发、通知
  | 'storage'        // 存储类：文件操作、数据库
  | 'custom';        // 自定义

/**
 * 技能定价
 */
export interface SkillPricing {
  /** 定价模型 */
  model: PricingModel;
  /** 价格（根据模型不同含义不同） */
  price: number;
  /** 货币单位（默认 'credits'） */
  currency?: string;
  /** 免费额度 */
  freeQuota?: number;
}

/**
 * 定价模型
 */
export type PricingModel = 
  | 'per_call'       // 按次计费
  | 'per_minute'     // 按分钟计费
  | 'per_token'      // 按 token 计费
  | 'subscription'   // 订阅制
  | 'free';          // 免费

// ============================================================================
// 技能发现协议
// ============================================================================

/**
 * 技能公告消息
 */
export interface SkillAnnouncePayload {
  /** 节点 ID */
  peerId: string;
  /** 可用技能列表 */
  skills: SkillDefinition[];
  /** 公告时间 */
  timestamp: number;
  /** 过期时间（秒） */
  ttl?: number;
}

/**
 * 技能查询消息
 */
export interface SkillQueryPayload {
  /** 查询 ID */
  queryId: string;
  /** 技能名称（支持模糊匹配） */
  skillName?: string;
  /** 技能分类 */
  category?: SkillCategory;
  /** 标签过滤 */
  tags?: string[];
  /** 最低熟练度 */
  minProficiency?: number;
  /** 最高价格 */
  maxPrice?: number;
  /** 最大结果数 */
  limit?: number;
}

/**
 * 技能查询响应
 */
export interface SkillQueryResponsePayload {
  /** 查询 ID */
  queryId: string;
  /** 匹配的技能 */
  results: Array<{
    peerId: string;
    skill: SkillDefinition;
    available: boolean;
    estimatedWaitTime?: number;
  }>;
}

// ============================================================================
// 技能调用协议
// ============================================================================

/**
 * 技能调用请求
 */
export interface SkillInvokePayload {
  /** 调用 ID */
  invokeId: string;
  /** 技能 ID */
  skillId: string;
  /** 技能名称（备选） */
  skillName?: string;
  /** 输入参数 */
  input: Record<string, unknown>;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 优先级 */
  priority?: 'low' | 'normal' | 'high';
  /** 回调地址（可选，用于异步结果） */
  callback?: string;
}

/**
 * 技能调用响应
 */
export interface SkillInvokeResponsePayload {
  /** 调用 ID */
  invokeId: string;
  /** 状态 */
  status: 'accepted' | 'rejected' | 'queued';
  /** 拒绝原因 */
  reason?: string;
  /** 预计等待时间（毫秒） */
  estimatedWaitTime?: number;
  /** 排队位置 */
  queuePosition?: number;
}

/**
 * 技能执行结果
 */
export interface SkillResultPayload {
  /** 调用 ID */
  invokeId: string;
  /** 状态 */
  status: 'success' | 'failed' | 'timeout';
  /** 输出结果 */
  output?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  executionTimeMs: number;
  /** 资源消耗 */
  resourceUsage?: {
    cpuMs?: number;
    memoryMB?: number;
    tokensUsed?: number;
  };
  /** 费用 */
  cost?: number;
}

// ============================================================================
// 技能注册表
// ============================================================================

/**
 * 远程技能信息
 */
export interface RemoteSkill {
  /** 技能定义 */
  definition: SkillDefinition;
  /** 提供者 PeerId */
  providerId: string;
  /** 最后更新时间 */
  lastUpdated: number;
  /** 可用性状态 */
  available: boolean;
  /** 平均响应时间 */
  avgResponseTimeMs?: number;
  /** 成功率 */
  successRate?: number;
}

/**
 * 技能注册表条目
 */
export interface SkillRegistryEntry {
  /** 技能 ID */
  skillId: string;
  /** 本地技能定义（如果是本地技能） */
  local?: {
    definition: SkillDefinition;
    handler: SkillHandler;
  };
  /** 远程技能提供者列表 */
  remote: RemoteSkill[];
}

/**
 * 技能处理器函数
 */
export type SkillHandler = (
  input: Record<string, unknown>,
  context: SkillExecutionContext
) => Promise<unknown>;

/**
 * 技能执行上下文
 */
export interface SkillExecutionContext {
  /** 调用者 PeerId */
  callerId: string;
  /** 调用 ID */
  invokeId: string;
  /** 超时时间 */
  timeout: number;
  /** 取消信号 */
  abortSignal?: AbortSignal;
  /** 日志函数 */
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

// ============================================================================
// 技能交换配置
// ============================================================================

/**
 * 技能交换配置
 */
export interface SkillExchangeConfig {
  /** 是否启用技能广播 */
  enableAnnounce: boolean;
  /** 广播间隔（秒） */
  announceInterval?: number;
  /** 技能过期时间（秒） */
  skillTtl?: number;
  /** 最大远程技能缓存 */
  maxCachedSkills?: number;
  /** 默认超时（毫秒） */
  defaultTimeout?: number;
  /** 最大并发调用 */
  maxConcurrentInvokes?: number;
  /** 是否允许付费技能 */
  allowPaidSkills?: boolean;
  /** 最大单次费用 */
  maxCostPerInvoke?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_SKILL_EXCHANGE_CONFIG: Required<SkillExchangeConfig> = {
  enableAnnounce: true,
  announceInterval: 60,
  skillTtl: 300,
  maxCachedSkills: 1000,
  defaultTimeout: 30000,
  maxConcurrentInvokes: 10,
  allowPaidSkills: true,
  maxCostPerInvoke: 1000,
};