/**
 * F2A 测试工具函数
 * 提供可复用的 mock 创建、断言辅助和数据生成函数
 */

import { vi } from 'vitest';

// ==================== Mock 工厂函数 ====================

/**
 * 创建 mock OpenClaw API
 */
export function createMockApi(overrides: Record<string, any> = {}) {
  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    },
    config: {
      plugins: {
        entries: {}
      },
      agents: {
        defaults: {
          workspace: '/tmp/test-f2a'
        }
      }
    },
    registerTool: vi.fn(),
    registerService: vi.fn(),
    ...overrides
  };
}

/**
 * 创建 mock NetworkClient
 */
export function createMockNetworkClient(overrides: Record<string, any> = {}) {
  return {
    discoverAgents: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getConnectedPeers: vi.fn().mockResolvedValue({ success: true, data: [] }),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    registerWebhook: vi.fn().mockResolvedValue(undefined),
    updateAgentInfo: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

/**
 * 创建 mock TaskQueue
 */
export function createMockTaskQueue(overrides: Record<string, any> = {}) {
  return {
    add: vi.fn().mockReturnValue({ taskId: 'task-1', status: 'pending' }),
    getStats: vi.fn().mockReturnValue({ pending: 0, processing: 0, completed: 0, failed: 0 }),
    getPending: vi.fn().mockReturnValue([]),
    getAll: vi.fn().mockReturnValue([]),
    markProcessing: vi.fn().mockReturnValue({ taskId: 'task-1', status: 'processing' }),
    complete: vi.fn(),
    close: vi.fn(),
    ...overrides
  };
}

/**
 * 创建 mock ReputationSystem
 */
export function createMockReputationSystem(overrides: Record<string, any> = {}) {
  return {
    getReputation: vi.fn().mockReturnValue({ score: 50 }),
    isAllowed: vi.fn().mockReturnValue(true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    flush: vi.fn(),
    ...overrides
  };
}

/**
 * 创建 mock F2A 实例
 */
export function createMockF2A(overrides: Record<string, any> = {}) {
  const peerId = '12D3KooWTestPeer123456789012345678901234567890';
  return {
    peerId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    ...overrides
  };
}

// ==================== 测试数据生成 ====================

/**
 * 生成有效的 Peer ID (52 字符)
 */
export function generateValidPeerId(suffix: string = ''): string {
  const base = '12D3KooW';
  const padding = 'A'.repeat(44 - suffix.length);
  return `${base}${suffix}${padding}`.slice(0, 52);
}

/**
 * 创建 mock Agent 信息
 */
export function createMockAgentInfo(overrides: Record<string, any> = {}): any {
  return {
    peerId: generateValidPeerId(),
    displayName: 'Test Agent',
    agentType: 'test',
    version: '1.0.0',
    capabilities: [],
    multiaddrs: [],
    lastSeen: Date.now(),
    ...overrides
  };
}

/**
 * 创建 mock 任务请求
 */
export function createMockTaskRequest(overrides: Record<string, any> = {}): any {
  return {
    taskId: `task-${Date.now()}`,
    taskType: 'test-task',
    description: 'Test task description',
    from: generateValidPeerId('sender'),
    parameters: {},
    timeout: 60000,
    createdAt: Date.now(),
    ...overrides
  };
}

// ==================== 断言辅助函数 ====================

/**
 * 验证 Peer ID 格式
 */
export function expectValidPeerId(peerId: string) {
  expect(peerId).toMatch(/^12D3KooW[A-Za-z0-9]{44}$/);
  expect(peerId.length).toBe(52);
}

/**
 * 验证错误响应格式
 */
export function expectErrorResponse(result: any) {
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
  expect(result.error?.message).toBeDefined();
}

/**
 * 验证成功响应格式
 */
export function expectSuccessResponse(result: any) {
  expect(result.success).toBe(true);
  expect(result.error).toBeUndefined();
}

// ==================== 异步测试辅助 ====================

/**
 * 等待条件满足
 */
export async function waitFor(
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Condition not met within timeout');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// ==================== 安全测试数据 ====================

/**
 * 恶意输入测试用例
 */
export const MALICIOUS_INPUTS = {
  sqlInjection: [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "'; DELETE FROM tasks WHERE '1'='1",
    "1; SELECT * FROM users"
  ],
  xss: [
    '<script>alert("XSS")</script>',
    '<img src=x onerror="alert(\'XSS\')">',
    'javascript:alert("XSS")',
    '<svg onload="alert(\'XSS\')">'
  ],
  pathTraversal: [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\config\\sam',
    '....//....//....//etc/passwd'
  ],
  overflow: [
    'A'.repeat(10000),
    'A'.repeat(100000),
    { nested: { deep: { value: 'A'.repeat(1000) } } }
  ]
};

/**
 * 边界值测试用例
 */
export const BOUNDARY_VALUES = {
  empty: ['', null, undefined, [], {}],
  whitespace: [' ', '  ', '\t', '\n', '\r\n'],
  unicode: ['🎉', '测试', '日本語', '한국어', '🇺🇸'],
  special: ['<>&"\'', 'line1\nline2', 'a\tb\tc', 'a\\nb']
};