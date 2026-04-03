import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityDetector } from '../src/capability-detector';

describe('CapabilityDetector', () => {
  let detector: CapabilityDetector;

  beforeEach(() => {
    detector = new CapabilityDetector();
  });

  describe('getDefaultCapabilities', () => {
    it('should return default capabilities list', () => {
      const capabilities = detector.getDefaultCapabilities();
      
      expect(capabilities.length).toBeGreaterThan(0);
      // 检查是否包含核心能力
      expect(capabilities.some(c => c.name === 'file-operation')).toBe(true);
      expect(capabilities.some(c => c.name === 'command-execution')).toBe(true);
      expect(capabilities.some(c => c.name === 'web-browsing')).toBe(true);
      expect(capabilities.some(c => c.name === 'code-generation')).toBe(true);
      expect(capabilities.some(c => c.name === 'task-delegation')).toBe(true);
    });

    it('should return capabilities with proper structure', () => {
      const capabilities = detector.getDefaultCapabilities();
      
      for (const cap of capabilities) {
        expect(cap.name).toBeDefined();
        expect(cap.description).toBeDefined();
        expect(cap.parameters).toBeDefined();
        expect(typeof cap.name).toBe('string');
        expect(typeof cap.description).toBe('string');
        expect(typeof cap.parameters).toBe('object');
      }
    });

    it('should include tools array for relevant capabilities', () => {
      const capabilities = detector.getDefaultCapabilities();
      
      const fileOp = capabilities.find(c => c.name === 'file-operation');
      expect(fileOp?.tools).toContain('read');
      expect(fileOp?.tools).toContain('write');
    });
  });

  describe('mergeCustomCapabilities', () => {
    it('should add custom capabilities to defaults', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['custom-ml', 'custom-data-analysis'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      
      expect(merged.length).toBe(defaults.length + 2);
      expect(merged.some(c => c.name === 'custom-ml')).toBe(true);
      expect(merged.some(c => c.name === 'custom-data-analysis')).toBe(true);
    });

    it('should not duplicate existing capabilities', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['code-generation']; // 已存在的能力
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      
      const count = merged.filter(c => c.name === 'code-generation').length;
      expect(count).toBe(1);
    });

    it('should create proper structure for custom capabilities', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['my-custom-capability'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      const customCap = merged.find(c => c.name === 'my-custom-capability');
      
      expect(customCap).toBeDefined();
      expect(customCap?.description).toContain('my-custom-capability');
      expect(customCap?.parameters).toBeDefined();
    });

    it('should handle empty custom list', () => {
      const defaults = detector.getDefaultCapabilities();
      const merged = detector.mergeCustomCapabilities(defaults, []);
      
      expect(merged.length).toBe(defaults.length);
    });

    it('should preserve default capabilities order', () => {
      const defaults = detector.getDefaultCapabilities();
      const custom = ['zzz-custom'];
      
      const merged = detector.mergeCustomCapabilities(defaults, custom);
      
      // 默认能力应该在前，自定义在后
      const defaultNames = defaults.map(c => c.name);
      const mergedDefaultNames = merged.slice(0, defaults.length).map(c => c.name);
      expect(mergedDefaultNames).toEqual(defaultNames);
    });
  });
});