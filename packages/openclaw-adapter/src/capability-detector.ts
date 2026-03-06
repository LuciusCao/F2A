/**
 * OpenClaw 能力检测器
 * 提供默认能力列表（外部插件无法动态检测 OpenClaw 内部能力）
 */

import type { AgentCapability, ParameterSchema } from './types.js';

export interface OpenClawCapabilities {
  tools: string[];
  skills: string[];
}

export class CapabilityDetector {
  /**
   * 获取默认能力列表
   * 外部插件无法直接访问 OpenClaw 内部，使用预定义的能力列表
   */
  getDefaultCapabilities(): AgentCapability[] {
    return [
      {
        name: 'file-operation',
        description: 'Read and write files on the local system',
        tools: ['read', 'write', 'edit', 'list'],
        parameters: {
          action: {
            type: 'string',
            description: 'Action to perform: read, write, edit, list',
            required: true
          },
          path: {
            type: 'string',
            description: 'File or directory path',
            required: true
          }
        }
      },
      {
        name: 'command-execution',
        description: 'Execute shell commands',
        tools: ['exec', 'bash'],
        parameters: {
          command: {
            type: 'string',
            description: 'Shell command to execute',
            required: true
          },
          cwd: {
            type: 'string',
            description: 'Working directory',
            required: false
          }
        }
      },
      {
        name: 'web-browsing',
        description: 'Browse web pages and fetch content',
        tools: ['browser', 'fetch'],
        parameters: {
          url: {
            type: 'string',
            description: 'URL to browse or fetch',
            required: true
          },
          action: {
            type: 'string',
            description: 'Action: fetch, screenshot, click, type',
            required: false
          }
        }
      },
      {
        name: 'image-analysis',
        description: 'Analyze images using vision models',
        tools: ['image', 'analyze'],
        parameters: {
          image: {
            type: 'string',
            description: 'Image path or URL',
            required: true
          },
          prompt: {
            type: 'string',
            description: 'Analysis prompt',
            required: false
          }
        }
      },
      {
        name: 'subagent-creation',
        description: 'Create sub-agents for parallel task execution',
        tools: ['sessions_spawn', 'subagents'],
        parameters: {
          task: {
            type: 'string',
            description: 'Task description for sub-agent',
            required: true
          },
          agentId: {
            type: 'string',
            description: 'Agent type to spawn',
            required: false
          }
        }
      },
      {
        name: 'messaging',
        description: 'Send messages to users or channels',
        tools: ['message', 'notify'],
        parameters: {
          target: {
            type: 'string',
            description: 'Message target',
            required: true
          },
          content: {
            type: 'string',
            description: 'Message content',
            required: true
          }
        }
      },
      {
        name: 'code-generation',
        description: 'Generate code in various programming languages',
        tools: ['generate', 'refactor', 'explain'],
        parameters: {
          language: {
            type: 'string',
            description: 'Programming language',
            required: true
          },
          description: {
            type: 'string',
            description: 'What the code should do',
            required: true
          }
        }
      },
      {
        name: 'task-delegation',
        description: 'Delegate tasks to other agents in the network',
        tools: ['delegate', 'discover'],
        parameters: {
          capability: {
            type: 'string',
            description: 'Required capability',
            required: true
          },
          description: {
            type: 'string',
            description: 'Task description',
            required: true
          }
        }
      }
    ];
  }

  /**
   * 合并自定义能力
   */
  mergeCustomCapabilities(defaults: AgentCapability[], custom: string[]): AgentCapability[] {
    const merged = [...defaults];
    
    for (const capName of custom) {
      if (!merged.find(c => c.name === capName)) {
        merged.push({
          name: capName,
          description: `Custom capability: ${capName}`,
          parameters: {
            query: {
              type: 'string',
              description: 'Input for this capability',
              required: true
            }
          }
        });
      }
    }

    return merged;
  }
}