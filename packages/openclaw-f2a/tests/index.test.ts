import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2APlugin } from '../src/connector';

describe('F2APlugin', () => {
  let adapter: F2APlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new F2APlugin();
  });

  describe('basic properties', () => {
    it('should have correct name and version', () => {
      expect(adapter.name).toBe('f2a-openclaw-f2a');
      expect(adapter.version).toBe('0.3.0');
    });
  });

  describe('getTools', () => {
    it('should return array of tools before initialization', () => {
      // getTools can be called before initialize to check available tools
      const tools = adapter.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(5);
    });

    it('should include f2a_discover tool with correct parameters', () => {
      const tools = adapter.getTools();
      const discoverTool = tools.find(t => t.name === 'f2a_discover');
      expect(discoverTool).toBeDefined();
      expect(discoverTool?.description).toContain('发现');
      expect(discoverTool?.parameters).toHaveProperty('capability');
      expect(discoverTool?.parameters).toHaveProperty('min_reputation');
      expect(discoverTool?.parameters.capability.type).toBe('string');
      expect(discoverTool?.parameters.capability.required).toBe(false);
    });

    it('should include f2a_send tool with correct parameters', () => {
      const tools = adapter.getTools();
      const sendTool = tools.find(t => t.name === 'f2a_send');
      expect(sendTool).toBeDefined();
      expect(sendTool?.description).toContain('发送');
      expect(sendTool?.parameters).toHaveProperty('agent');
      expect(sendTool?.parameters).toHaveProperty('message');
      expect(sendTool?.parameters).toHaveProperty('topic');
      expect(sendTool?.parameters.agent.required).toBe(true);
    });

    it('should include f2a_broadcast tool with correct parameters', () => {
      const tools = adapter.getTools();
      const broadcastTool = tools.find(t => t.name === 'f2a_broadcast');
      expect(broadcastTool).toBeDefined();
      expect(broadcastTool?.description).toContain('广播');
      expect(broadcastTool?.parameters).toHaveProperty('capability');
      expect(broadcastTool?.parameters).toHaveProperty('min_responses');
    });

    it('should include f2a_status tool', () => {
      const tools = adapter.getTools();
      const statusTool = tools.find(t => t.name === 'f2a_status');
      expect(statusTool).toBeDefined();
      expect(statusTool?.description).toContain('状态');
    });

    it('should include f2a_reputation tool with action enum', () => {
      const tools = adapter.getTools();
      const repTool = tools.find(t => t.name === 'f2a_reputation');
      expect(repTool).toBeDefined();
      expect(repTool?.parameters).toHaveProperty('action');
      expect(repTool?.parameters.action.enum).toContain('list');
      expect(repTool?.parameters.action.enum).toContain('view');
      expect(repTool?.parameters.action.enum).toContain('block');
      expect(repTool?.parameters.action.enum).toContain('unblock');
    });

    it('should have handler functions for all tools', () => {
      const tools = adapter.getTools();
      for (const tool of tools) {
        expect(typeof tool.handler).toBe('function');
      }
    });
  });
});