/**
 * F2A 输入验证 Schema
 * 使用 Zod 进行运行时类型验证
 */

import { z } from 'zod';

// ============================================================================
// 常量定义
// ============================================================================

const MAX_MESSAGE_CONTENT_SIZE = 1024 * 1024; // 1MB
// P2 优化：防止连续点号/连字符，只允许小写字母、数字、点号、连字符
const TOPIC_REGEX = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

// ============================================================================
// 基础类型 Schema
// ============================================================================

export const LogLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);

export const SecurityLevelSchema = z.enum(['low', 'medium', 'high']);

// ============================================================================
// Agent 能力 Schema
// ============================================================================

export const ParameterSchemaSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional()
});

export const AgentCapabilitySchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().trim().min(1).max(256),
  tools: z.array(z.string().trim().min(1)).max(32),
  parameters: z.record(ParameterSchemaSchema).optional()
});

// ============================================================================
// 网络配置 Schema
// ============================================================================

export const P2PNetworkConfigSchema = z.object({
  listenPort: z.number().int().min(0).max(65535).optional(),
  listenAddresses: z.array(z.string()).optional(),
  bootstrapPeers: z.array(z.string()).optional(),
  bootstrapPeerFingerprints: z.record(z.string(), z.string()).optional(),
  trustedPeers: z.array(z.string()).optional(),
  enableMDNS: z.boolean().optional(),
  enableDHT: z.boolean().optional(),
  dhtServerMode: z.boolean().optional()
});

export const SecurityConfigSchema = z.object({
  level: SecurityLevelSchema.optional(),
  requireConfirmation: z.boolean().optional(),
  verifySignatures: z.boolean().optional(),
  whitelist: z.array(z.string()).optional(),
  blacklist: z.array(z.string()).optional(),
  rateLimit: z.object({
    maxRequests: z.number().int().positive(),
    windowMs: z.number().int().positive()
  }).optional(),
  maxTasksPerMinute: z.number().int().positive().optional()
});

export const F2AOptionsSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  agentType: z.enum(['openclaw', 'claude-code', 'codex', 'custom']).optional(),
  network: P2PNetworkConfigSchema.optional(),
  security: SecurityConfigSchema.optional(),
  logLevel: LogLevelSchema.optional(),
  dataDir: z.string().optional()
});

// ============================================================================
// 任务委托 Schema
// ============================================================================

export const TaskDelegateOptionsSchema = z.object({
  capability: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(1024),
  parameters: z.record(z.unknown()).optional(),
  timeout: z.number().int().min(1000).max(300000).optional(), // 1s - 5min
  parallel: z.boolean().optional(),
  minResponses: z.number().int().min(1).max(10).optional()
});

// ============================================================================
// 消息协议 Schema - 两层设计
// ============================================================================

// Layer 1: 网络层协议（基础设施）
export const NetworkMessageTypeSchema = z.enum([
  'DISCOVER',
  'DISCOVER_RESP',
  'PING',
  'PONG',
  'DECRYPT_FAILED',
  'KEY_EXCHANGE',
]);

// Layer 2: Agent 协议层（语义层）
export const AgentMessageTypeSchema = z.enum([
  'MESSAGE',
]);

// 技能交换协议（可选扩展）
export const SkillMessageTypeSchema = z.enum([
  /** 技能公告：Agent 向网络广播自己提供的技能 */
  'SKILL_ANNOUNCE',
  /** 技能查询：查询网络中具备特定技能的 Agent */
  'SKILL_QUERY',
  /** 技能查询响应：响应技能查询请求 */
  'SKILL_QUERY_RESPONSE',
  /** 技能调用：请求 Agent 执行特定技能 */
  'SKILL_INVOKE',
  /** 技能调用响应：响应技能调用请求 */
  'SKILL_INVOKE_RESPONSE',
  /** 技能执行结果：返回技能执行的最终结果 */
  'SKILL_RESULT',
]);

// 完整消息类型
export const F2AMessageTypeSchema = z.union([
  NetworkMessageTypeSchema,
  AgentMessageTypeSchema,
  SkillMessageTypeSchema,
]);

export const F2AMessageSchema = z.object({
  id: z.string().uuid(),
  type: F2AMessageTypeSchema,
  from: z.string().min(1),
  to: z.string().optional(),
  timestamp: z.number().int().positive(),
  ttl: z.number().int().positive().optional(),
  payload: z.unknown()
});

// MESSAGE 消息载荷 Schema
export const StructuredMessagePayloadSchema = z.object({
  topic: z.string().max(256).regex(TOPIC_REGEX, 'Invalid topic format').optional(),
  content: z.union([
    z.string().max(MAX_MESSAGE_CONTENT_SIZE),
    z.record(z.unknown())
  ]),
  replyTo: z.string().max(128).optional(),
});

// 消息主题常量
export const MESSAGE_TOPICS_SCHEMA = z.enum([
  'task.request',
  'task.response',
  'capability.query',
  'capability.response',
  'chat',
]);

// ============================================================================
// Webhook Schema
// ============================================================================

export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  timeout: z.number().int().positive().optional(),
  retries: z.number().int().min(0).max(10).optional(),
  retryDelay: z.number().int().positive().optional()
});

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证 F2A 配置
 */
export function validateF2AOptions(options: unknown) {
  return F2AOptionsSchema.safeParse(options);
}

/**
 * 验证任务委托选项
 */
export function validateTaskDelegateOptions(options: unknown) {
  return TaskDelegateOptionsSchema.safeParse(options);
}

/**
 * 验证 Agent 能力
 */
export function validateAgentCapability(capability: unknown) {
  return AgentCapabilitySchema.safeParse(capability);
}

/**
 * 验证 F2A 消息
 */
export function validateF2AMessage(message: unknown) {
  return F2AMessageSchema.safeParse(message);
}

/**
 * 验证 MESSAGE 消息载荷
 */
export function validateStructuredMessagePayload(payload: unknown) {
  return StructuredMessagePayloadSchema.safeParse(payload);
}

/**
 * 验证 Webhook 配置
 */
export function validateWebhookConfig(config: unknown) {
  return WebhookConfigSchema.safeParse(config);
}
