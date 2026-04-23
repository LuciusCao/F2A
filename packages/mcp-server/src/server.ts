/**
 * F2A MCP Server 核心实现
 *
 * 封装 Model Context Protocol Server，注册所有 F2A Tools。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  pollMessagesTool,
  sendMessageTool,
  clearMessagesTool,
  handlePollMessages,
  handleSendMessage,
  handleClearMessages,
} from './tools/messaging.js';

import {
  listAgentsTool,
  getAgentStatusTool,
  handleListAgents,
  handleGetAgentStatus,
} from './tools/discovery.js';

/**
 * 所有已注册的 MCP Tools
 */
const ALL_TOOLS = [
  pollMessagesTool,
  sendMessageTool,
  clearMessagesTool,
  listAgentsTool,
  getAgentStatusTool,
];

/**
 * Tool 名称到 handler 的映射
 */
const TOOL_HANDLERS: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  [pollMessagesTool.name]: handlePollMessages as unknown as (
    args: Record<string, unknown>
  ) => Promise<string>,
  [sendMessageTool.name]: handleSendMessage as unknown as (
    args: Record<string, unknown>
  ) => Promise<string>,
  [clearMessagesTool.name]: handleClearMessages as unknown as (
    args: Record<string, unknown>
  ) => Promise<string>,
  [listAgentsTool.name]: handleListAgents as unknown as (
    args: Record<string, unknown>
  ) => Promise<string>,
  [getAgentStatusTool.name]: handleGetAgentStatus as unknown as (
    args: Record<string, unknown>
  ) => Promise<string>,
};

/** F2A MCP Server 选项 */
export interface F2AMcpServerOptions {
  /** Daemon 控制端口（默认从环境变量读取） */
  controlPort?: number;
  /** 默认 Agent ID */
  defaultAgentId?: string | null;
}

/** 内部使用的完整选项 */
interface ResolvedServerOptions {
  controlPort: number;
  defaultAgentId: string | null;
}

/**
 * F2A MCP Server 类
 */
export class F2AMcpServer {
  private server: Server;
  private transport?: StdioServerTransport;
  private options: ResolvedServerOptions;

  constructor(options: F2AMcpServerOptions = {}) {
    this.options = {
      controlPort: options.controlPort ?? parseInt(process.env.F2A_CONTROL_PORT || '9001'),
      defaultAgentId: options.defaultAgentId ?? process.env.F2A_AGENT_ID ?? null,
    };

    this.server = new Server(
      {
        name: 'f2a-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  /**
   * 注册所有请求处理器
   */
  private registerHandlers(): void {
    // 处理 tools/list 请求
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: ALL_TOOLS,
      };
    });

    // 处理 tools/call 请求
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = TOOL_HANDLERS[name];

      if (!handler) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ 未知 Tool：${name}。可用 Tools：${Object.keys(TOOL_HANDLERS).join(', ')}`,
            },
          ],
        };
      }

      try {
        const result = await handler((args as Record<string, unknown>) ?? {});
        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Tool 执行失败：${message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 启动 MCP Server（stdio 传输）
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    console.error('[F2A MCP] Server started via stdio');
  }

  /**
   * 关闭 MCP Server
   */
  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
    console.error('[F2A MCP] Server stopped');
  }
}
