/**
 * OpenClaw 能力检测器
 * 动态检测 OpenClaw 可用的工具和 skills
 */

import type { AgentCapability, ParameterSchema } from './types.js';

export interface OpenClawCapabilities {
  tools: string[];
  skills: string[];
}

export class CapabilityDetector {
  /**
   * 检测 OpenClaw 的能力
   * 通过调用 OpenClaw 的内部 API 或分析配置
   */
  async detectCapabilities(openclawSession: {
    listTools?: () => Promise<string[]>;
    listSkills?: () => Promise<string[]>;
    execute?: (task: string) => Promise<unknown>;
  }): Promise<AgentCapability[]> {
    const capabilities: AgentCapability[] = [];

    // 尝试动态检测
    let tools: string[] = [];
    let skills: string[] = [];

    try {
      if (openclawSession.listTools) {
        tools = await openclawSession.listTools();
      }
    } catch (e) {
      console.log('[F2A] 无法动态检测 tools，使用默认列表');
    }

    try {
      if (openclawSession.listSkills) {
        skills = await openclawSession.listSkills();
      }
    } catch (e) {
      console.log('[F2A] 无法动态检测 skills，使用默认列表');
    }

    // 如果动态检测失败，使用默认列表
    if (tools.length === 0) {
      tools = this.getDefaultTools();
    }

    // 映射 tools 到能力
    for (const tool of tools) {
      const capability = this.mapToolToCapability(tool);
      if (capability) {
        capabilities.push(capability);
      }
    }

    // 映射 skills 到能力
    for (const skill of skills) {
      const capability = this.mapSkillToCapability(skill);
      if (capability && !capabilities.find(c => c.name === capability.name)) {
        capabilities.push(capability);
      }
    }

    // 去重
    const uniqueCapabilities = this.deduplicateCapabilities(capabilities);

    console.log(`[F2A] 检测到 ${uniqueCapabilities.length} 个能力`);
    
    return uniqueCapabilities;
  }

  /**
   * 获取默认工具列表
   */
  private getDefaultTools(): string[] {
    return [
      'read', 'write', 'edit', 'list',
      'exec', 'bash',
      'browser', 'fetch',
      'image', 'analyze',
      'sessions_spawn', 'subagents',
      'message', 'notify'
    ];
  }

  /**
   * 将 Tool 映射为能力
   */
  private mapToolToCapability(tool: string): AgentCapability | null {
    const mappings: Record<string, AgentCapability> = {
      'read': {
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
          },
          content: {
            type: 'string',
            description: 'Content for write operations',
            required: false
          }
        }
      },
      'exec': {
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
      'browser': {
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
      'image': {
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
      'sessions_spawn': {
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
      'message': {
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
      }
    };

    // 找到包含该 tool 的 mapping
    for (const [key, capability] of Object.entries(mappings)) {
      if (capability.tools?.includes(tool)) {
        return capability;
      }
    }

    return null;
  }

  /**
   * 将 Skill 映射为能力
   */
  private mapSkillToCapability(skill: string): AgentCapability | null {
    // Skills 通常已经是高阶能力
    return {
      name: skill,
      description: `Execute ${skill} skill`,
      parameters: {
        query: {
          type: 'string',
          description: 'Skill input/query',
          required: true
        }
      }
    };
  }

  /**
   * 去重能力
   */
  private deduplicateCapabilities(capabilities: AgentCapability[]): AgentCapability[] {
    const seen = new Set<string>();
    return capabilities.filter(c => {
      if (seen.has(c.name)) {
        return false;
      }
      seen.add(c.name);
      return true;
    });
  }

  /**
   * 合并默认能力（代码生成等通用能力）
   */
  mergeDefaultCapabilities(detected: AgentCapability[]): AgentCapability[] {
    const defaults: AgentCapability[] = [
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
          },
          context: {
            type: 'string',
            description: 'Additional context or requirements',
            required: false
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

    // 合并，检测到的能力优先
    const merged = [...detected];
    for (const def of defaults) {
      if (!merged.find(c => c.name === def.name)) {
        merged.push(def);
      }
    }

    return merged;
  }
}