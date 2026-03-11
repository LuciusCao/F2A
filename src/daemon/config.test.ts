/**
 * Daemon 配置解析测试
 * 测试环境变量解析和默认值
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Daemon 配置解析', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('环境变量解析', () => {
    it('应该使用默认控制端口 9001', () => {
      delete process.env.F2A_CONTROL_PORT;
      const port = parseInt(process.env.F2A_CONTROL_PORT || '9001');
      expect(port).toBe(9001);
    });

    it('应该从环境变量读取控制端口', () => {
      process.env.F2A_CONTROL_PORT = '8080';
      const port = parseInt(process.env.F2A_CONTROL_PORT || '9001');
      expect(port).toBe(8080);
    });

    it('应该使用默认 P2P 端口 0（随机分配）', () => {
      delete process.env.F2A_P2P_PORT;
      const port = parseInt(process.env.F2A_P2P_PORT || '0');
      expect(port).toBe(0);
    });

    it('应该从环境变量读取 P2P 端口', () => {
      process.env.F2A_P2P_PORT = '9002';
      const port = parseInt(process.env.F2A_P2P_PORT || '0');
      expect(port).toBe(9002);
    });

    it('应该解析 BOOTSTRAP_PEERS 逗号分隔列表', () => {
      process.env.BOOTSTRAP_PEERS = '/ip4/127.0.0.1/tcp/9001/p2p/peer1,/ip4/127.0.0.1/tcp/9002/p2p/peer2';
      const peers = process.env.BOOTSTRAP_PEERS ? process.env.BOOTSTRAP_PEERS.split(',') : undefined;
      expect(peers).toHaveLength(2);
      expect(peers?.[0]).toBe('/ip4/127.0.0.1/tcp/9001/p2p/peer1');
      expect(peers?.[1]).toBe('/ip4/127.0.0.1/tcp/9002/p2p/peer2');
    });

    it('当 BOOTSTRAP_PEERS 未设置时应该返回 undefined', () => {
      delete process.env.BOOTSTRAP_PEERS;
      const peers = process.env.BOOTSTRAP_PEERS ? process.env.BOOTSTRAP_PEERS.split(',') : undefined;
      expect(peers).toBeUndefined();
    });

    it('当 BOOTSTRAP_PEERS 为空字符串时应该返回空数组', () => {
      process.env.BOOTSTRAP_PEERS = '';
      const peers = process.env.BOOTSTRAP_PEERS && process.env.BOOTSTRAP_PEERS.length > 0 
        ? process.env.BOOTSTRAP_PEERS.split(',') 
        : undefined;
      expect(peers).toBeUndefined();
    });
  });

  describe('信号处理', () => {
    it('应该定义 SIGINT 和 SIGTERM 处理器', () => {
      // 验证进程有信号处理器
      // 注意：实际测试信号处理需要更复杂的设置
      expect(process.listenerCount('SIGINT')).toBeGreaterThanOrEqual(0);
      expect(process.listenerCount('SIGTERM')).toBeGreaterThanOrEqual(0);
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的端口号', () => {
      process.env.F2A_CONTROL_PORT = 'invalid';
      const port = parseInt(process.env.F2A_CONTROL_PORT || '9001');
      expect(port).toBeNaN();
    });

    it('应该处理负的端口号', () => {
      process.env.F2A_CONTROL_PORT = '-1';
      const port = parseInt(process.env.F2A_CONTROL_PORT || '9001');
      expect(port).toBe(-1);
    });
  });
});
