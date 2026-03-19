/**
 * F2A OpenClaw Adapter Plugin
 * OpenClaw 插件标准入口
 * 
 * 架构重构：延迟初始化策略
 * - register() 只调用 initialize()，保存配置，不打开资源
 * - enable() 在插件真正被使用时调用，启动 WebhookServer 等
 * - 这允许 `openclaw gateway status` 等 CLI 命令能正常退出
 */

import type { OpenClawPluginApi } from './types.js';
import { F2AOpenClawAdapter } from './connector.js';

/**
 * OpenClaw 插件注册函数
 * 这是 OpenClaw 加载插件时调用的入口
 */
export default async function register(api: OpenClawPluginApi) {
  const plugin = new F2AOpenClawAdapter();
  
  // 从 OpenClaw 配置中获取插件配置
  const pluginsConfig = api.config.plugins;
  const config = pluginsConfig?.entries?.['openclaw-adapter']?.config || {};
  
  // 将 API 引用传递给插件（用于触发心跳等操作）
  const fullConfig = {
    ...config,
    _api: api
  };
  
  // 初始化插件 - 只保存配置，不启动服务
  try {
    await plugin.initialize(fullConfig);
    api.logger?.info('[F2A Adapter] 初始化完成（延迟模式）');
  } catch (error: any) {
    api.logger?.error(`[F2A Adapter] 初始化失败: ${error.message}`);
    
    // 清理已分配的资源，避免孤儿进程和端口占用
    try {
      api.logger?.info('[F2A Adapter] 正在清理资源...');
      await plugin.shutdown?.();
    } catch (shutdownError: any) {
      api.logger?.warn(`[F2A Adapter] 清理资源时出错: ${shutdownError.message}`);
    }
    
    // 不抛出异常，让插件以降级模式加载
    // 这样 Gateway 可以继续运行，只是 F2A 功能不可用
    api.logger?.warn('[F2A Adapter] 插件将以降级模式运行，功能受限');
    return; // 直接返回，不注册工具
  }
  
  // 初始化完成后注册所有工具
  // OpenClaw 的 registerTool 需要 execute 方法
  const tools = plugin.getTools();
  for (const tool of tools) {
    api.registerTool?.({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      // OpenClaw 使用 execute 而不是 handler
      async execute(_id: string, params: unknown) {
        // 首次使用工具时，启用适配器（启动 WebhookServer 等）
        if (!plugin.isInitialized()) {
          api.logger?.info('[F2A Adapter] 首次使用工具，启用适配器...');
          try {
            await plugin.enable();
          } catch (enableError: any) {
            api.logger?.error(`[F2A Adapter] 启用失败: ${enableError.message}`);
            throw new Error(`F2A Adapter 启用失败: ${enableError.message}`);
          }
        }
        
        try {
          // 构造一个模拟的 SessionContext
          const workspace = api.config.agents?.defaults?.workspace || '.';
          const mockContext = {
            sessionId: _id,
            workspace,
            toJSON: () => ({})
          };
          
          const result = await tool.handler(params as Record<string, unknown>, mockContext);
          
          // 将 ToolResult 转换为 OpenClaw 期望的格式
          if (typeof result === 'string') {
            return { content: [{ type: 'text', text: result }] };
          }
          
          if (result?.content) {
            return { content: [{ type: 'text', text: result.content }] };
          }
          
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error: any) {
          api.logger?.error(`[F2A Adapter] 工具 ${tool.name} 执行失败: ${error.message}`);
          throw error;
        }
      }
    });
  }
  
  // 注册后台服务（用于清理资源）
  api.registerService?.({
    id: 'f2a-adapter-service',
    start: () => {
      api.logger?.info('[F2A Adapter] 服务已启动');
    },
    stop: async () => {
      api.logger?.info('[F2A Adapter] 正在停止服务...');
      await plugin.shutdown?.();
    }
  });
  
  api.logger?.info(`[F2A Adapter] 已注册 ${tools.length} 个工具（延迟初始化模式）`);
}

// 重新导出主要类，供外部使用
export { F2AOpenClawAdapter } from './connector.js';
export * from './types.js';
export { TaskQueue, QueuedTask, TaskQueueStats } from './task-queue.js';
export { AnnouncementQueue, AnnouncementQueueStats } from './announcement-queue.js';
export { TaskGuard, TaskGuardReport, TaskGuardRule, TaskGuardConfig, taskGuard } from './task-guard.js';