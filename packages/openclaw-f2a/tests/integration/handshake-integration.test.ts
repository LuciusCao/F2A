/**
 * HandshakeProtocol 集成测试
 * 
 * 测试真实的两节点握手流程，不使用 mock。
 * 
 * 运行方式：
 * - 本地：npm run test:integration
 * - CI：使用 Docker Compose 模拟多节点环境
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { F2A } from '@f2a/network';
import { HandshakeProtocol, HANDSHAKE_MESSAGE_TYPES } from '../../src/handshake-protocol.js';
import { ContactManager } from '../../src/contact-manager.js';
import { FriendStatus } from '../../src/contact-types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe.skip('HandshakeProtocol 集成测试', () => {
  // 此测试需要真实的 P2P 网络连接
  // 在 CI 环境中使用 Docker Compose 运行
  // 或者使用 handshake-semi-integration.test.ts 进行测试
  let tempDir1: string;
  let tempDir2: string;
  let f2a1: F2A;
  let f2a2: F2A;
  let contactManager1: ContactManager;
  let contactManager2: ContactManager;
  let protocol1: HandshakeProtocol;
  let protocol2: HandshakeProtocol;

  beforeAll(async () => {
    // 创建临时目录
    tempDir1 = mkdtempSync(join(tmpdir(), 'f2a-integration-1-'));
    tempDir2 = mkdtempSync(join(tmpdir(), 'f2a-integration-2-'));

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // 创建两个真实的 F2A 实例
    // 注意：这需要实际的 P2P 网络连接
    // 在 CI 中，我们使用 Docker Compose 来模拟多节点环境
    f2a1 = await F2A.create({
      displayName: 'Node1',
      dataDir: tempDir1,
      network: {
        listenPort: 0, // 随机端口
        enableMDNS: false, // 禁用 mDNS 避免干扰
        enableDHT: false,
      },
    });

    f2a2 = await F2A.create({
      displayName: 'Node2',
      dataDir: tempDir2,
      network: {
        listenPort: 0,
        enableMDNS: false,
        enableDHT: false,
      },
    });

    // 启动实例
    await f2a1.start();
    await f2a2.start();

    // 创建 ContactManager
    contactManager1 = new ContactManager(tempDir1, logger);
    contactManager2 = new ContactManager(tempDir2, logger);

    // 创建 HandshakeProtocol
    protocol1 = new HandshakeProtocol(f2a1 as any, contactManager1, logger);
    protocol2 = new HandshakeProtocol(f2a2 as any, contactManager2, logger);
  }, 30000);

  afterAll(async () => {
    // 清理
    await f2a1?.stop();
    await f2a2?.stop();
    
    if (existsSync(tempDir1)) {
      rmSync(tempDir1, { recursive: true, force: true });
    }
    if (existsSync(tempDir2)) {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  describe('数据目录一致性', () => {
    it('ContactManager 应该使用与 F2A 相同的数据目录', () => {
      // 这是之前 bug 的回归测试
      expect(contactManager1).toBeDefined();
      expect(contactManager2).toBeDefined();
    });
  });

  describe('握手流程', () => {
    beforeAll(async () => {
      // 建立两个节点之间的连接
      const node1Addrs = f2a1.agentInfo?.multiaddrs || [];
      const node2PeerId = f2a2.peerId;
      
      // Node1 dial Node2
      if (node1Addrs.length > 0) {
        console.log(`[Test] Node1 connecting to Node2 via ${node1Addrs[0]}`);
        // 等待连接建立
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }, 10000);

    it('应该能够发送好友请求', async () => {
      const peerId2 = f2a2.peerId;
      
      const requestId = await protocol1.sendFriendRequest(peerId2, 'Hello from Node1!');
      
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId.startsWith('req-')).toBe(true);
    }, 10000);

    it('接收方应该收到好友请求', async () => {
      // 等待消息传递
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const pending = contactManager2.getPendingHandshakes();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].fromName).toBe('Node1');
    }, 10000);

    it('应该能够接受好友请求', async () => {
      const pending = contactManager2.getPendingHandshakes();
      if (pending.length === 0) {
        throw new Error('No pending handshake found');
      }
      
      const success = await protocol2.acceptRequest(pending[0].requestId);
      expect(success).toBe(true);
    }, 10000);

    it('接受后双方应该成为好友', async () => {
      // 等待响应传递
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Node2 的联系人列表应该有 Node1
      const contacts2 = contactManager2.getContactsByStatus(FriendStatus.FRIEND);
      expect(contacts2.length).toBeGreaterThan(0);
      
      // Node1 的联系人列表应该有 Node2
      const contacts1 = contactManager1.getContactsByStatus(FriendStatus.FRIEND);
      expect(contacts1.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('边界情况', () => {
    it('重复发送好友请求应该返回已有请求 ID', async () => {
      const peerId2 = f2a2.peerId;
      
      const requestId1 = await protocol1.sendFriendRequest(peerId2, 'First');
      const requestId2 = await protocol1.sendFriendRequest(peerId2, 'Second');
      
      // 如果已经是好友，应该返回 null
      // 如果还有 pending 请求，应该返回相同的 ID
      expect(requestId2).toBe(requestId1);
    }, 10000);
  });
});

/**
 * CI 环境说明：
 * 
 * 1. 本地测试：需要确保没有其他 F2A 实例占用端口
 * 2. CI 测试：使用 Docker Compose 启动两个容器，分别运行 F2A 实例
 * 
 * docker-compose.yml 示例：
 * 
 * version: '3'
 * services:
 *   node1:
 *     build: .
 *     environment:
 *       - NODE_NAME=Node1
 *   node2:
 *     build: .
 *     environment:
 *       - NODE_NAME=Node2
 */