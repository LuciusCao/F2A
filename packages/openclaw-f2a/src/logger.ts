/**
 * OpenClaw Plugin 统一日志模块
 * 
 * 设计说明：
 * - 提供统一的日志接口，与 core 包的 Logger 保持一致
 * - 支持结构化日志输出 (message, meta) 格式
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
 * 格式化时间戳 (HH:MM:SS)
 */
function formatTimestamp(): string {
  const now = new Date();
  return now.toTimeString().split(' ')[0];
}

/**
 * 格式化输出 (开发环境人类可读)
 */
function formatOutput(level: string, prefix: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = formatTimestamp();
  const levelStr = `[${level}]`;
  
  if (meta && Object.keys(meta).length > 0) {
    // 结构化输出：时间 + 前缀 + 级别 + 消息 + meta
    const metaStr = JSON.stringify(meta);
    return `${timestamp} ${prefix} ${levelStr} ${message} ${metaStr}`;
  }
  
  return `${timestamp} ${prefix} ${levelStr} ${message}`;
}

/**
 * 创建日志记录器
 * @param component 组件名称（可选）
 */
export function createLogger(component?: string): Logger {
  const prefix = component ? `[F2A:${component}]` : DEFAULT_PREFIX;

  return {
    debug(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      console.debug(formatOutput('DEBUG', prefix, message, meta as Record<string, unknown> | undefined));
    },
    info(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      console.log(formatOutput('INFO', prefix, message, meta as Record<string, unknown> | undefined));
    },
    warn(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      console.warn(formatOutput('WARN', prefix, message, meta as Record<string, unknown> | undefined));
    },
    error(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      console.error(formatOutput('ERROR', prefix, message, meta as Record<string, unknown> | undefined));
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