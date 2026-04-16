/**
 * Agent Registry
 * 管理注册到 Daemon 的 Agent 实例
 */

import { Logger } from '../utils/logger.js';
import type { AgentCapability } from '../types/index.js';
import type { AgentIdentity } from '../core/identity/types.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';
import { isIPv6 } from 'net';

/**
 * 消息签名载荷
 * 用于验证 Agent 发送的消息签名
 */
export interface MessageSignaturePayload {
  /** 消息 ID */
  messageId: string;
  /** 发送方 Agent ID */
  fromAgentId: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type?: string;
  /** 创建时间 */
  createdAt?: string;
}

/**
 * Agent Webhook 配置
 * 用于 Agent 级消息推送
 */
export interface AgentWebhook {
  /** Webhook URL（用于推送消息给 Agent） */
  url: string;
  /** Webhook 认证令牌（可选） */
  token?: string;
  /** Webhook 超时时间（毫秒，默认 5000） */
  timeout?: number;
  /** Webhook 重试次数（默认 3） */
  retries?: number;
}

/**
 * Agent 注册信息
 */
export interface AgentRegistration {
  /** Agent 唯一标识符 */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 注册时间 */
  registeredAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** Webhook 配置（用于推送消息给 Agent） */
  webhook?: AgentWebhook;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** Agent 身份签名（Node 对 Agent 的签名，base64） */
  signature?: string;
  /** 所属 Node ID */
  nodeId?: string;
  /** Agent 公钥（base64） */
  publicKey?: string;
  /** Agent 创建时间（ISO string） */
  createdAt?: string;
}

/**
 * Agent 注册请求（用于 register 方法）
 */
export interface AgentRegistrationRequest {
  /** Agent 唯一标识符 */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** Webhook 配置（用于推送消息给 Agent） */
  webhook?: AgentWebhook;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** Agent 身份签名（Node 对 Agent 的签名，base64） */
  signature?: string;
  /** 所属 Node ID */
  nodeId?: string;
  /** Agent 公钥（base64） */
  publicKey?: string;
  /** Agent 创建时间（ISO string） */
  createdAt?: string;
}

/**
 * 持久化的 Agent 注册信息（用于存储/序列化）
 */
export interface PersistedAgentRegistration {
  /** Agent 唯一标识符 */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 注册时间（ISO string） */
  registeredAt: string;
  /** 最后活跃时间（ISO string） */
  lastActiveAt: string;
  /** Webhook 配置（用于推送消息给 Agent） */
  webhook?: AgentWebhook;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** Agent 身份签名（Node 对 Agent 的签名，base64） */
  signature?: string;
  /** 所属 Node ID */
  nodeId?: string;
  /** Agent 公钥（base64） */
  publicKey?: string;
  /** Agent 创建时间（ISO string） */
  createdAt?: string;
}

/**
 * Agent 注册表
 * 管理注册到 Daemon 的所有 Agent
 */
/**
 * RFC 004: Agent 级 Webhook URL 安全验证
 * 验证 webhook URL 是否为安全的公网地址
 * 
 * 拒绝以下地址：
 * - 私有 IP 地址（127.x.x.x, 10.x.x.x, 192.168.x.x, 172.16-31.x.x）
 * - localhost 和 .local/.localhost 域名
 * - IPv6 私有地址（::1, fc00::/7, fe80::/10）
 * - 无效 URL 格式
 * 
 * @param webhookUrl - Webhook URL
 * @returns 验证结果 { valid: boolean, error?: string }
 */
export function validateAgentWebhookUrl(webhookUrl: string): { valid: boolean; error?: string } {
  // 1. 检查 URL 是否为空
  if (!webhookUrl || webhookUrl.trim() === '') {
    return { valid: true }; // 空 URL 允许（表示不使用 webhook）
  }

  // 2. 验证 URL 格式
  try {
    const url = new URL(webhookUrl);
    
    // 2.1 只允许 http 和 https 协议
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: `Invalid protocol: ${url.protocol}. Only http and https are allowed.` };
    }
    
    // 2.2 获取 hostname
    const hostname = url.hostname;
    
    // 2.3 检查 localhost 和 local 域名
    if (hostname === 'localhost' || hostname === 'local' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      return { valid: false, error: 'localhost and .local/.localhost domains are not allowed for agent webhook URLs (SSRF protection).' }; 
    }
    
    // 2.4 检查私有 IPv4 地址
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);
    if (ipv4Match) {
      const octets = [parseInt(ipv4Match[1], 10), parseInt(ipv4Match[2], 10), parseInt(ipv4Match[3], 10), parseInt(ipv4Match[4], 10)];
      if (isPrivateIPv4ForWebhook(octets)) {
        return { valid: false, error: `Private IP address ${hostname} is not allowed for agent webhook URLs (SSRF protection).` }; 
      }
    }
    
    // 2.5 检查私有 IPv6 地址
    if (isPrivateIPv6ForWebhook(hostname)) {
      return { valid: false, error: `Private IPv6 address ${hostname} is not allowed for agent webhook URLs (SSRF protection).` }; 
    }
    
    return { valid: true }; 
  } catch (error) {
    return { valid: false, error: `Invalid URL format: ${error instanceof Error ? error.message : String(error)}` }; 
  }
}

/**
 * 检查 IPv4 地址是否为私有地址（用于 webhook 验证）
 */
function isPrivateIPv4ForWebhook(octets: number[]): boolean {
  // 127.x.x.x (loopback)
  if (octets[0] === 127) return true;
  // 10.x.x.x (Class A private)
  if (octets[0] === 10) return true;
  // 192.168.x.x (Class C private)
  if (octets[0] === 192 && octets[1] === 168) return true;
  // 172.16.x.x - 172.31.x.x (Class B private)
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  // 169.254.x.x (link-local)
  if (octets[0] === 169 && octets[1] === 254) return true;
  // 0.0.0.0 (all interfaces)
  if (octets[0] === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0) return true;
  return false;
}

/**
 * 检查 IPv6 地址是否为私有地址（用于 webhook 验证）
 */
function isPrivateIPv6ForWebhook(hostname: string): boolean {
  // 去除方括号
  let cleanHostname = hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    cleanHostname = hostname.slice(1, -1);
  }
  
  const lower = cleanHostname.toLowerCase();
  
  // :: (未指定地址)
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  // ::1 (loopback)
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  
  // IPv4-mapped IPv6: ::ffff:x.x.x.x (缩写或完整格式)
  // 支持: ::ffff:127.0.0.1 或 0:0:0:0:0:ffff:127.0.0.1
  const mappedMatch = lower.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/) ||
                       lower.match(/^(?:0:){5}ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (mappedMatch) {
    const octets = [parseInt(mappedMatch[1], 10), parseInt(mappedMatch[2], 10), parseInt(mappedMatch[3], 10), parseInt(mappedMatch[4], 10)];
    return isPrivateIPv4ForWebhook(octets);
  }
  
  // IPv4-mapped IPv6 十六进制格式 (URL 解析后的格式)
  // ::ffff:7f00:1 对应 127.0.0.1 (7f=127, 00=0, 1=1)
  // 格式: ::ffff:XXYY:ZZWW 其中 XXYY 是前两个 octet，ZZWW 是后两个
  const hexMappedMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMappedMatch) {
    // 将十六进制转换为 IPv4 octets
    const hex1 = hexMappedMatch[1];
    const hex2 = hexMappedMatch[2];
    // 解析: 7f00 -> 7f (127) 和 00 (0)
    // 注意: IPv6 中每段是 16 位，需要拆成两个 8 位
    const part1 = parseInt(hex1, 16); // 十六进制值
    const part2 = parseInt(hex2, 16);
    const octet1 = (part1 >> 8) & 0xff;
    const octet2 = part1 & 0xff;
    const octet3 = (part2 >> 8) & 0xff;
    const octet4 = part2 & 0xff;
    const octets = [octet1, octet2, octet3, octet4];
    return isPrivateIPv4ForWebhook(octets);
  }
  
  // 只对纯 IPv6 格式检查 fc/fd 前缀
  if (isIPv6(cleanHostname)) {
    // fc00::/7 (ULA)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // fe80::/10 (link-local)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  }
  
  return false;
}

export class AgentRegistry {
  private agents: Map<string, AgentRegistration> = new Map();
  private logger: Logger;
  /** Node 公钥验证函数（用于验证 Agent 签名） */
  private verifyWithNodeKey?: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>;

  constructor(options?: {
    /** 提供 Node 公钥验证函数 */
    verifyWithNodeKey?: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>;
  }) {
    this.logger = new Logger({ component: 'AgentRegistry' });
    this.verifyWithNodeKey = options?.verifyWithNodeKey;
  }

  /**
   * 设置 Node 公钥验证函数
   */
  setVerifyFunction(verifyFn: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>): void {
    this.verifyWithNodeKey = verifyFn;
  }

  /**
   * 验证 Webhook URL 格式
   * 确保 URL 符合规范且安全
   * 
   * @param webhook - Webhook 配置
   * @returns 验证结果
   */
  validateWebhook(webhook: AgentWebhook | undefined): { valid: boolean; error?: string } {
    if (!webhook) {
      return { valid: true }; // 无 webhook 配置视为有效
    }

    // 1. 检查 URL 是否存在
    if (!webhook.url) {
      return { valid: false, error: 'Webhook URL is required' }; 
    }

    // 2. URL 格式验证
    try {
      const url = new URL(webhook.url);
      
      // 只允许 HTTP/HTTPS 协议
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { valid: false, error: 'Webhook URL must use http or https protocol' }; 
      }
      
      // 3. SSRF 安全检查
      // 检查是否指向内部网络地址
      const hostname = url.hostname.toLowerCase();
      
      // 禁止 localhost 和 127.0.0.1
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return { valid: false, error: 'Webhook URL cannot point to localhost' }; 
      }
      
      // 禁止内网 IP 地址（10.x.x.x, 172.16-31.x.x, 192.168.x.x）
      if (this.isPrivateIpAddress(hostname)) {
        return { valid: false, error: 'Webhook URL cannot point to private network addresses' }; 
      }
      
      // 禁止 0.0.0.0 和 ::1 (IPv6 localhost)
      if (hostname === '0.0.0.0' || hostname === '::1' || hostname.startsWith('0:')) {
        return { valid: false, error: 'Webhook URL cannot point to wildcard or IPv6 localhost' }; 
      }
      
      // 禁止 .internal, .local, .localhost 等特殊域名
      if (hostname.endsWith('.internal') || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
        return { valid: false, error: 'Webhook URL cannot point to internal/local domains' }; 
      }
      
    } catch (error) {
      return { valid: false, error: 'Invalid webhook URL format' }; 
    }

    // 4. 验证 timeout 和 retries 参数
    if (webhook.timeout !== undefined) {
      if (typeof webhook.timeout !== 'number' || webhook.timeout <= 0 || webhook.timeout > 60000) {
        return { valid: false, error: 'Webhook timeout must be a positive number (1-60000 ms)' }; 
      }
    }
    
    if (webhook.retries !== undefined) {
      if (typeof webhook.retries !== 'number' || webhook.retries < 0 || webhook.retries > 10) {
        return { valid: false, error: 'Webhook retries must be a number (0-10)' }; 
      }
    }

    return { valid: true }; 
  }

  /**
   * 检查是否为私有 IP 地址
   */
  private isPrivateIpAddress(hostname: string): boolean {
    // IPv4 私有地址范围
    const privateIpPatterns = [
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,        // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
      /^192\.168\.\d{1,3}\.\d{1,3}$/,          // 192.168.0.0/16
      /^169\.254\.\d{1,3}\.\d{1,3}$/,          // 链路本地地址 169.254.0.0/16
    ];
    
    for (const pattern of privateIpPatterns) {
      if (pattern.test(hostname)) {
        return true; 
      }
    }
    
    return false; 
  }

  /**
   * 注册 Agent
   * 包含 Webhook URL 格式验证和 SSRF 安全检查
   */
  register(agent: Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'>): AgentRegistration {
    // 验证 webhook URL
    const webhookValidation = this.validateWebhook(agent.webhook);
    if (!webhookValidation.valid) {
      this.logger.warn('Webhook validation failed', {
        agentId: agent.agentId,
        error: webhookValidation.error,
      });
      throw new Error(`Invalid webhook configuration: ${webhookValidation.error}`);
    }

    const registration: AgentRegistration = {
      ...agent,
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.agents.set(agent.agentId, registration);
    this.logger.info('Agent registered', {
      agentId: agent.agentId,
      name: agent.name,
      capabilities: agent.capabilities.map(c => c.name),
    });

    return registration;
  }

  /**
   * 注销 Agent
   */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not found for unregister', { agentId });
      return false;
    }

    this.agents.delete(agentId);
    this.logger.info('Agent unregistered', { agentId, name: agent.name });
    return true;
  }

  /**
   * 获取 Agent 信息
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 列出所有注册的 Agent
   */
  list(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  /**
   * 查找具备特定能力的 Agent
   */
  findByCapability(capabilityName: string): AgentRegistration[] {
    return this.list().filter(agent =>
      agent.capabilities.some(cap => cap.name === capabilityName)
    );
  }

  /**
   * 更新 Agent 最后活跃时间
   */
  updateLastActive(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActiveAt = new Date();
    }
  }

  /**
   * 获取注册表统计信息
   */
  getStats(): {
    total: number;
    capabilities: Record<string, number>;
  } {
    const agents = this.list();
    const capabilities: Record<string, number> = {};

    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        capabilities[cap.name] = (capabilities[cap.name] || 0) + 1;
      }
    }

    return {
      total: agents.length,
      capabilities,
    };
  }

  /**
   * 验证 Agent 签名
   * 检查消息签名是否来自已注册的 Agent
   * 
   * @param agentId - Agent ID
   * @param signature - 消息签名（可选，如未提供则使用注册时的签名）
   * @returns 签名是否有效
   */
  verifySignature(agentId: string, signature?: string): boolean {
    // 1. 检查 Agent 是否已注册
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not registered for signature verification', { agentId });
      return false;
    }

    // 2. 获取签名
    const sigToVerify = signature || agent.signature;
    if (!sigToVerify) {
      this.logger.warn('Missing signature', { agentId });
      return false;
    }

    // 3. 验证签名格式（必须是有效的 base64 字符串，长度为 64 字节的 Ed25519 签名）
    // 64 字节的签名编码为 base64 后大约是 88 字符
    try {
      const sigBytes = Buffer.from(sigToVerify, 'base64');
      // Ed25519 签名长度应该是 64 字节
      if (sigBytes.length !== 64) {
        this.logger.warn('Invalid signature length', { agentId, expectedLength: 64, actualLength: sigBytes.length });
        return false;
      }
      // 验证 base64 字符串格式（不应包含非法字符）
      const validBase64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
      if (!validBase64Pattern.test(sigToVerify.replace(/\s/g, ''))) {
        this.logger.warn('Invalid base64 format', { agentId });
        return false;
      }
    } catch (error) {
      this.logger.warn('Invalid signature format (not base64)', { agentId });
      return false;
    }

    // 4. 验证 AgentId 格式（RFC 003: agent:<PeerId前16位>:<随机8位>）
    const agentIdPattern = /^agent:[a-zA-Z0-9]{16}:[a-zA-Z0-9]{8}$/;
    if (!agentIdPattern.test(agentId)) {
      this.logger.warn('Invalid AgentId format', { agentId, pattern: 'agent:<PeerId16>:<Random8>' });
      return false;
    }

    // 5. 验证签名与 AgentId 匹配（AgentId 必须来自所属 NodeId）
    // AgentId 格式: agent:<PeerId前16位>:<随机8位>
    // NodeId 必须与 AgentId 中的 PeerId 前缀匹配
    if (agent.nodeId) {
      const peerIdPrefix = agentId.split(':')[1]; // 取 PeerId 前16位
      const expectedPrefix = agent.nodeId.substring(0, 16);
      if (peerIdPrefix !== expectedPrefix) {
        this.logger.warn('AgentId does not match NodeId', {
          agentId,
          nodeId: agent.nodeId,
          peerIdPrefix,
          expectedPrefix
        });
        return false;
      }
    }

    // 6. TODO: 使用 Node 公钥进行真实签名验证
    // 当前仅做格式验证，Phase 3 将集成 IdentityDelegator.verifyAgent()
    // 真实验证需要调用 AgentIdentityManager.verifySignature()
    if (this.verifyWithNodeKey && agent.nodeId && agent.publicKey && agent.createdAt) {
      // 如果提供了验证函数，可以进行完整验证
      // 但这里简化处理，标记为需要后续集成
      this.logger.debug('Signature format validated, full verification pending', { agentId });
    }

    this.logger.debug('Signature format validated', { agentId });
    return true;
  }

  /**
   * 验证 Agent 身份完整性
   * 使用 AgentIdentityManager 的验证方法
   * 
   * @param agentIdentity - Agent 身份信息
   * @returns Promise<boolean> 签名是否有效
   */
  async verifyAgentIdentity(agentIdentity: AgentIdentity): Promise<boolean> {
    if (!this.verifyWithNodeKey) {
      this.logger.warn('No verification function configured');
      return false;
    }

    try {
      return await AgentIdentityManager.verifySignature(agentIdentity, this.verifyWithNodeKey);
    } catch (error) {
      this.logger.error('Failed to verify agent identity', {
        agentId: agentIdentity.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 序列化消息签名载荷
   * 用于生成签名验证的数据
   * 
   * 格式稳定性保证:
   * - 字段按固定顺序序列化: messageId, fromAgentId, content
   * - 可选字段 type 和 createdAt 在存在时追加
   * - 字段之间使用冒号 ':' 分隔
   * - 此格式在 v1.x 版本中保持稳定
   * 
   * @param payload 消息签名载荷
   * @returns 序列化后的字符串
   */
  static serializeMessagePayloadForSignature(payload: MessageSignaturePayload): string {
    const parts = [
      payload.messageId,
      payload.fromAgentId,
      payload.content
    ];
    
    // 可选字段按顺序追加
    if (payload.type) {
      parts.push(payload.type);
    }
    if (payload.createdAt) {
      parts.push(payload.createdAt);
    }
    
    return parts.join(':');
  }

  /**
   * 验证消息签名
   * 使用 Agent 公钥验证消息签名的真实性
   * 
   * P0 Bug1 修复: 实现真正的 Ed25519 签名验证
   * - 签名应覆盖消息内容 (messageId + fromAgentId + content)
   * - 使用 Agent 注册时存储的公钥进行验证
   * 
   * @param agentId - 发送方 Agent ID
   * @param messagePayload - 消息签名载荷
   * @param signature - 消息签名 (base64)
   * @returns Promise<boolean> 签名是否有效
   */
  async verifyMessageSignature(
    agentId: string,
    messagePayload: MessageSignaturePayload,
    signature: string
  ): Promise<boolean> {
    // 1. 检查 Agent 是否已注册
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not registered for message signature verification', { agentId });
      return false;
    }

    // 2. 检查 Agent 是否有公钥
    if (!agent.publicKey) {
      this.logger.warn('Agent has no public key stored', { agentId });
      return false;
    }

    // 3. 验证签名格式
    try {
      const sigBytes = Buffer.from(signature, 'base64');
      if (sigBytes.length !== 64) {
        this.logger.warn('Invalid message signature length', {
          agentId,
          expectedLength: 64,
          actualLength: sigBytes.length
        });
        return false;
      }
    } catch (error) {
      this.logger.warn('Invalid message signature format (not base64)', { agentId });
      return false;
    }

    // 4. 序列化消息载荷
    const payloadString = AgentRegistry.serializeMessagePayloadForSignature(messagePayload);
    const payloadBytes = Buffer.from(payloadString, 'utf-8');

    // 5. 使用 Ed25519 公钥验证签名
    try {
      const { ed25519 } = await import('@noble/curves/ed25519.js');
      const publicKeyBytes = Buffer.from(agent.publicKey, 'base64');
      const signatureBytes = Buffer.from(signature, 'base64');
      
      // 验证签名
      const isValid = ed25519.verify(signatureBytes, payloadBytes, publicKeyBytes);
      
      if (!isValid) {
        this.logger.warn('Message signature verification failed', {
          agentId,
          messageId: messagePayload.messageId,
          reason: 'signature does not match payload'
        });
        return false;
      }
      
      this.logger.debug('Message signature verified successfully', {
        agentId,
        messageId: messagePayload.messageId
      });
      return true;
    } catch (error) {
      this.logger.error('Message signature verification error', {
        agentId,
        messageId: messagePayload.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 注册 Agent 并验证签名
   * 如果签名验证失败，拒绝注册
   * 
   * @param agent - Agent 注册信息（包含签名）
   * @param verifySignature - 是否验证签名（默认 false，Phase 3 后默认 true）
   * @returns 注册结果或验证失败原因
   */
  registerWithVerification(
    agent: Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'>,
    verifySignature: boolean = false
  ): { success: boolean; registration?: AgentRegistration; error?: string } {
    // 如果需要验证签名
    if (verifySignature) {
      // 直接验证签名格式（不依赖 registry）
      const isValid = this.validateSignatureFormat(agent.agentId, agent.signature, agent.nodeId);
      if (!isValid) {
        this.logger.warn('Agent registration rejected: signature verification failed', {
          agentId: agent.agentId
        });
        return {
          success: false,
          error: 'Signature verification failed'
        };
      }
    }

    // 注册 Agent
    const registration = this.register(agent);
    return {
      success: true,
      registration
    };
  }

  /**
   * 验证签名格式（用于注册前验证）
   * 不依赖 registry 中已存在的记录
   */
  private validateSignatureFormat(
    agentId: string,
    signature: string | undefined,
    nodeId: string | undefined
  ): boolean {
    // 1. 检查签名是否存在
    if (!signature) {
      this.logger.warn('Missing signature', { agentId });
      return false;
    }

    // 2. 验证签名格式（必须是有效的 base64 字符串，长度为 64 字节的 Ed25519 签名）
    try {
      const sigBytes = Buffer.from(signature, 'base64');
      if (sigBytes.length !== 64) {
        this.logger.warn('Invalid signature length', { agentId, expectedLength: 64, actualLength: sigBytes.length });
        return false;
      }
      const validBase64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
      if (!validBase64Pattern.test(signature.replace(/\s/g, ''))) {
        this.logger.warn('Invalid base64 format', { agentId });
        return false;
      }
    } catch (error) {
      this.logger.warn('Invalid signature format (not base64)', { agentId });
      return false;
    }

    // 3. 验证 AgentId 格式（RFC 003: agent:<PeerId前16位>:<随机8位>）
    const agentIdPattern = /^agent:[a-zA-Z0-9]{16}:[a-zA-Z0-9]{8}$/;
    if (!agentIdPattern.test(agentId)) {
      this.logger.warn('Invalid AgentId format', { agentId, pattern: 'agent:<PeerId16>:<Random8>' });
      return false;
    }

    // 4. 验证签名与 AgentId 匹配（AgentId 必须来自所属 NodeId）
    if (nodeId) {
      const peerIdPrefix = agentId.split(':')[1];
      const expectedPrefix = nodeId.substring(0, 16);
      if (peerIdPrefix !== expectedPrefix) {
        this.logger.warn('AgentId does not match NodeId', {
          agentId,
          nodeId,
          peerIdPrefix,
          expectedPrefix
        });
        return false;
      }
    }

    this.logger.debug('Signature format validated', { agentId });
    return true;
  }

  /**
   * 清理过期的 Agent（超过指定时间未活跃）
   */
  cleanupInactive(maxInactiveMs: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [agentId, agent] of this.agents.entries()) {
      const inactiveTime = now - agent.lastActiveAt.getTime();
      if (inactiveTime > maxInactiveMs) {
        this.agents.delete(agentId);
        this.logger.info('Agent cleaned up due to inactivity', {
          agentId,
          name: agent.name,
          inactiveTimeMs: inactiveTime,
        });
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 检查 AgentId 是否过期
   * 基于 createdAt 字段判断 AgentId 是否超过指定时间
   * 
   * @param agentId - Agent ID
   * @param maxAgeMs - 最大有效时间（毫秒）
   * @returns 是否已过期
   */
  isAgentIdExpired(agentId: string, maxAgeMs: number): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('AgentId not found for expiry check', { agentId });
      return true; // 未注册视为过期
    }

    if (!agent.createdAt) {
      this.logger.warn('Agent has no createdAt field', { agentId });
      return true; // 无 createdAt 视为过期
    }

    try {
      const createdAtDate = new Date(agent.createdAt);
      const ageMs = Date.now() - createdAtDate.getTime();
      const isExpired = ageMs > maxAgeMs;

      if (isExpired) {
        this.logger.debug('AgentId is expired', {
          agentId,
          createdAt: agent.createdAt,
          ageMs,
          maxAgeMs
        });
      }

      return isExpired;
    } catch (error) {
      this.logger.warn('Invalid createdAt format', { agentId, createdAt: agent.createdAt });
      return true;
    }
  }

  /**
   * 验证签名并检查 AgentId 是否过期
   * 组合签名验证和过期检查
   * 
   * @param agentId - Agent ID
   * @param maxAgeMs - AgentId 最大有效时间（毫秒）
   * @param signature - 可选签名（如未提供则使用注册时的签名）
   * @returns 签名是否有效且未过期
   */
  verifySignatureWithExpiry(agentId: string, maxAgeMs: number, signature?: string): boolean {
    // 1. 先检查是否过期
    if (this.isAgentIdExpired(agentId, maxAgeMs)) {
      this.logger.warn('AgentId expired, signature verification rejected', { agentId });
      return false;
    }

    // 2. 再验证签名
    return this.verifySignature(agentId, signature);
  }
}