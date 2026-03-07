/**
 * F2A OpenClaw Adapter Plugin
 * OpenClaw 插件标准入口
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pluginsConfig = (api.config as any)?.plugins;
  const config = pluginsConfig?.entries?.['f2a-openclaw-adapter']?.config || {};
  
  // 将 API 引用传递给插件（用于触发心跳等操作）
  const fullConfig = {
    ...config,
    _api: api
  };
  
  // 初始化插件 - 等待完成后再注册工具
  try {
    await plugin.initialize(fullConfig);
    api.logger?.info('[F2A Adapter] 初始化完成');
  } catch (error: any) {
    api.logger?.error(`[F2A Adapter] 初始化失败: ${error.message}`);
    
    // 清理已分配的资源，避免孤儿进程和端口占用
    try {
      api.logger?.info('[F2A Adapter] 正在清理资源...');
      await plugin.shutdown?.();
    } catch (shutdownError: any) {
      api.logger?.warn(`[F2A Adapter] 清理资源时出错: ${shutdownError.message}`);
    }
    
    // 抛出错误让 OpenClaw 知道插件加载失败
    throw new Error(`F2A Adapter 初始化失败: ${error.message}`);
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
      async execute(_id: string, params: any) {
        try {
          // 构造一个模拟的 SessionContext
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const workspace = (api.config as any)?.agents?.defaults?.workspace || '.';
          const mockContext = {
            sessionId: _id,
            workspace,
            toJSON: () => ({})
          };
          
          const result = await tool.handler(params, mockContext);
          
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
  
  api.logger?.info(`[F2A Adapter] 已注册 ${tools.length} 个工具`);
}

// 重新导出主要类，供外部使用
export { F2AOpenClawAdapter } from './connector.js';
export * from './types.js';
export { TaskQueue, QueuedTask, TaskQueueStats } from './task-queue.js';
export { AnnouncementQueue, AnnouncementQueueStats } from './announcement-queue.js';
export { TaskGuard, TaskGuardReport, TaskGuardRule, TaskGuardConfig } from './task-guard.js';