/**
 * F2A OpenClaw Plugin
 * OpenClaw 插件标准入口
 *
 * 架构说明:
 * - register() 只调用 initialize(),保存配置,不打开资源
 * - registerService() 注册后台服务,在 Gateway 启动后异步启用 F2A
 * - 使用 setImmediate() 避免阻塞 Gateway 启动
 * - 所有网络资源和定时器都使用 unref(),确保 Gateway 可以正常退出
 */

import type { OpenClawPluginApi } from './types.js';
import { F2APlugin } from './connector.js';

/** 全局单例 - 防止重复创建插件实例 */
let _pluginInstance: F2APlugin | null = null;

/** 记录创建实例的进程 PID,用于检测 Gateway 是否重启 */
let _instancePid: number | null = null;

/**
 * OpenClaw 插件注册函数
 * 这是 OpenClaw 加载插件时调用的入口
 * 
 * ⚠️ 重要：必须是同步函数，不能是 async！
 * Gateway 不支持异步插件注册，async register() 会被忽略。
 * 
 * ⚠️ Gateway 可能会多次调用 register()，每次都应该重新注册工具和服务。
 * 不使用单例检测，让 Gateway 自己处理重复注册。
 */
export default function register(api: OpenClawPluginApi) {
  // 不使用单例，每次都重新注册
  // Gateway 可能多次调用 register，每次都应该注册工具和服务
  const plugin = new F2APlugin();
  
  // 从 OpenClaw 配置中获取插件配置
  const pluginsConfig = api.config.plugins;
  const config = pluginsConfig?.entries?.['openclaw-f2a']?.config || {}; 
  
  // 将 API 引用传递给插件（用于触发心跳等操作）
  const fullConfig = {
    ...config,
    _api: api
  };

  // 初始化插件 - 同步保存配置，不启动服务
  // ⚠️ 重要：initialize() 必须同步完成，不能 await
  // 异步启动移到 registerService.start() 中
  plugin.initialize(fullConfig);
  api.logger?.info('[F2A Plugin] 初始化完成（延迟模式）');

  // 注册所有工具
  const tools = plugin.getTools();
  for (const tool of tools) {
    api.registerTool?.({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(sessionId: string, params: unknown) {
        const toolName = tool.name;
        const startTime = Date.now();

        // 确保适配器已启用
        if (!plugin.isInitialized()) {
          api.logger?.info('[F2A Plugin] 首次使用工具，启用适配器...', { toolName, sessionId });
          try {
            await plugin.enable();
          } catch (enableError: any) {
            api.logger?.error('[F2A Plugin] 启用失败:', { toolName, sessionId, error: enableError.message });
            throw new Error(`F2A Plugin 启用失败: ${enableError.message}`);
          }
        }

        // 记录工具执行开始
        api.logger?.info('[F2A Plugin] 工具执行开始:', { toolName, sessionId });

        try {
          const workspace = api.config.agents?.defaults?.workspace || '.';
          const mockContext = {
            sessionId,
            workspace,
            toJSON: () => ({})
          };

          const result = await tool.handler(params as Record<string, unknown>, mockContext);

          // 记录工具执行完成
          const duration = Date.now() - startTime;
          api.logger?.info('[F2A Plugin] 工具执行完成:', {
            toolName,
            sessionId,
            duration: `${duration}ms`,
            success: true
          });

          if (typeof result === 'string') {
            return { content: [{ type: 'text', text: result }] };
          }

          if (result?.content) {
            return { content: [{ type: 'text', text: result.content }] };
          }

          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error: any) {
          // 记录工具执行失败
          const duration = Date.now() - startTime;
          api.logger?.error('[F2A Plugin] 工具执行失败:', {
            toolName,
            sessionId,
            duration: `${duration}ms`,
            error: error.message,
            stack: error.stack
          });
          throw error;
        }
      }
    });
  }

  // 注册后台服务
  // 使用 setImmediate 异步启动 F2A,避免阻塞 Gateway
  api.registerService?.({
    id: 'f2a-plugin-service',
    start: () => {
      api.logger?.info('[F2A Plugin] 服务已启动');

      // 使用 setImmediate 在下一个事件循环中启动 F2A
      // 这样不会阻塞 Gateway 的启动流程
      setImmediate(async () => {
        try {
          // 检查是否配置了 autoStart(默认 true)
          const autoStart = config.autoStart !== false;

          if (autoStart) {
            api.logger?.info('[F2A Plugin] 正在启用 F2A 实例(后台模式)...');
            await plugin.enable();
            api.logger?.info('[F2A Plugin] F2A 实例已启用');
          }
        } catch (error: any) {
          // 启动失败不影响 Gateway 运行
          api.logger?.warn('[F2A Plugin] F2A 实例启动失败:', { error: error.message });
          api.logger?.warn('[F2A Plugin] P2P 功能将不可用,但 Gateway 可继续运行');
        }
      });
    },
    stop: async () => {
      api.logger?.info('[F2A Plugin] 正在停止服务...');
      await plugin.shutdown?.();
      api.logger?.info('[F2A Plugin] 服务已停止');
    }
  });

  api.logger?.info('[F2A Plugin] 已注册工具:', { count: tools.length, mode: '延迟初始化' });
}

// 重新导出主要类,供外部使用
export { F2APlugin } from './connector.js';
export * from './types.js';
export { TaskQueue, QueuedTask, TaskQueueStats } from './task-queue.js';
export { AnnouncementQueue, AnnouncementQueueStats } from './announcement-queue.js';
export { TaskGuard, TaskGuardReport, TaskGuardRule, TaskGuardConfig, taskGuard } from './task-guard.js';