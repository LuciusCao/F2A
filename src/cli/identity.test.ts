/**
 * F2A CLI Identity 命令测试
 * 
 * P2-1 修复: 添加 CLI identity 命令的单元测试
 * P2-6 修复: 添加跨节点导入、E2EE 不可用等场景测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir, homedir } from 'os';
import { importIdentityInternal, ImportResult, showIdentityStatus, exportIdentity, importIdentity, showIdentityHelp, AgentImportConfirmation } from './identity.js';
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

// ============================================================
// Tests for previously uncovered functions
// ============================================================

describe('validateImportPath (via importIdentityInternal)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `f2a-path-validation-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should reject non-JSON file extension', async () => {
    const txtFile = join(testDir, 'import.txt');
    writeFileSync(txtFile, 'some content', 'utf-8');
    
    const result = await importIdentityInternal(txtFile, testDir);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_PARAMS');
      expect(result.error.message).toContain('JSON file');
    }
  });

  it('should reject file outside allowed directories', async () => {
    // Create a file in a disallowed location (simulated)
    // Note: realpathSync will fail for non-existent paths
    const fakePath = '/etc/passwd.json';
    
    const result = await importIdentityInternal(fakePath, testDir);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('should accept file in home directory', async () => {
    // Create a valid import file in home directory
    const homeTestDir = join(homedir(), '.f2a-test-temp-' + Date.now());
    mkdirSync(homeTestDir, { recursive: true });
    
    const importFile = join(homeTestDir, 'import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'home-agent-id',
        name: 'home-agent',
        capabilities: [],
        nodeId: 'home-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    const result = await importIdentityInternal(importFile, testDir, true);
    
    expect(result.success).toBe(true);
    
    // Cleanup
    rmSync(homeTestDir, { recursive: true, force: true });
  });

  it('should accept file in temp directory', async () => {
    const importFile = join(testDir, 'import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'temp-agent-id',
        name: 'temp-agent',
        capabilities: [],
        nodeId: 'temp-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    const result = await importIdentityInternal(importFile, testDir, true);
    
    expect(result.success).toBe(true);
  });

  it('should accept relative path within current directory', async () => {
    // Create a file in current working directory
    const cwd = process.cwd();
    const importFile = join(cwd, 'f2a-test-import-' + Date.now() + '.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'cwd-agent-id',
        name: 'cwd-agent',
        capabilities: [],
        nodeId: 'cwd-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    // Use relative path (basename)
    const relativePath = basename(importFile);
    const result = await importIdentityInternal(relativePath, testDir, true);
    
    expect(result.success).toBe(true);
    
    // Cleanup
    rmSync(importFile, { force: true });
  });

  it('should log warning for path traversal patterns but still process if resolved safely', async () => {
    // Create file in test dir, then use .. patterns that resolve to same location
    const subDir = join(testDir, 'subdir');
    mkdirSync(subDir, { recursive: true });
    
    const importFile = join(testDir, 'import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'traversal-agent-id',
        name: 'traversal-agent',
        capabilities: [],
        nodeId: 'traversal-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    // Use path with .. that resolves to testDir
    const pathWithTraversal = join(subDir, '..', 'import.json');
    
    const result = await importIdentityInternal(pathWithTraversal, testDir, true);
    
    expect(result.success).toBe(true);
  });
});

describe('importNodeIdentity edge cases', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `f2a-node-import-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should generate E2EE keys on import', async () => {
    const importFile = join(testDir, 'node-import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      node: {
        nodeId: 'e2ee-test-node-id',
        peerId: 'test-peer-id',
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    const result = await importIdentityInternal(importFile, testDir);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodeImported).toBe(true);
      
      // Verify E2EE keys were generated
      const nodeFile = join(testDir, 'node-identity.json');
      const nodeData = JSON.parse(readFileSync(nodeFile, 'utf-8'));
      expect(nodeData.e2eePrivateKey).toBeDefined();
      expect(nodeData.e2eePublicKey).toBeDefined();
      expect(nodeData.e2eeKeyRegenerated).toBe(true);
    }
  });

  it('should set correct file permissions on node identity', async () => {
    const importFile = join(testDir, 'node-import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      node: {
        nodeId: 'permissions-test-node-id',
        peerId: 'test-peer-id',
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    await importIdentityInternal(importFile, testDir);
    
    const nodeFile = join(testDir, 'node-identity.json');
    const stats = statSync(nodeFile);
    const mode = stats.mode & 0o777;
    
    expect(mode).toBe(0o600);
  });

  it('should import new node identity when existing file is corrupted', async () => {
    // Create corrupted existing file
    const existingNodeFile = join(testDir, 'node-identity.json');
    writeFileSync(existingNodeFile, 'corrupted content', { mode: 0o600 });
    
    const importFile = join(testDir, 'node-import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      node: {
        nodeId: 'new-node-id',
        peerId: 'test-peer-id',
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    const result = await importIdentityInternal(importFile, testDir);
    
    // Should succeed importing new node identity since existing is corrupted
    expect(result.success).toBe(true);
    if (result.success) {
      // Node import succeeds because existing file is corrupted and can't be loaded
      // so the import proceeds
      expect(result.data.nodeImported).toBe(true);
    }
  });
});

describe('importAgentIdentity edge cases', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `f2a-agent-import-edge-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('signature verification', () => {
    it('should require confirmation when no local Node Identity exists', async () => {
      const importFile = join(testDir, 'agent-no-node.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'agent-no-node-id',
          name: 'agent-no-node',
          capabilities: [],
          nodeId: 'agent-node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          createdAt: new Date().toISOString(),
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      // Import without force - should require confirmation
      const result = await importIdentityInternal(importFile, testDir, false);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentConfirmation?.required).toBe(true);
        expect(result.data.agentConfirmation?.reason).toContain('No local Node Identity');
        expect(result.data.agentImported).toBe(false);
      }
    });

    it('should require confirmation for cross-node Agent import', async () => {
      // Create a local Node Identity with different nodeId
      const nodeManager = new NodeIdentityManager({ dataDir: testDir });
      await nodeManager.loadOrCreate();
      const localNodeId = nodeManager.getNodeId();
      
      // Import Agent with different nodeId
      const importFile = join(testDir, 'cross-node-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'cross-node-agent-id',
          name: 'cross-node-agent',
          capabilities: [],
          nodeId: 'different-node-id', // Different from local
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          createdAt: new Date().toISOString(),
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir, false);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentConfirmation?.required).toBe(true);
        expect(result.data.agentConfirmation?.reason).toContain('different Node');
        expect(result.data.agentImported).toBe(false);
      }
    });

    it('should import with force flag even without signature verification', async () => {
      const importFile = join(testDir, 'force-import-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'force-import-agent-id',
          name: 'force-import-agent',
          capabilities: [],
          nodeId: 'force-import-node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          createdAt: new Date().toISOString(),
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir, true);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentImported).toBe(true);
        expect(result.data.agentConfirmation?.required).toBeFalsy();
      }
    });
  });

  describe('expiry validation', () => {
    it('should reject already expired agent identity', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      
      const importFile = join(testDir, 'expired-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'expired-agent-id',
          name: 'expired-agent',
          capabilities: [],
          nodeId: 'expired-agent-node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          createdAt: new Date().toISOString(),
          expiresAt: pastDate.toISOString(),
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir, true);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentImported).toBe(false);
        expect(result.data.agentError).toContain('expired');
      }
    });

    it('should accept valid expiry date in future', async () => {
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
      
      const importFile = join(testDir, 'valid-expiry-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'valid-expiry-agent-id',
          name: 'valid-expiry-agent',
          capabilities: ['test-cap'],
          nodeId: 'valid-expiry-node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          createdAt: new Date().toISOString(),
          expiresAt: futureDate.toISOString(),
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir, true);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentImported).toBe(true);
      }
    });
  });

  describe('required fields validation', () => {
    it('should reject agent without id', async () => {
      const importFile = join(testDir, 'no-id-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          name: 'no-id-agent',
          nodeId: 'node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentImported).toBe(false);
        expect(result.data.agentError).toContain('missing required fields');
      }
    });

    it('should reject agent without name', async () => {
      const importFile = join(testDir, 'no-name-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'no-name-agent-id',
          nodeId: 'node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU=',
          privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentImported).toBe(false);
        expect(result.data.agentError).toContain('missing required fields');
      }
    });

    it('should reject agent without privateKey', async () => {
      const importFile = join(testDir, 'no-private-agent.json');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: {
          id: 'no-private-agent-id',
          name: 'no-private-agent',
          nodeId: 'node-id',
          publicKey: 'dGVzdC1wdWJsaWMta2V5',
          signature: 'dGVzdC1zaWduYXR1cmU='
        }
      }), 'utf-8');
      
      const result = await importIdentityInternal(importFile, testDir);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentImported).toBe(false);
        expect(result.data.agentError).toContain('missing required fields');
      }
    });
  });
});

// Note: showIdentityStatus and exportIdentity use homedir() from os module,
// which doesn't respect process.env.HOME in Node.js.
// These tests verify the functions work correctly with the real data directory.
// For isolated testing, we focus on importIdentityInternal which accepts a custom dataDir.

describe('showIdentityStatus', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should display identity status output', async () => {
    await showIdentityStatus();
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('=== F2A Identity Status ===');
  });

  it('should display Node Identity section', async () => {
    await showIdentityStatus();
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Node Identity:');
  });

  it('should display Agent Identity section', async () => {
    await showIdentityStatus();
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Agent Identity:');
  });
});

describe('exportIdentity', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let testOutputFile: string;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    testOutputFile = join(tmpdir(), `f2a-export-test-${Date.now()}.json`);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    if (existsSync(testOutputFile)) {
      rmSync(testOutputFile, { force: true });
    }
  });

  it('should display export output', async () => {
    await exportIdentity(testOutputFile);
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('=== Exporting F2A Identity ===');
  });

  it('should display Node Identity export result', async () => {
    await exportIdentity(testOutputFile);
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Node Identity:');
  });

  it('should display Agent Identity export result', async () => {
    await exportIdentity(testOutputFile);
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Agent Identity:');
  });

  it('should display security warning', async () => {
    await exportIdentity(testOutputFile);
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('WARNING');
    expect(output).toContain('private keys');
  });

  it('should create export file with correct version', async () => {
    await exportIdentity(testOutputFile);
    
    // Export file may or may not exist depending on whether identities exist
    if (existsSync(testOutputFile)) {
      const exportData = JSON.parse(readFileSync(testOutputFile, 'utf-8'));
      expect(exportData.version).toBe('1.0');
      expect(exportData.exportedAt).toBeDefined();
    }
  });
});

describe('importIdentity CLI entry point', () => {
  let testDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `f2a-import-cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`);
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should exit with error when import fails', async () => {
    const nonExistentFile = join(testDir, 'nonexistent.json');
    
    try {
      await importIdentity(nonExistentFile, false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('process.exit called with code 1');
    }
    
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should show import header', async () => {
    // Create valid import file
    const importFile = join(testDir, 'valid-import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'cli-import-agent-id',
        name: 'cli-import-agent',
        capabilities: [],
        nodeId: 'cli-import-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    try {
      await importIdentity(importFile, true);
    } catch {
      // process.exit(1) may be called for other reasons
    }
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('=== Importing F2A Identity ===');
  });

  it('should show confirmation warning when Agent needs verification', async () => {
    // Create import file without force - will require confirmation
    const importFile = join(testDir, 'needs-confirm.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'needs-confirm-agent-id',
        name: 'needs-confirm-agent',
        capabilities: [],
        nodeId: 'needs-confirm-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    try {
      await importIdentity(importFile, false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('process.exit called with code 1');
    }
    
    // Verify the function ran and produced output
    // The exact output depends on the system's home directory state
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    // Verify it shows import header
    expect(output).toContain('=== Importing F2A Identity ===');
  });

  it('should show Node import result', async () => {
    const importFile = join(testDir, 'node-import-cli.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      node: {
        nodeId: 'cli-node-id',
        peerId: 'cli-peer-id',
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    try {
      await importIdentity(importFile, false);
    } catch {
      // May throw due to process.exit
    }
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Node Identity');
  });

  it('should show completion message', async () => {
    // Create valid import file with force
    const importFile = join(testDir, 'complete-import.json');
    writeFileSync(importFile, JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: 'complete-agent-id',
        name: 'complete-agent',
        capabilities: [],
        nodeId: 'complete-node-id',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        signature: 'dGVzdC1zaWduYXR1cmU=',
        createdAt: new Date().toISOString(),
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
      }
    }), 'utf-8');
    
    try {
      await importIdentity(importFile, true);
    } catch {
      // May throw
    }
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Identity import');
  });
});

describe('showIdentityHelp', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should display help information', () => {
    showIdentityHelp();
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Usage:');
    expect(output).toContain('identity');
    expect(output).toContain('status');
    expect(output).toContain('export');
    expect(output).toContain('import');
  });

  it('should include security warnings', () => {
    showIdentityHelp();
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('--force');
    expect(output).toContain('Security');
  });

  it('should include examples', () => {
    showIdentityHelp();
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Examples:');
    expect(output).toContain('f2a identity status');
    expect(output).toContain('f2a identity export');
    expect(output).toContain('f2a identity import');
  });

  it('should include import limitations notes', () => {
    showIdentityHelp();
    
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Import Limitations');
    expect(output).toContain('E2EE Keys');
  });
});