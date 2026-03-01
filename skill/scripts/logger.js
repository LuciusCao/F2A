/**
 * F2A Logger Module
 * 统一日志管理，支持级别控制和输出
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(options = {}) {
    // 默认 INFO 级别，避免生产环境产生过多日志
    this.level = LOG_LEVELS[options.level?.toUpperCase()] ?? LOG_LEVELS.INFO;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    
    // 日志缓冲区，批量写入
    this.logBuffer = [];
    this.flushInterval = null;
    
    // 日志文件路径
    const logDir = options.logDir || path.join(os.homedir(), '.f2a');
    this.logFile = options.logFile || path.join(logDir, 'f2a.log');
    
    // 确保日志目录存在并检查可写性
    if (this.enableFile) {
      try {
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        // 测试文件可写性
        fs.accessSync(logDir, fs.constants.W_OK);
        // 启动定时 flush
        this._startFlushInterval();
      } catch (err) {
        console.error(`[Logger] 无法写入日志文件: ${err.message}`);
        this.enableFile = false;
      }
    }
  }

  _startFlushInterval() {
    // 每 5 秒批量写入一次
    this.flushInterval = setInterval(() => {
      this._flush();
    }, 5000);
  }

  _flush() {
    if (this.logBuffer.length === 0 || !this.enableFile) return;
    
    const content = this.logBuffer.join('\n') + '\n';
    this.logBuffer = [];
    
    fs.appendFile(this.logFile, content, (err) => {
      if (err) {
        console.error(`[Logger] 写入日志失败: ${err.message}`);
      }
    });
  }

  _log(level, levelName, ...args) {
    if (level < this.level) return;
    
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const logLine = `[${timestamp}] [${levelName}] ${message}`;
    
    // 控制台输出 - 根据级别使用不同的 console 方法
    if (this.enableConsole) {
      if (level === LOG_LEVELS.ERROR) {
        console.error(logLine);
      } else if (level === LOG_LEVELS.WARN) {
        console.warn(logLine);
      } else {
        console.log(logLine);
      }
    }
    
    // 文件输出 - 加入缓冲区
    if (this.enableFile) {
      this.logBuffer.push(logLine);
      // 缓冲区超过 100 条立即写入
      if (this.logBuffer.length >= 100) {
        this._flush();
      }
    }
  }

  debug(...args) { this._log(LOG_LEVELS.DEBUG, 'DEBUG', ...args); }
  info(...args) { this._log(LOG_LEVELS.INFO, 'INFO', ...args); }
  warn(...args) { this._log(LOG_LEVELS.WARN, 'WARN', ...args); }
  error(...args) { this._log(LOG_LEVELS.ERROR, 'ERROR', ...args); }

  // 网络消息日志
  network(direction, type, data) {
    this.debug(`[NET-${direction}] ${type}:`, data);
  }

  // 连接状态日志
  connection(peerId, status, details = {}) {
    this.info(`[CONN] ${peerId?.slice(0, 12)}... ${status}`, details);
  }

  // 协议流程日志
  protocol(step, peerId, details = {}) {
    this.debug(`[PROTO] ${step} | ${peerId?.slice(0, 12)}...`, details);
  }

  // 关闭日志，确保缓冲区写入
  close() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this._flush();
  }
}

module.exports = { Logger, LOG_LEVELS };
