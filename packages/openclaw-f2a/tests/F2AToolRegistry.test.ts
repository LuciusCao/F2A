/**
 * F2AToolRegistry 测试
 * 
 * 测试工具注册器的功能：
 * 1. 工具组装
 * 2. 依赖更新
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2AToolRegistry, type ToolRegistryDeps } from '../src/F2AToolRegistry.js';
import type { Tool } from '../src/types.js';
import {
  createMockToolHandlers,
  createMockClaimHandlers,
  createMockContactToolHandlers,
} from './utils/test-helpers.js';

describe('F2AToolRegistry', () => {
  let registry: F2AToolRegistry;
  let deps: ToolRegistryDeps;

  beforeEach(() => {
    deps = {
      toolHandlers: createMockToolHandlers() as unknown as import('../src/tool-handlers.js').ToolHandlers,
      claimHandlers: createMockClaimHandlers() as unknown as import('../src/claim-handlers.js').ClaimHandlers,
      contactToolHandlers: createMockContactToolHandlers() as unknown as import('../src/contact-tool-handlers.js').ContactToolHandlers,
    };
    registry = new F2AToolRegistry(deps);
  });

  describe('getTools', () => {
    it('应该返回所有 F2A 工具', () => {
      const tools = registry.getTools();
      
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该包含网络工具', () => {
      const tools = registry.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_discover');
      expect(toolNames).toContain('f2a_delegate');
      expect(toolNames).toContain('f2a_broadcast');
      expect(toolNames).toContain('f2a_status');
      expect(toolNames).toContain('f2a_reputation');
    });

    it('应该包含任务工具', () => {
      const tools = registry.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_poll_tasks');
      expect(toolNames).toContain('f2a_submit_result');
      expect(toolNames).toContain('f2a_task_stats');
      expect(toolNames).toContain('f2a_announce');
      expect(toolNames).toContain('f2a_list_announcements');
      expect(toolNames).toContain('f2a_claim');
      expect(toolNames).toContain('f2a_manage_claims');
      expect(toolNames).toContain('f2a_my_claims');
      expect(toolNames).toContain('f2a_announcement_stats');
      expect(toolNames).toContain('f2a_estimate_task');
      expect(toolNames).toContain('f2a_review_task');
      expect(toolNames).toContain('f2a_get_reviews');
      expect(toolNames).toContain('f2a_get_capabilities');
    });

    it('应该包含通讯录工具', () => {
      const tools = registry.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_contacts');
      expect(toolNames).toContain('f2a_contact_groups');
      expect(toolNames).toContain('f2a_friend_request');
      expect(toolNames).toContain('f2a_pending_requests');
      expect(toolNames).toContain('f2a_contacts_export');
      expect(toolNames).toContain('f2a_contacts_import');
    });

    it('每个工具应该有正确的结构', () => {
      const tools = registry.getTools();
      
      for (const tool of tools) {
        // P2-9: 改进断言精确度，使用更具体的断言
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.parameters).toBe('object');
        expect(tool.parameters).not.toBeNull();
        // parameters 可以是空对象 {} 或有内容的对象
        expect(tool.parameters).toBeTypeOf('object');
      }
    });

    // P2-4 修复：工具数量断言改为 toBeGreaterThanOrEqual，避免因新增工具导致测试失败
    it('工具数量应该符合预期', () => {
      const tools = registry.getTools();
      
      // 网络: 5 + 任务: 13 + 通讯录: 6 = 至少 24 个工具
      expect(tools.length).toBeGreaterThanOrEqual(24);
    });
  });

  describe('updateDeps', () => {
    it('应该更新 toolHandlers', () => {
      const newHandlers = createMockToolHandlers() as unknown as import('../src/tool-handlers.js').ToolHandlers;
      
      registry.updateDeps({ toolHandlers: newHandlers });
      
      // 验证更新后仍能正常工作
      const tools = registry.getTools();
      // P2-4 修复：使用 toBeGreaterThanOrEqual
      expect(tools.length).toBeGreaterThanOrEqual(24);
    });

    it('应该更新 claimHandlers', () => {
      const newHandlers = createMockClaimHandlers() as unknown as import('../src/claim-handlers.js').ClaimHandlers;
      
      registry.updateDeps({ claimHandlers: newHandlers });
      
      const tools = registry.getTools();
      expect(tools.length).toBeGreaterThanOrEqual(24);
    });

    it('应该更新 contactToolHandlers', () => {
      const newHandlers = createMockContactToolHandlers() as unknown as import('../src/contact-tool-handlers.js').ContactToolHandlers;
      
      registry.updateDeps({ contactToolHandlers: newHandlers });
      
      const tools = registry.getTools();
      expect(tools.length).toBeGreaterThanOrEqual(24);
    });

    it('应该支持部分更新', () => {
      const newToolHandlers = createMockToolHandlers() as unknown as import('../src/tool-handlers.js').ToolHandlers;
      
      registry.updateDeps({ toolHandlers: newToolHandlers });
      
      // 其他 handlers 应该保持不变
      const tools = registry.getTools();
      expect(tools.length).toBeGreaterThanOrEqual(24);
    });
  });
});