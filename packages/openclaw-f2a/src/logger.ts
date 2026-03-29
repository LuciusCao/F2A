/**
 * OpenClaw Plugin 统一日志模块
 * 
 * 设计说明：
 * - 提供统一的日志接口，与 core 包的 Logger 保持一致
 * - 支持结构化日志输出 (message, meta) 格式
 * - 默认使用 console，支持文件持久化和日志轮转
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Logger {
  debug?(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** 日志配置选项 */
export interface LoggerOptions {
  /** 组件名称 */
  component?: string;
  /** 是否启用控制台输出（默认 true） */
  enableConsole?: boolean;
  /** 是否启用文件输出（默认 false） */
  enableFile?: boolean;
  /** 日志文件目录（默认 ~/.openclaw/logs） */
  logDir?: string;
  /** 日志文件名（默认 f2a.log） */
  logFileName?: string;
  /** 日志轮转：最大文件大小（字节），默认 10MB */
  maxFileSize?: number;
  /** 日志轮转：最大文件数量，默认 5 */
  maxFiles?: number;
}

/** 默认日志前缀 */
const DEFAULT_PREFIX = '[F2A]';

/** 默认配置 */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_FILES = 5;
const DEFAULT_LOG_DIR = path.join(process.env.HOME || '/tmp', '.openclaw', 'logs');
const DEFAULT_LOG_FILE_NAME = 'f2a.log';

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
 * 格式化 JSON 日志条目（用于文件输出）
 */
function formatJsonLog(level: string, component: string, message: string, meta?: Record<string, unknown>): string {
  const entry = {
    level,
    msg: message,
    timestamp: new Date().toISOString(),
    component,
    ...meta
  };
  return JSON.stringify(entry);
}

/**
 * 文件日志管理器
 */
class FileLogManager {
  private filePath: string;
  private maxFileSize: number;
  private maxFiles: number;
  private fileStream: fs.WriteStream | undefined;
  private currentFileSize: number = 0;

  constructor(logDir: string, logFileName: string, maxFileSize: number, maxFiles: number) {
    this.filePath = path.join(logDir, logFileName);
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.initFileStream();
  }

  /**
   * 初始化文件写入流
   */
  private initFileStream(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        // 设置目录权限为 700（仅所有者可访问）
        try {
          fs.chmodSync(dir, 0o700);
        } catch {
          // 忽略权限设置错误（某些文件系统可能不支持）
        }
      }

      // 创建写入流（追加模式）
      this.fileStream = fs.createWriteStream(this.filePath, {
        flags: 'a',
        encoding: 'utf8'
      });

      // 文件打开后设置权限为 600（仅所有者可读写）
      this.fileStream.on('open', () => {
        try {
          fs.chmodSync(this.filePath, 0o600);
        } catch {
          // 忽略权限设置错误
        }
      });

      this.fileStream.on('error', (err) => {
        console.error(`[Logger] File stream error: ${err.message}`);
      });

      // 获取当前文件大小
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        this.currentFileSize = stats.size;
      } else {
        this.currentFileSize = 0;
      }

    } catch (err) {
      console.error(`[Logger] Failed to initialize file stream: ${err}`);
      this.fileStream = undefined;
    }
  }

  /**
   * 检查并执行日志轮转
   */
  private checkRotation(lineSize: number): void {
    if (this.currentFileSize + lineSize > this.maxFileSize) {
      this.rotateLogFiles();
    }
  }

  /**
   * 轮转日志文件
   */
  private rotateLogFiles(): void {
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
   * 写入日志
   */
  write(level: string, component: string, message: string, meta?: Record<string, unknown>): void {
    if (!this.fileStream || !this.fileStream.writable) {
      return;
    }

    const line = formatJsonLog(level, component, message, meta);
    const lineSize = Buffer.byteLength(line + '\n', 'utf8');

    // 检查是否需要轮转
    this.checkRotation(lineSize);

    // 写入日志
    this.fileStream.write(line + '\n');
    this.currentFileSize += lineSize;
  }

  /**
   * 关闭文件流
   */
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }
}

/**
 * 创建日志记录器
 * @param optionsOrComponent 组件名称或完整配置选项
 */
export function createLogger(optionsOrComponent?: string | LoggerOptions): Logger {
  // 处理参数：支持旧的字符串参数形式和新的配置对象形式
  let options: LoggerOptions;
  if (typeof optionsOrComponent === 'string') {
    options = { component: optionsOrComponent };
  } else {
    options = optionsOrComponent || {};
  }

  const component = options.component || '';
  const prefix = component ? `[F2A:${component}]` : DEFAULT_PREFIX;
  const enableConsole = options.enableConsole !== false;
  const enableFile = options.enableFile ?? false;
  const logDir = options.logDir || DEFAULT_LOG_DIR;
  const logFileName = options.logFileName || DEFAULT_LOG_FILE_NAME;
  const maxFileSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;

  // 文件日志管理器（仅在启用文件输出时创建）
  let fileManager: FileLogManager | undefined;
  if (enableFile) {
    fileManager = new FileLogManager(logDir, logFileName, maxFileSize, maxFiles);
  }

  return {
    debug(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      if (enableConsole) {
        console.debug(formatOutput('DEBUG', prefix, message, meta as Record<string, unknown> | undefined));
      }
      if (fileManager) {
        fileManager.write('DEBUG', `F2A:${component}`, message, meta as Record<string, unknown> | undefined);
      }
    },
    info(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      if (enableConsole) {
        console.log(formatOutput('INFO', prefix, message, meta as Record<string, unknown> | undefined));
      }
      if (fileManager) {
        fileManager.write('INFO', `F2A:${component}`, message, meta as Record<string, unknown> | undefined);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      if (enableConsole) {
        console.warn(formatOutput('WARN', prefix, message, meta as Record<string, unknown> | undefined));
      }
      if (fileManager) {
        fileManager.write('WARN', `F2A:${component}`, message, meta as Record<string, unknown> | undefined);
      }
    },
    error(message: string, ...args: unknown[]): void {
      const meta = args.length > 0 ? args[0] : undefined;
      if (enableConsole) {
        console.error(formatOutput('ERROR', prefix, message, meta as Record<string, unknown> | undefined));
      }
      if (fileManager) {
        fileManager.write('ERROR', `F2A:${component}`, message, meta as Record<string, unknown> | undefined);
      }
    }
  };
}

/**
 * 创建带文件输出的日志记录器
 * @param options 配置选项
 */
export function createFileLogger(options: LoggerOptions = {}): Logger {
  return createLogger({ ...options, enableFile: true });
}

/** 默认日志记录器（仅控制台） */
export const logger = createLogger();

/** 组件专用日志记录器（仅控制台） */
export const webhookLogger = createLogger('Webhook');
export const taskGuardLogger = createLogger('TaskGuard');
export const queueLogger = createLogger('Queue');
export const nodeLogger = createLogger('Node');
export const pluginLogger = createLogger('Plugin');