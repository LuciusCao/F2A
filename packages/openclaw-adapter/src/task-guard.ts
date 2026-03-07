/**
 * F2A Task Guard
 * 轻量级任务安全检查和评审
 */

import type { TaskRequest, TaskAnnouncement, ReputationEntry } from './types.js';
import { taskGuardLogger as logger } from './logger.js';

export interface TaskGuardRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'info' | 'warn' | 'block';
  check: (task: TaskRequest | TaskAnnouncement, context: TaskGuardContext) => TaskGuardResult;
}

export interface TaskGuardContext {
  requesterReputation?: ReputationEntry;
  isWhitelisted: boolean;
  isBlacklisted: boolean;
  recentTaskCount: number;
  config: TaskGuardConfig;
}

export interface TaskGuardConfig {
  enabled: boolean;
  requireConfirmationForDangerous: boolean;
  maxTasksPerMinute: number;
  blockedKeywords: string[];
  dangerousPatterns: RegExp[];
  minReputationForDangerous: number;
}

export interface TaskGuardResult {
  passed: boolean;
  severity: 'info' | 'warn' | 'block';
  ruleId: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TaskGuardReport {
  taskId: string;
  passed: boolean;
  results: TaskGuardResult[];
  warnings: TaskGuardResult[];
  blocks: TaskGuardResult[];
  requiresConfirmation: boolean;
  timestamp: number;
}

// 默认配置
export const DEFAULT_TASK_GUARD_CONFIG: TaskGuardConfig = {
  enabled: true,
  requireConfirmationForDangerous: true,
  maxTasksPerMinute: 10,
  blockedKeywords: [
    'rm -rf /',
    'rm -rf /*',
    'format',
    'delete all',
    'destroy',
    'wipe'
  ],
  dangerousPatterns: [
    /rm\s+-rf\s+\/\s*$/i,
    /format\s+/i,
    /delete\s+all/i,
    /drop\s+database/i,
    /shutdown\s+-h/i
  ],
  minReputationForDangerous: 70
};

/**
 * 路径规范化 - 移除 .. 和多余的斜杠
 * 用于检测路径遍历绕过
 */
function normalizePath(path: string): string {
  // 解码 URL 编码
  let normalized = path;
  try {
    normalized = decodeURIComponent(normalized);
  } catch { /* ignore */ }
  
  // 替换多个斜杠为单个
  normalized = normalized.replace(/\/+/g, '/');
  
  // 解析 .. 和 .
  const parts = normalized.split('/');
  const result: string[] = [];
  
  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }
  
  return '/' + result.join('/');
}

/**
 * 检测变量替换绕过
 */
function detectVariableSubstitution(text: string): string[] {
  const detected: string[] = [];
  
  // 环境变量模式: $VAR, ${VAR}, %VAR%
  const envPatterns = [
    /\$([A-Za-z_][A-Za-z0-9_]*)/g,           // $VAR
    /\$\{([^}]+)\}/g,                         // ${VAR}
    /%([A-Za-z_][A-Za-z0-9_]*)%/g,           // %VAR%
  ];
  
  for (const pattern of envPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      detected.push(`变量替换: ${match[0]}`);
    }
  }
  
  return detected;
}

/**
 * 检测编码绕过
 */
function detectEncodingBypass(text: string): string[] {
  const detected: string[] = [];
  
  // 八进制编码: \177, \027
  if (/\\[0-7]{1,3}/.test(text)) {
    detected.push('八进制编码');
  }
  
  // 十六进制编码: \x7f, \x1b
  if (/\\x[0-9a-fA-F]{2}/.test(text)) {
    detected.push('十六进制编码');
  }
  
  // Unicode 编码: \u007f
  if (/\\u[0-9a-fA-F]{4}/.test(text)) {
    detected.push('Unicode编码');
  }
  
  // URL 编码: %20, %2f
  if (/%[0-9a-fA-F]{2}/.test(text)) {
    detected.push('URL编码');
  }
  
  return detected;
}

/**
 * 检测命令注入绕过
 */
function detectCommandInjectionBypass(text: string): string[] {
  const detected: string[] = [];
  const lowerText = text.toLowerCase();
  
  // 反引号命令替换
  if (/`[^`]+`/.test(text)) {
    detected.push('反引号命令替换');
  }
  
  // $() 命令替换
  if (/\$\([^)]+\)/.test(text)) {
    detected.push('$()命令替换');
  }
  
  // 分号命令链接
  if (/;\s*(rm|dd|mkfs|shutdown|reboot|halt|init)\b/i.test(text)) {
    detected.push('分号命令链接');
  }
  
  // 管道命令注入
  if (/\|\s*(rm|dd|mkfs|shutdown|reboot|halt)\b/i.test(text)) {
    detected.push('管道命令注入');
  }
  
  // &&/|| 命令链接
  if (/(&&|\|\|)\s*(rm|dd|mkfs|shutdown|reboot|halt)\b/i.test(text)) {
    detected.push('逻辑运算符命令链接');
  }
  
  return detected;
}

export class TaskGuard {
  private config: TaskGuardConfig;
  private rules: TaskGuardRule[];
  private recentTasks: Map<string, number[]> = new Map();
  /** 清理阈值：当条目数超过此值时触发清理 */
  private cleanupThreshold: number = 100;
  /** 上次清理时间戳 */
  private lastCleanupTime: number = 0;
  /** 定时清理间隔（毫秒） */
  private cleanupIntervalMs: number = 60000; // 1分钟

  constructor(config: Partial<TaskGuardConfig> = {}) {
    this.config = { ...DEFAULT_TASK_GUARD_CONFIG, ...config };
    this.rules = this.createDefaultRules();
  }

  /**
   * 检查任务
   */
  check(
    task: TaskRequest | TaskAnnouncement,
    context: Partial<TaskGuardContext> = {}
  ): TaskGuardReport {
    const fullContext: TaskGuardContext = {
      requesterReputation: context.requesterReputation,
      isWhitelisted: context.isWhitelisted ?? false,
      isBlacklisted: context.isBlacklisted ?? false,
      recentTaskCount: this.getRecentTaskCount(task.from),
      config: this.config
    };

    const taskId = 'taskId' in task ? task.taskId : task.announcementId;
    logger.debug('check: taskId=%s, from=%s, rules=%d', taskId, task.from, this.rules.filter(r => r.enabled).length);

    const results: TaskGuardResult[] = [];

    // 运行所有规则
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      
      try {
        const result = rule.check(task, fullContext);
        results.push(result);
        
        // 记录规则执行结果
        if (!result.passed) {
          if (result.severity === 'block') {
            logger.warn('rule-blocked: taskId=%s, ruleId=%s, message=%s', taskId, rule.id, result.message);
          } else if (result.severity === 'warn') {
            logger.info('rule-warning: taskId=%s, ruleId=%s, message=%s', taskId, rule.id, result.message);
          }
        }
      } catch (error) {
        logger.error('rule-error: ruleId=%s, taskId=%s, error=%s', rule.id, taskId, error);
        results.push({
          passed: false,
          severity: 'warn',
          ruleId: rule.id,
          message: `规则执行错误: ${rule.name}`
        });
      }
    }

    // 记录任务
    this.recordTask(task.from);

    const blocks = results.filter(r => r.severity === 'block' && !r.passed);
    const warnings = results.filter(r => r.severity === 'warn' && !r.passed);
    const requiresConfirmation = results.some(r => 
      r.severity === 'warn' && 
      !r.passed && 
      this.config.requireConfirmationForDangerous
    );

    const passed = blocks.length === 0;
    logger.debug('check-result: taskId=%s, passed=%s, blocks=%d, warnings=%d, requiresConfirmation=%s', 
      taskId, passed, blocks.length, warnings.length, requiresConfirmation);

    return {
      taskId,
      passed,
      results,
      warnings,
      blocks,
      requiresConfirmation,
      timestamp: Date.now()
    };
  }

  /**
   * 快速检查（只返回是否通过）
   */
  quickCheck(
    task: TaskRequest | TaskAnnouncement,
    context?: Partial<TaskGuardContext>
  ): boolean {
    const report = this.check(task, context);
    const taskId = 'taskId' in task ? task.taskId : task.announcementId;
    logger.debug('quickCheck: taskId=%s, passed=%s', taskId, report.passed);
    return report.passed;
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: TaskGuardRule): void {
    this.rules.push(rule);
    logger.info('addRule: ruleId=%s, name=%s, severity=%s, enabled=%s', rule.id, rule.name, rule.severity, rule.enabled);
  }

  /**
   * 启用/禁用规则
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      logger.info('setRuleEnabled: ruleId=%s, enabled=%s', ruleId, enabled);
    } else {
      logger.warn('setRuleEnabled: rule not found, ruleId=%s', ruleId);
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TaskGuardConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ========== 私有方法 ==========

  private createDefaultRules(): TaskGuardRule[] {
    return [
      // 规则 1: 黑名单检查
      {
        id: 'blacklist',
        name: '黑名单检查',
        description: '检查请求者是否在黑名单中',
        enabled: true,
        severity: 'block',
        check: (task, context) => ({
          passed: !context.isBlacklisted,
          severity: 'block',
          ruleId: 'blacklist',
          message: context.isBlacklisted 
            ? '请求者在黑名单中，任务被拒绝' 
            : '通过黑名单检查'
        })
      },

      // 规则 2: 频率限制
      {
        id: 'rate-limit',
        name: '频率限制',
        description: '检查请求频率是否过高',
        enabled: true,
        severity: 'block',
        check: (task, context) => {
          const exceeded = context.recentTaskCount > context.config.maxTasksPerMinute;
          return {
            passed: !exceeded,
            severity: 'block',
            ruleId: 'rate-limit',
            message: exceeded 
              ? `请求频率过高: ${context.recentTaskCount}/${context.config.maxTasksPerMinute} 每分钟` 
              : '频率检查通过',
            details: { current: context.recentTaskCount, limit: context.config.maxTasksPerMinute }
          };
        }
      },

      // 规则 3: 危险关键词检查
      {
        id: 'dangerous-keywords',
        name: '危险关键词检查',
        description: '检查任务描述中是否包含危险关键词',
        enabled: true,
        severity: 'block',
        check: (task, context) => {
          const description = task.description.toLowerCase();
          const found = context.config.blockedKeywords.filter(kw => 
            description.includes(kw.toLowerCase())
          );
          return {
            passed: found.length === 0,
            severity: 'block',
            ruleId: 'dangerous-keywords',
            message: found.length > 0 
              ? `发现危险关键词: ${found.join(', ')}` 
              : '未检测到危险关键词',
            details: { found }
          };
        }
      },

      // 规则 4: 危险模式检查（正则）
      {
        id: 'dangerous-patterns',
        name: '危险模式检查',
        description: '使用正则表达式检测危险命令模式',
        enabled: true,
        severity: 'block',
        check: (task, context) => {
          const description = task.description;
          const found: string[] = [];
          
          for (const pattern of context.config.dangerousPatterns) {
            if (pattern.test(description)) {
              found.push(pattern.source);
            }
          }
          
          return {
            passed: found.length === 0,
            severity: 'block',
            ruleId: 'dangerous-patterns',
            message: found.length > 0 
              ? `发现危险命令模式` 
              : '未检测到危险模式',
            details: { patternsFound: found.length }
          };
        }
      },

      // 规则 5: 信誉检查
      {
        id: 'reputation',
        name: '信誉检查',
        description: '检查请求者信誉是否足够',
        enabled: true,
        severity: 'warn',
        check: (task, context) => {
          if (!context.requesterReputation) {
            // 无信誉记录时返回 warn，而非直接通过
            // 新 peer 首次任务需要谨慎处理
            return {
              passed: true,
              severity: 'warn',
              ruleId: 'reputation',
              message: '无信誉记录，首次任务建议谨慎处理'
            };
          }

          const rep = context.requesterReputation.score;
          const isDangerous = this.isDangerousTask(task);
          
          if (isDangerous && rep < context.config.minReputationForDangerous) {
            return {
              passed: false,
              severity: 'warn',
              ruleId: 'reputation',
              message: `信誉不足执行危险任务: ${rep} < ${context.config.minReputationForDangerous}`,
              details: { reputation: rep, required: context.config.minReputationForDangerous }
            };
          }

          return {
            passed: true,
            severity: 'info',
            ruleId: 'reputation',
            message: `信誉检查通过: ${rep}`,
            details: { reputation: rep }
          };
        }
      },

      // 规则 6: 文件操作检查
      {
        id: 'file-operation',
        name: '文件操作检查',
        description: '检查文件操作是否在允许范围内',
        enabled: true,
        severity: 'warn',
        check: (task, context) => {
          const description = task.description.toLowerCase();
          const isFileOp = /\b(read|write|edit|delete|remove)\b/.test(description);
          const hasPath = /[\/~]\w+/.test(description);
          
          if (isFileOp && hasPath) {
            // 检查是否是系统路径（包括 macOS 路径）
            const systemPaths = [
              // Linux/Unix 系统路径
              '/etc/', '/sys/', '/proc/', '/dev/', '/root/', '/boot/',
              // macOS 系统路径
              '/System/', '/Library/', '/Applications/', '/usr/', '/bin/', '/sbin/',
              // Windows 系统路径
              'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
              'c:\\users\\public', 'c:\\users\\default'
            ];
            const hasSystemPath = systemPaths.some(p => description.includes(p.toLowerCase()));
            
            if (hasSystemPath) {
              return {
                passed: false,
                severity: 'warn',
                ruleId: 'file-operation',
                message: '检测到系统路径文件操作，需要确认',
                details: { systemPath: true }
              };
            }
          }

          return {
            passed: true,
            severity: 'info',
            ruleId: 'file-operation',
            message: '文件操作检查通过'
          };
        }
      },

      // 规则 7: 网络操作检查
      {
        id: 'network-operation',
        name: '网络操作检查',
        description: '检查网络操作是否可疑',
        enabled: true,
        severity: 'warn',
        check: (task, context) => {
          const description = task.description.toLowerCase();
          const isNetworkOp = /\b(fetch|download|curl|wget|http|api)\b/.test(description);
          
          if (isNetworkOp) {
            // 更精确的可疑文件扩展名检测（移除 python/script 等宽泛词）
            const suspiciousExtensions = ['exe', 'dll', 'app', 'deb', 'rpm', 'dmg', 'msi', 'bat', 'ps1'];
            const hasSuspicious = suspiciousExtensions.some(ext => {
              // 匹配 .ext 后跟空格、引号、斜杠、大于号，或字符串结尾
              const pattern = new RegExp(`\\.${ext}([\\s"'\\/>]|$)`, 'i');
              return pattern.test(description);
            });
            
            if (hasSuspicious) {
              return {
                passed: false,
                severity: 'warn',
                ruleId: 'network-operation',
                message: '检测到可疑的网络下载操作（可执行文件）',
                details: { suspicious: true }
              };
            }
          }

          return {
            passed: true,
            severity: 'info',
            ruleId: 'network-operation',
            message: '网络操作检查通过'
          };
        }
      }
    ];
  }

  private isDangerousTask(task: TaskRequest | TaskAnnouncement): boolean {
    const description = task.description.toLowerCase();
    
    // 检查关键词
    if (this.config.blockedKeywords.some(kw => description.includes(kw.toLowerCase()))) {
      return true;
    }
    
    // 检查模式
    if (this.config.dangerousPatterns.some(p => p.test(description))) {
      return true;
    }
    
    return false;
  }

  private getRecentTaskCount(peerId: string): number {
    const now = Date.now();
    const windowMs = this.config.maxTasksPerMinute ? 60000 : 60000;
    const windowStart = now - windowMs;
    
    const timestamps = this.recentTasks.get(peerId) || [];
    const recent = timestamps.filter(t => t > windowStart);
    
    // 更新存储
    this.recentTasks.set(peerId, recent);
    
    return recent.length;
  }

  private recordTask(peerId: string): void {
    const timestamps = this.recentTasks.get(peerId) || [];
    timestamps.push(Date.now());
    this.recentTasks.set(peerId, timestamps);
    
    // 优化：仅在超过阈值或定时触发时清理，而非每次都清理
    this.maybeCleanup();
  }

  /**
   * 条件触发清理：当条目数超过阈值或距上次清理超过间隔时执行
   */
  private maybeCleanup(): void {
    const now = Date.now();
    const shouldCleanup = 
      this.recentTasks.size > this.cleanupThreshold ||
      (now - this.lastCleanupTime) > this.cleanupIntervalMs;
    
    if (shouldCleanup) {
      this.cleanupRecentTasks();
      this.lastCleanupTime = now;
    }
  }

  /**
   * 清理过期的 recentTasks 条目，防止内存泄漏
   */
  private cleanupRecentTasks(): void {
    const now = Date.now();
    const windowMs = 60000; // 1分钟窗口
    
    for (const [key, timestamps] of this.recentTasks.entries()) {
      // 过滤掉过期的时间戳
      const validTimestamps = timestamps.filter(t => now - t < windowMs);
      if (validTimestamps.length === 0) {
        // 没有有效时间戳，删除整个条目
        this.recentTasks.delete(key);
      } else if (validTimestamps.length !== timestamps.length) {
        // 更新为有效的时间戳
        this.recentTasks.set(key, validTimestamps);
      }
    }
  }
}

// 导出单例
export const taskGuard = new TaskGuard();