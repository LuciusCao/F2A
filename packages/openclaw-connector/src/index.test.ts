import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2AOpenClawConnector } from './connector';

describe('F2AOpenClawConnector', () => {
  let connector: F2AOpenClawConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    connector = new F2AOpenClawConnector();
  });

  describe('basic properties', () => {
    it('should have correct name and version', () => {
      expect(connector.name).toBe('f2a-openclaw-connector');
      expect(connector.version).toBe('0.2.0');
    });
  });

  describe('getTools', () => {
    it('should return array of tools before initialization', () => {
      // getTools can be called before initialize to check available tools
      const tools = connector.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(5);
    });

    it('should include f2a_discover tool with correct parameters', () => {
      const tools = connector.getTools();
      const discoverTool = tools.find(t => t.name === 'f2a_discover');
      expect(discoverTool).toBeDefined();
      expect(discoverTool?.description).toContain('发现');
      expect(discoverTool?.parameters).toHaveProperty('capability');
      expect(discoverTool?.parameters).toHaveProperty('min_reputation');
      expect(discoverTool?.parameters.capability.type).toBe('string');
      expect(discoverTool?.parameters.capability.required).toBe(false);
    });

    it('should include f2a_delegate tool with correct parameters', () => {
      const tools = connector.getTools();
      const delegateTool = tools.find(t => t.name === 'f2a_delegate');
      expect(delegateTool).toBeDefined();
      expect(delegateTool?.description).toContain('委托');
      expect(delegateTool?.parameters).toHaveProperty('agent');
      expect(delegateTool?.parameters).toHaveProperty('task');
      expect(delegateTool?.parameters.agent.required).toBe(true);
    });

    it('should include f2a_broadcast tool with correct parameters', () => {
      const tools = connector.getTools();
      const broadcastTool = tools.find(t => t.name === 'f2a_broadcast');
      expect(broadcastTool).toBeDefined();
      expect(broadcastTool?.description).toContain('广播');
      expect(broadcastTool?.parameters).toHaveProperty('capability');
      expect(broadcastTool?.parameters).toHaveProperty('min_responses');
    });

    it('should include f2a_status tool', () => {
      const tools = connector.getTools();
      const statusTool = tools.find(t => t.name === 'f2a_status');
      expect(statusTool).toBeDefined();
      expect(statusTool?.description).toContain('状态');
    });

    it('should include f2a_reputation tool with action enum', () => {
      const tools = connector.getTools();
      const repTool = tools.find(t => t.name === 'f2a_reputation');
      expect(repTool).toBeDefined();
      expect(repTool?.parameters).toHaveProperty('action');
      expect(repTool?.parameters.action.enum).toContain('list');
      expect(repTool?.parameters.action.enum).toContain('view');
      expect(repTool?.parameters.action.enum).toContain('block');
      expect(repTool?.parameters.action.enum).toContain('unblock');
    });

    it('should have handler functions for all tools', () => {
      const tools = connector.getTools();
      for (const tool of tools) {
        expect(typeof tool.handler).toBe('function');
      }
    });
  });
});
