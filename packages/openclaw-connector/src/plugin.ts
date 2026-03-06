/**
 * F2A OpenClaw Connector Plugin
 * OpenClaw 插件标准入口
 */

import { F2AOpenClawConnector } from './connector.js';

/**
 * OpenClaw 插件注册函数
 * 这是 OpenClaw 加载插件时调用的入口
 */
export default async function register(api: any) {
  const plugin = new F2AOpenClawConnector();
  
  // 从 OpenClaw 配置中获取插件配置
  const config = api.config?.plugins?.entries?.['f2a-openclaw-connector']?.config || {};
  
  // 添加 openclaw 会话引用到配置
  const fullConfig = {
    ...config,
    openclaw: api.openclaw || api.session
  };
  
  // 初始化插件 - 等待完成后再注册工具
  try {
    await plugin.initialize(fullConfig);
    api.logger?.info?.('[F2A Plugin] 初始化完成');
  } catch (error: any) {
    api.logger?.error?.('[F2A Plugin] 初始化失败:', error.message);
    // 抛出错误让 OpenClaw 知道插件加载失败
    throw new Error(`F2A Plugin 初始化失败: ${error.message}`);
  }
  
  // 初始化完成后注册所有工具
  const tools = plugin.getTools();
  for (const tool of tools) {
    api.registerTool?.({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      handler: async (params: any, context: any) => {
        // 确保插件已完全初始化
        try {
          return await tool.handler(params, context);
        } catch (error: any) {
          api.logger?.error?.(`[F2A Plugin] 工具 ${tool.name} 执行失败:`, error.message);
          throw error;
        }
      }
    });
  }
  
  // 注册后台服务（用于清理资源）
  api.registerService?.({
    id: 'f2a-connector-service',
    start: () => {
      api.logger?.info?.('[F2A Plugin] 服务已启动');
    },
    stop: async () => {
      api.logger?.info?.('[F2A Plugin] 正在停止服务...');
      await plugin.shutdown?.();
    }
  });
  
  api.logger?.info?.(`[F2A Plugin] 已注册 ${tools.length} 个工具`);
}

// 重新导出主要类，供外部使用
export { F2AOpenClawConnector } from './connector.js';
export * from './types.js';
