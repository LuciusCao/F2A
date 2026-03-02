/**
 * 协议消息定义和验证
 * 使用 Zod 进行运行时类型验证
 */

import { z } from 'zod';

// ============================================================================
// 基础消息架构
// ============================================================================

export const MessageTypeSchema = z.enum([
  'identity_challenge',
  'identity_response',
  'connection_pending',
  'confirmation_result',
  'message',
  'message_ack',
  'skill_query',
  'skill_response',
  'skill_invoke',
  'skill_result',
  'group_message',
  'group_invite',
  'key_exchange',
  'webrtc_offer',
  'webrtc_answer',
  'webrtc_ice'
]);

export const BaseMessageSchema = z.object({
  type: MessageTypeSchema,
  id: z.string().uuid().optional(),
  timestamp: z.number().int().positive()
});

// ============================================================================
// 身份验证消息
// ============================================================================

export const IdentityChallengeSchema = BaseMessageSchema.extend({
  type: z.literal('identity_challenge'),
  agentId: z.string(),
  publicKey: z.string(),
  challenge: z.string(),
  timestamp: z.number().int()
});

export const IdentityResponseSchema = BaseMessageSchema.extend({
  type: z.literal('identity_response'),
  agentId: z.string(),
  publicKey: z.string(),
  signature: z.string()
});

// ============================================================================
// 连接确认消息
// ============================================================================

export const ConnectionPendingSchema = BaseMessageSchema.extend({
  type: z.literal('connection_pending'),
  confirmationId: z.string().uuid(),
  message: z.string(),
  timeout: z.number().int().positive()
});

export const ConfirmationResultSchema = BaseMessageSchema.extend({
  type: z.literal('confirmation_result'),
  confirmationId: z.string().uuid(),
  accepted: z.boolean(),
  reason: z.string().optional()
});

// ============================================================================
// 文本消息
// ============================================================================

export const TextMessageSchema = BaseMessageSchema.extend({
  type: z.literal('message'),
  id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  content: z.string(),
  timestamp: z.number().int()
});

export const MessageAckSchema = BaseMessageSchema.extend({
  type: z.literal('message_ack'),
  messageId: z.string().uuid()
});

// ============================================================================
// Skill 消息
// ============================================================================

export const SkillQuerySchema = BaseMessageSchema.extend({
  type: z.literal('skill_query'),
  requestId: z.string().uuid()
});

export const SkillResponseSchema = BaseMessageSchema.extend({
  type: z.literal('skill_response'),
  requestId: z.string().uuid(),
  skills: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.any())
  }))
});

export const SkillInvokeSchema = BaseMessageSchema.extend({
  type: z.literal('skill_invoke'),
  requestId: z.string().uuid(),
  skill: z.string(),
  parameters: z.record(z.any())
});

export const SkillResultSchema = BaseMessageSchema.extend({
  type: z.literal('skill_result'),
  requestId: z.string().uuid(),
  status: z.enum(['success', 'error']),
  result: z.any().optional(),
  error: z.string().optional()
});

// ============================================================================
// 群聊消息
// ============================================================================

export const GroupMessageSchema = BaseMessageSchema.extend({
  type: z.literal('group_message'),
  groupId: z.string(),
  groupName: z.string(),
  from: z.string(),
  content: z.string()
});

export const GroupInviteSchema = BaseMessageSchema.extend({
  type: z.literal('group_invite'),
  groupId: z.string(),
  groupName: z.string(),
  inviter: z.string()
});

// ============================================================================
// WebRTC 消息
// ============================================================================

export const WebRTCOfferSchema = BaseMessageSchema.extend({
  type: z.literal('webrtc_offer'),
  offer: z.any()
});

export const WebRTCAnswerSchema = BaseMessageSchema.extend({
  type: z.literal('webrtc_answer'),
  answer: z.any()
});

export const WebRTCIceSchema = BaseMessageSchema.extend({
  type: z.literal('webrtc_ice'),
  candidate: z.any()
});

// ============================================================================
// 加密消息
// ============================================================================

export const KeyExchangeSchema = BaseMessageSchema.extend({
  type: z.literal('key_exchange'),
  publicKey: z.string()
});

// ============================================================================
// 联合类型
// ============================================================================

export const F2AMessageSchema = z.discriminatedUnion('type', [
  IdentityChallengeSchema,
  IdentityResponseSchema,
  ConnectionPendingSchema,
  ConfirmationResultSchema,
  TextMessageSchema,
  MessageAckSchema,
  SkillQuerySchema,
  SkillResponseSchema,
  SkillInvokeSchema,
  SkillResultSchema,
  GroupMessageSchema,
  GroupInviteSchema,
  WebRTCOfferSchema,
  WebRTCAnswerSchema,
  WebRTCIceSchema,
  KeyExchangeSchema
]);

// ============================================================================
// 类型导出
// ============================================================================

export type IdentityChallengeMessage = z.infer<typeof IdentityChallengeSchema>;
export type IdentityResponseMessage = z.infer<typeof IdentityResponseSchema>;
export type ConnectionPendingMessage = z.infer<typeof ConnectionPendingSchema>;
export type ConfirmationResultMessage = z.infer<typeof ConfirmationResultSchema>;
export type TextMessage = z.infer<typeof TextMessageSchema>;
export type MessageAck = z.infer<typeof MessageAckSchema>;
export type SkillQueryMessage = z.infer<typeof SkillQuerySchema>;
export type SkillResponseMessage = z.infer<typeof SkillResponseSchema>;
export type SkillInvokeMessage = z.infer<typeof SkillInvokeSchema>;
export type SkillResultMessage = z.infer<typeof SkillResultSchema>;
export type GroupMessage = z.infer<typeof GroupMessageSchema>;
export type GroupInviteMessage = z.infer<typeof GroupInviteSchema>;
export type WebRTCOfferMessage = z.infer<typeof WebRTCOfferSchema>;
export type WebRTCAnswerMessage = z.infer<typeof WebRTCAnswerSchema>;
export type WebRTCIceMessage = z.infer<typeof WebRTCIceSchema>;
export type KeyExchangeMessage = z.infer<typeof KeyExchangeSchema>;
export type F2AMessage = z.infer<typeof F2AMessageSchema>;

// ============================================================================
// 验证函数
// ============================================================================

export function validateMessage(data: unknown): { success: true; data: F2AMessage } | { success: false; error: string } {
  const result = F2AMessageSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

export function createMessageId(): string {
  return crypto.randomUUID();
}

export function createTimestamp(): number {
  return Date.now();
}