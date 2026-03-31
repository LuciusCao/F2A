/**
 * 消息等待工具
 * 用于轮询消息队列，支持超时处理和正则匹配
 */

export interface WaitOptions {
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否使用正则匹配 */
  matchRegex?: boolean;
  /** 匹配的发送者（可选） */
  fromPeerId?: string;
}

export interface MessageMatch {
  from: string;
  content: string;
  metadata?: Record<string, unknown>;
  messageId?: string;
}

export interface TaskRequestMatch {
  from: string;
  taskId: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface TaskResponseMatch {
  from: string;
  taskId: string;
  status: string;
  result?: unknown;
  error?: string;
}

/**
 * 消息等待器
 */
export class MessageWaiter {
  private messages: MessageMatch[] = [];
  private taskRequests: TaskRequestMatch[] = [];
  private taskResponses: TaskResponseMatch[] = [];
  private peerConnectedEvents: string[] = [];
  private peerDiscoveredEvents: string[] = [];

  /**
   * 添加消息
   */
  addMessage(message: MessageMatch): void {
    this.messages.push(message);
  }

  /**
   * 添加任务请求
   */
  addTaskRequest(request: TaskRequestMatch): void {
    this.taskRequests.push(request);
  }

  /**
   * 添加任务响应
   */
  addTaskResponse(response: TaskResponseMatch): void {
    this.taskResponses.push(response);
  }

  /**
   * 添加 peer 连接事件
   */
  addPeerConnected(peerId: string): void {
    this.peerConnectedEvents.push(peerId);
  }

  /**
   * 添加 peer 发现事件
   */
  addPeerDiscovered(peerId: string): void {
    this.peerDiscoveredEvents.push(peerId);
  }

  /**
   * 等待消息
   */
  async waitForMessage(
    contentPattern: string,
    options: WaitOptions = {}
  ): Promise<MessageMatch | null> {
    const timeout = options.timeout || 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = this.findMessage(contentPattern, options);
      if (match) {
        return match;
      }
      await this.sleep(100);
    }

    return null;
  }

  /**
   * 等待任意消息
   */
  async waitForAnyMessage(options: WaitOptions = {}): Promise<MessageMatch | null> {
    const timeout = options.timeout || 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = this.messages.find(m => {
        if (options.fromPeerId && m.from !== options.fromPeerId) {
          return false;
        }
        return true;
      });
      if (match) {
        return match;
      }
      await this.sleep(100);
    }

    return null;
  }

  /**
   * 等待任务请求
   */
  async waitForTaskRequest(
    taskTypePattern: string,
    options: WaitOptions = {}
  ): Promise<TaskRequestMatch | null> {
    const timeout = options.timeout || 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = this.findTaskRequest(taskTypePattern, options);
      if (match) {
        return match;
      }
      await this.sleep(100);
    }

    return null;
  }

  /**
   * 等待任务响应
   */
  async waitForTaskResponse(
    taskId: string,
    options: WaitOptions = {}
  ): Promise<TaskResponseMatch | null> {
    const timeout = options.timeout || 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = this.taskResponses.find(r => {
        if (r.taskId !== taskId) {
          return false;
        }
        if (options.fromPeerId && r.from !== options.fromPeerId) {
          return false;
        }
        return true;
      });
      if (match) {
        return match;
      }
      await this.sleep(100);
    }

    return null;
  }

  /**
   * 等待 peer 连接事件
   */
  async waitForPeerConnected(
    peerIdPattern?: string,
    options: WaitOptions = {}
  ): Promise<string | null> {
    const timeout = options.timeout || 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = this.peerConnectedEvents.find(peerId => {
        if (!peerIdPattern) {
          return true;
        }
        if (options.matchRegex) {
          return new RegExp(peerIdPattern).test(peerId);
        }
        return peerId === peerIdPattern || peerId.includes(peerIdPattern);
      });
      if (match) {
        return match;
      }
      await this.sleep(100);
    }

    return null;
  }

  /**
   * 等待 peer 发现事件
   */
  async waitForPeerDiscovered(
    peerIdPattern?: string,
    options: WaitOptions = {}
  ): Promise<string | null> {
    const timeout = options.timeout || 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = this.peerDiscoveredEvents.find(peerId => {
        if (!peerIdPattern) {
          return true;
        }
        if (options.matchRegex) {
          return new RegExp(peerIdPattern).test(peerId);
        }
        return peerId === peerIdPattern || peerId.includes(peerIdPattern);
      });
      if (match) {
        return match;
      }
      await this.sleep(100);
    }

    return null;
  }

  /**
   * 清空所有队列
   */
  clear(): void {
    this.messages = [];
    this.taskRequests = [];
    this.taskResponses = [];
    this.peerConnectedEvents = [];
    this.peerDiscoveredEvents = [];
  }

  /**
   * 获取所有消息
   */
  getAllMessages(): MessageMatch[] {
    return [...this.messages];
  }

  /**
   * 获取所有任务请求
   */
  getAllTaskRequests(): TaskRequestMatch[] {
    return [...this.taskRequests];
  }

  /**
   * 获取所有 peer 连接事件
   */
  getAllPeerConnected(): string[] {
    return [...this.peerConnectedEvents];
  }

  // Private methods

  private findMessage(contentPattern: string, options: WaitOptions): MessageMatch | undefined {
    return this.messages.find(m => {
      if (options.fromPeerId && m.from !== options.fromPeerId) {
        return false;
      }
      if (options.matchRegex) {
        return new RegExp(contentPattern).test(m.content);
      }
      return m.content === contentPattern || m.content.includes(contentPattern);
    });
  }

  private findTaskRequest(taskTypePattern: string, options: WaitOptions): TaskRequestMatch | undefined {
    return this.taskRequests.find(r => {
      if (options.fromPeerId && r.from !== options.fromPeerId) {
        return false;
      }
      if (options.matchRegex) {
        return new RegExp(taskTypePattern).test(r.taskType);
      }
      return r.taskType === taskTypePattern || r.taskType.includes(taskTypePattern);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}