/**
 * AgentIdentityVerifier 测试
 * 
 * RFC 003: 跨节点签名验证测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentIdentityVerifier } from './agent-identity-verifier.js';
import { E2EECrypto } from '../e2ee-crypto.js';
import { Ed25519Signer } from './ed25519-signer.js';
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

    it('should verify with Ed25519 signature successfully', async () => {
      // 创建 Ed25519 签名器
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();
      
      const peerId = '12D3KooWEd25519Test';
      const agentId = `agent:${peerId.slice(0, 16)}:a1b2c3d4`;
      
      // 用 Ed25519 签名
      const signature = signer.signSync(agentId);
      
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        signature,
        publicKey,
        peerId
      );
      
      expect(result.valid).toBe(true);
      expect(result.peerIdPrefix).toBe(peerId.slice(0, 16));
    });

    it('should fail Ed25519 signature verification with wrong signature', async () => {
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();
      
      const peerId = '12D3KooWEd25519Bad';
      const agentId = `agent:${peerId.slice(0, 16)}:a1b2c3d4`;
      
      // 用不同的消息签名（错误签名）
      const wrongSignature = signer.signSync('different-message');
      
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        wrongSignature,
        publicKey,
        peerId
      );
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Ed25519 signature verification failed');
    });

    it('should handle Ed25519 verification error gracefully', async () => {
      const peerId = '12D3KooWEd25519Err';
      const agentId = `agent:${peerId.slice(0, 16)}:a1b2c3d4`;
      
      // 无效的 base64 公钥会触发错误（太短）
      const invalidPublicKey = Buffer.from('short').toString('base64');
      
      const result = await verifier.verifyRemoteAgentId(
        agentId,
        'some-signature',
        invalidPublicKey,
        peerId
      );
      
      expect(result.valid).toBe(false);
      // Should return an error message
      expect(result.error).toBeDefined();
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

  describe('verifyBatch', () => {
    it('should verify multiple AgentIds', async () => {
      const agentIds = [
        'agent:12D3KooWTestPeer:a1b2c3d4',
        'agent:UnknownPeer12345:a1b2c3d5'
      ];
      const signatures = ['sig1', 'sig2'];
      
      const results = await verifier.verifyBatch(agentIds, signatures);
      
      expect(results.length).toBe(2);
      expect(results[0].peerIdPrefix).toBe('12D3KooWTestPeer');
      expect(results[1].valid).toBe(false); // Unknown peer
      expect(results[1].error).toContain('Unknown peer');
    });

    it('should return error for mismatched array lengths', async () => {
      const agentIds = ['agent:12D3KooWTestPeer:a1b2c3d4', 'agent:OtherPeer12345:a1b2c3d5'];
      const signatures = ['sig1']; // 长度不匹配
      
      const results = await verifier.verifyBatch(agentIds, signatures);
      
      expect(results.length).toBe(2);
      expect(results[0].valid).toBe(false);
      expect(results[0].error).toBe('Mismatched input arrays');
      expect(results[1].valid).toBe(false);
      expect(results[1].error).toBe('Mismatched input arrays');
    });

    it('should verify batch with peerIds', async () => {
      const agentIds = ['agent:12D3KooWTestPeer:a1b2c3d4'];
      const signatures = ['sig1'];
      const peerIds = ['12D3KooWTestPeer12345']; // 匹配前缀
      
      const results = await verifier.verifyBatch(agentIds, signatures, peerIds);
      
      expect(results.length).toBe(1);
      expect(results[0].peerIdPrefix).toBe('12D3KooWTestPeer');
    });
  });

  describe('quickVerify - format only', () => {
    it('should pass format-only verification without peerId', () => {
      // 不提供 peerId，只检查格式
      const agentId = 'agent:SomePeerPrefix12:a1b2c3d4';
      const result = verifier.quickVerify(agentId);
      
      expect(result).toBe(true);
    });

    it('should fail for invalid format in quickVerify', () => {
      const invalidId = 'invalid-format';
      const result = verifier.quickVerify(invalidId);
      
      expect(result).toBe(false);
    });
  });

  describe('findPeerByPrefix - priority', () => {
    it('should prioritize connectedPeers over peerTable', async () => {
      // 创建一个新的 verifier 实例，避免受之前测试的影响
      const e2eeCrypto2 = new E2EECrypto();
      await e2eeCrypto2.initialize();
      
      const newPeerTable = new Map<string, PeerInfo>();
      const newConnectedPeers = new Set<string>();
      
      // Add peer to both peerTable and connectedPeers
      const testPeerId = '12D3KooWTestPeer12345';
      newPeerTable.set(testPeerId, {
        peerId: testPeerId,
        multiaddrs: [],
        connected: true,
        reputation: 50,
        lastSeen: Date.now()
      });
      newConnectedPeers.add(testPeerId);
      
      // Add another peer to peerTable only (not connected)
      const tableOnlyPeerId = '12D3KooWTestPeerX';
      newPeerTable.set(tableOnlyPeerId, {
        peerId: tableOnlyPeerId,
        multiaddrs: [],
        connected: false,
        reputation: 50,
        lastSeen: Date.now()
      });
      
      const localVerifier = new AgentIdentityVerifier(e2eeCrypto2, newPeerTable, newConnectedPeers);
      
      const prefix = '12D3KooWTestPeer';
      const result = localVerifier.findPeerByPrefix(prefix);
      
      // Should return the connected peer, not the table-only peer
      expect(result).toBe('12D3KooWTestPeer12345');
      
      e2eeCrypto2.stop();
    });
  });

  describe('verifyRemoteAgentId - E2EE fallback', () => {
    it('should fail when peer not in table', async () => {
      const e2eeCrypto2 = new E2EECrypto();
      await e2eeCrypto2.initialize();
      
      const newPeerTable = new Map<string, PeerInfo>();
      const newConnectedPeers = new Set<string>();
      
      // Add to connectedPeers but NOT to peerTable
      const peerId = '12D3KooWNotInTbl';
      newConnectedPeers.add(peerId);
      
      const localVerifier = new AgentIdentityVerifier(e2eeCrypto2, newPeerTable, newConnectedPeers);
      
      const agentId = `agent:${peerId.slice(0, 16)}:a1b2c3d4`;
      
      const result = await localVerifier.verifyRemoteAgentId(
        agentId,
        'sig',
        undefined,
        peerId
      );
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Peer not found in peer table');
      
      e2eeCrypto2.stop();
    });

    it('should fail when no E2EE public key available', async () => {
      const e2eeCrypto2 = new E2EECrypto();
      await e2eeCrypto2.initialize();
      
      const newPeerTable = new Map<string, PeerInfo>();
      const newConnectedPeers = new Set<string>();
      
      const peerId = '12D3KooWNoPubKey';
      
      // Add peer without encryptionPublicKey
      newPeerTable.set(peerId, {
        peerId,
        multiaddrs: [],
        connected: true,
        reputation: 50,
        lastSeen: Date.now(),
        agentInfo: {
          peerId,
          displayName: 'No Key',
          agentType: 'custom',
          version: '1.0',
          capabilities: [],
          protocolVersion: '1.0',
          lastSeen: Date.now(),
          multiaddrs: []
          // no encryptionPublicKey
        }
      });
      newConnectedPeers.add(peerId);
      
      const localVerifier = new AgentIdentityVerifier(e2eeCrypto2, newPeerTable, newConnectedPeers);
      
      const agentId = `agent:${peerId.slice(0, 16)}:a1b2c3d4`;
      
      const result = await localVerifier.verifyRemoteAgentId(
        agentId,
        'sig',
        undefined,
        peerId
      );
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No E2EE public key available');
      
      e2eeCrypto2.stop();
    });

    it('should handle E2EE verification error gracefully', async () => {
      const e2eeCrypto2 = new E2EECrypto();
      await e2eeCrypto2.initialize();
      
      const newPeerTable = new Map<string, PeerInfo>();
      const newConnectedPeers = new Set<string>();
      
      const peerId = '12D3KooWBadPubKey';
      const publicKey = e2eeCrypto2.getPublicKey()!;
      
      // Register peer's public key
      e2eeCrypto2.registerPeerPublicKey(peerId, publicKey);
      
      newPeerTable.set(peerId, {
        peerId,
        multiaddrs: [],
        connected: true,
        reputation: 50,
        lastSeen: Date.now(),
        agentInfo: {
          peerId,
          displayName: 'Bad Key',
          agentType: 'custom',
          version: '1.0',
          capabilities: [],
          protocolVersion: '1.0',
          lastSeen: Date.now(),
          multiaddrs: [],
          encryptionPublicKey: publicKey
        }
      });
      newConnectedPeers.add(peerId);
      
      const localVerifier = new AgentIdentityVerifier(e2eeCrypto2, newPeerTable, newConnectedPeers);
      
      const agentId = `agent:${peerId.slice(0, 16)}:a1b2c3d4`;
      
      // Use a valid base64 signature that will fail verification
      const invalidSignature = Buffer.from('invalid-sig-data').toString('base64');
      
      const result = await localVerifier.verifyRemoteAgentId(
        agentId,
        invalidSignature,
        undefined,
        peerId
      );
      
      expect(result.valid).toBe(false);
      // Should be signature verification error, not format error
      expect(result.error).toBeDefined();
      
      e2eeCrypto2.stop();
    });
  });
});