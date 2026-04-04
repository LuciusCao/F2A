/**
 * F2A 测试工具函数
 * 提供可复用的 mock 创建、断言辅助和数据生成函数
 */

import { vi, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ==================== 类型定义 ====================

/**
 * F2APluginPublicInterface 类型定义（用于类型约束）
 */
export interface F2APluginPublicInterface {
  getConfig(): Record<string, any>;
  getApi(): any;
  getNetworkClient(): any;
  getReputationSystem(): any;
  getNodeManager(): any;
  getTaskQueue(): any;
  getAnnouncementQueue(): any;
  getReviewCommittee(): any;
  getContactManager(): any;
  getHandshakeProtocol(): any;
  getF2AStatus(): { running: boolean; peerId?: string };
  getF2A(): any;
  discoverAgents(capability?: string): Promise<any>;
  getConnectedPeers(): Promise<any>;
  sendMessage(peerId: string, content: string): Promise<any>;
  sendFriendRequest?(peerId: string, message?: string): Promise<string | null>;
  acceptFriendRequest?(requestId: string): Promise<boolean>;
  rejectFriendRequest?(requestId: string, reason?: string): Promise<boolean>;
}

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
    sendTaskResponse: vi.fn().mockResolvedValue({ success: true }),
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
    get: vi.fn(),
    markProcessing: vi.fn().mockImplementation((taskId: string) => ({
      taskId,
      taskType: 'test-task',
      description: 'Test task description',
      from: generateValidPeerId('sender'),
      parameters: {},
      timeout: 60000,
      status: 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })),
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
    hasPermission: vi.fn().mockReturnValue(true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    flush: vi.fn(),
    getAllReputations: vi.fn().mockReturnValue([]),
    ...overrides
  };
}

/**
 * 创建 mock NodeManager
 */
export function createMockNodeManager(overrides: Record<string, any> = {}) {
  return {
    getStatus: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    isRunning: vi.fn().mockReturnValue(false),
    getConfig: vi.fn().mockReturnValue({}),
    ...overrides
  };
}

/**
 * 创建 mock AnnouncementQueue
 */
export function createMockAnnouncementQueue(overrides: Record<string, any> = {}) {
  return {
    create: vi.fn(),
    getOpen: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    submitClaim: vi.fn(),
    acceptClaim: vi.fn(),
    rejectClaim: vi.fn(),
    getMyClaims: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ open: 0, claimed: 0, delegated: 0, expired: 0, total: 0 }),
    ...overrides
  };
}

/**
 * 创建 mock ReviewCommittee
 */
export function createMockReviewCommittee(overrides: Record<string, any> = {}) {
  return {
    submitReview: vi.fn().mockReturnValue({ success: true }),
    isReviewComplete: vi.fn().mockReturnValue(false),
    getReviewStatus: vi.fn().mockReturnValue(null),
    finalizeReview: vi.fn(),
    ...overrides
  };
}

/**
 * 创建 mock F2A 实例
 */
export function createMockF2A(overrides: Record<string, any> = {}) {
  const peerId = generateValidPeerId();
  return {
    peerId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    ...overrides
  };
}

/**
 * 创建 mock F2AOpenClawAdapter（完整的 adapter mock）
 * 用于 tool-handlers.test.ts 等需要完整 adapter 的测试
 */
export function createMockAdapter(overrides: Record<string, any> = {}) {
  const networkClient = createMockNetworkClient();
  const reputationSystem = createMockReputationSystem();
  const taskQueue = createMockTaskQueue();
  const nodeManager = createMockNodeManager();
  const reviewCommittee = createMockReviewCommittee();
  const announcementQueue = createMockAnnouncementQueue();
  
  const config = {
    security: {
      requireConfirmation: false,
      whitelist: [] as string[],
      blacklist: [] as string[],
      maxTasksPerMinute: 10
    },
    agentName: 'Test Agent'
  };
  
  const mockF2A = createMockF2A();
  
  return {
    networkClient,
    reputationSystem,
    taskQueue,
    nodeManager,
    reviewCommittee,
    announcementQueue,
    config,
    _f2a: mockF2A,
    // api 属性（默认包含 requestHeartbeatNow mock）
    api: {
      runtime: {
        system: {
          requestHeartbeatNow: vi.fn()
        }
      }
    },
    // Getter methods
    getNetworkClient: vi.fn(() => networkClient),
    getReputationSystem: vi.fn(() => reputationSystem),
    getTaskQueue: vi.fn(() => taskQueue),
    getNodeManager: vi.fn(() => nodeManager),
    getReviewCommittee: vi.fn(() => reviewCommittee),
    getAnnouncementQueue: vi.fn(() => announcementQueue),
    getConfig: vi.fn(() => config),
    getApi: vi.fn(() => undefined),
    getF2AStatus: vi.fn(() => ({ running: true, peerId: mockF2A.peerId, uptime: 3600 })),
    core: {
      getF2A: vi.fn(() => mockF2A)
    },
    // f2aClient
    f2aClient: {
      getConnectedPeers: vi.fn().mockResolvedValue({ success: true, data: [] }),
      discoverAgents: networkClient.discoverAgents,
      sendMessage: vi.fn().mockResolvedValue(undefined)
    },
    ...overrides
  };
}

// ==================== P1-4: Tool Handlers Mock 工厂 ====================

/**
 * 创建 mock ToolHandlers（用于 F2AToolRegistry 测试）
 */
export function createMockToolHandlers() {
  return {
    handleDiscover: vi.fn(),
    handleDelegate: vi.fn(),
    handleBroadcast: vi.fn(),
    handleStatus: vi.fn(),
    handleReputation: vi.fn(),
    handlePollTasks: vi.fn(),
    handleSubmitResult: vi.fn(),
    handleTaskStats: vi.fn(),
    handleEstimateTask: vi.fn(),
    handleReviewTask: vi.fn(),
    handleGetReviews: vi.fn(),
    handleGetCapabilities: vi.fn(),
  };
}

/**
 * 创建 mock ClaimHandlers（用于 F2AToolRegistry 测试）
 */
export function createMockClaimHandlers() {
  return {
    handleAnnounce: vi.fn(),
    handleListAnnouncements: vi.fn(),
    handleClaim: vi.fn(),
    handleManageClaims: vi.fn(),
    handleMyClaims: vi.fn(),
    handleAnnouncementStats: vi.fn(),
  };
}

/**
 * 创建 mock ContactToolHandlers（用于 F2AToolRegistry 测试）
 */
export function createMockContactToolHandlers() {
  return {
    handleContacts: vi.fn(),
    handleContactGroups: vi.fn(),
    handleFriendRequest: vi.fn(),
    handlePendingRequests: vi.fn(),
    handleContactsExport: vi.fn(),
    handleContactsImport: vi.fn(),
  };
}

// ==================== 测试数据生成 ====================

/**
 * 生成有效的 Peer ID (52 字符)
 * 注意：Peer ID 格式要求 [A-Za-z1-9]，不允许 0
 */
export function generateValidPeerId(suffix: string = ''): string {
  const base = '12D3KooW';
  // 将 suffix 中的 0 替换为 X（因为 Peer ID 不允许 0）
  const safeSuffix = suffix.replace(/0/g, 'X');
  const padding = 'A'.repeat(44 - safeSuffix.length);
  return `${base}${safeSuffix}${padding}`.slice(0, 52);
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

/**
 * 创建 mock QueuedTask（包含状态信息）
 */
export function createMockQueuedTask(overrides: Record<string, any> = {}): any {
  return {
    taskId: `task-${Date.now()}`,
    taskType: 'test-task',
    description: 'Test task description',
    from: generateValidPeerId('sender'),
    parameters: {},
    timeout: 60000,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
  ],
  // P2-13: 扩展 XXE/SSRF 测试数据
  xxe: [
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
    '<?xml version="1.0"?><!DOCTYPE data [<!ENTITY xxe SYSTEM "http://internal-server/secret">]><data>&xxe;</data>',
    '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "expect://id">]><foo>&xxe;</foo>',
    '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">]><foo>&xxe;</foo>'
  ],
  ssrf: [
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://127.0.0.1:8080/admin',
    'http://[::1]/admin',
    'file:///etc/passwd',
    'gopher://internal-host:70/GET%20/admin',
    'dict://internal-host:11211/stats',
    'http://localhost:6379/'
  ],
  // P2-14: 时序攻击测试数据（用于注释说明）
  // 注意：时序攻击防护通常在实现代码中处理，测试应验证：
  // 1. 密码比较使用恒定时间算法
  // 2. Token 验证不泄露信息
  // 3. 错误响应时间一致
  timingAttack: {
    validTokens: ['valid-token-1', 'valid-token-2'],
    invalidTokens: ['invalid-token-a', 'invalid-token-b'],
    // 测试时应验证 valid 和 invalid token 的响应时间差异在可接受范围内
  }
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

/**
 * 特殊数值测试用例（用于 NaN/Infinity 测试）
 */
export const SPECIAL_NUMERIC_VALUES = {
  nan: [NaN, 'NaN', 'nan'],
  infinity: [Infinity, -Infinity, 'Infinity', '-Infinity', '+Infinity'],
  negative: [-1, -100, -0.001],
  zero: [0, -0, 0.0],
  large: [Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, 1e308],
  small: [Number.MIN_SAFE_INTEGER, Number.MIN_VALUE, -1e308]
};

// ==================== 临时目录管理 ====================

/**
 * 创建唯一的临时测试目录
 * 使用 mkdtempSync 确保每次测试都有独立目录
 */
export function createTestTempDir(prefix: string = 'f2a-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * 清理临时测试目录
 */
export function cleanupTestTempDir(dirPath: string): void {
  try {
    if (dirPath && existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * 检查路径是否存在
 */
export function existsSync(path: string): boolean {
  try {
    const fs = require('fs');
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

// ==================== SessionContext Mock ====================

/**
 * 创建 mock SessionContext
 */
export function createMockSessionContext(): any {
  return {
    sessionId: 'test-session-123',
    workspace: '/tmp/test-workspace',
    toJSON: vi.fn(() => ({ sessionId: 'test-session-123', workspace: '/tmp/test-workspace' }))
  };
}

// ==================== JSON 结构验证 ====================

/**
 * 验证消息 JSON 结构完整性
 */
export function expectValidMessageJson(jsonString: string, expectedFields: string[] = []) {
  expect(jsonString).toBeDefined();
  expect(typeof jsonString).toBe('string');
  
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Invalid JSON: ${jsonString}`);
  }
  
  expect(parsed).toBeDefined();
  expect(typeof parsed).toBe('object');
  
  // 验证必需字段
  for (const field of expectedFields) {
    expect(parsed[field]).toBeDefined();
  }
  
  return parsed;
}

/**
 * 验证握手消息类型
 */
export function expectHandshakeMessageType(parsedJson: any, expectedType: string) {
  expect(parsedJson.type).toBe(expectedType);
  expect(parsedJson.timestamp).toBeDefined();
  expect(typeof parsedJson.timestamp).toBe('number');
}

// ==================== 数据完整性验证 ====================

/**
 * 验证任务数据完整性（字段对比断言）
 */
export function expectTaskDataIntegrity(task: any, original: any) {
  expect(task.taskId).toBe(original.taskId);
  expect(task.taskType).toBe(original.taskType);
  expect(task.from).toBe(original.from);
  expect(task.timeout).toBe(original.timeout);
  
  // 验证时间戳
  if (original.createdAt) {
    expect(task.createdAt).toBeDefined();
    expect(typeof task.createdAt).toBe('number');
  }
  
  // 验证状态
  expect(task.status).toBeDefined();
  expect(['pending', 'processing', 'completed', 'failed'].includes(task.status)).toBe(true);
}

/**
 * 验证统计数据完整性
 */
export function expectStatsIntegrity(stats: any) {
  expect(stats).toBeDefined();
  expect(typeof stats.pending).toBe('number');
  expect(typeof stats.processing).toBe('number');
  expect(typeof stats.completed).toBe('number');
  expect(typeof stats.failed).toBe('number');
  expect(typeof stats.total).toBe('number');
  
  expect(stats.pending).toBeGreaterThanOrEqual(0);
  expect(stats.processing).toBeGreaterThanOrEqual(0);
  expect(stats.completed).toBeGreaterThanOrEqual(0);
  expect(stats.failed).toBeGreaterThanOrEqual(0);
  expect(stats.total).toBeGreaterThanOrEqual(0);
  
  // 验证总计一致性
  expect(stats.total).toBe(stats.pending + stats.processing + stats.completed + stats.failed);
}

// ==================== 配置值验证 ====================

/**
 * 验证配置值被正确处理（不丢失、不损坏）
 */
export function expectConfigValueHandled(plugin: any, key: string, expectedValue: any) {
  const config = plugin.getConfig?.() || plugin.config;
  expect(config).toBeDefined();
  expect(config[key]).toBe(expectedValue);
}

/**
 * 验证空配置被正确处理（使用默认值）
 */
export function expectEmptyConfigHandled(plugin: any) {
  const config = plugin.getConfig?.() || plugin.config;
  expect(config).toBeDefined();
  // 验证默认值存在
  expect(config.agentName).toBeDefined();
}

// ==================== P2-16: Shutdown 测试辅助函数 ====================

/**
 * 创建临时测试目录（用于 shutdown 测试）
 */
export function createShutdownTestDir(prefix: string = 'f2a-shutdown-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * 清理临时测试目录（带 try-catch 保护）
 */
export function cleanupShutdownTestDir(dirPath: string): void {
  try {
    if (dirPath && existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * 安全执行 shutdown（带 try-catch 保护）
 */
export async function safeShutdown(plugin: any): Promise<void> {
  try {
    if (plugin && typeof plugin.shutdown === 'function') {
      await plugin.shutdown();
    }
  } catch {
    // 忽略关闭错误
  }
}

/**
 * 创建标准 shutdown 测试 mock API
 */
export function createShutdownMockApi(tempDir: string, extraConfig: Record<string, any> = {}) {
  return {
    config: {
      agents: {
        defaults: {
          workspace: tempDir,
        },
      },
    },
    ...extraConfig
  };
}

/**
 * 验证插件 shutdown 后状态正确
 */
export function expectPluginShutdownState(plugin: any, shouldBeInitialized: boolean = false) {
  expect(plugin.isInitialized()).toBe(shouldBeInitialized);
  
  const pluginAny = plugin as any;
  if (!shouldBeInitialized) {
    expect(pluginAny._f2a).toBeUndefined();
    expect(pluginAny._f2aStartTime).toBeUndefined();
  }
}

/**
 * 执行完整的生命周期测试（初始化-启用-关闭）
 */
export async function executeFullLifecycleTest(
  plugin: any,
  mockApi: any,
  config: Record<string, any> = {}
): Promise<void> {
  await plugin.initialize({
    api: mockApi as any,
    _api: mockApi as any,
    config: { autoStart: false, ...config },
  });

  await plugin.enable();
  expect(plugin.isInitialized()).toBe(true);

  await safeShutdown(plugin);
  expect(plugin.isInitialized()).toBe(false);
}