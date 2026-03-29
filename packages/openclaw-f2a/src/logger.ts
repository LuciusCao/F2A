/**
 * OpenClaw Plugin 统一日志模块
 * 
 * 设计说明：
 * - 提供统一的日志接口，便于维护和测试
 * - 支持结构化日志输出
 * - 默认使用 console，未来可扩展为其他日志系统
 */

export interface Logger {
  debug?(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** 默认日志前缀 */
const DEFAULT_PREFIX = '[F2A]';

/**
 * 创建日志记录器
 * @param component 组件名称（可选）
 */
export function createLogger(component?: string): Logger {
  const prefix = component ? `[F2A:${component}]` : DEFAULT_PREFIX;

  return {
    debug(message: string, ...args: unknown[]): void {
      console.log(`${prefix} ${message}`, ...args);
    },
    info(message: string, ...args: unknown[]): void {
      console.log(`${prefix} ${message}`, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
      console.warn(`${prefix} ${message}`, ...args);
    },
    error(message: string, ...args: unknown[]): void {
      console.error(`${prefix} ${message}`, ...args);
    }
  };
}

/** 默认日志记录器 */
export const logger = createLogger();

/** 组件专用日志记录器 */
export const webhookLogger = createLogger('Webhook');
export const taskGuardLogger = createLogger('TaskGuard');
export const queueLogger = createLogger('Queue');
export const nodeLogger = createLogger('Node');
export const pluginLogger = createLogger('Plugin');