/**
 * F2A 网络模拟工具
 * 
 * 参考 libp2p 的测试策略，使用内存消息队列模拟 P2P 网络。
 * 
 * 核心思想：
 * - 不使用真实网络（TCP/WebSocket）
 * - 用 MessageQueue 模拟双向通信
 * - 支持背压、关闭、重置等真实网络行为
 */

import { EventEmitter } from 'events';

/**
 * 消息队列 - 模拟网络传输
 */
export class MockMessageQueue extends EventEmitter {
  private queue: any[] = [];
  private paused = false;

  send(message: any): boolean {
    if (this.paused) {
      this.queue.push(message);
      return false;
    }
    this.emit('message', message);
    return true;
  }

  pause(): void {
    this.paused = true;
    this.emit('pause');
  }

  resume(): void {
    this.paused = false;
    while (this.queue.length > 0 && !this.paused) {
      const msg = this.queue.shift();
      this.emit('message', msg);
    }
    this.emit('resume');
  }

  close(): void {
    this.emit('close');
  }

  reset(): void {
    this.emit('reset');
  }
}

/**
 * 模拟 P2P 连接对
 */
export interface MockConnectionPair {
  node1to2: MockMessageQueue;
  node2to1: MockMessageQueue;
  
  // 便捷方法
  node1: {
    send: (msg: any) => boolean;
    onMessage: (handler: (msg: any) => void) => void;
    close: () => void;
    reset: () => void;
  };
  node2: {
    send: (msg: any) => boolean;
    onMessage: (handler: (msg: any) => void) => void;
    close: () => void;
    reset: () => void;
  };
}

/**
 * 创建模拟连接对
 * 
 * 类似 libp2p 的 multiaddrConnectionPair
 */
export function createMockConnectionPair(): MockConnectionPair {
  const node1to2 = new MockMessageQueue();
  const node2to1 = new MockMessageQueue();

  // 消息传递逻辑：
  // - Node1 发送消息 → node1to2.send() → node1to2 触发 'message' 事件 → Node2 接收
  // - Node2 发送消息 → node2to1.send() → node2to1 触发 'message' 事件 → Node1 接收
  // 
  // 关键：两个队列是独立的，不需要互相转发！

  return {
    node1to2,
    node2to1,
    node1: {
      send: (msg) => node1to2.send(msg),
      // Node1 接收来自 Node2 的消息：监听 node2to1
      onMessage: (handler) => node2to1.on('message', handler),
      close: () => { node1to2.close(); node2to1.close(); },
      reset: () => { node1to2.reset(); node2to1.reset(); },
    },
    node2: {
      send: (msg) => node2to1.send(msg),
      // Node2 接收来自 Node1 的消息：监听 node1to2
      onMessage: (handler) => node1to2.on('message', handler),
      close: () => { node1to2.close(); node2to1.close(); },
      reset: () => { node1to2.reset(); node2to1.reset(); },
    },
  };
}

/**
 * 模拟 F2A 实例工厂
 */
export interface MockF2AOptions {
  peerId: string;
  displayName: string;
  connection: MockConnectionPair;
}

export function createMockF2A(options: MockF2AOptions) {
  const { peerId, displayName, connection } = options;

  // 消息处理器存储
  const messageHandlers = new Map<string, Set<Function>>();

  // 设置消息接收
  const myConnection = peerId.endsWith('A') ? connection.node1 : connection.node2;
  const theirConnection = peerId.endsWith('A') ? connection.node2 : connection.node1;

  // 模拟 F2A 宥例
  const mockF2A = {
    peerId,
    agentInfo: { displayName },
    
    getCapabilities: () => [{ name: 'test-capability', description: 'Test capability' }],
    
    on: (event: string, handler: Function) => {
      if (!messageHandlers.has(event)) {
        messageHandlers.set(event, new Set());
      }
      messageHandlers.get(event)!.add(handler);
    },
    
    off: (event: string, handler: Function) => {
      messageHandlers.get(event)?.delete(handler);
    },
    
    sendMessage: async (peerId: string, content: string, metadata?: any) => {
      // 通过模拟连接发送
      // metadata 已经包含 { type: 'handshake' }
      const sent = myConnection.send({ 
        from: mockF2A.peerId, 
        content, 
        metadata 
      });
      return { success: sent };
    },
    
    // 内部方法 - 接收消息
    _receiveMessage: (msg: any) => {
      const handlers = messageHandlers.get('message');
      if (handlers) {
        for (const handler of handlers) {
          handler(msg);
        }
      }
    },
  };

  // 设置消息接收处理
  myConnection.onMessage((msg) => {
    mockF2A._receiveMessage(msg);
  });

  return mockF2A;
}

/**
 * 创建一对互相连接的模拟 F2A 实例
 */
export function createMockF2APair() {
  const connection = createMockConnectionPair();

  const f2a1 = createMockF2A({
    peerId: '12D3KooW' + 'A'.repeat(44),
    displayName: 'Node1',
    connection,
  });

  const f2a2 = createMockF2A({
    peerId: '12D3KooW' + 'B'.repeat(44),
    displayName: 'Node2',
    connection,
  });

  return { f2a1, f2a2, connection };
}

/**
 * 等待消息
 */
export function waitForMessage(queue: MockMessageQueue, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for message'));
    }, timeout);

    queue.once('receive', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}