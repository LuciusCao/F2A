/**
 * F2A 输入验证 Schema
 * 使用 Zod 进行运行时类型验证
 */

import { z } from 'zod';

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
// 消息协议 Schema
// ============================================================================

// P2-3 修复：添加 DECRYPT_FAILED 消息类型
export const F2AMessageTypeSchema = z.enum([
  'DISCOVER',
  'DISCOVER_RESP',
  'CAPABILITY_QUERY',
  'CAPABILITY_RESPONSE',
  'TASK_REQUEST',
  'TASK_RESPONSE',
  'TASK_DELEGATE',
  'DECRYPT_FAILED',
  'PING',
  'PONG'
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

export const TaskRequestPayloadSchema = z.object({
  taskId: z.string().uuid(),
  taskType: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  parameters: z.record(z.unknown()).optional(),
  timeout: z.number().int().min(1).max(300).optional() // seconds
});

export const TaskResponsePayloadSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['success', 'error', 'rejected', 'delegated']),
  result: z.unknown().optional(),
  error: z.string().max(1024).optional(),
  delegatedTo: z.string().optional()
});

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
 * 验证任务请求载荷
 */
export function validateTaskRequestPayload(payload: unknown) {
  return TaskRequestPayloadSchema.safeParse(payload);
}

/**
 * 验证任务响应载荷
 */
export function validateTaskResponsePayload(payload: unknown) {
  return TaskResponsePayloadSchema.safeParse(payload);
}

/**
 * 验证 Webhook 配置
 */
export function validateWebhookConfig(config: unknown) {
  return WebhookConfigSchema.safeParse(config);
}
