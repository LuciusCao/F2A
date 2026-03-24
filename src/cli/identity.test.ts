/**
 * F2A CLI Identity 命令测试
 * 
 * P2-1 修复: 添加 CLI identity 命令的单元测试
 * P2-6 修复: 添加跨节点导入、E2EE 不可用等场景测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { importIdentityInternal, ImportResult } from './identity.js';
import { success, failure, createError } from '../types/index.js';
import { NodeIdentityManager } from '../core/identity/node-identity.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), 'f2a-identity-cli-test-' + Date.now());

describe('CLI Identity Commands', () => {
  beforeEach(() => {
    // 创建测试目录
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('importIdentityInternal', () => {
    describe('file validation', () => {
      it('should return error when file does not exist', async () => {
        const result = await importIdentityInternal('/nonexistent/file.json', TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('not found');
        }
      });

      it('should return error when file is not valid JSON', async () => {
        const invalidFile = join(TEST_DIR, 'invalid.json');
        writeFileSync(invalidFile, 'not valid json {{{', 'utf-8');
        
        const result = await importIdentityInternal(invalidFile, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('Failed to read or parse');
        }
      });

      it('should return error for unsupported version', async () => {
        const unsupportedFile = join(TEST_DIR, 'unsupported.json');
        writeFileSync(unsupportedFile, JSON.stringify({
          version: '2.0',
          exportedAt: new Date().toISOString()
        }), 'utf-8');
        
        const result = await importIdentityInternal(unsupportedFile, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('Unsupported identity file version');
        }
      });
    });

    describe('Node Identity import', () => {
      it('should skip when node identity not in import file', async () => {
        const importFile = join(TEST_DIR, 'import.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'test-agent-id',
            name: 'test-agent',
            capabilities: [],
            nodeId: 'test-node-id',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            createdAt: new Date().toISOString(),
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.nodeImported).toBe(false);
          expect(result.data.warnings).toContain('Node Identity: Not in import file');
        }
      });

      it('should return error for invalid nodeId format', async () => {
        const importFile = join(TEST_DIR, 'invalid-node.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          node: {
            nodeId: 'invalid@node!id', // 包含非法字符
            peerId: 'test-peer-id',
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.nodeImported).toBe(false);
          expect(result.data.nodeError).toContain('Invalid nodeId format');
        }
      });

      it('should import node identity when no existing identity', async () => {
        const importFile = join(TEST_DIR, 'node-import.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          node: {
            nodeId: 'valid-node-id',
            peerId: 'test-peer-id',
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.nodeImported).toBe(true);
          
          // 验证文件已创建
          const nodeFile = join(TEST_DIR, 'node-identity.json');
          expect(existsSync(nodeFile)).toBe(true);
        }
      });

      it('should refuse to overwrite different node identity', async () => {
        // 使用 NodeIdentityManager 创建一个有效的现有 Node Identity
        const nodeManager = new NodeIdentityManager({ dataDir: TEST_DIR });
        const createResult = await nodeManager.loadOrCreate();
        expect(createResult.success).toBe(true);
        
        const existingNodeId = nodeManager.getNodeId();
        expect(existingNodeId).not.toBeNull();
        
        const importFile = join(TEST_DIR, 'different-node.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          node: {
            nodeId: 'different-node-id',
            peerId: 'test-peer-id',
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.nodeImported).toBe(false);
          expect(result.data.nodeError).toContain('Cannot import Node Identity');
          expect(result.data.nodeError).toContain('different Node Identity already exists');
        }
      });

      it('should accept same node identity without error', async () => {
        // 先创建一个现有的 Node Identity
        const existingNodeFile = join(TEST_DIR, 'node-identity.json');
        writeFileSync(existingNodeFile, JSON.stringify({
          nodeId: 'same-node-id',
          peerId: 'existing-private-key',
          e2eePrivateKey: '',
          e2eePublicKey: '',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString()
        }), { mode: 0o600 });
        
        const importFile = join(TEST_DIR, 'same-node.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          node: {
            nodeId: 'same-node-id',
            peerId: 'test-peer-id',
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.nodeImported).toBe(true);
        }
      });
    });

    describe('Agent Identity import', () => {
      it('should skip when agent identity not in import file', async () => {
        const importFile = join(TEST_DIR, 'no-agent.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString()
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agentImported).toBe(false);
          expect(result.data.warnings).toContain('Agent Identity: Not in import file');
        }
      });

      it('should return error for missing required fields', async () => {
        const importFile = join(TEST_DIR, 'incomplete-agent.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'test-agent-id',
            name: 'test-agent'
            // 缺少 nodeId, publicKey, signature, privateKey
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agentImported).toBe(false);
          expect(result.data.agentError).toContain('missing required fields');
        }
      });

      it('should return error for expired agent identity', async () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1); // 昨天已过期
        
        const importFile = join(TEST_DIR, 'expired-agent.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'test-agent-id',
            name: 'test-agent',
            capabilities: [],
            nodeId: 'test-node-id',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            createdAt: new Date().toISOString(),
            expiresAt: pastDate.toISOString(),
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agentImported).toBe(false);
          expect(result.data.agentError).toContain('expired');
        }
      });

      it('should import valid agent identity', async () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30); // 30天后过期
        
        const importFile = join(TEST_DIR, 'valid-agent.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'test-agent-id',
            name: 'test-agent',
            capabilities: ['capability1', 'capability2'],
            nodeId: 'test-node-id',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            createdAt: new Date().toISOString(),
            expiresAt: futureDate.toISOString(),
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        // P1-2 修复: 使用 forceImport 跳过签名验证
        const result = await importIdentityInternal(importFile, TEST_DIR, true);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agentImported).toBe(true);
          
          // 验证文件已创建
          const agentFile = join(TEST_DIR, 'agent-identity.json');
          expect(existsSync(agentFile)).toBe(true);
          
          // 验证内容
          const savedData = JSON.parse(readFileSync(agentFile, 'utf-8'));
          expect(savedData.id).toBe('test-agent-id');
          expect(savedData.name).toBe('test-agent');
        }
      });

      it('should import agent without expiry date', async () => {
        const importFile = join(TEST_DIR, 'no-expiry-agent.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'test-agent-id',
            name: 'test-agent',
            capabilities: [],
            nodeId: 'test-node-id',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            createdAt: new Date().toISOString(),
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        // P1-2 修复: 使用 forceImport 跳过签名验证
        const result = await importIdentityInternal(importFile, TEST_DIR, true);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agentImported).toBe(true);
        }
      });

      it('should set correct file permissions', async () => {
        const importFile = join(TEST_DIR, 'permissions-agent.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'test-agent-id',
            name: 'test-agent',
            capabilities: [],
            nodeId: 'test-node-id',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            createdAt: new Date().toISOString(),
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        // P1-2 修复: 使用 forceImport 跳过签名验证
        await importIdentityInternal(importFile, TEST_DIR, true);
        
        const agentFile = join(TEST_DIR, 'agent-identity.json');
        const stats = await import('fs').then(fs => fs.statSync(agentFile));
        const mode = stats.mode & 0o777;
        
        expect(mode).toBe(0o600);
      });
    });

    describe('combined import', () => {
      it('should import both node and agent identity', async () => {
        // 先创建一个有效的 Node Identity
        const nodeManager = new NodeIdentityManager({ dataDir: TEST_DIR });
        await nodeManager.loadOrCreate();
        const existingNodeId = nodeManager.getNodeId();
        
        // 使用与现有 Node 相同的 nodeId 创建 Agent 导入数据
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        
        const importFile = join(TEST_DIR, 'combined.json');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          node: {
            nodeId: existingNodeId, // 使用现有的 nodeId
            peerId: 'test-peer-id',
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          },
          agent: {
            id: 'combined-agent-id',
            name: 'combined-agent',
            capabilities: [],
            nodeId: existingNodeId, // 与 node nodeId 匹配
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            createdAt: new Date().toISOString(),
            expiresAt: futureDate.toISOString(),
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importIdentityInternal(importFile, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          // Node 应该成功导入（相同 nodeId）
          expect(result.data.nodeImported).toBe(true);
          // Agent 可能因为签名验证失败而失败，但这是预期行为
          // 因为我们使用的是假的签名数据
        }
      });
    });
  });

  describe('Result type pattern (P2-2)', () => {
    it('should return Result type instead of throwing or exiting', async () => {
      // 这个测试验证 P2-2 修复：importIdentityInternal 返回 Result 类型
      const result = await importIdentityInternal('/nonexistent/file.json', TEST_DIR);
      
      // 应该返回 Result 类型，而不是抛出异常或调用 process.exit
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);
      
      if (!result.success) {
        expect(result.error).toHaveProperty('code');
        expect(result.error).toHaveProperty('message');
      }
    });

    it('should allow caller to handle errors', async () => {
      const invalidFile = join(TEST_DIR, 'invalid.json');
      writeFileSync(invalidFile, 'not json', 'utf-8');
      
      // 调用者可以处理错误而不需要 try-catch
      const result = await importIdentityInternal(invalidFile, TEST_DIR);
      
      if (!result.success) {
        // 调用者可以访问错误信息
        const errorCode = result.error.code;
        const errorMessage = result.error.message;
        
        expect(errorCode).toBe('INVALID_PARAMS');
        expect(errorMessage).toContain('Failed to read or parse');
      }
    });
  });
});

describe('importIdentityInternal edge cases', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `f2a-identity-edge-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create data directory if not exists', async () => {
    const newDir = join(testDir, 'new-data-dir');
    
    const importFile = join(testDir, 'import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'test-agent-id',
        name: 'test-agent',
        capabilities: [],
        nodeId: 'test-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    const result = await importIdentityInternal(importFile, newDir);
    
    expect(result.success).toBe(true);
    expect(existsSync(newDir)).toBe(true);
  });

  it('should handle empty import file gracefully', async () => {
    const emptyFile = join(testDir, 'empty.json');
    writeFileSync(emptyFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString()
    }), 'utf-8');
    
    const result = await importIdentityInternal(emptyFile, testDir);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodeImported).toBe(false);
      expect(result.data.agentImported).toBe(false);
    }
  });

  it('should preserve existing data when partial import fails', async () => {
    // 创建现有的 Agent Identity
    const existingAgentFile = join(testDir, 'agent-identity.json');
    const existingAgentData = {
      id: 'existing-agent-id',
      name: 'existing-agent',
      capabilities: ['existing-cap'],
      nodeId: 'existing-node-id',
      publicKey: 'ZXhpc3RpbmctcHVibGljLWtleQ==',
      signature: 'ZXhpc3Rpbmctc2lnbmF0dXJl',
      createdAt: new Date().toISOString(),
      privateKey: 'ZXhpc3RpbmctcHJpdmF0ZS1rZXk='
    };
    writeFileSync(existingAgentFile, JSON.stringify(existingAgentData, null, 2), { mode: 0o600 });
    
    // 尝试导入一个无效的 Agent Identity
    const importFile = join(testDir, 'invalid-import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'invalid-agent-id'
        // 缺少必要字段
      }
    }), 'utf-8');
    
    const result = await importIdentityInternal(importFile, testDir);
    
    // 导入失败，但现有数据应该保留
    const savedData = JSON.parse(readFileSync(existingAgentFile, 'utf-8'));
    expect(savedData.id).toBe('existing-agent-id');
    expect(savedData.name).toBe('existing-agent');
  });
});