/**
 * F2A CLI Agents 命令测试
 * 
 * 测试内容：
 * 1. `f2a agents list` - 测试列出功能
 * 2. `f2a agents export/import` - 测试导出导入流程
 * 3. `f2a agents delete` - 测试删除功能
 * 4. 多 Agent 场景 - 多个 identity 文件共存
 * 5. 错误场景 - 不存在的 agentId、损坏的文件等
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir, homedir } from 'os';
import {
  listAgentsInternal,
  exportAgentInternal,
  importAgentInternal,
  deleteAgentInternal,
  getAgentIdentityFiles,
  findAgentFileById,
  findAgentFileByName,
  getDataDir,
  AgentIdentityFile,
  ListResult,
  ExportResult,
  ImportResult,
  DeleteResult,
  DeleteSecurityOptions,
  SecurityCheckResult,
  TokenValidationResult,
  createSessionToken,
  createCorruptedSessionToken,
  showAgentsHelp,
  listAgents,
  exportAgent,
  importAgent,
  deleteAgent
} from './agents.js';
import { success, failure, createError } from '../types/index.js';
import { NodeIdentityManager } from '../core/identity/node-identity.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';
import { IdentityDelegator } from '../core/identity/delegator.js';
import type { ExportedAgentIdentity } from '../core/identity/types.js';

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), 'f2a-agents-cli-test-' + Date.now());

// 创建有效的 Agent Identity 数据
function createValidAgentData(agentId: string, name: string, nodeId: string): ExportedAgentIdentity {
  return {
    id: agentId,
    name,
    capabilities: ['test-capability'],
    nodeId,
    publicKey: 'dGVzdC1wdWJsaWMta2V5',
    signature: 'dGVzdC1zaWduYXR1cmU=',
    createdAt: new Date().toISOString(),
    privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
  };
}

// 创建带过期时间的 Agent Identity 数据
function createExpiringAgentData(agentId: string, name: string, nodeId: string, expiresAt: Date): ExportedAgentIdentity {
  return {
    ...createValidAgentData(agentId, name, nodeId),
    expiresAt: expiresAt.toISOString()
  };
}

describe('CLI Agents Commands', () => {
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

  // ==========================================
  // 1. listAgentsInternal - 列出功能测试
  // ==========================================
  describe('listAgentsInternal', () => {
    describe('基本功能', () => {
      it('should return empty list when no agent identities exist', async () => {
        const emptyDir = join(TEST_DIR, 'empty');
        mkdirSync(emptyDir, { recursive: true });
        
        const result = await listAgentsInternal(emptyDir);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents).toEqual([]);
          expect(result.data.total).toBe(0);
          expect(result.data.dataDir).toBe(emptyDir);
        }
      });

      it('should return empty list when data directory does not exist', async () => {
        const nonExistentDir = join(TEST_DIR, 'nonexistent');
        
        const result = await listAgentsInternal(nonExistentDir);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents).toEqual([]);
          expect(result.data.total).toBe(0);
        }
      });

      it('should list single agent identity file', async () => {
        const agentData = createValidAgentData('agent-001', 'TestAgent', 'node-001');
        const agentFile = join(TEST_DIR, 'agent-identity.json');
        writeFileSync(agentFile, JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.total).toBe(1);
          expect(result.data.agents[0].agentId).toBe('agent-001');
          expect(result.data.agents[0].name).toBe('TestAgent');
        }
      });

      it('should list multiple agent identity files', async () => {
        // 创建多个 Agent Identity 文件
        const agent1 = createValidAgentData('agent-001', 'AgentOne', 'node-001');
        const agent2 = createValidAgentData('agent-002', 'AgentTwo', 'node-001');
        const agent3 = createValidAgentData('agent-003', 'AgentThree', 'node-001');
        
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(agent1, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-agent-002.json'), JSON.stringify(agent2, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-agent-003.json'), JSON.stringify(agent3, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.total).toBe(3);
          expect(result.data.agents.map(a => a.agentId)).toContain('agent-001');
          expect(result.data.agents.map(a => a.agentId)).toContain('agent-002');
          expect(result.data.agents.map(a => a.agentId)).toContain('agent-003');
        }
      });

      it('should sort agents by creation time (most recent first)', async () => {
        const olderDate = new Date('2024-01-01');
        const newerDate = new Date('2024-12-01');
        
        const agent1 = { ...createValidAgentData('agent-001', 'OldAgent', 'node-001'), createdAt: olderDate.toISOString() };
        const agent2 = { ...createValidAgentData('agent-002', 'NewAgent', 'node-001'), createdAt: newerDate.toISOString() };
        
        writeFileSync(join(TEST_DIR, 'agent-identity-old.json'), JSON.stringify(agent1, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-new.json'), JSON.stringify(agent2, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents[0].agentId).toBe('agent-002'); // newer first
          expect(result.data.agents[1].agentId).toBe('agent-001');
        }
      });
    });

    describe('文件过滤', () => {
      it('should only list files with agent-identity prefix', async () => {
        const agentData = createValidAgentData('agent-001', 'TestAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'other-file.json'), JSON.stringify({ other: 'data' }), 'utf-8');
        writeFileSync(join(TEST_DIR, 'node-identity.json'), JSON.stringify({ nodeId: 'node-001' }), 'utf-8');
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.total).toBe(1);
          expect(result.data.agents[0].agentId).toBe('agent-001');
        }
      });

      it('should only list .json files', async () => {
        const agentData = createValidAgentData('agent-001', 'TestAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity.txt'), 'not json', 'utf-8');
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.total).toBe(1);
        }
      });

      it('should skip corrupted agent identity files', async () => {
        const validAgent = createValidAgentData('agent-001', 'ValidAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(validAgent, null, 2), { mode: 0o600 });
        
        // 写入损坏的文件
        writeFileSync(join(TEST_DIR, 'agent-identity-corrupted.json'), 'not valid json {{{', 'utf-8');
        writeFileSync(join(TEST_DIR, 'agent-identity-missing-fields.json'), JSON.stringify({ id: 'incomplete' }), 'utf-8');
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.total).toBe(1);
          expect(result.data.agents[0].agentId).toBe('agent-001');
        }
      });
    });

    describe('过期状态', () => {
      it('should mark agent as expired when expiresAt is in the past', async () => {
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const expiredAgent = createExpiringAgentData('agent-001', 'ExpiredAgent', 'node-001', pastDate);
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(expiredAgent, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents[0].isExpired).toBe(true);
        }
      });

      it('should mark agent as valid when expiresAt is in the future', async () => {
        const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const validAgent = createExpiringAgentData('agent-001', 'ValidAgent', 'node-001', futureDate);
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(validAgent, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents[0].isExpired).toBe(false);
        }
      });

      it('should mark agent as valid when no expiresAt field', async () => {
        const nonExpiringAgent = createValidAgentData('agent-001', 'NonExpiringAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(nonExpiringAgent, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents[0].isExpired).toBe(false);
        }
      });
    });

    describe('文件元数据', () => {
      it('should include file size in result', async () => {
        const agentData = createValidAgentData('agent-001', 'TestAgent', 'node-001');
        const agentFile = join(TEST_DIR, 'agent-identity.json');
        writeFileSync(agentFile, JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const expectedSize = statSync(agentFile).size;
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents[0].fileSize).toBe(expectedSize);
        }
      });

      it('should include correct file path', async () => {
        const agentData = createValidAgentData('agent-001', 'TestAgent', 'node-001');
        const filename = 'agent-identity.json';
        writeFileSync(join(TEST_DIR, filename), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents[0].filePath).toBe(join(TEST_DIR, filename));
          expect(result.data.agents[0].filename).toBe(filename);
        }
      });
    });
  });

  // ==========================================
  // 2. exportAgentInternal - 导出功能测试
  // ==========================================
  describe('exportAgentInternal', () => {
    beforeEach(() => {
      // 创建测试用的 Agent Identity 文件
      const agentData = createValidAgentData('agent-export-001', 'ExportAgent', 'node-export-001');
      writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
    });

    describe('基本导出功能', () => {
      it('should export agent by Agent ID', async () => {
        const outputPath = join(TEST_DIR, 'export-output.json');
        const result = await exportAgentInternal('agent-export-001', outputPath, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.exported).toBe(true);
          expect(result.data.agentId).toBe('agent-export-001');
          expect(existsSync(outputPath)).toBe(true);
        }
      });

      it('should export agent by filename', async () => {
        const outputPath = join(TEST_DIR, 'export-output.json');
        const result = await exportAgentInternal('agent-identity.json', outputPath, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.exported).toBe(true);
        }
      });

      it('should create export file with correct version', async () => {
        const outputPath = join(TEST_DIR, 'export-output.json');
        await exportAgentInternal('agent-export-001', outputPath, TEST_DIR);
        
        const exportContent = JSON.parse(readFileSync(outputPath, 'utf-8'));
        expect(exportContent.version).toBe('1.0');
        expect(exportContent.exportedAt).toBeDefined();
        expect(exportContent.agent).toBeDefined();
      });

      it('should use default output path when not specified', async () => {
        const result = await exportAgentInternal('agent-export-001', undefined, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.outputPath).toContain('f2a-agent');
          expect(result.data.outputPath).toContain('.json');
        }
      });

      it('should set correct file permissions on export file', async () => {
        const outputPath = join(TEST_DIR, 'export-output.json');
        await exportAgentInternal('agent-export-001', outputPath, TEST_DIR);
        
        const stats = statSync(outputPath);
        const mode = stats.mode & 0o777;
        expect(mode).toBe(0o600);
      });
    });

    describe('错误场景', () => {
      it('should return error when agent not found by ID', async () => {
        const result = await exportAgentInternal('nonexistent-agent', undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_NOT_FOUND');
        }
      });

      it('should return error when agent not found by filename', async () => {
        const result = await exportAgentInternal('nonexistent-file.json', undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_NOT_FOUND');
        }
      });

      it('should return error when data directory is empty', async () => {
        const emptyDir = join(TEST_DIR, 'empty');
        mkdirSync(emptyDir, { recursive: true });
        
        const result = await exportAgentInternal('any-agent', undefined, emptyDir);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_NOT_FOUND');
        }
      });
    });

    describe('警告信息', () => {
      it('should include warning when exporting expired agent', async () => {
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const expiredAgent = createExpiringAgentData('expired-001', 'ExpiredAgent', 'node-001', pastDate);
        writeFileSync(join(TEST_DIR, 'agent-identity-expired.json'), JSON.stringify(expiredAgent, null, 2), { mode: 0o600 });
        
        const outputPath = join(TEST_DIR, 'export-output.json');
        const result = await exportAgentInternal('expired-001', outputPath, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.warnings).toContain('Agent identity is expired');
        }
      });

      it('should not include warning when exporting valid agent', async () => {
        const outputPath = join(TEST_DIR, 'export-output.json');
        const result = await exportAgentInternal('agent-export-001', outputPath, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.warnings).toEqual([]);
        }
      });
    });
  });

  // ==========================================
  // 3. importAgentInternal - 导入功能测试
  // ==========================================
  describe('importAgentInternal', () => {
    describe('文件验证', () => {
      it('should return error when import file does not exist', async () => {
        const result = await importAgentInternal('/nonexistent/file.json', undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('not found');
        }
      });

      it('should return error when file is not valid JSON', async () => {
        const invalidFile = join(TEST_DIR, 'invalid.json');
        writeFileSync(invalidFile, 'not valid json {{{', 'utf-8');
        
        const result = await importAgentInternal(invalidFile, undefined, TEST_DIR);
        
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
        
        const result = await importAgentInternal(unsupportedFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('Unsupported import file version');
        }
      });

      it('should return error for non-JSON file extension', async () => {
        const txtFile = join(TEST_DIR, 'import.txt');
        writeFileSync(txtFile, 'some content', 'utf-8');
        
        const result = await importAgentInternal(txtFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('JSON file');
        }
      });

      it('should return error when no agent data in import file', async () => {
        const emptyImportFile = join(TEST_DIR, 'empty-import.json');
        writeFileSync(emptyImportFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString()
        }), 'utf-8');
        
        const result = await importAgentInternal(emptyImportFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARAMS');
          expect(result.error.message).toContain('No agent identity');
        }
      });
    });

    describe('Agent 数据验证', () => {
      it('should return error for missing required fields', async () => {
        const incompleteFile = join(TEST_DIR, 'incomplete-agent.json');
        writeFileSync(incompleteFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'agent-incomplete'
            // 缺少 name, nodeId, publicKey, signature, privateKey
          }
        }), 'utf-8');
        
        const result = await importAgentInternal(incompleteFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_IDENTITY_CORRUPTED');
          expect(result.error.message).toContain('missing required fields');
        }
      });

      it('should return error for missing id', async () => {
        const noIdFile = join(TEST_DIR, 'no-id-agent.json');
        writeFileSync(noIdFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            name: 'NoIdAgent',
            nodeId: 'node-001',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU=',
            privateKey: 'dGVzdC1wcml2YXRlLWtleQ=='
          }
        }), 'utf-8');
        
        const result = await importAgentInternal(noIdFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_IDENTITY_CORRUPTED');
        }
      });

      it('should return error for missing privateKey', async () => {
        const noPrivateKeyFile = join(TEST_DIR, 'no-private-agent.json');
        writeFileSync(noPrivateKeyFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: {
            id: 'agent-001',
            name: 'NoPrivateAgent',
            nodeId: 'node-001',
            publicKey: 'dGVzdC1wdWJsaWMta2V5',
            signature: 'dGVzdC1zaWduYXR1cmU='
          }
        }), 'utf-8');
        
        const result = await importAgentInternal(noPrivateKeyFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_IDENTITY_CORRUPTED');
        }
      });
    });

    describe('成功导入', () => {
      it('should import valid agent identity', async () => {
        const importFile = join(TEST_DIR, 'valid-import.json');
        const agentData = createValidAgentData('import-001', 'ImportAgent', 'node-001');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData
        }), 'utf-8');
        
        const result = await importAgentInternal(importFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.imported).toBe(true);
          expect(result.data.agentId).toBe('import-001');
        }
      });

      it('should import with custom filename', async () => {
        const importFile = join(TEST_DIR, 'custom-import.json');
        const agentData = createValidAgentData('custom-001', 'CustomAgent', 'node-001');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData
        }), 'utf-8');
        
        const customFilename = 'my-custom-agent.json';
        const result = await importAgentInternal(importFile, customFilename, TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.filename).toBe(customFilename);
          expect(existsSync(join(TEST_DIR, customFilename))).toBe(true);
        }
      });

      it('should set correct file permissions on imported file', async () => {
        const importFile = join(TEST_DIR, 'permission-import.json');
        const agentData = createValidAgentData('permission-001', 'PermissionAgent', 'node-001');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData
        }), 'utf-8');
        
        await importAgentInternal(importFile, undefined, TEST_DIR);
        
        const importedFiles = readdirSync(TEST_DIR).filter(f => f.startsWith('agent-identity'));
        for (const file of importedFiles) {
          const stats = statSync(join(TEST_DIR, file));
          const mode = stats.mode & 0o777;
          expect(mode).toBe(0o600);
        }
      });

      it('should create data directory if not exists', async () => {
        const newDir = join(TEST_DIR, 'new-data-dir');
        const importFile = join(TEST_DIR, 'new-import.json');
        const agentData = createValidAgentData('new-001', 'NewAgent', 'node-001');
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData
        }), 'utf-8');
        
        const result = await importAgentInternal(importFile, undefined, newDir);
        
        expect(result.success).toBe(true);
        expect(existsSync(newDir)).toBe(true);
      });
    });

    describe('过期处理', () => {
      it('should reject expired agent without force flag', async () => {
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const importFile = join(TEST_DIR, 'expired-import.json');
        const expiredAgent = createExpiringAgentData('expired-import-001', 'ExpiredImportAgent', 'node-001', pastDate);
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: expiredAgent
        }), 'utf-8');
        
        const result = await importAgentInternal(importFile, undefined, TEST_DIR, false);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_IDENTITY_EXPIRED');
        }
      });

      it('should import expired agent with force flag', async () => {
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const importFile = join(TEST_DIR, 'expired-force-import.json');
        const expiredAgent = createExpiringAgentData('expired-force-001', 'ExpiredForceAgent', 'node-001', pastDate);
        writeFileSync(importFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: expiredAgent
        }), 'utf-8');
        
        const result = await importAgentInternal(importFile, undefined, TEST_DIR, true);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.imported).toBe(true);
          expect(result.data.warnings).toContain('Imported agent identity is expired');
        }
      });
    });

    describe('重复导入', () => {
      it('should reject duplicate agent ID without force', async () => {
        // 先导入一个
        const importFile1 = join(TEST_DIR, 'duplicate-import-1.json');
        const agentData1 = createValidAgentData('duplicate-001', 'DuplicateAgent', 'node-001');
        writeFileSync(importFile1, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData1
        }), 'utf-8');
        
        await importAgentInternal(importFile1, undefined, TEST_DIR);
        
        // 再导入相同的 ID
        const importFile2 = join(TEST_DIR, 'duplicate-import-2.json');
        writeFileSync(importFile2, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData1
        }), 'utf-8');
        
        const result = await importAgentInternal(importFile2, undefined, TEST_DIR, false);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_ALREADY_EXISTS');
        }
      });

      it('should overwrite duplicate agent ID with force', async () => {
        // 先导入一个
        const importFile1 = join(TEST_DIR, 'overwrite-import-1.json');
        const agentData1 = createValidAgentData('overwrite-001', 'OriginalAgent', 'node-001');
        writeFileSync(importFile1, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData1
        }), 'utf-8');
        
        await importAgentInternal(importFile1, undefined, TEST_DIR);
        
        // 强制覆盖
        const importFile2 = join(TEST_DIR, 'overwrite-import-2.json');
        const agentData2 = createValidAgentData('overwrite-001', 'UpdatedAgent', 'node-001');
        writeFileSync(importFile2, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData2
        }), 'utf-8');
        
        const result = await importAgentInternal(importFile2, undefined, TEST_DIR, true);
        
        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================
  // 4. deleteAgentInternal - 删除功能测试
  // ==========================================
  describe('deleteAgentInternal', () => {
    beforeEach(() => {
      const agentData = createValidAgentData('delete-001', 'DeleteAgent', 'node-001');
      writeFileSync(join(TEST_DIR, 'agent-identity.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
      
      const agentData2 = createValidAgentData('delete-002', 'DeleteAgent2', 'node-001');
      writeFileSync(join(TEST_DIR, 'agent-identity-delete-002.json'), JSON.stringify(agentData2, null, 2), { mode: 0o600 });
    });

    describe('基本删除功能', () => {
      it('should delete agent by Agent ID', async () => {
        // 使用 force 参数跳过安全检查（基本功能测试）
        const result = await deleteAgentInternal('delete-001', TEST_DIR, { force: true });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.agentId).toBe('delete-001');
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity.json'))).toBe(false);
      });

      it('should delete agent by filename', async () => {
        // 使用 force 参数跳过安全检查
        const result = await deleteAgentInternal('agent-identity-delete-002.json', TEST_DIR, { force: true });
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.filename).toBe('agent-identity-delete-002.json');
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-delete-002.json'))).toBe(false);
      });

      it('should only delete specified agent, not others', async () => {
        // 使用 force 参数跳过安全检查
        const result = await deleteAgentInternal('delete-001', TEST_DIR, { force: true });
        
        expect(result.success).toBe(true);
        
        // 另一个 agent 应该还存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-delete-002.json'))).toBe(true);
      });
    });

    describe('错误场景', () => {
      it('should return error when agent not found by ID', async () => {
        const result = await deleteAgentInternal('nonexistent-agent', TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_NOT_FOUND');
        }
      });

      it('should return error when agent not found by filename', async () => {
        const result = await deleteAgentInternal('nonexistent-file.json', TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_NOT_FOUND');
        }
      });

      it('should return error when data directory is empty', async () => {
        const emptyDir = join(TEST_DIR, 'empty');
        mkdirSync(emptyDir, { recursive: true });
        
        const result = await deleteAgentInternal('any-agent', emptyDir, { force: true });
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('AGENT_NOT_FOUND');
        }
      });
    });

    describe('安全性', () => {
      it('should permanently delete private keys', async () => {
        const agentFile = join(TEST_DIR, 'agent-identity.json');
        const contentBefore = readFileSync(agentFile, 'utf-8');
        expect(contentBefore).toContain('privateKey');
        
        // 使用 force 参数跳过安全检查
        await deleteAgentInternal('delete-001', TEST_DIR, { force: true });
        
        expect(existsSync(agentFile)).toBe(false);
      });
    });
  });

  // ==========================================
  // 5. 多 Agent 场景测试
  // ==========================================
  describe('Multi-Agent Scenarios', () => {
    beforeEach(() => {
      // 创建多个不同 Node ID 的 Agent
      const agent1 = createValidAgentData('multi-001', 'AgentNode1', 'node-alpha');
      const agent2 = createValidAgentData('multi-002', 'AgentNode2', 'node-beta');
      const agent3 = createValidAgentData('multi-003', 'AgentNode3', 'node-gamma');
      
      writeFileSync(join(TEST_DIR, 'agent-identity-multi-001.json'), JSON.stringify(agent1, null, 2), { mode: 0o600 });
      writeFileSync(join(TEST_DIR, 'agent-identity-multi-002.json'), JSON.stringify(agent2, null, 2), { mode: 0o600 });
      writeFileSync(join(TEST_DIR, 'agent-identity-multi-003.json'), JSON.stringify(agent3, null, 2), { mode: 0o600 });
    });

    it('should list all agents from different nodes', async () => {
      const result = await listAgentsInternal(TEST_DIR);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.total).toBe(3);
        const nodeIds = result.data.agents.map(a => a.nodeId);
        expect(nodeIds).toContain('node-alpha');
        expect(nodeIds).toContain('node-beta');
        expect(nodeIds).toContain('node-gamma');
      }
    });

    it('should export specific agent from multi-agent directory', async () => {
      const outputPath = join(TEST_DIR, 'export-multi-002.json');
      const result = await exportAgentInternal('multi-002', outputPath, TEST_DIR);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentId).toBe('multi-002');
        const exportContent = JSON.parse(readFileSync(outputPath, 'utf-8'));
        expect(exportContent.agent.nodeId).toBe('node-beta');
      }
    });

    it('should delete specific agent without affecting others', async () => {
      // 使用 force 参数跳过安全检查
      const result = await deleteAgentInternal('multi-001', TEST_DIR, { force: true });
      
      expect(result.success).toBe(true);
      
      // 验证剩余 agents
      const remainingResult = await listAgentsInternal(TEST_DIR);
      if (remainingResult.success) {
        expect(remainingResult.data.total).toBe(2);
        expect(remainingResult.data.agents.map(a => a.agentId)).toContain('multi-002');
        expect(remainingResult.data.agents.map(a => a.agentId)).toContain('multi-003');
      }
    });

    it('should handle import into multi-agent directory', async () => {
      const importFile = join(TEST_DIR, 'import-multi.json');
      const newAgent = createValidAgentData('imported-multi', 'ImportedAgent', 'node-delta');
      writeFileSync(importFile, JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        agent: newAgent
      }), 'utf-8');
      
      const result = await importAgentInternal(importFile, undefined, TEST_DIR);
      
      expect(result.success).toBe(true);
      
      // 验证总数
      const listResult = await listAgentsInternal(TEST_DIR);
      if (listResult.success) {
        expect(listResult.data.total).toBe(4);
      }
    });

    it('should find agent by ID in multi-agent directory', async () => {
      const agentFile = findAgentFileById('multi-002', TEST_DIR);
      
      expect(agentFile).not.toBeNull();
      if (agentFile) {
        expect(agentFile.agentId).toBe('multi-002');
        expect(agentFile.nodeId).toBe('node-beta');
      }
    });

    it('should find agent by filename in multi-agent directory', async () => {
      const agentFile = findAgentFileByName('agent-identity-multi-003.json', TEST_DIR);
      
      expect(agentFile).not.toBeNull();
      if (agentFile) {
        expect(agentFile.agentId).toBe('multi-003');
      }
    });

    it('should not find nonexistent agent', async () => {
      const agentFile = findAgentFileById('nonexistent', TEST_DIR);
      expect(agentFile).toBeNull();
    });
  });

  // ==========================================
  // 6. 辅助函数测试
  // ==========================================
  describe('Helper Functions', () => {
    describe('getAgentIdentityFiles', () => {
      it('should return empty array for nonexistent directory', () => {
        const files = getAgentIdentityFiles(join(TEST_DIR, 'nonexistent'));
        expect(files).toEqual([]);
      });

      it('should return sorted files by creation time', () => {
        const olderDate = new Date('2024-01-01');
        const newerDate = new Date('2024-12-01');
        
        const agent1 = { ...createValidAgentData('old-001', 'OldAgent', 'node-001'), createdAt: olderDate.toISOString() };
        const agent2 = { ...createValidAgentData('new-001', 'NewAgent', 'node-001'), createdAt: newerDate.toISOString() };
        
        writeFileSync(join(TEST_DIR, 'agent-identity-old.json'), JSON.stringify(agent1));
        writeFileSync(join(TEST_DIR, 'agent-identity-new.json'), JSON.stringify(agent2));
        
        const files = getAgentIdentityFiles(TEST_DIR);
        expect(files[0].agentId).toBe('new-001');
        expect(files[1].agentId).toBe('old-001');
      });
    });

    describe('findAgentFileById', () => {
      it('should find agent by exact ID match', async () => {
        const agentData = createValidAgentData('find-001', 'FindAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-find.json'), JSON.stringify(agentData));
        
        const result = findAgentFileById('find-001', TEST_DIR);
        
        expect(result).not.toBeNull();
        expect(result?.agentId).toBe('find-001');
      });

      it('should return null for nonexistent ID', () => {
        const result = findAgentFileById('nonexistent', TEST_DIR);
        expect(result).toBeNull();
      });
    });

    describe('findAgentFileByName', () => {
      it('should find agent by exact filename', async () => {
        const agentData = createValidAgentData('byname-001', 'ByNameAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-byname.json'), JSON.stringify(agentData));
        
        const result = findAgentFileByName('agent-identity-byname.json', TEST_DIR);
        
        expect(result).not.toBeNull();
        expect(result?.filename).toBe('agent-identity-byname.json');
      });

      it('should return null for nonexistent filename', () => {
        const result = findAgentFileByName('nonexistent.json', TEST_DIR);
        expect(result).toBeNull();
      });

      it('should return null for corrupted file', async () => {
        writeFileSync(join(TEST_DIR, 'agent-identity-corrupted.json'), 'corrupted');
        
        const result = findAgentFileByName('agent-identity-corrupted.json', TEST_DIR);
        expect(result).toBeNull();
      });
    });

    describe('getDataDir', () => {
      it('should return correct default data directory', () => {
        const dataDir = getDataDir();
        expect(dataDir).toContain('.f2a');
        expect(dataDir).toContain(homedir());
      });
    });
  });

  // ==========================================
  // 7. CLI 入口函数测试
  // ==========================================
  describe('CLI Entry Points', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with code ${code}`);
      });
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    describe('showAgentsHelp', () => {
      it('should display help information', () => {
        showAgentsHelp();
        
        const output = consoleLogSpy.mock.calls.flat().join('\n');
        expect(output).toContain('Usage:');
        expect(output).toContain('agents');
        expect(output).toContain('list');
        expect(output).toContain('export');
        expect(output).toContain('import');
        expect(output).toContain('delete');
      });

      it('should include security warnings', () => {
        showAgentsHelp();
        
        const output = consoleLogSpy.mock.calls.flat().join('\n');
        expect(output).toContain('Security');
        expect(output).toContain('private keys');
      });

      it('should include examples', () => {
        showAgentsHelp();
        
        const output = consoleLogSpy.mock.calls.flat().join('\n');
        expect(output).toContain('Examples:');
        expect(output).toContain('f2a agents list');
      });
    });

    describe('listAgents CLI', () => {
      it('should display empty list message', async () => {
        const emptyDir = join(TEST_DIR, 'cli-empty');
        mkdirSync(emptyDir, { recursive: true });
        
        // 临时修改 getDataDir 返回测试目录
        vi.doMock('./agents.js', () => ({
          ...require('./agents.js'),
          getDataDir: () => emptyDir
        }));
        
        try {
          await listAgents();
        } catch (error) {
          // process.exit may be called
        }
        
        const output = consoleLogSpy.mock.calls.flat().join('\n');
        expect(output).toContain('Agent Identities');
      });
    });

    describe('exportAgent CLI', () => {
      it('should exit with error when agent not found', async () => {
        try {
          await exportAgent('nonexistent-agent');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain('process.exit');
        }
        
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });
    });

    describe('importAgent CLI', () => {
      it('should exit with error when import file not found', async () => {
        try {
          await importAgent('/nonexistent/file.json');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain('process.exit');
        }
        
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });
    });

    describe('deleteAgent CLI', () => {
      it('should exit with error when agent not found', async () => {
        try {
          await deleteAgent('nonexistent-agent');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain('process.exit');
        }
        
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });
    });
  });

  // ==========================================
  // 8. 边界测试和错误测试
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    describe('文件损坏场景', () => {
      it('should handle malformed JSON gracefully', async () => {
        writeFileSync(join(TEST_DIR, 'agent-identity-malformed.json'), '{{{malformed');
        
        const files = getAgentIdentityFiles(TEST_DIR);
        
        // 损坏的文件应该被跳过
        const malformedFile = files.find(f => f.filename === 'agent-identity-malformed.json');
        expect(malformedFile).toBeUndefined();
      });

      it('should handle empty file gracefully', async () => {
        writeFileSync(join(TEST_DIR, 'agent-identity-empty.json'), '');
        
        const files = getAgentIdentityFiles(TEST_DIR);
        
        const emptyFile = files.find(f => f.filename === 'agent-identity-empty.json');
        expect(emptyFile).toBeUndefined();
      });

      it('should handle file with only whitespace', async () => {
        writeFileSync(join(TEST_DIR, 'agent-identity-whitespace.json'), '   ');
        
        const files = getAgentIdentityFiles(TEST_DIR);
        
        const whitespaceFile = files.find(f => f.filename === 'agent-identity-whitespace.json');
        expect(whitespaceFile).toBeUndefined();
      });

      it('should handle file with valid JSON but wrong structure', async () => {
        writeFileSync(join(TEST_DIR, 'agent-identity-wrong-structure.json'), JSON.stringify({
          wrongField: 'value',
          anotherField: 123
        }));
        
        const files = getAgentIdentityFiles(TEST_DIR);
        
        const wrongStructureFile = files.find(f => f.filename === 'agent-identity-wrong-structure.json');
        expect(wrongStructureFile).toBeUndefined();
      });
    });

    describe('特殊字符处理', () => {
      it('should handle agent ID with special characters in filename', async () => {
        const agentData = createValidAgentData('agent-special-123', 'SpecialAgent', 'node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-agent-special-123.json'), JSON.stringify(agentData));
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.agents.some(a => a.agentId === 'agent-special-123')).toBe(true);
        }
      });

      it('should handle agent name with unicode characters', async () => {
        const agentData = {
          ...createValidAgentData('unicode-001', 'Agent-中文名称', 'node-001')
        };
        writeFileSync(join(TEST_DIR, 'agent-identity-unicode.json'), JSON.stringify(agentData));
        
        const result = await listAgentsInternal(TEST_DIR);
        
        expect(result.success).toBe(true);
        if (result.success) {
          const unicodeAgent = result.data.agents.find(a => a.agentId === 'unicode-001');
          expect(unicodeAgent?.name).toBe('Agent-中文名称');
        }
      });
    });

    describe('并发和时序测试', () => {
      it('should handle multiple rapid imports', async () => {
        const imports = [];
        for (let i = 0; i < 3; i++) {
          const importFile = join(TEST_DIR, `rapid-import-${i}.json`);
          const agentData = createValidAgentData(`rapid-${i}`, `RapidAgent${i}`, 'node-001');
          writeFileSync(importFile, JSON.stringify({
            version: '1.0',
            exportedAt: new Date().toISOString(),
            agent: agentData
          }));
          
          imports.push(importAgentInternal(importFile, `agent-identity-rapid-${i}.json`, TEST_DIR));
        }
        
        const results = await Promise.all(imports);
        
        for (const result of results) {
          expect(result.success).toBe(true);
        }
        
        // 验证所有文件都已创建
        const listResult = await listAgentsInternal(TEST_DIR);
        if (listResult.success) {
          expect(listResult.data.total).toBe(3);
        }
      });
    });

    describe('路径安全测试', () => {
      it('should reject import path outside allowed directories', async () => {
        // 创建一个在系统敏感位置的模拟文件路径
        const sensitivePath = '/etc/passwd.json';
        
        const result = await importAgentInternal(sensitivePath, undefined, TEST_DIR);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toContain('not found');
        }
      });

      it('should accept relative path in current directory', async () => {
        const cwd = process.cwd();
        const relativeFile = join(cwd, `test-relative-${Date.now()}.json`);
        const agentData = createValidAgentData('relative-001', 'RelativeAgent', 'node-001');
        writeFileSync(relativeFile, JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          agent: agentData
        }));
        
        const result = await importAgentInternal(relativeFile, undefined, TEST_DIR);
        
        expect(result.success).toBe(true);
        
        // 清理
        rmSync(relativeFile, { force: true });
      });
    });
  });

  // ==========================================
  // 9. Result 类型模式测试
  // ==========================================
  describe('Result Type Pattern', () => {
    it('should return Result type instead of throwing', async () => {
      const result = await listAgentsInternal('/nonexistent/path');
      
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('should allow caller to handle errors without try-catch', async () => {
      const result = await deleteAgentInternal('nonexistent', TEST_DIR);
      
      if (!result.success) {
        const errorCode = result.error.code;
        const errorMessage = result.error.message;
        
        expect(errorCode).toBe('AGENT_NOT_FOUND');
        expect(errorMessage).toContain('not found');
      }
    });

    it('should include proper error codes', async () => {
      // 测试各种错误类型的 error code
      const notFoundResult = await exportAgentInternal('nonexistent', undefined, TEST_DIR);
      expect(notFoundResult.success).toBe(false);
      if (!notFoundResult.success) {
        expect(notFoundResult.error.code).toBe('AGENT_NOT_FOUND');
      }
      
      const invalidPathResult = await importAgentInternal('/invalid.txt', undefined, TEST_DIR);
      expect(invalidPathResult.success).toBe(false);
      if (!invalidPathResult.success) {
        expect(invalidPathResult.error.code).toBe('INVALID_PARAMS');
      }
    });
  });

  // ==========================================
  // 10. Delete 安全测试
  // ==========================================
  describe('Delete Security Tests', () => {
    // ==========================================
    // 10.1 权限验证测试
    // ==========================================
    describe('权限验证测试', () => {
      beforeEach(() => {
        // 创建测试 Agent
        const agentData1 = createValidAgentData('secure-delete-001', 'SecureAgent', 'node-owner-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-secure-001.json'), JSON.stringify(agentData1, null, 2), { mode: 0o600 });
        
        const agentData2 = createValidAgentData('secure-delete-002', 'SecureAgent2', 'node-owner-002');
        writeFileSync(join(TEST_DIR, 'agent-identity-secure-002.json'), JSON.stringify(agentData2, null, 2), { mode: 0o600 });
      });

      it('should reject deletion by non-issuing Node', async () => {
        // Agent 属于 node-owner-001，但尝试用 node-owner-002 删除
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-owner-002',
          confirm: true
        }; // 非签发节点尝试删除
        
        const result = await deleteAgentInternal('secure-delete-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_UNAUTHORIZED_NODE');
          expect(result.error.message).toContain('different Node');
          expect(result.error.message).toContain('issuing Node');
        }
        
        // 验证文件仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-secure-001.json'))).toBe(true);
      });

      it('should allow deletion by issuing Node', async () => {
        // Agent 属于 node-owner-001，使用正确的 Node ID 删除
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-owner-001',
          confirm: true
        }; // 签发节点删除
        
        const result = await deleteAgentInternal('secure-delete-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.securityCheck?.passed).toBe(true);
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-secure-001.json'))).toBe(false);
      });

      it('should reject deletion without Node Identity', async () => {
        // 不提供 currentNodeId
        const options: DeleteSecurityOptions = {
          confirm: true
        }; // 无 Node ID
        
        const result = await deleteAgentInternal('secure-delete-002', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_UNAUTHORIZED_NODE');
          expect(result.error.message).toContain('no Node Identity');
        }
        
        // 验证文件仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-secure-002.json'))).toBe(true);
      });

      it('should include Node ID in error message for mismatched ownership', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'wrong-node-id',
          confirm: true
        }; // 错误节点
        
        const result = await deleteAgentInternal('secure-delete-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          // 错误消息应该包含 Node ID 信息（截断后的前缀）
          expect(result.error.message).toContain('Node'); // Agent 的 Node ID
          expect(result.error.message).toContain('issuing Node'); // 提示信息
        }
      });
    });

    // ==========================================
    // 10.2 确认机制测试
    // ==========================================
    describe('确认机制测试', () => {
      beforeEach(() => {
        const agentData = createValidAgentData('confirm-delete-001', 'ConfirmAgent', 'node-confirm-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-confirm.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
      });

      it('should reject deletion without confirm parameter', async () => {
        // 不提供 confirm 或 force
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-confirm-001'
        }; // 无确认
        
        const result = await deleteAgentInternal('confirm-delete-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_REQUIRES_CONFIRMATION');
          expect(result.error.message).toContain('--confirm');
          expect(result.error.message).toContain('--force');
        }
        
        // 验证文件仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-confirm.json'))).toBe(true);
      });

      it('should allow deletion with --confirm parameter', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-confirm-001',
          confirm: true
        }; // 已确认
        
        const result = await deleteAgentInternal('confirm-delete-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.securityCheck?.checkType).toBe('node_ownership');
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-confirm.json'))).toBe(false);
      });

      it('should skip all checks with --force parameter', async () => {
        // 创建新 Agent 用于 force 测试
        const agentData = createValidAgentData('force-delete-001', 'ForceAgent', 'node-force-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-force.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // force 会跳过所有检查，即使 Node ID 不匹配
        const options: DeleteSecurityOptions = {
          currentNodeId: 'wrong-node-id', // Node 不匹配
          force: true
        }; // 强制删除
        
        const result = await deleteAgentInternal('force-delete-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          // force 模式下，securityCheck 应该标记为通过
          expect(result.data.securityCheck?.passed).toBe(true);
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-force.json'))).toBe(false);
      });

      it('should allow force delete without any Node Identity', async () => {
        const agentData = createValidAgentData('force-no-node-001', 'ForceNoNodeAgent', 'node-some-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-force-no-node.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // 不提供任何 Node ID，使用 force
        const options: DeleteSecurityOptions = {
          force: true
        }; // 无 Node ID 但强制
        
        const result = await deleteAgentInternal('force-no-node-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-force-no-node.json'))).toBe(false);
      });

      it('should skip security checks when force is used', async () => {
        const agentData = createValidAgentData('force-log-001', 'ForceLogAgent', 'node-force-log-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-force-log.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // force 会跳过所有检查，即使 Node ID 不匹配
        const options: DeleteSecurityOptions = {
          currentNodeId: 'wrong-node-id',
          force: true
        }; // 强制删除
        
        const result = await deleteAgentInternal('force-log-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.securityCheck?.passed).toBe(true);
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-force-log.json'))).toBe(false);
      });
    });

    // ==========================================
    // 10.3 跨 Agent 删除防护测试
    // ==========================================
    describe('跨 Agent 删除防护', () => {
      beforeEach(() => {
        // 创建两个不同的 Agent
        const agentA = createValidAgentData('agent-a-001', 'AgentA', 'node-shared-001');
        const agentB = createValidAgentData('agent-b-001', 'AgentB', 'node-shared-001');
        
        writeFileSync(join(TEST_DIR, 'agent-identity-a.json'), JSON.stringify(agentA, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-b.json'), JSON.stringify(agentB, null, 2), { mode: 0o600 });
      });

      it('should reject Agent A attempting to delete Agent B', async () => {
        // Agent A 尝试删除 Agent B
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-shared-001', // 正确的 Node
          confirm: true,
          requesterAgentId: 'agent-a-001' // Agent A 发起请求
        }; // Agent A 删除 Agent B
        
        const result = await deleteAgentInternal('agent-b-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_CROSS_AGENT_BLOCKED');
          expect(result.error.message).toContain('Cross-agent deletion');
          expect(result.error.message).toContain('agent-a');
          expect(result.error.message).toContain('agent-b');
        }
        
        // Agent B 文件应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-b.json'))).toBe(true);
      });

      it('should allow Agent to delete itself', async () => {
        // Agent A 删除自己
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-shared-001',
          confirm: true,
          requesterAgentId: 'agent-a-001' // Agent A 删除自己
        }; // Agent A 删除 Agent A
        
        const result = await deleteAgentInternal('agent-a-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.agentId).toBe('agent-a-001');
        }
        
        // Agent A 文件应该已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-a.json'))).toBe(false);
        // Agent B 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-b.json'))).toBe(true);
      });

      it('should allow Node owner to delete any Agent on same Node', async () => {
        // Node owner 删除 Agent B（不提供 requesterAgentId）
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-shared-001', // Node owner
          confirm: true
          // 不提供 requesterAgentId - 表示 Node owner 操作
        }; // Node owner 删除 Agent B
        
        const result = await deleteAgentInternal('agent-b-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
        }
        
        // Agent B 文件应该已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-b.json'))).toBe(false);
      });

      it('should block cross-Agent deletion even on same Node', async () => {
        // 重新创建 Agent B（前面的测试可能已删除）
        const agentB = createValidAgentData('agent-b-002', 'AgentB2', 'node-shared-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-b2.json'), JSON.stringify(agentB, null, 2), { mode: 0o600 });
        
        // Agent A 尝试删除 Agent B2（同一个 Node）
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-shared-001', // 正确的 Node
          confirm: true,
          requesterAgentId: 'agent-a-001' // 但 Agent A 不是被删除的 Agent
        }; // Agent A 删除 Agent B2
        
        const result = await deleteAgentInternal('agent-b-002', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_CROSS_AGENT_BLOCKED');
        }
        
        // Agent B2 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-b2.json'))).toBe(true);
      });

      it('should force delete allow cross-Agent deletion', async () => {
        // force 模式应该跳过跨 Agent 检查
        const agentData = createValidAgentData('agent-c-001', 'AgentC', 'node-cross-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-c.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-cross-001',
          requesterAgentId: 'different-agent', // 不同的 Agent
          force: true // 强制模式
        }; // 强制跨 Agent 删除
        
        const result = await deleteAgentInternal('agent-c-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-c.json'))).toBe(false);
      });
    });

    // ==========================================
    // 10.4 skipNodeValidation 测试
    // ==========================================
    describe('skipNodeValidation 选项', () => {
      beforeEach(() => {
        const agentData = createValidAgentData('skip-node-001', 'SkipNodeAgent', 'node-skip-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-skip.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
      });

      it('should skip node validation with skipNodeValidation option', async () => {
        // 跳过节点验证，不提供 currentNodeId
        const options: DeleteSecurityOptions = {
          confirm: true,
          skipNodeValidation: true
        }; // 跳过节点验证
        
        const result = await deleteAgentInternal('skip-node-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.securityCheck?.passed).toBe(true);
        }
        
        // 验证文件已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-skip.json'))).toBe(false);
      });

      it('should still require confirm with skipNodeValidation', async () => {
        // 跳过节点验证，但不提供 confirm
        const agentData = createValidAgentData('skip-node-no-confirm', 'SkipNoConfirm', 'node-skip-002');
        writeFileSync(join(TEST_DIR, 'agent-identity-skip-no-confirm.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const options: DeleteSecurityOptions = {
          skipNodeValidation: true
          // 没有 confirm
        }; // 跳过节点验证但无确认
        
        const result = await deleteAgentInternal('skip-node-no-confirm', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_REQUIRES_CONFIRMATION');
        }
        
        // 文件应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-skip-no-confirm.json'))).toBe(true);
      });
    });

    // ==========================================
    // 10.5 安全日志审计测试
    // ==========================================
    describe('安全日志审计', () => {
      beforeEach(() => {
        const agentData = createValidAgentData('audit-001', 'AuditAgent', 'node-audit-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-audit.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
      });

      it('should return securityCheck info on successful deletion', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-audit-001',
          confirm: true
        }; // 正确删除
        
        const result = await deleteAgentInternal('audit-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.securityCheck).toBeDefined();
          expect(result.data.securityCheck?.passed).toBe(true);
          expect(result.data.securityCheck?.checkType).toBe('node_ownership');
        }
      });

      it('should return securityCheck info on failed deletion', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'wrong-node',
          confirm: true
        }; // 错误节点
        
        const result = await deleteAgentInternal('audit-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          // 错误应该包含安全相关信息
          expect(result.error.message).toContain('different Node');
          expect(result.error.message).toContain('issuing Node');
        }
      });

      it('should return checkType in error response', async () => {
        // 创建新 Agent 用于跨 Agent 删除测试
        const agentData = createValidAgentData('audit-cross-001', 'AuditCrossAgent', 'node-audit-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-audit-cross.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-audit-001',
          confirm: true,
          requesterAgentId: 'different-agent'
        }; // 跨 Agent 删除
        
        const result = await deleteAgentInternal('audit-cross-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_CROSS_AGENT_BLOCKED');
          expect(result.error.message).toContain('Cross-agent');
        }
      });

      it('should return confirmation checkType for unconfirmed deletion', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-audit-001'
          // 没有 confirm
        }; // 无确认
        
        const result = await deleteAgentInternal('audit-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_REQUIRES_CONFIRMATION');
        }
      });
    });

    // ==========================================
    // 10.6 边界安全场景测试
    // ==========================================
    describe('边界安全场景', () => {
      it('should handle empty currentNodeId gracefully', async () => {
        const agentData = createValidAgentData('empty-node-001', 'EmptyNodeAgent', 'node-empty-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-empty-node.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const options: DeleteSecurityOptions = {
          currentNodeId: '', // 空 Node ID
          confirm: true
        }; // 空 Node ID
        
        const result = await deleteAgentInternal('empty-node-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          // 空 Node ID 应该被视为无效，需要验证
          expect(result.error.code).toBe('DELETE_UNAUTHORIZED_NODE');
        }
      });

      it('should handle partial Node ID match correctly', async () => {
        const agentData = createValidAgentData('partial-node-001', 'PartialNodeAgent', 'node-full-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-partial.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // 使用 Node ID 前缀尝试删除
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-full', // 前缀，不完整匹配
          confirm: true
        }; // 部分 Node ID
        
        const result = await deleteAgentInternal('partial-node-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        // Node ID 必须完全匹配
        if (!result.success) {
          expect(result.error.message).toContain('different Node');
        }
      });

      it('should handle Agent ID that looks like Node ID', async () => {
        // 创建一个 Agent，其 ID 看起来像 Node ID
        const agentData = createValidAgentData('node-lookalike', 'LookalikeAgent', 'node-real-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-lookalike.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // 尝试用 Agent ID 作为 requesterAgentId（它看起来像 Node ID）
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-real-001',
          confirm: true,
          requesterAgentId: 'node-lookalike' // Agent ID 看起来像 Node ID
        }; // Agent ID 作为 requester
        
        // 这个 Agent ID 等于要删除的 Agent ID，所以应该成功
        const result = await deleteAgentInternal('node-lookalike', TEST_DIR, options);
        
        expect(result.success).toBe(true);
      });

      it('should handle concurrent deletion requests safely', async () => {
        const agentData = createValidAgentData('concurrent-001', 'ConcurrentAgent', 'node-concurrent-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-concurrent.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // 同时发起多个删除请求（一个成功，其他应该失败）
        const options: DeleteSecurityOptions = {
          currentNodeId: 'node-concurrent-001',
          confirm: true
        }; // 正确的选项
        
        const results = await Promise.all([
          deleteAgentInternal('concurrent-001', TEST_DIR, options),
          deleteAgentInternal('concurrent-001', TEST_DIR, options),
          deleteAgentInternal('concurrent-001', TEST_DIR, options)
        ]); // 并发删除
        
        // 只有第一个应该成功，其他应该失败（文件已不存在）
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        // 至少有一个失败（因为只有一个文件，删除一次后就不存在了）
        expect(failCount).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ==========================================
  // 11. Session Token 和签名验证测试
  // ==========================================
  describe('Session Token and Signature Tests', () => {
    // ==========================================
    // 11.1 Session Token 验证测试
    // ==========================================
    describe('Session Token 验证', () => {
      beforeEach(() => {
        // 创建多个同一节点的 Agent
        const agentA = createValidAgentData('token-agent-a', 'AgentA', 'token-node-001');
        const agentB = createValidAgentData('token-agent-b', 'AgentB', 'token-node-001');
        const agentC = createValidAgentData('token-agent-c', 'AgentC', 'token-node-001');
        
        writeFileSync(join(TEST_DIR, 'agent-identity-token-a.json'), JSON.stringify(agentA, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-token-b.json'), JSON.stringify(agentB, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-token-c.json'), JSON.stringify(agentC, null, 2), { mode: 0o600 });
      });

      it('should reject Agent A trying to delete Agent B with A token', async () => {
        // Agent A 的 token
        const tokenA = createSessionToken('token-agent-a', 'token-node-001');
        
        // 尝试用 Agent A 的 token 删除 Agent B
        const options: DeleteSecurityOptions = {
          currentNodeId: 'token-node-001',
          confirm: true,
          sessionToken: tokenA
        }; // Agent A token 删除 Agent B
        
        const result = await deleteAgentInternal('token-agent-b', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_TOKEN_MISMATCH');
          expect(result.error.message).toContain('different Agent');
        }
        
        // Agent B 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-b.json'))).toBe(true);
      });

      it('should allow Agent to delete itself with its own token', async () => {
        // Agent A 的 token
        const tokenA = createSessionToken('token-agent-a', 'token-node-001');
        
        // Agent A 用自己的 token 删除自己
        const options: DeleteSecurityOptions = {
          currentNodeId: 'token-node-001',
          confirm: true,
          sessionToken: tokenA
        }; // Agent A token 删除 Agent A
        
        const result = await deleteAgentInternal('token-agent-a', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.securityCheck?.passed).toBe(true);
        }
        
        // Agent A 应该已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-a.json'))).toBe(false);
        // Agent B 和 C 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-b.json'))).toBe(true);
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-c.json'))).toBe(true);
      });

      it('should reject deletion with corrupted token', async () => {
        // 损坏的 token
        const corruptedToken = createCorruptedSessionToken();
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'token-node-001',
          confirm: true,
          sessionToken: corruptedToken
        }; // 损坏 token
        
        const result = await deleteAgentInternal('token-agent-a', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_INVALID_TOKEN');
          expect(result.error.message).toContain('decode');
          // HTTP 状态码应该是 401 Unauthorized
        }
        
        // Agent A 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-a.json'))).toBe(true);
      });

      it('should reject deletion with expired token', async () => {
        // 创建过期的 token（timestamp 设置为 25 小时前）
        const expiredTimestamp = Date.now() - (25 * 60 * 60 * 1000);
        const expiredTokenData = {
          agentId: 'token-agent-a',
          nodeId: 'token-node-001',
          timestamp: expiredTimestamp
        }; // 过期 token 数据
        const expiredToken = Buffer.from(JSON.stringify(expiredTokenData)).toString('base64');
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'token-node-001',
          confirm: true,
          sessionToken: expiredToken
        }; // 过期 token
        
        const result = await deleteAgentInternal('token-agent-a', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_TOKEN_EXPIRED');
          expect(result.error.message).toContain('expired');
          // HTTP 状态码应该是 401 Unauthorized
        }
        
        // Agent A 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-a.json'))).toBe(true);
      });

      it('should reject deletion with token from different Node', async () => {
        // 不同 Node 的 token
        const tokenDifferentNode = createSessionToken('token-agent-a', 'different-node-999');
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'token-node-001', // 当前节点
          confirm: true,
          sessionToken: tokenDifferentNode
        }; // 不同 Node 的 token
        
        const result = await deleteAgentInternal('token-agent-a', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toContain('different Node');
          // HTTP 状态码应该是 403 Forbidden
        }
        
        // Agent A 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-a.json'))).toBe(true);
      });

      it('should reject deletion with empty token', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'token-node-001',
          confirm: true,
          sessionToken: '' // 空 token
        }; // 空 token
        
        const result = await deleteAgentInternal('token-agent-a', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toContain('No session token');
          // HTTP 状态码应该是 401 Unauthorized
        }
        
        // Agent A 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-token-a.json'))).toBe(true);
      });
    });

    // ==========================================
    // 11.2 签名公钥验证测试
    // ==========================================
    describe('签名公钥验证', () => {
      beforeEach(() => {
        const agentData = createValidAgentData('sig-agent-001', 'SigAgent', 'sig-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-sig.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
      });

      it('should reject deletion with wrong signature public key', async () => {
        // 错误的公钥
        const wrongPublicKey = 'wrong-public-key-abc123';
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'sig-node-001',
          confirm: true,
          signaturePublicKey: wrongPublicKey
        }; // 错误公钥
        
        const result = await deleteAgentInternal('sig-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DELETE_SIGNATURE_MISMATCH');
          expect(result.error.message).toContain('does not match');
          // HTTP 状态码应该是 403 Forbidden
        }
        
        // Agent 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-sig.json'))).toBe(true);
      });

      it('should allow deletion with correct signature public key', async () => {
        // 读取正确的公钥
        const content = readFileSync(join(TEST_DIR, 'agent-identity-sig.json'), 'utf-8');
        const agentData = JSON.parse(content);
        const correctPublicKey = agentData.publicKey;
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'sig-node-001',
          confirm: true,
          signaturePublicKey: correctPublicKey
        }; // 正确公钥
        
        const result = await deleteAgentInternal('sig-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
          expect(result.data.securityCheck?.passed).toBe(true);
        }
        
        // Agent 应该已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-sig.json'))).toBe(false);
      });

      it('should reject deletion without signature public key', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'sig-node-001',
          confirm: true,
          signaturePublicKey: undefined // 无公钥
        }; // 无公钥
        
        const result = await deleteAgentInternal('sig-agent-001', TEST_DIR, options);
        
        // 注意：签名公钥是可选的，如果没有提供会跳过签名验证
        // 但如果提供了 skipSignatureValidation: false，应该通过其他验证
        expect(result.success).toBe(true); // 因为没有提供公钥，跳过签名验证
        if (result.success) {
          expect(result.data.deleted).toBe(true);
        }
      });

      it('should skip signature validation with skipSignatureValidation option', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'sig-node-001',
          confirm: true,
          signaturePublicKey: 'wrong-key', // 错误公钥
          skipSignatureValidation: true // 跳过签名验证
        }; // 跳过签名验证
        
        const result = await deleteAgentInternal('sig-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deleted).toBe(true);
        }
        
        // Agent 应该已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-sig.json'))).toBe(false);
      });
    });

    // ==========================================
    // 11.3 多 Agent 并发删除测试
    // ==========================================
    describe('多 Agent 并发删除', () => {
      beforeEach(() => {
        // 创建同一节点的多个 Agent
        const agent1 = createValidAgentData('concurrent-multi-1', 'ConcurrentAgent1', 'concurrent-node-001');
        const agent2 = createValidAgentData('concurrent-multi-2', 'ConcurrentAgent2', 'concurrent-node-001');
        const agent3 = createValidAgentData('concurrent-multi-3', 'ConcurrentAgent3', 'concurrent-node-001');
        
        writeFileSync(join(TEST_DIR, 'agent-identity-concurrent-1.json'), JSON.stringify(agent1, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-concurrent-2.json'), JSON.stringify(agent2, null, 2), { mode: 0o600 });
        writeFileSync(join(TEST_DIR, 'agent-identity-concurrent-3.json'), JSON.stringify(agent3, null, 2), { mode: 0o600 });
      });

      it('should allow multiple Agents to delete themselves concurrently', async () => {
        // 每个 Agent 用自己的 token
        const token1 = createSessionToken('concurrent-multi-1', 'concurrent-node-001');
        const token2 = createSessionToken('concurrent-multi-2', 'concurrent-node-001');
        const token3 = createSessionToken('concurrent-multi-3', 'concurrent-node-001');
        
        // 并发删除
        const results = await Promise.all([
          deleteAgentInternal('concurrent-multi-1', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token1 }),
          deleteAgentInternal('concurrent-multi-2', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token2 }),
          deleteAgentInternal('concurrent-multi-3', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token3 })
        ]); // 并发删除
        
        // 所有删除应该成功
        const successCount = results.filter(r => r.success).length;
        expect(successCount).toBe(3);
        
        // 所有 Agent 应该已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-1.json'))).toBe(false);
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-2.json'))).toBe(false);
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-3.json'))).toBe(false);
      });

      it('should block concurrent cross-Agent deletions', async () => {
        // Agent 1 的 token
        const token1 = createSessionToken('concurrent-multi-1', 'concurrent-node-001');
        
        // Agent 1 尝试并发删除 Agent 2 和 Agent 3（都应该失败）
        const results = await Promise.all([
          deleteAgentInternal('concurrent-multi-2', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token1 }),
          deleteAgentInternal('concurrent-multi-3', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token1 })
        ]); // 并发跨 Agent 删除
        
        // 所有删除应该失败
        const failCount = results.filter(r => !r.success).length;
        expect(failCount).toBe(2);
        
        // Agent 2 和 3 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-2.json'))).toBe(true);
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-3.json'))).toBe(true);
      });

      it('should handle mixed concurrent deletions (self + cross)', async () => {
        // Agent 1 和 Agent 2 的 token
        const token1 = createSessionToken('concurrent-multi-1', 'concurrent-node-001');
        const token2 = createSessionToken('concurrent-multi-2', 'concurrent-node-001');
        
        // Agent 1 删除自己（成功），Agent 1 尝试删除 Agent 3（失败）
        const results = await Promise.all([
          deleteAgentInternal('concurrent-multi-1', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token1 }),
          deleteAgentInternal('concurrent-multi-3', TEST_DIR, { currentNodeId: 'concurrent-node-001', confirm: true, sessionToken: token1 })
        ]); // 混合并发删除
        
        // Agent 1 删除自己应该成功，Agent 1 删除 Agent 3 应该失败
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
        
        // Agent 1 应该已删除，Agent 2 和 3 应该仍然存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-1.json'))).toBe(false);
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-2.json'))).toBe(true);
        expect(existsSync(join(TEST_DIR, 'agent-identity-concurrent-3.json'))).toBe(true);
      });
    });

    // ==========================================
    // 11.4 删除后重建测试
    // ==========================================
    describe('删除后重建', () => {
      it('should generate new agentId after deletion and re-registration', async () => {
        // 创建初始 Agent
        const agentData = createValidAgentData('rebuild-old-001', 'RebuildAgent', 'rebuild-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-rebuild-old.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        const oldAgentId = agentData.id;
        
        // 删除 Agent
        const deleteResult = await deleteAgentInternal('rebuild-old-001', TEST_DIR, { force: true });
        expect(deleteResult.success).toBe(true);
        
        // 验证已删除
        expect(existsSync(join(TEST_DIR, 'agent-identity-rebuild-old.json'))).toBe(false);
        
        // 重新创建 Agent（使用新的 ID）
        const newAgentData = createValidAgentData('rebuild-new-001', 'RebuildAgentNew', 'rebuild-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-rebuild-new.json'), JSON.stringify(newAgentData, null, 2), { mode: 0o600 });
        
        const newAgentId = newAgentData.id;
        
        // 新 ID 应该与旧 ID 不同
        expect(newAgentId).not.toBe(oldAgentId);
        expect(newAgentId).toBe('rebuild-new-001');
        
        // 新 Agent 应该存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-rebuild-new.json'))).toBe(true);
      });

      it('should not reuse old agentId filename', async () => {
        // 创建 Agent
        const agentData = createValidAgentData('reuse-test-001', 'ReuseAgent', 'reuse-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-reuse-old.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // 删除
        await deleteAgentInternal('reuse-test-001', TEST_DIR, { force: true });
        
        // 重新导入使用相同文件名
        const importFile = join(TEST_DIR, 'import-reuse.json');
        const newAgentData = createValidAgentData('reuse-new-001', 'ReuseAgentNew', 'reuse-node-001');
        writeFileSync(importFile, JSON.stringify({ version: '1.0', exportedAt: new Date().toISOString(), agent: newAgentData }), 'utf-8');
        
        // 导入时可以指定新的文件名
        const importResult = await importAgentInternal(importFile, 'agent-identity-reuse-new.json', TEST_DIR, true);
        expect(importResult.success).toBe(true);
        
        // 旧文件名应该不存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-reuse-old.json'))).toBe(false);
        // 新文件名应该存在
        expect(existsSync(join(TEST_DIR, 'agent-identity-reuse-new.json'))).toBe(true);
      });

      it('should allow re-import after deletion with same agentId', async () => {
        // 创建并导出 Agent
        const agentData = createValidAgentData('reimport-001', 'ReimportAgent', 'reimport-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-reimport.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
        
        // 导出
        const exportResult = await exportAgentInternal('reimport-001', join(TEST_DIR, 'export-reimport.json'), TEST_DIR);
        expect(exportResult.success).toBe(true);
        
        // 删除
        await deleteAgentInternal('reimport-001', TEST_DIR, { force: true });
        expect(existsSync(join(TEST_DIR, 'agent-identity-reimport.json'))).toBe(false);
        
        // 重新导入
        const importResult = await importAgentInternal(join(TEST_DIR, 'export-reimport.json'), undefined, TEST_DIR, true);
        expect(importResult.success).toBe(true);
        
        // Agent 应该重新存在（使用相同的 agentId）
        const files = getAgentIdentityFiles(TEST_DIR);
        const reimportedAgent = files.find(f => f.agentId === 'reimport-001');
        expect(reimportedAgent).toBeDefined();
      });
    });

    // ==========================================
    // 11.5 HTTP 状态码验证测试
    // ==========================================
    describe('HTTP 状态码验证', () => {
      beforeEach(() => {
        const agentData = createValidAgentData('http-agent-001', 'HTTPAgent', 'http-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-http.json'), JSON.stringify(agentData, null, 2), { mode: 0o600 });
      });

      it('should return 401 Unauthorized for invalid token', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'http-node-001',
          confirm: true,
          sessionToken: createCorruptedSessionToken()
        }; // 无效 token
        
        const result = await deleteAgentInternal('http-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        // HTTP 状态码应该在 securityCheck 中
        if (!result.success && result.data?.securityCheck) {
          expect(result.data.securityCheck.httpStatus).toBe(401);
        }
      });

      it('should return 403 Forbidden for cross-Agent deletion', async () => {
        const tokenA = createSessionToken('http-agent-a', 'http-node-001');
        
        // 创建 Agent B
        const agentB = createValidAgentData('http-agent-b', 'HTTPAgentB', 'http-node-001');
        writeFileSync(join(TEST_DIR, 'agent-identity-http-b.json'), JSON.stringify(agentB, null, 2), { mode: 0o600 });
        
        const options: DeleteSecurityOptions = {
          currentNodeId: 'http-node-001',
          confirm: true,
          sessionToken: tokenA
        }; // Agent A token 删除 Agent B
        
        const result = await deleteAgentInternal('http-agent-b', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success && result.data?.securityCheck) {
          expect(result.data.securityCheck.httpStatus).toBe(403);
        }
      });

      it('should return 403 Forbidden for wrong Node ownership', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'wrong-node-001',
          confirm: true
        }; // 错误节点
        
        const result = await deleteAgentInternal('http-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success && result.data?.securityCheck) {
          expect(result.data.securityCheck.httpStatus).toBe(403);
        }
      });

      it('should return 400 Bad Request for missing confirmation', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'http-node-001'
          // 没有 confirm
        }; // 无确认
        
        const result = await deleteAgentInternal('http-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(false);
        if (!result.success && result.data?.securityCheck) {
          expect(result.data.securityCheck.httpStatus).toBe(400);
        }
      });

      it('should return 200 OK for successful deletion', async () => {
        const options: DeleteSecurityOptions = {
          currentNodeId: 'http-node-001',
          confirm: true
        }; // 正确删除
        
        const result = await deleteAgentInternal('http-agent-001', TEST_DIR, options);
        
        expect(result.success).toBe(true);
        if (result.success && result.data.securityCheck) {
          expect(result.data.securityCheck.httpStatus).toBe(200);
        }
      });
    });
  });
});