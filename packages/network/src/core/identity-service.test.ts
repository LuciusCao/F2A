/**
 * IdentityService Tests
 *
 * Phase 2b: 测试身份服务的三个核心方法
 * - exportNodeIdentity
 * - exportAgentIdentity
 * - renewAgentIdentity
 *
 * 测试覆盖:
 * - 正常路径: 至少 3 个具体值验证
 * - 错误路径: 至少 2 个错误场景
 * - 边界情况: getter 返回值测试
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { IdentityService } from './identity-service.js';
import { NodeIdentityManager } from './identity/node-identity.js';
import { AgentIdentityManager } from './identity/agent-identity.js';
import { IdentityDelegator } from './identity/delegator.js';
import { Ed25519Signer } from './identity/ed25519-signer.js';
import { Logger } from '../utils/logger.js';
import type { ExportedAgentIdentity, AgentIdentity } from './identity/types.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock Logger
vi.mock('../utils/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock NodeIdentityManager
vi.mock('./identity/node-identity.js', () => ({
  NodeIdentityManager: vi.fn(),
}));

// Mock AgentIdentityManager
vi.mock('./identity/agent-identity.js', () => ({
  AgentIdentityManager: vi.fn(),
}));

// Mock IdentityDelegator
vi.mock('./identity/delegator.js', () => ({
  IdentityDelegator: vi.fn(),
}));

// Mock Ed25519Signer
vi.mock('./identity/ed25519-signer.js', () => ({
  Ed25519Signer: vi.fn(),
}));

describe('IdentityService', () => {
  let service: IdentityService;
  let mockLogger: Logger;
  let mockNodeIdentityManager: {
    exportIdentity: Mock;
    getNodeId: Mock;
    getPrivateKey: Mock;
  };
  let mockAgentIdentityManager: {
    exportAgentIdentity: Mock;
    getAgentIdentity: Mock;
  };
  let mockIdentityDelegator: {
    renewAgent: Mock;
  };
  let mockEd25519Signer: {
    sign: Mock;
    verify: Mock;
    getPublicKey: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock instances
    mockLogger = new Logger({ component: 'TestIdentityService' });
    
    mockNodeIdentityManager = {
      exportIdentity: vi.fn(),
      getNodeId: vi.fn(),
      getPrivateKey: vi.fn(),
    };
    
    mockAgentIdentityManager = {
      exportAgentIdentity: vi.fn(),
      getAgentIdentity: vi.fn(),
    };
    
    mockIdentityDelegator = {
      renewAgent: vi.fn(),
    };
    
    mockEd25519Signer = {
      sign: vi.fn(),
      verify: vi.fn(),
      getPublicKey: vi.fn(),
    };

    // Make constructors return our mock instances
    vi.mocked(NodeIdentityManager).mockReturnValue(mockNodeIdentityManager as unknown as NodeIdentityManager);
    vi.mocked(AgentIdentityManager).mockReturnValue(mockAgentIdentityManager as unknown as AgentIdentityManager);
    vi.mocked(IdentityDelegator).mockReturnValue(mockIdentityDelegator as unknown as IdentityDelegator);
    vi.mocked(Ed25519Signer).mockReturnValue(mockEd25519Signer as unknown as Ed25519Signer);

    // Create service with all dependencies
    service = new IdentityService({
      logger: mockLogger,
      nodeIdentityManager: mockNodeIdentityManager as unknown as NodeIdentityManager,
      agentIdentityManager: mockAgentIdentityManager as unknown as AgentIdentityManager,
      identityDelegator: mockIdentityDelegator as unknown as IdentityDelegator,
      ed25519Signer: mockEd25519Signer as unknown as Ed25519Signer,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // exportNodeIdentity Tests
  // ============================================================================

  describe('exportNodeIdentity', () => {
    it('should export node identity with correct values', async () => {
      // Arrange - 正常路径 1: 设置 mock 返回值
      mockNodeIdentityManager.exportIdentity.mockReturnValue({
        peerId: '12D3KooGTestPeerId123456789',
        privateKey: 'cHJpdmF0ZUtleUJhc2U2NA==',
        e2eeKeyPair: {
          publicKey: 'cHVibGljS2V5QmFzZTY0',
          privateKey: 'cHJpdmF0ZUtleUJhc2U2NA==',
        },
        createdAt: new Date(),
      });
      mockNodeIdentityManager.getNodeId.mockReturnValue('node-12345');

      // Act
      const result = await service.exportNodeIdentity();

      // Assert - 验证具体值
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodeId).toBe('node-12345');
        expect(result.data.peerId).toMatch(/^12D3Koo/);
        expect(result.data.peerId).toBe('12D3KooGTestPeerId123456789');
        expect(result.data.privateKey).toBeDefined();
        expect(result.data.privateKey).toBe('cHJpdmF0ZUtleUJhc2U2NA==');
      }
    });

    it('should return error when node identity manager not initialized', async () => {
      // Arrange - 错误路径 1: 没有设置 nodeIdentityManager
      const serviceWithoutNode = new IdentityService({
        logger: mockLogger,
        // 不设置 nodeIdentityManager
      });

      // Act
      const result = await serviceWithoutNode.exportNodeIdentity();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('IDENTITY_NOT_INITIALIZED');
        expect(result.error.message).toContain('Node identity manager not initialized');
      }
    });

    it('should return error when exportIdentity throws', async () => {
      // Arrange - 错误路径: exportIdentity 抛出异常
      mockNodeIdentityManager.exportIdentity.mockImplementation(() => {
        throw new Error('Export failed');
      });

      // Act
      const result = await service.exportNodeIdentity();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('EXPORT_FAILED');
        expect(result.error.message).toContain('Failed to export node identity');
        expect(result.error.cause).toBeDefined();
      }
    });
  });

  // ============================================================================
  // exportAgentIdentity Tests
  // ============================================================================

  describe('exportAgentIdentity', () => {
    it('should export agent identity with correct values', async () => {
      // Arrange - 正常路径 2: 设置 mock 返回值
      const mockAgentIdentity: ExportedAgentIdentity = {
        id: 'agent-test-uuid-1234',
        name: 'TestAgent',
        capabilities: ['echo', 'compute'],
        nodeId: 'node-12345',
        publicKey: 'cHVibGljS2V5QmFzZTY0',
        signature: 'c2lnbmF0dXJlQmFzZTY0',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        privateKey: 'cHJpdmF0ZUtleUJhc2U2NA==',
      };

      mockAgentIdentityManager.exportAgentIdentity.mockReturnValue(mockAgentIdentity);

      // Act
      const result = await service.exportAgentIdentity();

      // Assert - 验证具体值
      expect(result.success).toBe(true);
      if (result.success) {
        // agentId 格式验证
        expect(result.data.id).toBeDefined();
        expect(result.data.id).toBe('agent-test-uuid-1234');
        // name 验证
        expect(result.data.name).toBe('TestAgent');
        // privateKey 验证
        expect(result.data.privateKey).toBeDefined();
        expect(result.data.privateKey).toBe('cHJpdmF0ZUtleUJhc2U2NA==');
        // 其他字段验证
        expect(result.data.nodeId).toBe('node-12345');
        expect(result.data.capabilities).toContain('echo');
        expect(result.data.capabilities).toContain('compute');
      }
    });

    it('should return error when agent identity manager not initialized', async () => {
      // Arrange - 错误路径 2: 没有设置 agentIdentityManager
      const serviceWithoutAgent = new IdentityService({
        logger: mockLogger,
        // 不设置 agentIdentityManager
      });

      // Act
      const result = await serviceWithoutAgent.exportAgentIdentity();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('IDENTITY_NOT_INITIALIZED');
        expect(result.error.message).toContain('Agent identity manager not initialized');
      }
    });

    it('should return error when agent identity not found', async () => {
      // Arrange - 错误路径 3: exportAgentIdentity 返回 null
      mockAgentIdentityManager.exportAgentIdentity.mockReturnValue(null);

      // Act
      const result = await service.exportAgentIdentity();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('IDENTITY_NOT_FOUND');
        expect(result.error.message).toContain('No agent identity found');
      }
    });

    it('should return error when exportAgentIdentity throws', async () => {
      // Arrange - 错误路径: exportAgentIdentity 抛出异常
      mockAgentIdentityManager.exportAgentIdentity.mockImplementation(() => {
        throw new Error('Agent export failed');
      });

      // Act
      const result = await service.exportAgentIdentity();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('EXPORT_FAILED');
        expect(result.error.message).toContain('Failed to export agent identity');
      }
    });
  });

  // ============================================================================
  // renewAgentIdentity Tests
  // ============================================================================

  describe('renewAgentIdentity', () => {
    it('should renew agent identity with new expiresAt', async () => {
      // Arrange - 正常路径 3: 设置续期成功
      const currentIdentity: AgentIdentity = {
        id: 'agent-renew-test',
        name: 'RenewAgent',
        capabilities: ['test'],
        nodeId: 'node-12345',
        publicKey: 'cHVibGljS2V5',
        signature: 'b2xkU2lnbmF0dXJl',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(), // 即将过期
      };

      const renewedIdentity: AgentIdentity = {
        ...currentIdentity,
        expiresAt: new Date(Date.now() + 86400000).toISOString(), // 延长 1 天
        signature: 'bmV3U2lnbmF0dXJl', // 新签名
      };

      mockAgentIdentityManager.getAgentIdentity.mockReturnValue(currentIdentity);
      mockNodeIdentityManager.getPrivateKey.mockReturnValue({
        bytes: new Uint8Array(32),
        sign: vi.fn().mockResolvedValue(new Uint8Array(64)),
      });
      mockIdentityDelegator.renewAgent.mockResolvedValue({
        success: true,
        data: renewedIdentity,
      });

      const newExpiresAt = new Date(Date.now() + 86400000);

      // Act
      const result = await service.renewAgentIdentity(newExpiresAt);

      // Assert - 验证新过期时间
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expiresAt).toBeDefined();
        const expiresTime = new Date(result.data.expiresAt!).getTime();
        expect(expiresTime).toBeGreaterThan(Date.now());
        expect(result.data.signature).toBe('bmV3U2lnbmF0dXJl');
      }

      // 验证 renewAgent 被正确调用
      expect(mockIdentityDelegator.renewAgent).toHaveBeenCalledWith(
        currentIdentity,
        newExpiresAt,
        expect.any(Function)
      );
    });

    it('should return error when identity delegator not initialized', async () => {
      // Arrange - 错误路径: 没有 identityDelegator
      const serviceWithoutDelegator = new IdentityService({
        logger: mockLogger,
        agentIdentityManager: mockAgentIdentityManager as unknown as AgentIdentityManager,
        // 不设置 identityDelegator
      });

      const newExpiresAt = new Date(Date.now() + 3600000);

      // Act
      const result = await serviceWithoutDelegator.renewAgentIdentity(newExpiresAt);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('IDENTITY_NOT_INITIALIZED');
        expect(result.error.message).toContain('Identity system not initialized');
      }
    });

    it('should return error when agent identity not initialized', async () => {
      // Arrange - 错误路径: 没有 agentIdentityManager
      const serviceWithoutAgent = new IdentityService({
        logger: mockLogger,
        identityDelegator: mockIdentityDelegator as unknown as IdentityDelegator,
        // 不设置 agentIdentityManager
      });

      const newExpiresAt = new Date(Date.now() + 3600000);

      // Act
      const result = await serviceWithoutAgent.renewAgentIdentity(newExpiresAt);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('IDENTITY_NOT_INITIALIZED');
        expect(result.error.message).toContain('Identity system not initialized');
      }
    });

    it('should return error when current agent identity not found', async () => {
      // Arrange - 错误路径: getAgentIdentity 返回 null
      mockAgentIdentityManager.getAgentIdentity.mockReturnValue(null);

      const newExpiresAt = new Date(Date.now() + 3600000);

      // Act
      const result = await service.renewAgentIdentity(newExpiresAt);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('IDENTITY_NOT_FOUND');
        expect(result.error.message).toContain('No current agent identity found');
      }
    });

    it('should return error when node private key not available', async () => {
      // Arrange - 错误路径: getPrivateKey 返回 null
      mockAgentIdentityManager.getAgentIdentity.mockReturnValue({
        id: 'agent-test',
        name: 'Test',
        capabilities: [],
        nodeId: 'node-123',
        publicKey: 'cHVibGlj',
        signature: 'c2ln',
        createdAt: new Date().toISOString(),
      });
      mockNodeIdentityManager.getPrivateKey.mockReturnValue(null);

      const newExpiresAt = new Date(Date.now() + 3600000);

      // Act
      const result = await service.renewAgentIdentity(newExpiresAt);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NODE_KEY_NOT_AVAILABLE');
        expect(result.error.message).toContain('Node private key not available');
      }
    });
  });

  // ============================================================================
  // Getters Tests
  // ============================================================================

  describe('getters', () => {
    it('should return ed25519 signer when set', () => {
      // Arrange - 边界情况: getter 返回值
      const signer = service.getEd25519Signer();

      // Assert
      expect(signer).toBeDefined();
      expect(signer).toBe(mockEd25519Signer as unknown as Ed25519Signer);
    });

    it('should return undefined for ed25519 signer when not set', () => {
      // Arrange - 边界情况: 没有设置 signer
      const serviceWithoutSigner = new IdentityService({
        logger: mockLogger,
      });

      // Act
      const signer = serviceWithoutSigner.getEd25519Signer();

      // Assert
      expect(signer).toBeUndefined();
    });

    it('should return node identity manager when set', () => {
      // Act
      const manager = service.getNodeIdentityManager();

      // Assert
      expect(manager).toBeDefined();
      expect(manager).toBe(mockNodeIdentityManager as unknown as NodeIdentityManager);
    });

    it('should return agent identity manager when set', () => {
      // Act
      const manager = service.getAgentIdentityManager();

      // Assert
      expect(manager).toBeDefined();
      expect(manager).toBe(mockAgentIdentityManager as unknown as AgentIdentityManager);
    });

    it('should return identity delegator when set', () => {
      // Act
      const delegator = service.getIdentityDelegator();

      // Assert
      expect(delegator).toBeDefined();
      expect(delegator).toBe(mockIdentityDelegator as unknown as IdentityDelegator);
    });
  });

  // ============================================================================
  // Setters Tests
  // ============================================================================

  describe('setters', () => {
    it('should update node identity manager via setter', async () => {
      // Arrange
      const serviceWithoutNode = new IdentityService({
        logger: mockLogger,
      });

      // 先验证没有 manager 时返回错误
      const resultBefore = await serviceWithoutNode.exportNodeIdentity();
      expect(resultBefore.success).toBe(false);

      // 设置 manager
      serviceWithoutNode.setNodeIdentityManager(mockNodeIdentityManager as unknown as NodeIdentityManager);

      // 设置 mock 返回值
      mockNodeIdentityManager.exportIdentity.mockReturnValue({
        peerId: '12D3KooNewPeerId',
        privateKey: 'newPrivateKey',
        e2eeKeyPair: { publicKey: 'pub', privateKey: 'priv' },
        createdAt: new Date(),
      });
      mockNodeIdentityManager.getNodeId.mockReturnValue('new-node-id');

      // Act
      const resultAfter = await serviceWithoutNode.exportNodeIdentity();

      // Assert
      expect(resultAfter.success).toBe(true);
      if (resultAfter.success) {
        expect(resultAfter.data.nodeId).toBe('new-node-id');
      }
    });

    it('should update agent identity manager via setter', async () => {
      // Arrange
      const serviceWithoutAgent = new IdentityService({
        logger: mockLogger,
      });

      // 设置 manager
      serviceWithoutAgent.setAgentIdentityManager(mockAgentIdentityManager as unknown as AgentIdentityManager);

      // 设置 mock 返回值
      mockAgentIdentityManager.exportAgentIdentity.mockReturnValue({
        id: 'agent-setter-test',
        name: 'SetterAgent',
        capabilities: [],
        nodeId: 'node-1',
        publicKey: 'pub',
        signature: 'sig',
        createdAt: new Date().toISOString(),
        privateKey: 'priv',
      });

      // Act
      const result = await serviceWithoutAgent.exportAgentIdentity();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('SetterAgent');
      }
    });

    it('should update identity delegator via setter', () => {
      // Arrange
      const serviceWithoutDelegator = new IdentityService({
        logger: mockLogger,
        agentIdentityManager: mockAgentIdentityManager as unknown as AgentIdentityManager,
      });

      // 设置 delegator
      serviceWithoutDelegator.setIdentityDelegator(mockIdentityDelegator as unknown as IdentityDelegator);

      // Act
      const delegator = serviceWithoutDelegator.getIdentityDelegator();

      // Assert
      expect(delegator).toBe(mockIdentityDelegator as unknown as IdentityDelegator);
    });

    it('should update ed25519 signer via setter', () => {
      // Arrange
      const serviceWithoutSigner = new IdentityService({
        logger: mockLogger,
      });

      // 设置 signer
      serviceWithoutSigner.setEd25519Signer(mockEd25519Signer as unknown as Ed25519Signer);

      // Act
      const signer = serviceWithoutSigner.getEd25519Signer();

      // Assert
      expect(signer).toBe(mockEd25519Signer as unknown as Ed25519Signer);
    });
  });
});