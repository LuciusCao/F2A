import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../src/core/connection-manager';
import { Socket } from 'net';

// Mock Socket
function createMockSocket(): Socket {
  const socket = {
    ended: false,
    end: function() { this.ended = true; },
    remoteAddress: '192.168.1.100',
    remotePort: 9001
  } as unknown as Socket;
  return socket;
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
    expect(socket1.ended).toBe(true);
  });

  it('should get pending list', () => {
    cm.addPending('agent-1', createMockSocket(), 'key1', '192.168.1.100', 9001);
    cm.addPending('agent-2', createMockSocket(), 'key2', '192.168.1.101', 9002);
    
    const list = cm.getPendingList();
    
    expect(list.length).toBe(2);
    expect(list[0].index).toBe(1);
    expect(list[1].index).toBe(2);
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

  it('should fail to confirm non-existent connection', () => {
    const result = cm.confirm(999);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should emit pending_added event', () => {
    const listener = vi.fn();
    cm.on('pending_added', listener);
    
    cm.addPending('agent-1', createMockSocket(), 'key', '192.168.1.100', 9001);
    
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      address: '192.168.1.100',
      port: 9001
    }));
  });
});