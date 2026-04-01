/**
 * 共享测试工具函数
 * 
 * 抽取重复的 mock 创建逻辑，确保测试一致性
 */

import { vi } from 'vitest';
import type { F2APluginPublicInterface } from '../../src/types.js';

/**
 * 生成符合格式的 Peer ID
 * 格式：12D3KooW + 44个base58字符
 */
export function generatePeerId(suffix: string = 'Test'): string {
  const padded = suffix.padEnd(44, 'A').slice(0, 44);
  return `12D3KooW${padded}`;
}

/**
 * 创建模拟的 F2A 实例
 * 使用正确的方法名 sendMessageToPeer
 */
export function createMockF2A(peerId?: string) {
  return {
    peerId: peerId || generatePeerId('MockF2A'),
    sendMessageToPeer: vi.fn().mockResolvedValue({ success: true }),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * 创建模拟的信誉系统
 */
export function createMockReputationSystem() {
  return {
    getReputation: vi.fn(() => ({
      score: 85,
      history: [],
      peerId: 'test-peer',
      successfulTasks: 10,
      failedTasks: 2,
      avgResponseTime: 150,
      lastInteraction: Date.now(),
    })),
    updateReputation: vi.fn(() => true),
    getTopAgents: vi.fn(() => []),
    recordInteraction: vi.fn(),
    getAllReputations: vi.fn(() => []),
    blockPeer: vi.fn(() => true),
    unblockPeer: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    hasPermission: vi.fn(() => true),
  };
}

/**
 * 创建模拟的网络客户端
 */
export function createMockNetworkClient() {
  return {
    discoverAgents: vi.fn(),
    getConnectedPeers: vi.fn(() => []),
    sendMessage: vi.fn(),
    sendTaskResponse: vi.fn(() => ({ success: true })),
  };
}

/**
 * 创建模拟的任务队列
 */
export function createMockTaskQueue() {
  return {
    getTasks: vi.fn(() => []),
    getPending: vi.fn(() => []),
    getAll: vi.fn(() => []),
    addTask: vi.fn(),
    completeTask: vi.fn(() => true),
    failTask: vi.fn(() => true),
    getTaskById: vi.fn(),
    get: vi.fn(() => ({
      taskId: 'task-1',
      from: generatePeerId('From'),
      createdAt: Date.now() - 1000,
    })),
    complete: vi.fn(),
    markProcessing: vi.fn((taskId: string) => ({
      taskId,
      status: 'processing',
      description: 'Mock task description',
      from: generatePeerId('From'),
      taskType: 'test',
      createdAt: Date.now() - 1000,
    })),
    getStats: vi.fn(() => ({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
    })),
  };
}

/**
 * 创建模拟的公告队列
 * 包含完整的公告队列方法
 */
export function createMockAnnouncementQueue() {
  return {
    // 基础方法
    getAnnouncements: vi.fn(() => []),
    addAnnouncement: vi.fn(),
    claimAnnouncement: vi.fn(),
    
    // 创建公告
    create: vi.fn(() => ({ announcementId: 'ann-1' })),
    
    // 获取公告
    get: vi.fn(() => ({
      announcementId: 'ann-1',
      description: 'Test task',
      taskType: 'test',
      status: 'open',
      claims: [],
      from: 'local',
    })),
    
    // 获取开放公告列表
    getOpen: vi.fn(() => [
      { announcementId: 'ann-1', description: 'Task 1', taskType: 'test' },
      { announcementId: 'ann-2', description: 'Task 2', taskType: 'test' },
    ]),
    
    // 认领相关
    submitClaim: vi.fn(() => ({ claimId: 'claim-1', status: 'pending' })),
    getClaims: vi.fn(() => [
      { claimId: 'claim-1', claimant: 'peer-1', status: 'pending' },
    ]),
    acceptClaim: vi.fn(() => ({ 
      claimId: 'claim-1', 
      claimant: 'peer-1',
      claimantName: 'TestAgent',
      status: 'accepted' 
    })),
    rejectClaim: vi.fn(() => ({ 
      claimId: 'claim-1', 
      claimant: 'peer-1',
      claimantName: 'TestAgent',
      status: 'rejected' 
    })),
    
    // 我的认领
    getMyClaims: vi.fn(() => []),
  };
}

/**
 * 创建模拟的评审委员会
 */
export function createMockReviewCommittee() {
  return {
    submitReview: vi.fn(() => ({ success: true })),
    getReviewStatus: vi.fn(),
    isReviewComplete: vi.fn(() => false),
    finalizeReview: vi.fn(),
    requiredReviewers: 3,
  };
}

/**
 * 创建完整的 Mock F2A Plugin
 * 
 * P1-4 修复：抽取重复的 mockPlugin 创建逻辑
 * 包含所有 F2APluginPublicInterface 方法
 */
export function createMockPlugin(options: {
  f2a?: any;
  running?: boolean;
  peerId?: string;
  workspace?: string;
} = {}): F2APluginPublicInterface & { _mocks: Record<string, any> } {
  const mockF2A = options.f2a ?? createMockF2A(options.peerId);
  const mockReputationSystem = createMockReputationSystem();
  const mockNetworkClient = createMockNetworkClient();
  const mockTaskQueue = createMockTaskQueue();
  const mockAnnouncementQueue = createMockAnnouncementQueue();
  const mockReviewCommittee = createMockReviewCommittee();

  const running = options.running ?? true;
  const workspace = options.workspace ?? '/test/workspace';

  return {
    // F2APluginPublicInterface 核心方法
    getConfig: () => ({
      minReputation: 0,
      agentName: 'TestAgent',
      autoStart: true,
    }),
    getApi: () => ({
      config: {
        agents: {
          defaults: {
            workspace,
          },
        },
      },
    }),
    getNetworkClient: () => mockNetworkClient,
    getReputationSystem: () => mockReputationSystem,
    getNodeManager: () => null,
    getTaskQueue: () => mockTaskQueue,
    getAnnouncementQueue: () => mockAnnouncementQueue,
    getReviewCommittee: () => mockReviewCommittee,
    getContactManager: () => null,
    getHandshakeProtocol: () => null,
    
    // F2A 状态方法
    getF2AStatus: () => ({
      running,
      peerId: mockF2A.peerId,
    }),
    getF2A: () => running ? mockF2A : undefined,
    
    // 公开 API 方法
    discoverAgents: mockNetworkClient.discoverAgents,
    getConnectedPeers: () => mockNetworkClient.getConnectedPeers(),
    sendMessage: mockNetworkClient.sendMessage,
    sendFriendRequest: vi.fn().mockResolvedValue(null),
    acceptFriendRequest: vi.fn().mockResolvedValue(false),
    rejectFriendRequest: vi.fn().mockResolvedValue(false),
    
    // f2aClient 方法
    f2aClient: {
      discoverAgents: mockNetworkClient.discoverAgents,
      getConnectedPeers: vi.fn().mockResolvedValue({ success: running, data: [] }),
    },
    
    // 兼容旧的直接属性访问（部分测试仍有使用）
    reputationSystem: mockReputationSystem,
    networkClient: mockNetworkClient,
    taskQueue: mockTaskQueue,
    announcementQueue: mockAnnouncementQueue,
    reviewCommittee: mockReviewCommittee,
    config: {
      minReputation: 0,
      security: {
        requireConfirmation: false,
        whitelist: [],
        blacklist: [],
        maxTasksPerMinute: 10,
      },
    },
    api: {
      config: {
        agents: {
          defaults: {
            workspace,
          },
        },
      },
    },
    
    // 暴露 mock 对象供测试验证
    _mocks: {
      f2a: mockF2A,
      networkClient: mockNetworkClient,
      reputationSystem: mockReputationSystem,
      taskQueue: mockTaskQueue,
      announcementQueue: mockAnnouncementQueue,
      reviewCommittee: mockReviewCommittee,
    },
  } as any;
}

/**
 * 创建未初始化状态的 Mock Plugin
 * 用于测试 F2A 未运行的场景
 */
export function createUninitializedMockPlugin(): F2APluginPublicInterface & { _mocks: Record<string, any> } {
  return createMockPlugin({ running: false, f2a: undefined });
}

/**
 * 安全清理临时目录
 * 使用 try-finally 确保清理
 */
export function safeCleanupTempDir(tempDir: string | null | undefined, rmSync: any): void {
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误，避免测试失败
      console.warn(`清理临时目录失败: ${tempDir}`, e);
    }
  }
}

/**
 * 恶意输入测试用例
 * 用于测试注入攻击防护
 */
export const MALICIOUS_INPUT_TEST_CASES = {
  // 命令注入
  commandInjection: [
    'rm -rf /',
    '; rm -rf /',
    '| rm -rf /',
    '&& rm -rf /',
    '|| rm -rf /',
    '`rm -rf /`',
    '$(rm -rf /)',
    '${rm -rf /}',
  ],
  
  // 路径遍历
  pathTraversal: [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32',
    '~/../../etc/passwd',
    '%2e%2e%2f%2e%2e%2fetc/passwd',
  ],
  
  // SQL 注入（如果适用）
  sqlInjection: [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "1; DELETE FROM tasks WHERE 1=1",
  ],
  
  // 环境变量注入
  envInjection: [
    '$HOME',
    '${HOME}',
    '$(echo hacked)',
    '${IFS}cat${IFS}/etc/passwd',
  ],
  
  // 编码绕过
  encodingBypass: [
    '\\x2e\\x2e\\x2f',  // ../ hex encoded
    '\\u002e\\u002e\\u002f',  // ../ unicode
    '%c0%ae%c0%ae%c0%af',  // ../ UTF-8 overlong
  ],
};

/**
 * Unicode 边界测试用例
 * 用于测试特殊字符处理
 */
export const UNICODE_BOUNDARY_TEST_CASES = {
  // 空字符和不可见字符
  invisible: [
    '\x00',  // Null
    '\x01',  // SOH
    '\x1F',  // US
    '\x7F',  // DEL
    '\u200B',  // Zero-width space
    '\u200C',  // Zero-width non-joiner
    '\u200D',  // Zero-width joiner
    '\uFEFF',  // BOM
  ],
  
  // 超长字符串
  longStrings: [
    'A'.repeat(10000),
    '中文'.repeat(5000),
    '😀'.repeat(2000),
  ],
  
  // Unicode 边界值
  boundaryChars: [
    '\u0000',  // Min Unicode
    '\uFFFF',  // Max BMP
    '\u{10FFFF}',  // Max Unicode (ES6)
    '\uD800\uDC00',  // Surrogate pair
  ],
  
  // 控制字符
  controlChars: [
    '\n', '\r', '\t',
    '\r\n', '\n\r',
    '\v', '\f',
  ],
  
  // 特殊 Unicode 字符
  specialChars: [
    '\u202E',  // Right-to-left override
    '\u2066',  // Isolate start
    '\u2069',  // Isolate end
    '\uFFFD',  // Replacement character
  ],
};

/**
 * 验证 MESSAGE 协议格式
 * 确保消息符合 PR #111 的结构化消息协议
 */
export function validateMessageProtocol(message: string): {
  valid: boolean;
  topic?: string;
  content?: any;
  error?: string;
} {
  try {
    const parsed = JSON.parse(message);
    
    // MESSAGE 协议要求有 topic 和 content
    if (!parsed.topic) {
      return { valid: false, error: 'Missing topic field' };
    }
    
    if (!parsed.content) {
      return { valid: false, error: 'Missing content field' };
    }
    
    // 有效的 topic 值
    const validTopics = ['chat', 'task.request', 'task.response', 'task.announce', 'handshake'];
    if (!validTopics.includes(parsed.topic)) {
      return { valid: false, error: `Invalid topic: ${parsed.topic}` };
    }
    
    return {
      valid: true,
      topic: parsed.topic,
      content: parsed.content,
    };
  } catch (e) {
    return { valid: false, error: 'Invalid JSON' };
  }
}

/**
 * 断言调用参数符合 MESSAGE 协议
 */
export function expectMessageProtocol(callArgs: any[]): {
  peerIdValid: boolean;
  messageValid: boolean;
  protocolResult: ReturnType<typeof validateMessageProtocol>;
} {
  const [peerId, message] = callArgs;
  
  // 验证 peerId 格式
  const peerIdValid = peerId && peerId.startsWith('12D3KooW') && peerId.length >= 52;
  
  // 验证消息协议
  const protocolResult = validateMessageProtocol(message);
  
  return {
    peerIdValid,
    messageValid: protocolResult.valid,
    protocolResult,
  };
}