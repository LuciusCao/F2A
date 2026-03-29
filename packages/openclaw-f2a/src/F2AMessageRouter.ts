/**
 * F2A 消息路由器
 * 
 * 负责消息的去重、分发和路由。
 * 从 connector.ts 拆分（Issue #106），遵循单一职责原则。
 * 
 * @module F2AMessageRouter
 */

import { createHash } from 'crypto';
import type { ApiLogger, F2APublicInterface } from './types.js';

/**
 * 消息事件结构
 */
export interface F2AMessageEvent {
  from: string;
  content: string;
  metadata?: Record<string, unknown>;
  messageId: string;
}

/**
 * 消息路由器配置
 */
export interface MessageRouterConfig {
  /** 最大缓存大小 */
  maxCacheSize: number;
  /** 缓存 TTL（毫秒） */
  cacheTtlMs: number;
  /** 启用哈希去重的消息长度阈值 */
  hashThreshold: number;
}

/** 默认配置 */
export const DEFAULT_ROUTER_CONFIG: MessageRouterConfig = {
  maxCacheSize: 10000,
  cacheTtlMs: 5 * 60 * 1000,  // 5 分钟
  hashThreshold: 100,
};

/**
 * 消息路由器依赖
 */
export interface MessageRouterDeps {
  /** F2A 实例（用于获取 peerId） */
  f2a?: F2APublicInterface;
  /** Logger */
  logger?: ApiLogger;
}

/**
 * F2A 消息路由器
 * 
 * 功能：
 * 1. 消息去重（基于 metadata 标记 + 内容哈希）
 * 2. 回声消息检测（防止循环）
 * 3. 消息哈希缓存管理
 */
export class F2AMessageRouter {
  private deps: MessageRouterDeps;
  private config: MessageRouterConfig;
  
  /** 已处理消息哈希缓存 */
  private processedHashes: Map<string, number> = new Map();

  constructor(deps: MessageRouterDeps, config: MessageRouterConfig = DEFAULT_ROUTER_CONFIG) {
    this.deps = deps;
    this.config = config;
  }

  /**
   * 检测是否为回声消息（避免循环）
   * 
   * 使用多层验证策略：
   * 1. 检查 metadata 中的特定标记
   * 2. 检查消息内容中的特殊标记
   * 3. 检查消息来源是否为自己的 peerId
   * 4. 基于消息内容哈希的去重机制
   * 
   * @param msg - 接收到的消息
   * @returns 是否为应该跳过的回声消息
   */
  isEchoMessage(msg: F2AMessageEvent): boolean {
    const { metadata, content, from } = msg;

    // 层1: 检查 metadata 中的标记
    if (metadata) {
      // 检查是否是回复消息标记
      if (metadata.type === 'reply' && metadata.replyTo) {
        return true;
      }

      // 检查显式的跳过标记
      if (metadata._f2a_skip_echo === true || metadata['x-openclaw-skip'] === true) {
        return true;
      }
    }

    // 层2: 检查消息内容中的特殊标记
    if (content) {
      if (content.includes('[[F2A:REPLY:') || content.includes('[[reply_to_current]]')) {
        return true;
      }

      if (content.startsWith('NO_REPLY:') || content.startsWith('[NO_REPLY]')) {
        return true;
      }
    }

    // 层3: 检查消息来源是否是我们自己的 peerId（防止自循环）
    if (this.deps.f2a && from === this.deps.f2a.peerId) {
      return true;
    }

    // 层4: 基于消息内容哈希的去重机制（仅对长消息启用）
    if (content && content.length > this.config.hashThreshold) {
      const messageHash = this.computeHash(from, content);
      const now = Date.now();

      // 检查是否已处理过相同的消息内容
      if (this.processedHashes.has(messageHash)) {
        const processedTime = this.processedHashes.get(messageHash)!;
        // 如果在 TTL 内，认为是重复消息
        if (now - processedTime < this.config.cacheTtlMs) {
          this.deps.logger?.debug?.(`[F2A] 检测到重复消息（哈希去重）: ${messageHash.slice(0, 16)}...`);
          return true;
        }
      }

      // 记录此消息哈希
      this.processedHashes.set(messageHash, now);

      // 清理过期的条目（防止内存泄漏）
      if (this.processedHashes.size > this.config.maxCacheSize) {
        this.cleanupCache(now);
      }
    }

    return false;
  }

  /**
   * 计算消息内容哈希
   * 
   * 使用 SHA256 算法生成安全的哈希值。
   * 
   * @param from - 发送者 peerId
   * @param content - 消息内容
   * @returns 哈希标识符
   */
  private computeHash(from: string, content: string): string {
    const data = `${from}:${content}`;
    const hash = createHash('sha256').update(data).digest('hex');
    return `msg-${hash.slice(0, 32)}-${data.length}`;
  }

  /**
   * 清理过期的消息哈希缓存
   * 
   * @param now - 当前时间戳
   */
  private cleanupCache(now: number): void {
    for (const [hash, timestamp] of this.processedHashes.entries()) {
      if (now - timestamp > this.config.cacheTtlMs) {
        this.processedHashes.delete(hash);
      }
    }
  }

  /**
   * 更新 F2A 实例（运行时更新）
   * 
   * @param f2a - 新的 F2A 实例
   */
  updateF2A(f2a: F2APublicInterface | undefined): void {
    this.deps.f2a = f2a;
  }

  /**
   * 更新 Logger（运行时更新）
   * 
   * @param logger - 新的 Logger
   */
  updateLogger(logger: ApiLogger | undefined): void {
    this.deps.logger = logger;
  }

  /**
   * 清空缓存（用于测试或重置）
   */
  clearCache(): void {
    this.processedHashes.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; maxAge: number } {
    let maxAge = 0;
    const now = Date.now();
    for (const timestamp of this.processedHashes.values()) {
      maxAge = Math.max(maxAge, now - timestamp);
    }
    return { size: this.processedHashes.size, maxAge };
  }
}