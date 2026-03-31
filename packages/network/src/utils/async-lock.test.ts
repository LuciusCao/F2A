/**
 * AsyncLock 测试
 */

import { describe, it, expect, vi } from 'vitest';
import { AsyncLock } from './async-lock.js';

describe('AsyncLock', () => {
  it('should acquire and release lock', async () => {
    const lock = new AsyncLock();
    
    expect(lock.isLocked()).toBe(false);
    
    await lock.acquire();
    expect(lock.isLocked()).toBe(true);
    
    lock.release();
    expect(lock.isLocked()).toBe(false);
  });

  it('should queue waiting acquires', async () => {
    const lock = new AsyncLock();
    const order: number[] = [];
    
    await lock.acquire();
    
    // Start two waiting acquires
    const p1 = lock.acquire().then(() => {
      order.push(1);
      lock.release();
    });
    const p2 = lock.acquire().then(() => {
      order.push(2);
      lock.release();
    });
    
    // Release the first lock
    lock.release();
    
    await Promise.all([p1, p2]);
    
    expect(order).toEqual([1, 2]);
  });

  it('should timeout if lock not acquired', async () => {
    const lock = new AsyncLock();
    
    await lock.acquire();
    
    await expect(lock.acquire(100)).rejects.toThrow('timeout');
    
    lock.release();
  });

  it('should handle multiple release calls', () => {
    const lock = new AsyncLock();
    
    lock.release(); // Should not throw
    lock.release(); // Should not throw
    
    expect(lock.isLocked()).toBe(false);
  });
});