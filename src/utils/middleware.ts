/**
 * F2A 中间件系统
 * 支持消息拦截、过滤和转换
 */

import { F2AMessage, AgentInfo } from '../types/index.js';
import { Logger } from './logger.js';

export interface MiddlewareContext {
  /** 消息 */
  message: F2AMessage;
  /** 发送方 Peer ID */
  peerId: string;
  /** 发送方 Agent 信息 */
  agentInfo?: AgentInfo;
  /** 中间件元数据 */
  metadata: Map<string, unknown>;
}

export type MiddlewareResult = 
  | { action: 'continue'; context: MiddlewareContext }
  | { action: 'drop'; reason: string }
  | { action: 'modify'; context: MiddlewareContext };

export interface Middleware {
  /** 中间件名称 */
  name: string;
  /** 执行优先级（数字越小优先级越高） */
  priority?: number;
  /** 
   * 中间件类型
   * - 'essential': 核心中间件，异常时中断链
   * - 'optional': 可选中间件，异常时继续处理
   */
  type?: 'essential' | 'optional';
  /** 处理函数 */
  process(context: MiddlewareContext): Promise<MiddlewareResult> | MiddlewareResult;
}

/**
 * 中间件管理器
 */
export class MiddlewareManager {
  private middlewares: Middleware[] = [];
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'MiddlewareManager' });
  }

  /**
   * 注册中间件
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
    // 按优先级排序
    this.middlewares.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    this.logger.info('Registered middleware', { name: middleware.name });
  }

  /**
   * 移除中间件
   */
  remove(name: string): boolean {
    const index = this.middlewares.findIndex(m => m.name === name);
    if (index !== -1) {
      this.middlewares.splice(index, 1);
      this.logger.info('Removed middleware', { name });
      return true;
    }
    return false;
  }

  /**
   * 执行中间件链
   */
  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    let currentContext = context;

    for (const middleware of this.middlewares) {
      try {
        const result = await middleware.process(currentContext);

        if (result.action === 'drop') {
          this.logger.info('Message dropped by middleware', {
            middleware: middleware.name,
            reason: result.reason
          });
          return result;
        }

        if (result.action === 'modify') {
          currentContext = result.context;
        }
      } catch (error) {
        this.logger.error('Middleware error', {
          middleware: middleware.name,
          error,
          type: middleware.type || 'optional'
        });
        
        // 根据中间件类型决定是否中断链
        // essential: 核心中间件，异常时中断链，返回 drop
        // optional: 可选中间件，异常时继续处理（原有行为）
        const middlewareType = middleware.type || 'optional';
        
        if (middlewareType === 'essential') {
          this.logger.warn('Essential middleware failed, aborting chain', {
            middleware: middleware.name
          });
          return {
            action: 'drop',
            reason: `Essential middleware ${middleware.name} failed: ${error instanceof Error ? error.message : String(error)}`
          };
        }
        
        // optional 中间件出错时继续处理，不阻塞消息
        this.logger.info('Optional middleware failed, continuing chain', {
          middleware: middleware.name
        });
      }
    }

    return { action: 'continue', context: currentContext };
  }

  /**
   * 获取已注册的中间件列表
   */
  list(): string[] {
    return this.middlewares.map(m => m.name);
  }

  /**
   * 清空所有中间件
   */
  clear(): void {
    this.middlewares = [];
    this.logger.info('Cleared all middlewares');
  }
}

// ============================================================================
// 内置中间件
// ============================================================================

/**
 * 消息大小限制中间件
 */
export function createMessageSizeLimitMiddleware(maxSize: number): Middleware {
  return {
    name: 'MessageSizeLimit',
    priority: 100, // 高优先级，尽早检查
    process(context: MiddlewareContext): MiddlewareResult {
      const messageSize = JSON.stringify(context.message).length;
      if (messageSize > maxSize) {
        return {
          action: 'drop',
          reason: `Message size ${messageSize} exceeds limit ${maxSize}`
        };
      }
      return { action: 'continue', context };
    }
  };
}

/**
 * 消息类型过滤中间件
 */
export function createMessageTypeFilterMiddleware(
  allowedTypes: string[]
): Middleware {
  return {
    name: 'MessageTypeFilter',
    priority: 90,
    process(context: MiddlewareContext): MiddlewareResult {
      if (!allowedTypes.includes(context.message.type)) {
        return {
          action: 'drop',
          reason: `Message type ${context.message.type} not allowed`
        };
      }
      return { action: 'continue', context };
    }
  };
}

/**
 * 消息日志中间件
 */
export function createMessageLoggingMiddleware(
  logger?: Logger
): Middleware {
  const log = logger || new Logger({ component: 'MessageLogger' });
  return {
    name: 'MessageLogger',
    priority: 50, // 中等优先级
    process(context: MiddlewareContext): MiddlewareResult {
      log.debug('Processing message', {
        type: context.message.type,
        from: context.peerId.slice(0, 16),
        id: context.message.id
      });
      return { action: 'continue', context };
    }
  };
}

/**
 * 消息转换中间件示例
 */
export function createMessageTransformMiddleware(
  transform: (msg: F2AMessage) => F2AMessage
): Middleware {
  return {
    name: 'MessageTransform',
    priority: 10, // 低优先级，最后执行
    process(context: MiddlewareContext): MiddlewareResult {
      const transformedMessage = transform(context.message);
      return {
        action: 'modify',
        context: {
          ...context,
          message: transformedMessage
        }
      };
    }
  };
}
