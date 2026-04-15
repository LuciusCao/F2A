/**
 * AgentIdentityVerifier 测试
 * 
 * RFC 003: 跨节点签名验证测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentIdentityVerifier } from './agent-identity-verifier.js';
import { E2EECrypto } from '../e2ee-crypto.js';
import type { PeerInfo } from '../../types/index.js';

describe('AgentIdentityVerifier', () => {
  let e2eeCrypto: E2EECrypto;
  let peerTable: Map<string, PeerInfo>;
  let connectedPeers: Set<string>;
  let verifier: AgentIdentityVerifier;

  beforeAll(async () => {
    // 初始化 E2EE
    e2eeCrypto = new E2EECrypto();
    await e2eeCrypto.initialize();

    // 创建测试 Peer 表
    peerTable = new Map();
    connectedPeers = new Set();

    // 添加一个测试 Peer（PeerId 前缀必须是 16 位）
    const testPeerId = '12D3KooWTestPeer12345'; // 确保前缀是 16 位
    const testPublicKey = e2eeCrypto.getPublicKey()!;
    
    peerTable.set(testPeerId, {
      peerId: testPeerId,
      multiaddrs: [],
      connected: true,
      reputation: 50,
      lastSeen: Date.now(),
      agentInfo: {
        peerId: testPeerId,
        displayName: 'Test Agent',
        agentType: 'custom',
        version: '0.1.0',
        capabilities: [],
        protocolVersion: '1.0.0',
        lastSeen: Date.now(),
        multiaddrs: [],
        encryptionPublicKey: testPublicKey
      }
    });
    
    connectedPeers.add(testPeerId);
    
    // 注册 Peer 公钥
    e2eeCrypto.registerPeerPublicKey(testPeerId, testPublicKey);

    // 创建验证器
    verifier = new AgentIdentityVerifier(e2eeCrypto, peerTable, connectedPeers);
  });

  afterAll(() => {
    e2eeCrypto.stop();
  });

  describe('parseAgentId', () => {
    it('should parse valid AgentId', () => {
      const agentId = 'agent:12D3KooWTestPeer:a1b2c3d4'; // 16位 PeerId 前缀
      const result = verifier.parseAgentId(agentId);

      expect(result).not.toBeNull();
      expect(result!.peerIdPrefix).toBe('12D3KooWTestPeer');
      expect(result!.randomSuffix).toBe('a1b2c3d4');
    });

    it('should reject invalid AgentId format', () => {
      const invalidIds = [
        'invalid-format',
        'agent:short:a1b2c3d4', // PeerId prefix 太短
        'agent:12D3KooWTestPe12345678:a1b2c3d4', // PeerId prefix 太长（22位）
        'agent:12D3KooWTestPeer:invalid', // random suffix 不是十六进制
        'agent:12D3KooWTestPeer:1234567', // random suffix 太短（7位）
      ];

      for (const id of invalidIds) {
        const result = verifier.parseAgentId(id);
        expect(result).toBeNull();
      }
    });
  });

  describe('findPeerByPrefix', () => {
    it('should find peer by prefix', () => {
      const prefix = '12D3KooWTestPeer';
      const result = verifier.findPeerByPrefix(prefix);

      expect(result).not.toBeNull();
      expect(result!.startsWith(prefix)).toBe(true);
    });

    it('should return null for unknown prefix', () => {
      const prefix = 'UnknownPrefix12';
      const result = verifier.findPeerByPrefix(prefix);

      expect(result).toBeNull();
    });
  });

  describe('quickVerify', () => {
    it('should pass quick verification for valid AgentId', () => {
      const agentId = 'agent:12D3KooWTestPeer:a1b2c3d4';
      const result = verifier.quickVerify(agentId);

      expect(result).toBe(true);
    });

    it('should pass quick verification with matching PeerId', () => {
      const agentId = 'agent:12D3KooWTestPeer:a1b2c3d4';
      const peerId = '12D3KooWTestPeer12345'; // PeerId 前缀匹配
      const result = verifier.quickVerify(agentId, peerId);

      expect(result).toBe(true);
    });

    it('should fail quick verification with mismatched PeerId', () => {
      const agentId = 'agent:12D3KooWTestPeer:a1b2c3d4';
      const peerId = 'DifferentPeerId12345'; // PeerId 前缀不匹配
      const result = verifier.quickVerify(agentId, peerId);

      expect(result).toBe(false);
    });
  });

  describe('verifyRemoteAgentId', () => {
    it('should correctly parse and match PeerId prefix', async () => {
      // 测试 PeerId 前缀匹配逻辑
      const agentId = 'agent:12D3KooWTestPeer:a1b2c3d4';
      
      // 不提供 ed25519PublicKey 和 peerId，让它从 peerTable 中查找
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        'dummy-signature', // 签名不重要，我们只测试 PeerId 匹配
        undefined, // ed25519PublicKey
        undefined, // peerId
        { allowUnknownPeers: true } // 允许不验证签名
      );

      // 应该能找到匹配的 Peer
      expect(result.peerIdPrefix).toBe('12D3KooWTestPeer');
      // matchedPeerId 是完整的 PeerId，应该以 PeerIdPrefix 开头
      expect(result.matchedPeerId?.startsWith('12D3KooWTestPeer')).toBe(true);
    });

    it('should reject AgentId with mismatched PeerId prefix', async () => {
      const agentId = 'agent:12D3KooWTestPeer:a1b2c3d4';
      const signature = 'dummy-signature';
      const mismatchedPeerId = 'DifferentPeerId12345'; // PeerId 前缀不匹配
      
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        signature,
        undefined, // ed25519PublicKey
        mismatchedPeerId,
        { strictPeerIdMatch: true }
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('impersonation');
    });

    it('should reject unknown peer by default', async () => {
      const agentId = 'agent:UnknownPeer12345:a1b2c3d4'; // 16位 PeerId 前缀
      const signature = 'dummy-signature';
      
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        signature
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown peer');
    });

    it('should allow unknown peer when configured', async () => {
      const agentId = 'agent:UnknownPeer12345:a1b2c3d4'; // 16位 PeerId 前缀
      const signature = 'dummy-signature';
      
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        signature,
        undefined, // ed25519PublicKey
        undefined, // peerId
        { allowUnknownPeers: true }
      );

      // 允许未知 Peer，但不验证签名
      expect(result.valid).toBe(true);
      expect(result.error).toContain('signature verification skipped');
    });
  });

  describe('updatePeerReferences', () => {
    it('should update peer references', () => {
      const newPeerTable = new Map<string, PeerInfo>();
      const newConnectedPeers = new Set<string>();
      
      verifier.updatePeerReferences(newPeerTable, newConnectedPeers);
      
      // 测试验证应该使用新的 Peer 表
      const result = verifier.findPeerByPrefix('12D3KooWTestPeer');
      expect(result).toBeNull();
    });
  });
});