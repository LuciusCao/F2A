/**
 * Plugin 入口测试
 * 
 * 测试 OpenClaw 插件注册函数，覆盖核心逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock F2APlugin before importing plugin
const mockPlugin = {
  initialize: vi.fn(),
  shutdown: vi.fn(),
  enable: vi.fn(),
  isInitialized: vi.fn().mockReturnValue(false),
  getTools: vi.fn().mockReturnValue([]),
};

vi.mock('../src/connector.js', () => ({
  F2APlugin: vi.fn(() => mockPlugin),
}));

// Import after mocking
import register from '../src/plugin.js';
import type { OpenClawPluginApi } from '../src/types.js';

describe('Plugin 入口', () => {
  let tempDir: string;
  let mockApi: OpenClawPluginApi;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'plugin-test-'));
    
    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );
    
    mockApi = {
      config: {
        agents: {
          defaults: {
            workspace: tempDir,
          },
        },
        plugins: {
          entries: {
            'openclaw-f2a': {
              config: {},
            },
          },
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      registerTool: vi.fn(),
      registerService: vi.fn(),
    };
    
    vi.clearAllMocks();
    mockPlugin.initialize.mockReset();
    mockPlugin.shutdown.mockReset();
    mockPlugin.enable.mockReset();
    mockPlugin.isInitialized.mockReset();
    mockPlugin.getTools.mockReset();
    mockPlugin.isInitialized.mockReturnValue(false);
    mockPlugin.getTools.mockReturnValue([]);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('register 函数', () => {
    it('应该能够注册插件', async () => {
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockPlugin.initialize).toHaveBeenCalled();
    });

    it('应该注册后台服务', async () => {
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockApi.registerService).toHaveBeenCalled();
    });

    it('应该记录初始化完成日志', async () => {
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('初始化完成')
      );
    });

    it('应该注册所有工具', async () => {
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_discover', description: 'Discover agents', parameters: {}, handler: vi.fn() },
        { name: 'f2a_delegate', description: 'Delegate task', parameters: {}, handler: vi.fn() },
      ]);
      
      await register(mockApi);
      
      // 每个工具应该被注册一次
      expect(mockApi.registerTool).toHaveBeenCalledTimes(2);
    });

    it('应该处理初始化失败', async () => {
      mockPlugin.initialize.mockRejectedValueOnce(new Error('Init failed'));
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockApi.logger?.error).toHaveBeenCalledWith(
        expect.stringContaining('初始化失败')
      );
      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('降级模式')
      );
    });

    it('应该处理初始化失败后清理资源', async () => {
      mockPlugin.initialize.mockRejectedValueOnce(new Error('Init failed'));
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockPlugin.shutdown).toHaveBeenCalled();
    });

    it('应该处理清理资源时的错误', async () => {
      mockPlugin.initialize.mockRejectedValueOnce(new Error('Init failed'));
      mockPlugin.shutdown.mockRejectedValueOnce(new Error('Shutdown error'));
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('清理资源时出错')
      );
    });
  });

  describe('工具执行', () => {
    it('应该注册可执行的工具', async () => {
      const mockHandler = vi.fn().mockResolvedValue('test result');
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      expect(toolConfig.name).toBe('f2a_test');
      expect(toolConfig.execute).toBeDefined();
    });

    it('应该在首次执行时启用适配器', async () => {
      const mockHandler = vi.fn().mockResolvedValue('test result');
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      mockPlugin.isInitialized.mockReturnValue(false);
      mockPlugin.enable.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      await toolConfig.execute('session-id', { param: 'value' });
      
      expect(mockPlugin.enable).toHaveBeenCalled();
    });

    it('应该处理启用失败', async () => {
      const mockHandler = vi.fn().mockResolvedValue('test result');
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      mockPlugin.isInitialized.mockReturnValue(false);
      mockPlugin.enable.mockRejectedValueOnce(new Error('Enable failed'));
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      await expect(toolConfig.execute('session-id', {})).rejects.toThrow('F2A Plugin 启用失败');
    });

    it('应该返回字符串结果', async () => {
      const mockHandler = vi.fn().mockResolvedValue('string result');
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      mockPlugin.isInitialized.mockReturnValue(true);
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      const result = await toolConfig.execute('session-id', {});
      
      expect(result).toEqual({ content: [{ type: 'text', text: 'string result' }] });
    });

    it('应该返回带 content 属性的对象结果', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ content: 'object result' });
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      mockPlugin.isInitialized.mockReturnValue(true);
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      const result = await toolConfig.execute('session-id', {});
      
      expect(result).toEqual({ content: [{ type: 'text', text: 'object result' }] });
    });

    it('应该返回 JSON 字符串化的其他结果', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ data: 'value' });
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      mockPlugin.isInitialized.mockReturnValue(true);
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      const result = await toolConfig.execute('session-id', {});
      
      expect(result).toEqual({ content: [{ type: 'text', text: '{"data":"value"}' }] });
    });

    it('应该处理工具执行错误', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      mockPlugin.getTools.mockReturnValue([
        { name: 'f2a_test', description: 'Test tool', parameters: {}, handler: mockHandler },
      ]);
      mockPlugin.isInitialized.mockReturnValue(true);
      
      await register(mockApi);
      
      const registerToolCall = (mockApi.registerTool as any).mock.calls[0];
      const toolConfig = registerToolCall[0];
      
      await expect(toolConfig.execute('session-id', {})).rejects.toThrow('Handler error');
      expect(mockApi.logger?.error).toHaveBeenCalled();
    });
  });

  describe('后台服务', () => {
    it('应该注册后台服务', async () => {
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockApi.registerService).toHaveBeenCalled();
      
      const serviceCall = (mockApi.registerService as any).mock.calls[0];
      const serviceConfig = serviceCall[0];
      
      expect(serviceConfig.id).toBe('f2a-plugin-service');
      expect(serviceConfig.start).toBeDefined();
      expect(serviceConfig.stop).toBeDefined();
    });

    it('服务 start 应该记录日志', async () => {
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      const serviceCall = (mockApi.registerService as any).mock.calls[0];
      const serviceConfig = serviceCall[0];
      
      serviceConfig.start();
      
      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('服务已启动')
      );
    });

    it('服务 stop 应该调用 shutdown', async () => {
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      const serviceCall = (mockApi.registerService as any).mock.calls[0];
      const serviceConfig = serviceCall[0];
      
      await serviceConfig.stop();
      
      expect(mockPlugin.shutdown).toHaveBeenCalled();
      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('服务已停止')
      );
    });

    it('autoStart 为 true 时应该启用 F2A', async () => {
      mockApi.config.plugins!.entries['openclaw-f2a'].config = { autoStart: true };
      mockPlugin.enable.mockResolvedValue(undefined);
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      const serviceCall = (mockApi.registerService as any).mock.calls[0];
      const serviceConfig = serviceCall[0];
      
      serviceConfig.start();
      
      // Wait for setImmediate
      await new Promise(resolve => setImmediate(resolve));
      
      expect(mockPlugin.enable).toHaveBeenCalled();
    });

    it('autoStart 为 false 时不应该启用 F2A', async () => {
      mockApi.config.plugins!.entries['openclaw-f2a'].config = { autoStart: false };
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      const serviceCall = (mockApi.registerService as any).mock.calls[0];
      const serviceConfig = serviceCall[0];
      
      serviceConfig.start();
      
      // Wait for setImmediate
      await new Promise(resolve => setImmediate(resolve));
      
      expect(mockPlugin.enable).not.toHaveBeenCalled();
    });

    it('启用失败应该记录警告', async () => {
      mockApi.config.plugins!.entries['openclaw-f2a'].config = { autoStart: true };
      mockPlugin.enable.mockRejectedValueOnce(new Error('Enable failed'));
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      const serviceCall = (mockApi.registerService as any).mock.calls[0];
      const serviceConfig = serviceCall[0];
      
      serviceConfig.start();
      
      // Wait for setImmediate
      await new Promise(resolve => setImmediate(resolve));
      
      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('F2A 实例启动失败')
      );
    });
  });

  describe('配置处理', () => {
    it('应该使用默认配置', async () => {
      mockApi.config.plugins = undefined as any;
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockPlugin.initialize).toHaveBeenCalled();
    });

    it('应该使用自定义配置', async () => {
      mockApi.config.plugins!.entries['openclaw-f2a'].config = {
        minReputation: 50,
        p2pPort: 4001,
      };
      mockPlugin.getTools.mockReturnValue([]);
      
      await register(mockApi);
      
      expect(mockPlugin.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          minReputation: 50,
          p2pPort: 4001,
        })
      );
    });
  });
});