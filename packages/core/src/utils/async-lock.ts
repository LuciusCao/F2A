/**
 * 简单的异步锁实现，用于保护关键资源的并发访问
 * 
 * P1 修复：添加超时机制，防止死锁
 */

/**
 * 异步锁类
 * 用于保护关键资源（如 peerTable）的并发访问
 */
export class AsyncLock {
  private locked = false;
  private queue: Array<() => void> = [];
  
  /** 默认锁超时时间（毫秒） */
  private static readonly DEFAULT_TIMEOUT_MS = 30000;

  /**
   * 获取锁
   * @param timeoutMs 超时时间（毫秒），默认 30 秒
   * @throws Error 如果超时未能获取锁
   */
  async acquire(timeoutMs: number = AsyncLock.DEFAULT_TIMEOUT_MS): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // 从队列中移除此等待者
        const index = this.queue.indexOf(onAcquire);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error(`AsyncLock acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAcquire = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      this.queue.push(onAcquire);
    });
  }

  /**
   * 释放锁
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      // 保持 locked = true，直接传递给下一个等待者
      next();
    } else {
      this.locked = false;
    }
  }

  /**
   * 检查锁是否被持有
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * 默认导出
 */
export default AsyncLock;