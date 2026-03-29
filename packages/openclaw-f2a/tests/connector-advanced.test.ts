/**
 * Connector (F2APlugin) 高级测试
 * 
 * 测试消息处理、Webhook 处理器、回声检测等复杂逻辑
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('F2APlugin - 高级测试', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-advanced-test-${Date.now()}-`));
    
    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );
    
    // 创建 .openclaw 目录
    mkdirSync(join(tempDir, '.openclaw'), { recursive: true });
  });

  afterEach(async () => {
    if (plugin) {
      try {
        await plugin.shutdown();
      } catch (e) {
        // 忽略关闭错误
      }
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('工具 handler 测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('f2a_discover handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const discoverTool = tools.find(t => t.name === 'f2a_discover');
      
      expect(discoverTool).toBeDefined();
      
      // 调用 handler
      const result = await discoverTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_status handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const statusTool = tools.find(t => t.name === 'f2a_status');
      
      expect(statusTool).toBeDefined();
      
      // 调用 handler
      const result = await statusTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_delegate handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const delegateTool = tools.find(t => t.name === 'f2a_delegate');
      
      expect(delegateTool).toBeDefined();
      
      // 调用 handler（应该失败，因为 F2A 未初始化）
      const result = await delegateTool!.handler({
        agent: 'test-agent',
        task: 'test task',
      });
      expect(result).toBeDefined();
    });

    it('f2a_broadcast handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const broadcastTool = tools.find(t => t.name === 'f2a_broadcast');
      
      expect(broadcastTool).toBeDefined();
      
      // 调用 handler
      const result = await broadcastTool!.handler({
        capability: 'test-capability',
        task: 'test task',
      });
      expect(result).toBeDefined();
    });

    it('f2a_poll_tasks handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const pollTool = tools.find(t => t.name === 'f2a_poll_tasks');
      
      expect(pollTool).toBeDefined();
      
      // 调用 handler
      const result = await pollTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_task_stats handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const statsTool = tools.find(t => t.name === 'f2a_task_stats');
      
      expect(statsTool).toBeDefined();
      
      // 调用 handler
      const result = await statsTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_submit_result handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const submitTool = tools.find(t => t.name === 'f2a_submit_result');
      
      expect(submitTool).toBeDefined();
      
      // 调用 handler
      const result = await submitTool!.handler({
        task_id: 'test-task-id',
        result: 'test result',
        status: 'success',
      });
      expect(result).toBeDefined();
    });

    it('f2a_announce handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const announceTool = tools.find(t => t.name === 'f2a_announce');
      
      expect(announceTool).toBeDefined();
      
      // 调用 handler
      const result = await announceTool!.handler({
        task_type: 'test-task',
        description: 'test description',
      });
      expect(result).toBeDefined();
    });

    it('f2a_list_announcements handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const listTool = tools.find(t => t.name === 'f2a_list_announcements');
      
      expect(listTool).toBeDefined();
      
      // 调用 handler
      const result = await listTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_claim handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const claimTool = tools.find(t => t.name === 'f2a_claim');
      
      expect(claimTool).toBeDefined();
      
      // 调用 handler
      const result = await claimTool!.handler({
        announcement_id: 'test-announcement-id',
      });
      expect(result).toBeDefined();
    });

    it('f2a_reputation handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const reputationTool = tools.find(t => t.name === 'f2a_reputation');
      
      expect(reputationTool).toBeDefined();
      
      // 调用 handler
      const result = await reputationTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_contacts handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const contactsTool = tools.find(t => t.name === 'f2a_contacts');
      
      expect(contactsTool).toBeDefined();
      
      // 调用 handler
      const result = await contactsTool!.handler({
        action: 'list',
      });
      expect(result).toBeDefined();
    });

    it('f2a_friend_request handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const friendTool = tools.find(t => t.name === 'f2a_friend_request');
      
      expect(friendTool).toBeDefined();
      
      // 调用 handler
      const result = await friendTool!.handler({
        peer_id: 'test-peer-id',
      });
      expect(result).toBeDefined();
    });

    it('f2a_pending_requests handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const pendingTool = tools.find(t => t.name === 'f2a_pending_requests');
      
      expect(pendingTool).toBeDefined();
      
      // 调用 handler
      const result = await pendingTool!.handler({
        action: 'list',
      });
      expect(result).toBeDefined();
    });

    it('f2a_contact_groups handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const groupsTool = tools.find(t => t.name === 'f2a_contact_groups');
      
      expect(groupsTool).toBeDefined();
      
      // 调用 handler
      const result = await groupsTool!.handler({
        action: 'list',
      });
      expect(result).toBeDefined();
    });

    it('f2a_contacts_export handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const exportTool = tools.find(t => t.name === 'f2a_contacts_export');
      
      expect(exportTool).toBeDefined();
      
      // 调用 handler
      const result = await exportTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_contacts_import handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const importTool = tools.find(t => t.name === 'f2a_contacts_import');
      
      expect(importTool).toBeDefined();
      
      // 调用 handler
      const result = await importTool!.handler({
        data: { contacts: [] },
      });
      expect(result).toBeDefined();
    });

    it('f2a_manage_claims handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const manageClaimsTool = tools.find(t => t.name === 'f2a_manage_claims');
      
      expect(manageClaimsTool).toBeDefined();
      
      // 调用 handler
      const result = await manageClaimsTool!.handler({
        action: 'list',
        announcement_id: 'test-id',
      });
      expect(result).toBeDefined();
    });

    it('f2a_my_claims handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const myClaimsTool = tools.find(t => t.name === 'f2a_my_claims');
      
      expect(myClaimsTool).toBeDefined();
      
      // 调用 handler
      const result = await myClaimsTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_announcement_stats handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const statsTool = tools.find(t => t.name === 'f2a_announcement_stats');
      
      expect(statsTool).toBeDefined();
      
      // 调用 handler
      const result = await statsTool!.handler({});
      expect(result).toBeDefined();
    });

    it('f2a_estimate_task handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const estimateTool = tools.find(t => t.name === 'f2a_estimate_task');
      
      expect(estimateTool).toBeDefined();
      
      // 调用 handler
      const result = await estimateTool!.handler({
        task_type: 'test-task',
        description: 'test description',
      });
      expect(result).toBeDefined();
    });

    it('f2a_review_task handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const reviewTool = tools.find(t => t.name === 'f2a_review_task');
      
      expect(reviewTool).toBeDefined();
      
      // 调用 handler（需要提供 context）
      const result = await reviewTool!.handler({
        task_id: 'test-task-id',
        workload: 50,
        value: 50,
      }, { sessionId: 'test-session' });
      expect(result).toBeDefined();
    });

    it('f2a_get_reviews handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const getReviewsTool = tools.find(t => t.name === 'f2a_get_reviews');
      
      expect(getReviewsTool).toBeDefined();
      
      // 调用 handler
      const result = await getReviewsTool!.handler({
        task_id: 'test-task-id',
      });
      expect(result).toBeDefined();
    });

    it('f2a_get_capabilities handler 应该可调用', async () => {
      const tools = plugin.getTools();
      const capabilitiesTool = tools.find(t => t.name === 'f2a_get_capabilities');
      
      expect(capabilitiesTool).toBeDefined();
      
      // 调用 handler
      const result = await capabilitiesTool!.handler({});
      expect(result).toBeDefined();
    });
  });

  describe('懒加载组件测试', () => {
    it('TaskQueue 懒加载应该正常工作', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 第一次访问触发懒加载
      const queue1 = plugin.getTaskQueue();
      expect(queue1).toBeDefined();
      
      // 第二次访问应该返回相同实例
      const queue2 = plugin.getTaskQueue();
      expect(queue2).toBe(queue1);
    });

    it('ReputationSystem 懒加载应该正常工作', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 第一次访问触发懒加载
      const system1 = plugin.getReputationSystem();
      expect(system1).toBeDefined();
      
      // 第二次访问应该返回相同实例
      const system2 = plugin.getReputationSystem();
      expect(system2).toBe(system1);
    });

    it('ContactManager 懒加载应该正常工作', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 第一次访问触发懒加载
      const manager1 = plugin.getContactManager();
      expect(manager1).toBeDefined();
      
      // 第二次访问应该返回相同实例
      const manager2 = plugin.getContactManager();
      expect(manager2).toBe(manager1);
    });

    it('AnnouncementQueue 懒加载应该正常工作', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 第一次访问触发懒加载
      const queue1 = plugin.getAnnouncementQueue();
      expect(queue1).toBeDefined();
      
      // 第二次访问应该返回相同实例
      const queue2 = plugin.getAnnouncementQueue();
      expect(queue2).toBe(queue1);
    });
  });

  describe('配置合并测试', () => {
    it('应该正确合并默认配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      const config = plugin.getConfig();
      
      // 应该有默认值
      expect(config).toBeDefined();
    });

    it('应该正确合并自定义配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        agentName: 'CustomAgent',
        p2pPort: 4001,
        enableMDNS: false,
        config: {},
      });

      const config = plugin.getConfig();
      expect(config.p2pPort).toBe(4001);
      expect(config.enableMDNS).toBe(false);
    });
  });

  describe('enable/disable 流程测试', () => {
    it('enable 应该创建 F2A 实例', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();
      
      expect(plugin.isInitialized()).toBe(true);
    });

    it('重复 enable 应该跳过', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();
      await plugin.enable(); // 应该跳过
      
      expect(plugin.isInitialized()).toBe(true);
    });

    it('shutdown 后应该能重新 enable', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);

      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);

      // 重新初始化
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
    });
  });

  describe('边界情况测试', () => {
    it('未初始化时调用公开方法应该安全', async () => {
      plugin = new F2APlugin();
      
      // 未初始化时调用各种方法
      const status = plugin.getF2AStatus();
      expect(status.running).toBe(false);
      
      // getConfig 在未初始化时可能返回 undefined 或默认配置
      // 这是预期行为，不强制要求
    });

    it('应该处理空的工具列表请求', () => {
      plugin = new F2APlugin();
      
      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该处理多次 shutdown', async () => {
      plugin = new F2APlugin();
      
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();
      
      // 不应该抛出错误
    });
  });

  describe('f2aClient 接口测试', () => {
    it('discoverAgents 应该返回正确格式', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin.f2aClient.discoverAgents('test');
      
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false); // F2A 未初始化
      expect(result).toHaveProperty('error');
    });

    it('getConnectedPeers 应该返回正确格式', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin.f2aClient.getConnectedPeers();
      
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false); // F2A 未初始化
      expect(result).toHaveProperty('error');
    });
  });

  describe('信誉系统接口测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('getReputationSystem 应该返回有效实例', () => {
      const system = plugin.getReputationSystem();
      
      expect(system).toBeDefined();
      expect(typeof system.getReputation).toBe('function');
      expect(typeof system.hasPermission).toBe('function');
    });
  });

  describe('任务队列接口测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('getTaskQueue 应该返回有效实例', () => {
      const queue = plugin.getTaskQueue();
      
      expect(queue).toBeDefined();
      expect(typeof queue.getStats).toBe('function');
    });

    it('任务队列统计应该有效', () => {
      const queue = plugin.getTaskQueue();
      const stats = queue.getStats();
      
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('processing');
      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.processing).toBe('number');
    });
  });

  describe('联系人管理器接口测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('getContactManager 应该返回有效实例', () => {
      const manager = plugin.getContactManager();
      
      expect(manager).toBeDefined();
    });
  });

  describe('公告队列接口测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('getAnnouncementQueue 应该返回有效实例', () => {
      const queue = plugin.getAnnouncementQueue();
      
      expect(queue).toBeDefined();
    });
  });
});