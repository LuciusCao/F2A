/**
 * E2E 测试配置
 */

import { randomUUID } from 'crypto';

export interface NodeConfig {
  /** 节点索引（用于端口分配） */
  nodeIndex: number;
  /** 节点名称 */
  name: string;
  /** 显示名称 */
  displayName: string;
  /** 监听端口（0 表示自动分配） */
  listenPort: number;
  /** 数据目录 */
  dataDir: string;
  /** mDNS service tag */
  mdnsServiceTag: string;
  /** 是否启用 DHT */
  enableDHT: boolean;
  /** 日志级别 */
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  /** 能力列表 */
  capabilities: string[];
}

export interface TestConfig {
  /** 测试运行 ID（用于隔离测试） */
  testRunId: string;
  /** mDNS service tag */
  mdnsServiceTag: string;
  /** 基础数据目录 */
  baseDataDir: string;
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
  /** 连接超时时间（毫秒） */
  connectionTimeout: number;
  /** 发现超时时间（毫秒） */
  discoveryTimeout: number;
  /** 消息等待超时时间（毫秒） */
  messageTimeout: number;
  /** 节点配置 */
  nodes: NodeConfig[];
}

/**
 * 生成测试配置
 */
export function generateTestConfig(nodeCount: number = 2): TestConfig {
  const testRunId = `test-${randomUUID().slice(0, 8)}`;
  const timestamp = Date.now();
  const mdnsServiceTag = `f2a-e2e-${timestamp}`;
  const baseDataDir = `./test-tmp-e2e-${testRunId}`;

  // 使用随机端口范围，避免冲突
  const basePort = Math.floor(Math.random() * 50000) + 10000;

  const nodes: NodeConfig[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const nodeBasePort = basePort + i * 100;
    nodes.push({
      nodeIndex: i,
      name: `node-${testRunId}-${i}`,
      displayName: `E2E Test Node ${i}`,
      listenPort: 0,  // 使用 0 让系统自动分配端口
      dataDir: `${baseDataDir}/node-${i}`,
      mdnsServiceTag,
      enableDHT: false,
      logLevel: 'INFO',
      capabilities: []
    });
  }

  return {
    testRunId,
    mdnsServiceTag,
    baseDataDir,
    defaultTimeout: 60000,
    connectionTimeout: 30000,
    discoveryTimeout: 15000,
    messageTimeout: 10000,
    nodes
  };
}

/**
 * 获取端口范围
 * @param nodeIndex 节点索引
 * @returns 节点可用的端口范围
 */
export function getPortRange(nodeIndex: number): { start: number; end: number } {
  const basePort = 10000 + nodeIndex * 100;
  return {
    start: basePort,
    end: basePort + 99
  };
}

/**
 * 测试节点 IPC 协议类型定义
 */

// 测试运行器 → 测试节点
export type TestCommand =
  | { type: 'start'; config: NodeConfig }
  | { type: 'send'; peerId: string; message: string; metadata?: Record<string, unknown> }
  | { type: 'sendTask'; peerId: string; taskType: string; description: string; parameters?: Record<string, unknown> }
  | { type: 'registerCapability'; capability: { name: string; description: string } }
  | { type: 'stop' }
  | { type: 'getStatus' }
  | { type: 'getConnectedPeers' };

// 测试节点 → 测试运行器
export type TestEvent =
  | { type: 'started'; peerId: string; multiaddrs: string[] }
  | { type: 'peerDiscovered'; peerId: string }
  | { type: 'peerConnected'; peerId: string }
  | { type: 'peerDisconnected'; peerId: string }
  | { type: 'messageReceived'; from: string; content: string; metadata?: Record<string, unknown>; messageId?: string }
  | { type: 'taskRequest'; from: string; taskId: string; taskType: string; description: string; parameters?: Record<string, unknown> }
  | { type: 'taskResponse'; from: string; taskId: string; status: string; result?: unknown; error?: string }
  | { type: 'error'; error: string; details?: unknown }
  | { type: 'stopped' }
  | { type: 'status'; peerId: string; connectedPeers: string[]; running: boolean }
  | { type: 'connectedPeers'; peers: string[] };