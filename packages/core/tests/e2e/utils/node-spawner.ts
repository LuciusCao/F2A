/**
 * 节点进程管理器
 * 负责启动、管理和监控测试节点子进程
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { NodeConfig, TestEvent, TestCommand } from './test-config.js';
import { MessageWaiter } from './message-waiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SpawnedNode {
  /** 节点配置 */
  config: NodeConfig;
  /** 子进程 */
  process: ChildProcess;
  /** Peer ID（启动后填充） */
  peerId?: string;
  /** 多地址列表 */
  multiaddrs?: string[];
  /** 消息等待器 */
  messageWaiter: MessageWaiter;
  /** 是否运行中 */
  running: boolean;
  /** 日志输出 */
  logs: string[];
}

export interface NodeSpawnerOptions {
  /** 默认超时时间 */
  defaultTimeout?: number;
  /** 启动超时时间 */
  startTimeout?: number;
  /** 是否保留日志 */
  keepLogs?: boolean;
}

/**
 * 获取测试节点脚本路径
 * 使用 .js 文件（编译后的版本）
 */
function getTestNodePath(): string {
  return resolve(__dirname, '../test-node.js');
}

/**
 * 节点进程管理器
 */
export class NodeSpawner {
  private nodes: Map<string, SpawnedNode> = new Map();
  private options: NodeSpawnerOptions;

  constructor(options: NodeSpawnerOptions = {}) {
    this.options = {
      defaultTimeout: 60000,
      startTimeout: 30000,
      keepLogs: true,
      ...options
    };
  }

  /**
   * 启动测试节点
   */
  async spawnNode(config: NodeConfig): Promise<SpawnedNode> {
    const testNodePath = getTestNodePath();

    // 启动子进程
    const childProcess = spawn('node', [testNodePath], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env
      }
    });

    const node: SpawnedNode = {
      config,
      process: childProcess,
      messageWaiter: new MessageWaiter(),
      running: false,
      logs: []
    };

    // 收集日志
    childProcess.stdout?.on('data', (data: Buffer) => {
      const log = data.toString().trim();
      if (log && this.options.keepLogs) {
        node.logs.push(log);
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const log = `[ERROR] ${data.toString().trim()}`;
      if (log && this.options.keepLogs) {
        node.logs.push(log);
      }
    });

    // 处理 IPC 消息
    childProcess.on('message', (event: TestEvent) => {
      this.handleEvent(node, event);
    });

    // 处理进程退出
    childProcess.on('exit', (code) => {
      node.running = false;
      if (code !== 0 && code !== null) {
        node.logs.push(`Process exited with code ${code}`);
      }
    });

    // 处理错误
    childProcess.on('error', (error) => {
      node.logs.push(`Process error: ${error.message}`);
    });

    // 发送启动命令
    const startCommand: TestCommand = { type: 'start', config };
    childProcess.send(startCommand);

    // 等待启动完成
    const started = await this.waitForStarted(node, this.options.startTimeout!);
    if (!started) {
      // 清理
      childProcess.kill();
      throw new Error(`Node ${config.name} failed to start within ${this.options.startTimeout}ms`);
    }

    this.nodes.set(config.name, node);
    return node;
  }

  /**
   * 发送命令给节点
   */
  sendCommand(nodeName: string, command: TestCommand): void {
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new Error(`Node ${nodeName} not found`);
    }

    if (!node.running) {
      throw new Error(`Node ${nodeName} is not running`);
    }

    node.process.send(command);
  }

  /**
   * 获取节点状态
   */
  async getStatus(nodeName: string): Promise<{ peerId: string; connectedPeers: string[]; running: boolean }> {
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new Error(`Node ${nodeName} not found`);
    }

    // 发送获取状态命令
    node.process.send({ type: 'getStatus' });

    // 等待状态响应
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Status request timeout'));
      }, 5000);

      const handler = (event: TestEvent) => {
        if (event.type === 'status') {
          clearTimeout(timeout);
          node.process.removeListener('message', handler);
          resolve({
            peerId: event.peerId,
            connectedPeers: event.connectedPeers,
            running: event.running
          });
        }
      };

      node.process.on('message', handler);
    });
  }

  /**
   * 获取连接的 peers
   */
  async getConnectedPeers(nodeName: string): Promise<string[]> {
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new Error(`Node ${nodeName} not found`);
    }

    // 发送获取连接 peers 命令
    node.process.send({ type: 'getConnectedPeers' });

    // 等待响应
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('getConnectedPeers request timeout'));
      }, 5000);

      const handler = (event: TestEvent) => {
        if (event.type === 'connectedPeers') {
          clearTimeout(timeout);
          node.process.removeListener('message', handler);
          resolve(event.peers);
        }
      };

      node.process.on('message', handler);
    });
  }

  /**
   * 停止节点
   */
  async stopNode(nodeName: string): Promise<void> {
    const node = this.nodes.get(nodeName);
    if (!node) {
      return;
    }

    // 发送停止命令
    node.process.send({ type: 'stop' });

    // 等待停止完成
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // 强制杀死进程
        node.process.kill('SIGKILL');
        resolve();
      }, 5000);

      node.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    node.running = false;
    this.nodes.delete(nodeName);
  }

  /**
   * 停止所有节点
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.nodes.keys()).map(name => this.stopNode(name));
    await Promise.all(stopPromises);
  }

  /**
   * 获取节点
   */
  getNode(nodeName: string): SpawnedNode | undefined {
    return this.nodes.get(nodeName);
  }

  /**
   * 获取所有节点
   */
  getAllNodes(): SpawnedNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * 清理测试数据目录
   */
  async cleanupDataDir(baseDataDir: string): Promise<void> {
    const fs = await import('fs/promises');
    try {
      await fs.rm(baseDataDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }

  // Private methods

  private handleEvent(node: SpawnedNode, event: TestEvent): void {
    switch (event.type) {
      case 'started':
        node.peerId = event.peerId;
        node.multiaddrs = event.multiaddrs;
        node.running = true;
        break;

      case 'peerDiscovered':
        node.messageWaiter.addPeerDiscovered(event.peerId);
        break;

      case 'peerConnected':
        node.messageWaiter.addPeerConnected(event.peerId);
        break;

      case 'peerDisconnected':
        // 可以添加到 disconnection events
        break;

      case 'messageReceived':
        node.messageWaiter.addMessage({
          from: event.from,
          content: event.content,
          metadata: event.metadata,
          messageId: event.messageId
        });
        break;

      case 'taskRequest':
        node.messageWaiter.addTaskRequest({
          from: event.from,
          taskId: event.taskId,
          taskType: event.taskType,
          description: event.description,
          parameters: event.parameters
        });
        break;

      case 'taskResponse':
        node.messageWaiter.addTaskResponse({
          from: event.from,
          taskId: event.taskId,
          status: event.status,
          result: event.result,
          error: event.error
        });
        break;

      case 'error':
        node.logs.push(`Error: ${event.error}`);
        if (event.details) {
          node.logs.push(`Details: ${JSON.stringify(event.details)}`);
        }
        break;

      case 'stopped':
        node.running = false;
        break;
    }
  }

  private async waitForStarted(node: SpawnedNode, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeout);

      const handler = (event: TestEvent) => {
        if (event.type === 'started') {
          clearTimeout(timer);
          node.process.removeListener('message', handler);
          resolve(true);
        } else if (event.type === 'error') {
          clearTimeout(timer);
          node.process.removeListener('message', handler);
          resolve(false);
        }
      };

      node.process.on('message', handler);
    });
  }
}