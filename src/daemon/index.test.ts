import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2ADaemon } from './index.js';

// Mock dependencies
vi.mock('../core/f2a', () => ({
  F2A: {
    create: vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn(),
      peerId: 'test-peer-id'
    })
  }
}));

vi.mock('./control-server', () => ({
  ControlServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn()
  }))
}));

describe('F2ADaemon', () => {
  let daemon: F2ADaemon;

  beforeEach(() => {
    daemon = new F2ADaemon({
      displayName: 'Test Daemon'
    });
  });

  describe('lifecycle', () => {
    it('should create daemon with options', () => {
      expect(daemon).toBeDefined();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);
    });

    it('should not start twice', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      await expect(daemon.start()).rejects.toThrow('Daemon already running');
    });

    it('should stop gracefully', async () => {
      await daemon.start();
      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should handle stop before start', async () => {
      await daemon.stop(); // Should not throw
      expect(daemon.isRunning()).toBe(false);
    });
  });

  describe('getters', () => {
    it('should return F2A instance', async () => {
      await daemon.start();
      const f2a = daemon.getF2A();
      expect(f2a).toBeDefined();
    });

    it('should return undefined when not running', () => {
      const f2a = daemon.getF2A();
      expect(f2a).toBeUndefined();
    });
  });

  describe('options', () => {
    it('should use default control port', () => {
      const defaultDaemon = new F2ADaemon();
      expect(defaultDaemon).toBeDefined();
    });

    it('should accept custom control port', () => {
      const customDaemon = new F2ADaemon({ controlPort: 8080 });
      expect(customDaemon).toBeDefined();
    });
  });
});
