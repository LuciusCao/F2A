/**
 * Connector (F2APlugin) 消息处理测试
 * 
 * 测试消息处理、回声检测、Webhook 处理等核心逻辑
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('F2APlugin - 消息处理测试', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-msg-test-${Date.now()}-`));
    
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

  describe('工具 handler 详细测试', () => {
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

    describe('f2a_discover', () => {
      it('应该处理带 capability 参数的请求', async () => {
        const tools = plugin.getTools();
        const discoverTool = tools.find(t => t.name === 'f2a_discover');
        
        const result = await discoverTool!.handler({
          capability: 'code-generation',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理无参数的请求', async () => {
        const tools = plugin.getTools();
        const discoverTool = tools.find(t => t.name === 'f2a_discover');
        
        const result = await discoverTool!.handler({});
        
        expect(result).toBeDefined();
      });

      it('应该处理 min_reputation 参数', async () => {
        const tools = plugin.getTools();
        const discoverTool = tools.find(t => t.name === 'f2a_discover');
        
        const result = await discoverTool!.handler({
          capability: 'code-generation',
          min_reputation: 50,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_send', () => {
      it('应该处理委托请求', async () => {
        const tools = plugin.getTools();
        const delegateTool = tools.find(t => t.name === 'f2a_send');
        
        const result = await delegateTool!.handler({
          agent: 'test-agent',
          task: 'test task description',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 context 的请求', async () => {
        const tools = plugin.getTools();
        const delegateTool = tools.find(t => t.name === 'f2a_send');
        
        const result = await delegateTool!.handler({
          agent: 'test-agent',
          task: 'test task',
          context: 'additional context',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 timeout 的请求', async () => {
        const tools = plugin.getTools();
        const delegateTool = tools.find(t => t.name === 'f2a_send');
        
        const result = await delegateTool!.handler({
          agent: 'test-agent',
          task: 'test task',
          timeout: 5000,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_broadcast', () => {
      it('应该处理广播请求', async () => {
        const tools = plugin.getTools();
        const broadcastTool = tools.find(t => t.name === 'f2a_broadcast');
        
        const result = await broadcastTool!.handler({
          capability: 'code-generation',
          task: 'test task',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 min_responses 参数', async () => {
        const tools = plugin.getTools();
        const broadcastTool = tools.find(t => t.name === 'f2a_broadcast');
        
        const result = await broadcastTool!.handler({
          capability: 'code-generation',
          task: 'test task',
          min_responses: 3,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_status', () => {
      it('应该返回状态信息', async () => {
        const tools = plugin.getTools();
        const statusTool = tools.find(t => t.name === 'f2a_status');
        
        const result = await statusTool!.handler({});
        
        expect(result).toBeDefined();
        // 结果格式可能是 { status: ... } 或其他
      });
    });

    describe('f2a_reputation', () => {
      it('应该处理 list action', async () => {
        const tools = plugin.getTools();
        const reputationTool = tools.find(t => t.name === 'f2a_reputation');
        
        const result = await reputationTool!.handler({
          action: 'list',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 view action', async () => {
        const tools = plugin.getTools();
        const reputationTool = tools.find(t => t.name === 'f2a_reputation');
        
        const result = await reputationTool!.handler({
          action: 'view',
          peer_id: 'test-peer-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 block action', async () => {
        const tools = plugin.getTools();
        const reputationTool = tools.find(t => t.name === 'f2a_reputation');
        
        const result = await reputationTool!.handler({
          action: 'block',
          peer_id: 'test-peer-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 unblock action', async () => {
        const tools = plugin.getTools();
        const reputationTool = tools.find(t => t.name === 'f2a_reputation');
        
        const result = await reputationTool!.handler({
          action: 'unblock',
          peer_id: 'test-peer-id',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_poll_tasks', () => {
      it('应该处理轮询请求', async () => {
        const tools = plugin.getTools();
        const pollTool = tools.find(t => t.name === 'f2a_poll_tasks');
        
        const result = await pollTool!.handler({});
        
        expect(result).toBeDefined();
      });

      it('应该处理 status 参数', async () => {
        const tools = plugin.getTools();
        const pollTool = tools.find(t => t.name === 'f2a_poll_tasks');
        
        const result = await pollTool!.handler({
          status: 'pending',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 limit 参数', async () => {
        const tools = plugin.getTools();
        const pollTool = tools.find(t => t.name === 'f2a_poll_tasks');
        
        const result = await pollTool!.handler({
          limit: 10,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_submit_result', () => {
      it('应该处理成功结果提交', async () => {
        const tools = plugin.getTools();
        const submitTool = tools.find(t => t.name === 'f2a_submit_result');
        
        const result = await submitTool!.handler({
          task_id: 'test-task-id',
          result: 'test result',
          status: 'success',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理错误结果提交', async () => {
        const tools = plugin.getTools();
        const submitTool = tools.find(t => t.name === 'f2a_submit_result');
        
        const result = await submitTool!.handler({
          task_id: 'test-task-id',
          result: 'error message',
          status: 'error',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_announce', () => {
      it('应该处理公告请求', async () => {
        const tools = plugin.getTools();
        const announceTool = tools.find(t => t.name === 'f2a_announce');
        
        const result = await announceTool!.handler({
          task_type: 'code-generation',
          description: 'test task description',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 reward 的请求', async () => {
        const tools = plugin.getTools();
        const announceTool = tools.find(t => t.name === 'f2a_announce');
        
        const result = await announceTool!.handler({
          task_type: 'code-generation',
          description: 'test task',
          reward: 100,
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 required_capabilities 的请求', async () => {
        const tools = plugin.getTools();
        const announceTool = tools.find(t => t.name === 'f2a_announce');
        
        const result = await announceTool!.handler({
          task_type: 'code-generation',
          description: 'test task',
          required_capabilities: ['code-generation', 'file-operation'],
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 timeout 的请求', async () => {
        const tools = plugin.getTools();
        const announceTool = tools.find(t => t.name === 'f2a_announce');
        
        const result = await announceTool!.handler({
          task_type: 'code-generation',
          description: 'test task',
          timeout: 30000,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_list_announcements', () => {
      it('应该处理列表请求', async () => {
        const tools = plugin.getTools();
        const listTool = tools.find(t => t.name === 'f2a_list_announcements');
        
        const result = await listTool!.handler({});
        
        expect(result).toBeDefined();
      });

      it('应该处理 capability 参数', async () => {
        const tools = plugin.getTools();
        const listTool = tools.find(t => t.name === 'f2a_list_announcements');
        
        const result = await listTool!.handler({
          capability: 'code-generation',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 limit 参数', async () => {
        const tools = plugin.getTools();
        const listTool = tools.find(t => t.name === 'f2a_list_announcements');
        
        const result = await listTool!.handler({
          limit: 10,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_claim', () => {
      it('应该处理认领请求', async () => {
        const tools = plugin.getTools();
        const claimTool = tools.find(t => t.name === 'f2a_claim');
        
        const result = await claimTool!.handler({
          announcement_id: 'test-announcement-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 estimated_time 的请求', async () => {
        const tools = plugin.getTools();
        const claimTool = tools.find(t => t.name === 'f2a_claim');
        
        const result = await claimTool!.handler({
          announcement_id: 'test-announcement-id',
          estimated_time: 30000,
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 confidence 的请求', async () => {
        const tools = plugin.getTools();
        const claimTool = tools.find(t => t.name === 'f2a_claim');
        
        const result = await claimTool!.handler({
          announcement_id: 'test-announcement-id',
          confidence: 0.8,
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_manage_claims', () => {
      it('应该处理 list action', async () => {
        const tools = plugin.getTools();
        const manageClaimsTool = tools.find(t => t.name === 'f2a_manage_claims');
        
        const result = await manageClaimsTool!.handler({
          action: 'list',
          announcement_id: 'test-announcement-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 accept action', async () => {
        const tools = plugin.getTools();
        const manageClaimsTool = tools.find(t => t.name === 'f2a_manage_claims');
        
        const result = await manageClaimsTool!.handler({
          action: 'accept',
          announcement_id: 'test-announcement-id',
          claim_id: 'test-claim-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 reject action', async () => {
        const tools = plugin.getTools();
        const manageClaimsTool = tools.find(t => t.name === 'f2a_manage_claims');
        
        const result = await manageClaimsTool!.handler({
          action: 'reject',
          announcement_id: 'test-announcement-id',
          claim_id: 'test-claim-id',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_my_claims', () => {
      it('应该处理 my_claims 请求', async () => {
        const tools = plugin.getTools();
        const myClaimsTool = tools.find(t => t.name === 'f2a_my_claims');
        
        const result = await myClaimsTool!.handler({});
        
        expect(result).toBeDefined();
      });

      it('应该处理 status 参数', async () => {
        const tools = plugin.getTools();
        const myClaimsTool = tools.find(t => t.name === 'f2a_my_claims');
        
        const result = await myClaimsTool!.handler({
          status: 'pending',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_announcement_stats', () => {
      it('应该处理统计请求', async () => {
        const tools = plugin.getTools();
        const statsTool = tools.find(t => t.name === 'f2a_announcement_stats');
        
        const result = await statsTool!.handler({});
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_estimate_task', () => {
      it('应该处理估算请求', async () => {
        const tools = plugin.getTools();
        const estimateTool = tools.find(t => t.name === 'f2a_estimate_task');
        
        const result = await estimateTool!.handler({
          task_type: 'code-generation',
          description: 'test task description',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 required_capabilities 的请求', async () => {
        const tools = plugin.getTools();
        const estimateTool = tools.find(t => t.name === 'f2a_estimate_task');
        
        const result = await estimateTool!.handler({
          task_type: 'code-generation',
          description: 'test task',
          required_capabilities: ['code-generation'],
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_get_reviews', () => {
      it('应该处理获取评审请求', async () => {
        const tools = plugin.getTools();
        const getReviewsTool = tools.find(t => t.name === 'f2a_get_reviews');
        
        const result = await getReviewsTool!.handler({
          task_id: 'test-task-id',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_get_capabilities', () => {
      it('应该处理获取能力请求', async () => {
        const tools = plugin.getTools();
        const capabilitiesTool = tools.find(t => t.name === 'f2a_get_capabilities');
        
        const result = await capabilitiesTool!.handler({});
        
        expect(result).toBeDefined();
      });

      it('应该处理 peer_id 参数', async () => {
        const tools = plugin.getTools();
        const capabilitiesTool = tools.find(t => t.name === 'f2a_get_capabilities');
        
        const result = await capabilitiesTool!.handler({
          peer_id: 'test-peer-id',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_contacts', () => {
      it('应该处理 list action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'list',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 get action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'get',
          contact_id: 'test-contact-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 add action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'add',
          peer_id: 'test-peer-id',
          name: 'Test Contact',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 remove action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'remove',
          contact_id: 'test-contact-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 update action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'update',
          contact_id: 'test-contact-id',
          name: 'Updated Name',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 block action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'block',
          contact_id: 'test-contact-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 unblock action', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'unblock',
          contact_id: 'test-contact-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 status 参数', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'list',
          status: 'friend',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 group 参数', async () => {
        const tools = plugin.getTools();
        const contactsTool = tools.find(t => t.name === 'f2a_contacts');
        
        const result = await contactsTool!.handler({
          action: 'list',
          group: 'test-group',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_contact_groups', () => {
      it('应该处理 list action', async () => {
        const tools = plugin.getTools();
        const groupsTool = tools.find(t => t.name === 'f2a_contact_groups');
        
        const result = await groupsTool!.handler({
          action: 'list',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 create action', async () => {
        const tools = plugin.getTools();
        const groupsTool = tools.find(t => t.name === 'f2a_contact_groups');
        
        const result = await groupsTool!.handler({
          action: 'create',
          name: 'Test Group',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 update action', async () => {
        const tools = plugin.getTools();
        const groupsTool = tools.find(t => t.name === 'f2a_contact_groups');
        
        const result = await groupsTool!.handler({
          action: 'update',
          group_id: 'test-group-id',
          name: 'Updated Group',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 delete action', async () => {
        const tools = plugin.getTools();
        const groupsTool = tools.find(t => t.name === 'f2a_contact_groups');
        
        const result = await groupsTool!.handler({
          action: 'delete',
          group_id: 'test-group-id',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_friend_request', () => {
      it('应该处理好友请求', async () => {
        const tools = plugin.getTools();
        const friendTool = tools.find(t => t.name === 'f2a_friend_request');
        
        const result = await friendTool!.handler({
          peer_id: 'test-peer-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 message 的请求', async () => {
        const tools = plugin.getTools();
        const friendTool = tools.find(t => t.name === 'f2a_friend_request');
        
        const result = await friendTool!.handler({
          peer_id: 'test-peer-id',
          message: 'Hello, I want to be friends!',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_pending_requests', () => {
      it('应该处理 list action', async () => {
        const tools = plugin.getTools();
        const pendingTool = tools.find(t => t.name === 'f2a_pending_requests');
        
        const result = await pendingTool!.handler({
          action: 'list',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 accept action', async () => {
        const tools = plugin.getTools();
        const pendingTool = tools.find(t => t.name === 'f2a_pending_requests');
        
        const result = await pendingTool!.handler({
          action: 'accept',
          request_id: 'test-request-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 reject action', async () => {
        const tools = plugin.getTools();
        const pendingTool = tools.find(t => t.name === 'f2a_pending_requests');
        
        const result = await pendingTool!.handler({
          action: 'reject',
          request_id: 'test-request-id',
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理带 reason 的 reject', async () => {
        const tools = plugin.getTools();
        const pendingTool = tools.find(t => t.name === 'f2a_pending_requests');
        
        const result = await pendingTool!.handler({
          action: 'reject',
          request_id: 'test-request-id',
          reason: 'Not interested',
        });
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_contacts_export', () => {
      it('应该处理导出请求', async () => {
        const tools = plugin.getTools();
        const exportTool = tools.find(t => t.name === 'f2a_contacts_export');
        
        const result = await exportTool!.handler({});
        
        expect(result).toBeDefined();
      });
    });

    describe('f2a_contacts_import', () => {
      it('应该处理导入请求', async () => {
        const tools = plugin.getTools();
        const importTool = tools.find(t => t.name === 'f2a_contacts_import');
        
        const result = await importTool!.handler({
          data: { contacts: [] },
        });
        
        expect(result).toBeDefined();
      });

      it('应该处理 merge 参数', async () => {
        const tools = plugin.getTools();
        const importTool = tools.find(t => t.name === 'f2a_contacts_import');
        
        const result = await importTool!.handler({
          data: { contacts: [] },
          merge: true,
        });
        
        expect(result).toBeDefined();
      });
    });
  });
});