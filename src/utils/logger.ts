/**
 * F2A 结构化日志系统
 * 基于 Pino 的日志实现，支持结构化输出和级别控制
 */

import { LogLevel } from '../types';

// 日志级别权重
const LOG_LEVELS: Record<LogLevel, number> = {
  'DEBUG': 0,
  'INFO': 1,
  'WARN': 2,
  'ERROR': 3
};

// 日志条目接口
export interface LogEntry {
  level: string;
  msg: string;
  timestamp: string;
  component?: string;
  [key: string]: unknown;
}

// 日志选项
export interface LoggerOptions {
  level?: LogLevel;
  component?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  filePath?: string;
  /** 是否使用 JSON 格式输出（生产环境推荐） */
  jsonMode?: boolean;
}

/**
 * 结构化日志记录器
 */
export class Logger {
  private level: LogLevel;
  private component: string;
  private enableConsole: boolean;
  private jsonMode: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'INFO';
    this.component = options.component || 'F2A';
    this.enableConsole = options.enableConsole !== false;
    // 自动检测：生产环境默认使用 JSON 格式
    this.jsonMode = options.jsonMode ?? (process.env.NODE_ENV === 'production');
  }

  /**
   * 检查日志级别是否启用
   */
  private isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  /**
   * 格式化日志条目
   */
  private formatLog(level: string, message: string, meta?: Record<string, unknown>): LogEntry {
    return {
      level,
      msg: message,
      timestamp: new Date().toISOString(),
      component: this.component,
      ...meta
    };
  }

  /**
   * 输出日志
   */
  private output(entry: LogEntry): void {
    if (!this.enableConsole) return;

    if (this.jsonMode) {
      // 生产环境：JSON 一行，便于日志系统收集
      console.log(JSON.stringify(entry));
    } else {
      // 开发环境：人类可读
      const { level, msg, timestamp, component, ...meta } = entry;
      const prefix = `[${timestamp.split('T')[1].split('.')[0]}] [${component}] [${level}]`;

      if (Object.keys(meta).length > 0) {
        // 结构化输出（开发环境可读格式）
        console.log(`${prefix} ${msg}`, meta);
      } else {
        console.log(`${prefix} ${msg}`);
      }
    }
  }

  /**
   * 记录 DEBUG 级别日志
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    if (!this.isLevelEnabled('DEBUG')) return;
    this.output(this.formatLog('DEBUG', message, meta));
  }

  /**
   * 记录 INFO 级别日志
   */
  info(message: string, meta?: Record<string, unknown>): void {
    if (!this.isLevelEnabled('INFO')) return;
    this.output(this.formatLog('INFO', message, meta));
  }

  /**
   * 记录 WARN 级别日志
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    if (!this.isLevelEnabled('WARN')) return;
    this.output(this.formatLog('WARN', message, meta));
  }

  /**
   * 记录 ERROR 级别日志
   */
  error(message: string, meta?: Record<string, unknown>): void {
    if (!this.isLevelEnabled('ERROR')) return;
    this.output(this.formatLog('ERROR', message, meta));
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * 创建子日志记录器
   */
  child(component: string): Logger {
    return new Logger({
      level: this.level,
      component: `${this.component}:${component}`,
      enableConsole: this.enableConsole,
      jsonMode: this.jsonMode
    });
  }
}

// 默认日志记录器实例
export const defaultLogger = new Logger({ component: 'F2A' });

// 便捷导出
export const logger = defaultLogger;
