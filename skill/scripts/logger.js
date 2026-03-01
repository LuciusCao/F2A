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
    this.level = LOG_LEVELS[options.level?.toUpperCase()] ?? LOG_LEVELS.INFO;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    
    // 日志文件路径
    const logDir = options.logDir || path.join(os.homedir(), '.f2a');
    this.logFile = options.logFile || path.join(logDir, 'f2a-debug.log');
    
    // 确保日志目录存在
    if (this.enableFile && !fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  _log(level, levelName, ...args) {
    if (level < this.level) return;
    
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const logLine = `[${timestamp}] [${levelName}] ${message}`;
    
    // 控制台输出
    if (this.enableConsole) {
      console.log(logLine);
    }
    
    // 文件输出
    if (this.enableFile) {
      try {
        fs.appendFileSync(this.logFile, logLine + '\n');
      } catch (e) {
        // 忽略文件写入错误
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
    this.info(`[CONN] ${peerId.slice(0, 12)}... ${status}`, details);
  }

  // 协议流程日志
  protocol(step, peerId, details = {}) {
    this.debug(`[PROTO] ${step} | ${peerId?.slice(0, 12)}...`, details);
  }
}

module.exports = { Logger, LOG_LEVELS };
