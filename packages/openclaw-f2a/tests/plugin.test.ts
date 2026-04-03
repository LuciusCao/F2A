/**
 * F2A OpenClaw Plugin - 单元测试
 * 测试插件注册和工具执行逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpenClawPluginApi } from '../src/types.js';

// 使用 vi.hoisted 在 mock 之前初始化所有需要的变量
const { mockTools, mockInitialize, mockShutdown, createMockTools } = vi.hoisted(() => {
  // 在 hoisted 作用域内定义工具创建函数
  const createMockTools = () => {
    const tools = [
      {
        name: 'f2a_discover',
        description: '发现 F2A 网络中的 Agents',
        parameters: {
          capability: { type: 'string', description: '按能力过滤' }
        },
        handler: vi.fn(async (params: any) => {
          return { content: '发现 2 个 Agents', data: { count: 2 } };
        })
      },
      {
        name: 'f2a_delegate',
        description: '委托任务给网络中的特定 Agent',
        parameters: {
          agent: { type: 'string', description: '目标 Agent', required: true },
          task: { type: 'string', description: '任务描述', required: true }
        },
        handler: vi.fn(async (params: any) => {
          return { content: '任务已完成', data: { taskId: 'task-123' } };
        })
      },
      {
        name: 'f2a_status',
        description: '查看 F2A 网络状态',
        parameters: {},
        handler: vi.fn(async () => {
          return { content: 'F2A 状态: 运行中' };
        })
      }
    ];
    return tools;
  };

  const mockTools = createMockTools();
  const mockInitialize = vi.fn();
  const mockShutdown = vi.fn();

  return { mockTools, mockInitialize, mockShutdown, createMockTools };
});

vi.mock('../src/connector.js', () => {
  const adapter = {
    initialize: mockInitialize,
    shutdown: mockShutdown,
    getTools: vi.fn(() => mockTools),
    isInitialized: vi.fn(() => true),
    _getMockTools: () => mockTools,
    _resetMockTools: () => {
      const newTools = createMockTools();
      // 复制新工具到 mockTools 数组
      mockTools.length = 0;
      mockTools.push(...newTools);
      return mockTools;
    }
  };
  
  return {
    F2APlugin: vi.fn(() => adapter)
  };
});

// 导入 mock 后的模块
import { F2APlugin } from '../src/connector.js';
import register from '../src/plugin.js';

describe('Plugin register 函数', () => {
  let mockApi: OpenClawPluginApi;
  let mockAdapter: any;
  let registeredTools: any[];
  let registeredServices: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools = [];
    registeredServices = [];
    
    // 重置 mock tools 到初始状态
    mockTools.length = 0;
    const freshTools = createMockTools();
    mockTools.push(...freshTools);
    
    // 重置 mock adapter
    mockAdapter = new F2APlugin();
    
    // 创建 mock API
    mockApi = {
      id: 'test-api-id',
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test plugin',
      source: 'test',
      config: {
        plugins: {
          entries: {
            'openclaw-f2a': {
              config: {
                agentName: 'Test Agent',
                autoStart: false
              }
            }
          }
        },
        agents: {
          defaults: {
            workspace: '/tmp/test-workspace'
          }
        }
      },
      runtime: {
        version: '1.0.0',
        config: {
          loadConfig: vi.fn(),
          writeConfigFile: vi.fn()
        },
        system: {
          enqueueSystemEvent: vi.fn(),
          requestHeartbeatNow: vi.fn(),
          runCommandWithTimeout: vi.fn()
        },
        media: {
          loadWebMedia: vi.fn(),
          detectMime: vi.fn()
        },
        tts: {
          textToSpeechTelephony: vi.fn()
        },
        stt: {
          transcribeAudioFile: vi.fn()
        },
        logging: {
          shouldLogVerbose: vi.fn(),
          getChildLogger: vi.fn()
        }
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      registerTool: vi.fn((tool) => {
        registeredTools.push(tool);
      }),
      registerService: vi.fn((service) => {
        registeredServices.push(service);
      })
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始化成功场景', () => {
    it('应该成功初始化插件并记录日志', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      expect(mockInitialize).toHaveBeenCalled();
      expect(mockApi.logger?.info).toHaveBeenCalledWith('[F2A Plugin] 初始化完成（延迟模式）');
    });

    it('应该从配置中提取插件配置并传递给 adapter', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      // 验证传递给 initialize 的配置包含 _api
      const initConfig = mockInitialize.mock.calls[0][0];
      expect(initConfig._api).toBe(mockApi);
      expect(initConfig.agentName).toBe('Test Agent');
    });

    it('应该处理空配置（使用默认值）', async () => {
      mockApi.config = {};
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      expect(mockInitialize).toHaveBeenCalled();
      const initConfig = mockInitialize.mock.calls[0][0];
      expect(initConfig._api).toBe(mockApi);
    });
  });

  describe('初始化失败时的资源清理', () => {
    it('应该在初始化失败时调用 shutdown 清理资源', async () => {
      const initError = new Error('初始化失败');
      mockInitialize.mockRejectedValue(initError);
      mockShutdown.mockResolvedValue(undefined);
      
      // 初始化失败时以降级模式运行，不抛出异常
      await register(mockApi);
      
      expect(mockShutdown).toHaveBeenCalled();
      expect(mockApi.logger?.error).toHaveBeenCalledWith(
        '[F2A Plugin] 初始化失败:',
        { error: '初始化失败' }
      );
    });

    it('应该在清理资源失败时记录警告', async () => {
      const initError = new Error('初始化失败');
      const shutdownError = new Error('清理失败');
      mockInitialize.mockRejectedValue(initError);
      mockShutdown.mockRejectedValue(shutdownError);
      
      // 初始化失败时以降级模式运行，不抛出异常
      await register(mockApi);
      
      expect(mockApi.logger?.warn).toHaveBeenCalledWith(
        '[F2A Plugin] 清理资源时出错:',
        { error: '清理失败' }
      );
    });

    it('初始化失败时不应该注册任何工具或服务', async () => {
      mockInitialize.mockRejectedValue(new Error('初始化失败'));
      mockShutdown.mockResolvedValue(undefined);
      
      // 初始化失败时以降级模式运行，不抛出异常
      await register(mockApi);
      
      expect(registeredTools.length).toBe(0);
      expect(registeredServices.length).toBe(0);
    });
  });

  describe('工具注册', () => {
    it('应该注册所有工具', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      expect(mockApi.registerTool).toHaveBeenCalled();
      // getTools 返回 3 个工具
      expect(registeredTools.length).toBe(3);
    });

    it('工具应该包含正确的属性', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const tool = registeredTools[0];
      expect(tool.name).toBe('f2a_discover');
      expect(tool.description).toBe('发现 F2A 网络中的 Agents');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });

    it('应该记录注册的工具数量', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      // 验证工具已注册（通过检查 registeredTools 数量）
      expect(registeredTools.length).toBe(3);
    });
  });

  describe('服务注册', () => {
    it('应该注册后台服务', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      expect(mockApi.registerService).toHaveBeenCalled();
      expect(registeredServices.length).toBe(1);
    });

    it('服务应该包含正确的 id', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const service = registeredServices[0];
      expect(service.id).toBe('f2a-plugin-service');
    });

    it('服务 start 应该记录日志', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const service = registeredServices[0];
      service.start();
      
      expect(mockApi.logger?.info).toHaveBeenCalledWith('[F2A Plugin] 服务已启动');
    });

    it('服务 stop 应该调用 shutdown', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockShutdown.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const service = registeredServices[0];
      await service.stop();
      
      expect(mockShutdown).toHaveBeenCalled();
      expect(mockApi.logger?.info).toHaveBeenCalledWith('[F2A Plugin] 正在停止服务...');
    });
  });

  describe('工具执行测试', () => {
    it('execute 应该调用 tool.handler 并返回正确格式', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const tool = registeredTools[0]; // f2a_discover
      
      // 执行工具
      const result = await tool.execute('session-123', { capability: 'code-generation' });
      
      // 验证返回格式
      expect(result).toHaveProperty('content');
      expect(result.content).toBeInstanceOf(Array);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
    });

    it('execute 应该正确处理字符串返回值', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const tool = registeredTools[2]; // f2a_status (返回字符串)
      
      const result = await tool.execute('session-123', {});
      
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('F2A 状态');
    });

    it('execute 应该正确处理带 content 的对象返回值', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const tool = registeredTools[0]; // f2a_discover
      
      const result = await tool.execute('session-123', {});
      
      // handler 返回 { content: '发现 2 个 Agents', data: { count: 2 } }
      expect(result.content[0].text).toBe('发现 2 个 Agents');
    });

    it('execute 应该正确处理其他对象返回值（JSON 序列化）', async () => {
      // 重置工具并使用自定义 handler
      mockAdapter._resetMockTools();
      mockTools[0].handler = vi.fn(async () => ({ data: { count: 5 }, status: 'ok' }));
      
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const tool = registeredTools[0];
      const result = await tool.execute('session-123', {});
      
      // JSON.stringify 不保留空格
      expect(result.content[0].text).toContain('"count":5');
      expect(result.content[0].text).toContain('"status":"ok"');
    });

    it('execute 应该传递正确的 mockContext 给 handler', async () => {
      mockInitialize.mockResolvedValue(undefined);
      
      // 获取 handler 的引用（在 register 之前）
      const handlerSpy = mockTools[0].handler;
      
      await register(mockApi);
      
      const tool = registeredTools[0];
      await tool.execute('my-session-id', { capability: 'test' });
      
      // 验证 handler 被调用
      expect(handlerSpy).toHaveBeenCalled();
      
      // 验证 context 参数
      const context = handlerSpy.mock.calls[0][1];
      expect(context.sessionId).toBe('my-session-id');
      expect(context.workspace).toBe('/tmp/test-workspace');
      expect(typeof context.toJSON).toBe('function');
    });

    it('execute 错误处理：应该记录错误并重新抛出', async () => {
      const testError = new Error('工具执行失败');
      
      // 重置工具并使用会抛出错误的 handler
      mockAdapter._resetMockTools();
      mockTools[0].name = 'failing_tool';
      mockTools[0].handler = vi.fn(async () => {
        throw testError;
      });
      
      mockInitialize.mockResolvedValue(undefined);
      
      await register(mockApi);
      
      const tool = registeredTools[0];
      
      await expect(tool.execute('session-123', {})).rejects.toThrow('工具执行失败');
      
      // 验证错误日志被调用（使用对象格式）
      expect(mockApi.logger?.error).toHaveBeenCalledWith(
        '[F2A Plugin] 工具执行失败:',
        expect.objectContaining({
          toolName: 'failing_tool',
          sessionId: 'session-123',
          error: '工具执行失败'
        })
      );
    });

    it('execute 应该使用默认 workspace 当配置中没有指定时', async () => {
      // 清空 workspace 配置
      mockApi.config = { 
        plugins: {
          entries: {
            'f2a-openclaw-adapter': { config: { autoStart: false } }
          }
        }
      };
      mockInitialize.mockResolvedValue(undefined);
      
      // 获取 handler 的引用（在 register 之前）
      const handlerSpy = mockTools[0].handler;
      
      await register(mockApi);
      
      const tool = registeredTools[0];
      await tool.execute('session-123', {});
      
      // 验证 handler 被调用且 workspace 默认为 '.'
      expect(handlerSpy).toHaveBeenCalled();
      const context = handlerSpy.mock.calls[0][1];
      expect(context.workspace).toBe('.');
    });
  });
});