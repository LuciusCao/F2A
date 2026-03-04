import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityDetector } from './capability-detector';

describe('CapabilityDetector', () => {
  let detector: CapabilityDetector;

  beforeEach(() => {
    detector = new CapabilityDetector();
  });

  describe('detectCapabilities', () => {
    it('should detect capabilities from tools', async () => {
      const mockSession = {
        listTools: vi.fn().mockResolvedValue(['read', 'write', 'browser']),
        listSkills: vi.fn().mockResolvedValue([]),
      };

      const capabilities = await detector.detectCapabilities(mockSession);
      
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.name === 'file-operation')).toBe(true);
      expect(capabilities.some(c => c.name === 'web-browsing')).toBe(true);
    });

    it('should detect capabilities from skills', async () => {
      const mockSession = {
        listTools: vi.fn().mockResolvedValue([]),
        listSkills: vi.fn().mockResolvedValue(['code-review', 'github']),
      };

      const capabilities = await detector.detectCapabilities(mockSession);
      
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.name === 'code-review')).toBe(true);
      expect(capabilities.some(c => c.name === 'github')).toBe(true);
    });

    it('should use default tools when detection fails', async () => {
      const mockSession = {
        listTools: vi.fn().mockRejectedValue(new Error('Not available')),
        listSkills: vi.fn().mockRejectedValue(new Error('Not available')),
      };

      const capabilities = await detector.detectCapabilities(mockSession);
      
      expect(capabilities.length).toBeGreaterThan(0);
    });

    it('should deduplicate capabilities', async () => {
      const mockSession = {
        listTools: vi.fn().mockResolvedValue(['read', 'write']),
        listSkills: vi.fn().mockResolvedValue(['file-operation']),
      };

      const capabilities = await detector.detectCapabilities(mockSession);
      
      const names = capabilities.map(c => c.name);
      const uniqueNames = [...new Set(names)];
      expect(names.length).toBe(uniqueNames.length);
    });
  });

  describe('mergeDefaultCapabilities', () => {
    it('should add default capabilities', () => {
      const existing: any[] = [];
      const merged = detector.mergeDefaultCapabilities(existing);
      
      expect(merged.length).toBeGreaterThan(0);
      expect(merged.some(c => c.name === 'code-generation')).toBe(true);
      expect(merged.some(c => c.name === 'task-delegation')).toBe(true);
    });

    it('should not duplicate existing capabilities', () => {
      const existing = [
        { name: 'code-generation', description: 'Test', tools: [] },
      ];
      const merged = detector.mergeDefaultCapabilities(existing);
      
      const count = merged.filter(c => c.name === 'code-generation').length;
      expect(count).toBe(1);
    });
  });
});
