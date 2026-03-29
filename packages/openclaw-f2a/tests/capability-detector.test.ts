/**
 * CapabilityDetector 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityDetector } from '../src/capability-detector.js';
import type { AgentCapability } from '../src/types.js';

describe('CapabilityDetector', () => {
  let detector: CapabilityDetector;

  beforeEach(() => {
    detector = new CapabilityDetector();
  });

  describe('getDefaultCapabilities', () => {
    it('应该返回默认能力列表', () => {
      const capabilities = detector.getDefaultCapabilities();
      
      expect(Array.isArray(capabilities)).toBe(true);
      expect(capabilities.length).toBeGreaterThan(0);
    });

    it('应该包含文件操作能力', () => {
      const capabilities = detector.getDefaultCapabilities();
      const fileOp = capabilities.find(c => c.name === 'file-operation');
      
      expect(fileOp).toBeDefined();
      expect(fileOp?.tools).toContain('read');
      expect(fileOp?.tools).toContain('write');
    });

    it('应该包含命令执行能力', () => {
      const capabilities = detector.getDefaultCapabilities();
      const cmdExec = capabilities.find(c => c.name === 'command-execution');
      
      expect(cmdExec).toBeDefined();
      expect(cmdExec?.tools).toContain('exec');
    });

    it('应该包含网络浏览能力', () => {
      const capabilities = detector.getDefaultCapabilities();
      const webBrowse = capabilities.find(c => c.name === 'web-browsing');
      
      expect(webBrowse).toBeDefined();
      expect(webBrowse?.tools).toContain('browser');
    });

    it('应该包含子代理创建能力', () => {
      const capabilities = detector.getDefaultCapabilities();
      const subagent = capabilities.find(c => c.name === 'subagent-creation');
      
      expect(subagent).toBeDefined();
      expect(subagent?.tools).toContain('sessions_spawn');
    });

    it('应该包含消息发送能力', () => {
      const capabilities = detector.getDefaultCapabilities();
      const messaging = capabilities.find(c => c.name === 'messaging');
      
      expect(messaging).toBeDefined();
      expect(messaging?.tools).toContain('message');
    });

    it('每个能力应该有正确的结构', () => {
      const capabilities = detector.getDefaultCapabilities();
      
      for (const cap of capabilities) {
        expect(cap).toHaveProperty('name');
        expect(cap).toHaveProperty('description');
        expect(cap).toHaveProperty('tools');
        expect(cap).toHaveProperty('parameters');
        expect(typeof cap.name).toBe('string');
        expect(typeof cap.description).toBe('string');
        expect(Array.isArray(cap.tools)).toBe(true);
        expect(typeof cap.parameters).toBe('object');
      }
    });

    it('每个能力的参数应该有正确的结构', () => {
      const capabilities = detector.getDefaultCapabilities();
      
      for (const cap of capabilities) {
        const params = cap.parameters as Record<string, { type: string; description: string; required: boolean }>;
        
        for (const [key, param] of Object.entries(params)) {
          expect(param).toHaveProperty('type');
          expect(param).toHaveProperty('description');
          expect(['string', 'number', 'boolean', 'array', 'object']).toContain(param.type);
          expect(typeof param.description).toBe('string');
        }
      }
    });
  });

  describe('mergeCustomCapabilities', () => {
    it('应该合并自定义能力', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['custom-ability-1', 'custom-ability-2'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      
      expect(merged.length).toBe(defaults.length + 2);
      expect(merged.find(c => c.name === 'custom-ability-1')).toBeDefined();
      expect(merged.find(c => c.name === 'custom-ability-2')).toBeDefined();
    });

    it('应该保留默认能力', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['new-ability'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      
      // 所有默认能力应该保留
      for (const def of defaults) {
        expect(merged.find(c => c.name === def.name)).toBeDefined();
      }
    });

    it('不应该重复添加已存在的能力', () => {
      const defaults = detector.getDefaultCapabilities();
      const existing = defaults[0].name;
      const custom = [existing, 'new-ability'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      
      // 不应该有重复
      const count = merged.filter(c => c.name === existing).length;
      expect(count).toBe(1);
    });

    it('自定义能力应该有正确的结构', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['test-capability'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      const customCap = merged.find(c => c.name === 'test-capability');
      
      expect(customCap).toBeDefined();
      expect(customCap?.description).toContain('test-capability');
      expect(customCap?.tools).toEqual([]);
      expect(customCap?.parameters).toHaveProperty('query');
    });

    it('空自定义列表应该返回原列表', () => {
      const defaults = detector.getDefaultCapabilities();
      const merged = detector.mergeCustomCapabilities(defaults, []);
      
      expect(merged).toEqual(defaults);
    });
  });
});