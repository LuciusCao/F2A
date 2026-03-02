import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connection-manager';
import { Socket } from 'net';

// Mock Socket
function createMockSocket(): Socket {
  return {
    ended: false,
    end: function() { this.ended = true; },
    remoteAddress: '192.168.1.100',
    remotePort: 9001
  } as unknown as Socket;
}

describe('ConnectionManager', () => {
  let cm: ConnectionManager;

  beforeEach(() => {
    cm = new ConnectionManager({ timeout: 1000, cleanupInterval: 100 });
  });

  afterEach(() => {
    cm.stop();
  });

  it('should add pending connection', () => {
    const socket = createMockSocket();
    const result = cm.addPending('agent-1', socket, 'key', '192.168.1.100', 9001);
    
    expect(result.confirmationId).toBeDefined();
    expect(result.isDuplicate).toBe(false);
    expect(cm.getPendingCount()).toBe(1);
  });

  it('should deduplicate same agent requests', () => {
    const socket1 = createMockSocket();
    cm.addPending('agent-1', socket1, 'key1', '192.168.1.100', 9001);
    
    const socket2 = createMockSocket();
    const result = cm.addPending('agent-1', socket2, 'key2', '192.168.1.100', 9002);
    
    expect(result.isDuplicate).toBe(true);
    expect(cm.getPendingCount()).toBe(1);
  });

  it('should confirm connection', () => {
    cm.addPending('agent-1', createMockSocket(), 'key1', '192.168.1.100', 9001);
    
    const result = cm.confirm(1);
    
    expect(result.success).toBe(true);
    expect(cm.getPendingCount()).toBe(0);
  });

  it('should reject connection', () => {
    const socket = createMockSocket();
    cm.addPending('agent-1', socket, 'key1', '192.168.1.100', 9001);
    
    const result = cm.reject(1, 'test reason');
    
    expect(result.success).toBe(true);
    expect(socket.ended).toBe(true);
    expect(cm.getPendingCount()).toBe(0);
  });
});