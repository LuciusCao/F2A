/**
 * Logger 单元测试
 * 测试日志级别、文件日志、重试机制等功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from './logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('Logger', () => {
  let testLogFile: string;

  beforeEach(() => {
    // 创建临时日志文件路径
    testLogFile = path.join(tmpdir(), `f2a-logger-test-${Date.now()}.log`);
  });

  afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(testLogFile)) {
      fs.unlinkSync(testLogFile);
    }
  });

  describe('日志级别控制', () => {
    it('应该只输出等于或高于设定级别的日志', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ level: 'WARN', enableFile: false });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      // 只应该有 WARN 和 ERROR 被输出
      const calls = consoleSpy.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      
      const output = calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('warn message');
      expect(output).toContain('error message');
      expect(output).not.toContain('debug message');
      expect(output).not.toContain('info message');

      consoleSpy.mockRestore();
    });

    it('应该支持动态修改日志级别', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ level: 'ERROR', enableFile: false });

      logger.warn('warn before change');
      logger.setLevel('DEBUG');
      logger.debug('debug after change');

      const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).not.toContain('warn before change');
      expect(output).toContain('debug after change');

      consoleSpy.mockRestore();
    });

    it('应该能够获取当前日志级别', () => {
      const logger = new Logger({ level: 'INFO' });
      expect(logger.getLevel()).toBe('INFO');
      
      logger.setLevel('DEBUG');
      expect(logger.getLevel()).toBe('DEBUG');
    });
  });

  describe('控制台输出', () => {
    it('应该默认启用控制台输出', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ enableFile: false });

      logger.info('test message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('应该支持禁用控制台输出', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ enableConsole: false, enableFile: false });

      logger.info('test message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('开发环境应该使用人类可读格式', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ 
        component: 'TestComponent',
        enableFile: false,
        jsonMode: false 
      });

      logger.info('test message', { key: 'value' });

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      expect(output).toContain('[TestComponent]');
      expect(output).toContain('[INFO]');
      expect(output).toContain('test message');

      consoleSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    });

    it('生产环境应该使用 JSON 格式', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ 
        component: 'TestComponent',
        enableFile: false,
        jsonMode: true 
      });

      logger.info('test message', { key: 'value' });

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('INFO');
      expect(parsed.msg).toBe('test message');
      expect(parsed.component).toBe('TestComponent');
      expect(parsed.key).toBe('value');
      expect(parsed.timestamp).toBeDefined();

      consoleSpy.mockRestore();
    });
  });

  describe('文件日志', () => {
    it('应该能够写入日志文件', async () => {
      const logger = new Logger({
        component: 'TestComponent',
        enableConsole: false,
        enableFile: true,
        filePath: testLogFile
      });

      logger.info('test message 1');
      logger.error('test message 2', { error: 'test error' });

      // 等待文件写入
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(fs.existsSync(testLogFile)).toBe(true);
      const content = fs.readFileSync(testLogFile, 'utf-8');
      expect(content).toContain('test message 1');
      expect(content).toContain('test message 2');

      logger.close();
    });

    it('应该自动创建日志目录', async () => {
      const nestedPath = path.join(tmpdir(), `f2a-test-${Date.now()}`, 'nested', 'logger.log');
      
      const logger = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: nestedPath
      });

      logger.info('test message');

      // 等待文件写入
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(fs.existsSync(nestedPath)).toBe(true);

      logger.close();
      
      // 清理
      fs.unlinkSync(nestedPath);
      fs.rmdirSync(path.dirname(nestedPath));
      fs.rmdirSync(path.dirname(path.dirname(nestedPath)));
    });

    it('应该支持追加模式写入', async () => {
      // 先写入一些内容
      const logger1 = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: testLogFile
      });
      logger1.info('first message');
      
      // 等待文件写入完成
      await new Promise(resolve => setTimeout(resolve, 100));
      logger1.close();

      // 再次打开并写入
      const logger2 = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: testLogFile
      });
      logger2.info('second message');
      
      // 等待文件写入完成
      await new Promise(resolve => setTimeout(resolve, 100));
      logger2.close();

      expect(fs.existsSync(testLogFile)).toBe(true);
      const content = fs.readFileSync(testLogFile, 'utf-8');
      expect(content).toContain('first message');
      expect(content).toContain('second message');
    });

    it('应该支持启用/禁用文件日志', async () => {
      const logger = new Logger({
        enableConsole: false,
        enableFile: false
      });

      logger.info('no file message');
      expect(fs.existsSync(testLogFile)).toBe(false);

      // 启用文件日志
      logger.setFileLogging(true, testLogFile);
      
      // 等待初始化
      await new Promise(resolve => setTimeout(resolve, 100));
      
      logger.info('file message');
      
      // 等待写入
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(fs.existsSync(testLogFile)).toBe(true);

      logger.close();
    });
  });

  describe('重试机制', () => {
    it('应该使用指数退避策略进行重试', async () => {
      // 这个测试验证重试配置被正确设置
      const logger = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: testLogFile,
        maxRetries: 3,
        retryDelayMs: 100
      });

      // 验证内部配置
      expect((logger as any).maxRetries).toBe(3);
      expect((logger as any).retryDelayMs).toBe(100);

      logger.close();
    });

    it('应该在超过最大重试次数后禁用文件日志', async () => {
      // 使用无效路径触发错误
      const invalidPath = '/invalid/path/that/does/not/exist/logger.log';
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: invalidPath,
        maxRetries: 1,
        retryDelayMs: 10
      });

      // 等待重试完成
      await new Promise(resolve => setTimeout(resolve, 200));

      // 文件日志应该被禁用
      expect((logger as any).enableFile).toBe(false);

      consoleSpy.mockRestore();
      logger.close();
    });
  });

  describe('子日志记录器', () => {
    it('应该创建带有正确组件名的子日志记录器', () => {
      const parent = new Logger({ component: 'Parent' });
      const child = parent.child('Child');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      child.info('test message');

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      expect(output).toContain('Parent:Child');

      consoleSpy.mockRestore();
      parent.close();
      child.close();
    });

    it('子日志记录器应该继承父级配置', () => {
      const parent = new Logger({ 
        component: 'Parent',
        level: 'WARN',
        enableConsole: false,
        jsonMode: true
      });
      const child = parent.child('Child');

      expect(child.getLevel()).toBe('WARN');
      expect((child as any).enableConsole).toBe(false);
      expect((child as any).jsonMode).toBe(true);

      parent.close();
      child.close();
    });
  });

  describe('资源清理', () => {
    it('close() 应该正确关闭文件流', async () => {
      const logger = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: testLogFile
      });

      logger.info('test message');
      
      // 等待写入
      await new Promise(resolve => setTimeout(resolve, 50));

      expect((logger as any).fileStream).toBeDefined();

      logger.close();

      expect((logger as any).fileStream).toBeUndefined();
    });

    it('多次调用 close() 不应该抛出异常', async () => {
      const logger = new Logger({
        enableConsole: false,
        enableFile: true,
        filePath: testLogFile
      });

      logger.close();
      expect(() => logger.close()).not.toThrow();
    });
  });

  describe('日志级别方法', () => {
    it('debug() 应该在 DEBUG 级别启用时输出', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ level: 'DEBUG', enableFile: false });

      logger.debug('debug message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('info() 应该在 INFO 级别启用时输出', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ level: 'INFO', enableFile: false });

      logger.info('info message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('warn() 应该在 WARN 级别启用时输出', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ level: 'WARN', enableFile: false });

      logger.warn('warn message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('error() 应该始终输出', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ level: 'ERROR', enableFile: false });

      logger.error('error message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('元数据支持', () => {
    it('应该支持在日志中添加元数据', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ enableFile: false, jsonMode: true });

      logger.info('test message', { userId: '123', action: 'login' });

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      const parsed = JSON.parse(output);
      expect(parsed.userId).toBe('123');
      expect(parsed.action).toBe('login');

      consoleSpy.mockRestore();
    });

    it('应该支持复杂元数据对象', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({ enableFile: false, jsonMode: true });

      logger.error('error occurred', {
        error: {
          code: 'E001',
          message: 'Something went wrong'
        },
        context: {
          user: 'test',
          action: 'delete'
        }
      });

      const output = consoleSpy.mock.calls[0]?.[0] || '';
      const parsed = JSON.parse(output);
      expect(parsed.error.code).toBe('E001');
      expect(parsed.context.user).toBe('test');

      consoleSpy.mockRestore();
    });
  });
});
