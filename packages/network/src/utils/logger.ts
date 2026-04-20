/**
 * F2A 结构化日志系统
 * 基于 Pino 的日志实现，支持结构化输出和级别控制
 */

import { LogLevel } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

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
  /** 文件流重试配置 */
  maxRetries?: number;
  /** 重试间隔（毫秒） */
  retryDelayMs?: number;
  /** 日志轮转：最大文件大小（字节），默认 10MB */
  maxFileSize?: number;
  /** 日志轮转：最大文件数量，默认 5 */
  maxFiles?: number;
}

/**
 * 结构化日志记录器
 */
export class Logger {
  private level: LogLevel;
  private component: string;
  private enableConsole: boolean;
  private enableFile: boolean;
  private filePath: string | undefined;
  private jsonMode: boolean;
  private fileStream: fs.WriteStream | undefined;
  private maxRetries: number;
  private retryDelayMs: number;
  private retryCount: number = 0;
  private isReconnecting: boolean = false;
  // 日志轮转配置
  private maxFileSize: number;
  private maxFiles: number;
  private currentFileSize: number = 0;

  constructor(options: LoggerOptions = {}) {
    // 支持环境变量控制：F2A_LOG_LEVEL 和 F2A_DEBUG
    const envLevel = process.env.F2A_LOG_LEVEL as LogLevel | undefined;
    const isDebug = process.env.F2A_DEBUG === '1';
    const envConsole = process.env.F2A_CONSOLE !== 'false';
    
    this.level = envLevel || (isDebug ? 'DEBUG' : options.level || 'INFO');
    this.component = options.component || 'F2A';
    // 环境变量 F2A_CONSOLE=false 可禁用控制台输出
    this.enableConsole = options.enableConsole !== false && envConsole;
    this.enableFile = options.enableFile ?? false;
    this.filePath = options.filePath;
    // 自动检测：生产环境默认使用 JSON 格式
    this.jsonMode = options.jsonMode ?? (process.env.NODE_ENV === 'production');
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    // 日志轮转配置：默认 10MB, 5 个文件
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles ?? 5;

    // 初始化文件流
    if (this.enableFile && this.filePath) {
      this.initFileStream();
    }
  }

  /**
   * 初始化文件写入流（带重试机制）
   * P2-3 修复：设置日志文件权限为 600
   */
  private initFileStream(): void {
    if (!this.filePath) return;

    const attemptInit = (attempt: number): void => {
      if (attempt > this.maxRetries) {
        console.error(`[Logger] Failed to initialize file stream after ${this.maxRetries} attempts`);
        this.enableFile = false;
        return;
      }

      try {
        // 确保目录存在
        const dir = path.dirname(this.filePath!);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          // P2-3 修复：设置目录权限为 700
          fs.chmodSync(dir, 0o700);
        }

        // 创建写入流（追加模式）
        this.fileStream = fs.createWriteStream(this.filePath!, {
          flags: 'a',
          encoding: 'utf8'
        });
        
        // P2-3 修复：文件打开后设置权限为 600（仅所有者可读写）
        this.fileStream.on('open', () => {
          try {
            fs.chmodSync(this.filePath!, 0o600);
          } catch {
            // 忽略权限设置错误（某些文件系统可能不支持）
          }
        });

        this.fileStream.on('error', (err) => {
          console.error(`[Logger] File stream error: ${err.message}`);
          this.handleStreamError(err);
        });

        this.fileStream.on('open', () => {
          // 成功打开，重置重试计数
          this.retryCount = 0;
          this.isReconnecting = false;
        });

        this.fileStream.on('close', () => {
          // 流关闭，如果需要文件日志则尝试重连
          if (this.enableFile && !this.isReconnecting) {
            this.scheduleReconnect();
          }
        });

      } catch (err) {
        console.error(`[Logger] Failed to initialize file stream (attempt ${attempt}/${this.maxRetries}): ${err}`);
        this.retryCount = attempt;
        
        // 延迟后重试
        setTimeout(() => attemptInit(attempt + 1), this.retryDelayMs);
      }
    };

    attemptInit(1);
  }

  /**
   * 处理流错误
   */
  private handleStreamError(err: Error): void {
    // 检查是否是可恢复的错误
    const isRecoverable = 
      err.message.includes('ENOENT') ||  // 文件不存在
      err.message.includes('EACCES') ||  // 权限问题（可能临时）
      err.message.includes('EMFILE') ||  // 文件描述符不足
      err.message.includes('ENOSPC');    // 磁盘空间不足

    if (isRecoverable && this.retryCount < this.maxRetries) {
      this.scheduleReconnect();
    } else {
      // 不可恢复或超过重试次数，降级到控制台
      console.warn(`[Logger] File logging disabled due to unrecoverable error: ${err.message}`);
      this.fileStream = undefined;
      this.enableFile = false;
    }
  }

  /**
   * 调度重连
   * 使用指数退避策略：delay = baseDelay * 2^(attempt-1)，最大不超过 30 秒
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting) return;
    
    this.isReconnecting = true;
    this.retryCount++;

    if (this.retryCount > this.maxRetries) {
      console.warn(`[Logger] Max reconnection attempts (${this.maxRetries}) reached, file logging disabled`);
      this.enableFile = false;
      this.isReconnecting = false;
      return;
    }

    // 计算指数退避延迟：1s, 2s, 4s, 8s, 16s... 最大 30s
    const exponentialDelay = Math.min(
      this.retryDelayMs * Math.pow(2, this.retryCount - 1),
      30000  // 最大 30 秒
    );

    console.log(`[Logger] Attempting to reconnect file stream (attempt ${this.retryCount}/${this.maxRetries}), delay: ${exponentialDelay}ms`);
    
    // 关闭旧流
    if (this.fileStream) {
      try {
        this.fileStream.destroy();
      } catch { /* ignore */ }
      this.fileStream = undefined;
    }

    // 延迟后重试
    setTimeout(() => {
      this.isReconnecting = false;
      this.initFileStream();
    }, exponentialDelay);
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
   * 检查并执行日志轮转
   * 当文件大小超过 maxFileSize 时，轮转日志文件
   */
  private checkRotation(): void {
    if (!this.filePath || !this.fileStream) return;

    try {
      // 检查当前文件大小
      const stats = fs.statSync(this.filePath);
      this.currentFileSize = stats.size;

      if (this.currentFileSize >= this.maxFileSize) {
        this.rotateLogFiles();
      }
    } catch {
      // 文件可能不存在，忽略错误
    }
  }

  /**
   * 轮转日志文件
   * 将旧文件重命名为 .1, .2, ... 删除最旧的文件
   */
  private rotateLogFiles(): void {
    if (!this.filePath) return;

    try {
      // 关闭当前流
      if (this.fileStream) {
        this.fileStream.end();
        this.fileStream = undefined;
      }

      // 删除最旧的文件（如果存在）
      const oldestFile = `${this.filePath}.${this.maxFiles}`;
      if (fs.existsSync(oldestFile)) {
        fs.unlinkSync(oldestFile);
      }

      // 轮转现有文件：.4 -> .5, .3 -> .4, ... .1 -> .2, current -> .1
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.filePath}.${i}`;
        const newFile = `${this.filePath}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }

      // 重命名当前文件为 .1
      if (fs.existsSync(this.filePath)) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      }

      // 重新打开文件流
      this.initFileStream();
      this.currentFileSize = 0;
    } catch (err) {
      console.error(`[Logger] Failed to rotate log files: ${err}`);
    }
  }

  /**
   * 输出日志
   */
  private output(entry: LogEntry): void {
    const jsonLine = JSON.stringify(entry);
    const lineSize = Buffer.byteLength(jsonLine + '\n', 'utf8');

    // 控制台输出
    if (this.enableConsole) {
      if (this.jsonMode) {
        // 生产环境：JSON 一行，便于日志系统收集
        console.log(jsonLine);
      } else {
        // 开发环境：人类可读
        const { level, msg, timestamp, component, ...meta } = entry;
        const timestampStr = typeof timestamp === 'string' ? timestamp : String(timestamp);
        const timePart = timestampStr.includes('T') ? timestampStr.split('T')[1].split('.')[0] : timestampStr;
        const prefix = `[${timePart}] [${component}] [${level}]`;

        if (Object.keys(meta).length > 0) {
          // 结构化输出（开发环境可读格式）
          console.log(`${prefix} ${msg}`, meta);
        } else {
          console.log(`${prefix} ${msg}`);
        }
      }
    }

    // 文件输出
    if (this.enableFile && this.fileStream && this.fileStream.writable) {
      // 检查是否需要轮转
      if (this.currentFileSize + lineSize > this.maxFileSize) {
        this.checkRotation();
      }

      this.fileStream.write(jsonLine + '\n');
      this.currentFileSize += lineSize;
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
   * 设置控制台输出开关
   */
  setConsoleEnabled(enabled: boolean): void {
    this.enableConsole = enabled;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * 启用文件日志
   */
  setFileLogging(enabled: boolean, filePath?: string): void {
    // 关闭现有流
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }

    this.enableFile = enabled;
    if (filePath) {
      this.filePath = filePath;
    }

    if (enabled && this.filePath) {
      this.initFileStream();
    }
  }

  /**
   * 创建子日志记录器
   */
  child(component: string): Logger {
    return new Logger({
      level: this.level,
      component: `${this.component}:${component}`,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      filePath: this.filePath,
      jsonMode: this.jsonMode
    });
  }

  /**
   * 关闭日志记录器，释放资源
   */
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }
}

