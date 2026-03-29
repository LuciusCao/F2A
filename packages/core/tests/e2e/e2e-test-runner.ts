/**
 * E2E 测试运行器
 * 
 * 提供统一的测试入口和工具函数
 */

import { NodeSpawner } from './utils/node-spawner.js';
import { generateTestConfig } from './utils/test-config.js';
import type { SpawnedNode } from './utils/node-spawner.js';

export interface E2ETestRunnerOptions {
  /** 节点数量 */
  nodeCount: number;
  /** 超时时间 */
  timeout?: number;
  /** 是否清理数据 */
  cleanup?: boolean;
}

export class E2ETestRunner {
  private spawner: NodeSpawner;
  private nodes: SpawnedNode[] = [];
  private testConfig: ReturnType<typeof generateTestConfig>;

  constructor(options: E2ETestRunnerOptions) {
    this.testConfig = generateTestConfig(options.nodeCount);
    this.spawner = new NodeSpawner({
      startTimeout: options.timeout || 30000,
      defaultTimeout: options.timeout || 60000
    });
  }

  /**
   * 启动所有节点
   */
  async startAllNodes(): Promise<SpawnedNode[]> {
    for (const config of this.testConfig.nodes) {
      const node = await this.spawner.spawnNode(config);
      this.nodes.push(node);
    }
    return this.nodes;
  }

  /**
   * 等待节点互相连接
   */
  async waitForConnections(): Promise<void> {
    for (let i = 0; i < this.nodes.length; i++) {
      const currentNode = this.nodes[i];
      const otherNodes = this.nodes.filter((_, idx) => idx !== i);
      
      for (const otherNode of otherNodes) {
        await currentNode.messageWaiter.waitForPeerConnected(
          otherNode.peerId!,
          { timeout: this.testConfig.connectionTimeout }
        );
      }
    }
  }

  /**
   * 获取节点
   */
  getNode(index: number): SpawnedNode | undefined {
    return this.nodes[index];
  }

  /**
   * 获取所有节点
   */
  getAllNodes(): SpawnedNode[] {
    return this.nodes;
  }

  /**
   * 发送消息
   */
  sendMessage(fromIndex: number, toIndex: number, content: string, metadata?: Record<string, unknown>): void {
    const fromNode = this.nodes[fromIndex];
    const toNode = this.nodes[toIndex];
    
    if (!fromNode || !toNode) {
      throw new Error('Invalid node index');
    }

    this.spawner.sendCommand(this.testConfig.nodes[fromIndex].name, {
      type: 'send',
      peerId: toNode.peerId!,
      message: content,
      metadata
    });
  }

  /**
   * 等待消息
   */
  async waitForMessage(nodeIndex: number, content: string, fromIndex?: number): Promise<boolean> {
    const node = this.nodes[nodeIndex];
    if (!node) {
      return false;
    }

    const options = fromIndex !== undefined
      ? { fromPeerId: this.nodes[fromIndex]?.peerId }
      : {};

    const received = await node.messageWaiter.waitForMessage(content, {
      timeout: this.testConfig.messageTimeout,
      ...options
    });

    return received !== null;
  }

  /**
   * 停止所有节点
   */
  async stopAllNodes(): Promise<void> {
    await this.spawner.stopAll();
    this.nodes = [];
  }

  /**
   * 清理测试数据
   */
  async cleanup(): Promise<void> {
    await this.spawner.cleanupDataDir(this.testConfig.baseDataDir);
  }

  /**
   * 获取测试配置
   */
  getConfig(): ReturnType<typeof generateTestConfig> {
    return this.testConfig;
  }
}

/**
 * 快速测试工具函数
 */
export async function quickTest(
  nodeCount: number,
  testFn: (runner: E2ETestRunner) => Promise<void>
): Promise<void> {
  const runner = new E2ETestRunner({ nodeCount, cleanup: true });
  
  try {
    await runner.startAllNodes();
    await runner.waitForConnections();
    await testFn(runner);
  } finally {
    await runner.stopAllNodes();
    await runner.cleanup();
  }
}

// 导出类型和工具
export { NodeSpawner, generateTestConfig };
export { MessageWaiter } from './utils/message-waiter.js';
export type { SpawnedNode } from './utils/node-spawner.js';
export type { NodeConfig, TestConfig, TestCommand, TestEvent } from './utils/test-config.js';