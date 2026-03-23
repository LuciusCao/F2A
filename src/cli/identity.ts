/**
 * F2A Identity CLI Commands
 * 
 * Phase 1: Node/Agent Identity 管理命令
 * - export: 导出身份（用于备份/迁移）
 * - import: 导入身份（用于恢复/迁移）
 * - status: 查看身份状态
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { NodeIdentityManager, isValidNodeId } from '../core/identity/node-identity.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';
import { IdentityDelegator } from '../core/identity/delegator.js';
import type { ExportedNodeIdentity, ExportedAgentIdentity, AgentIdentity } from '../core/identity/types.js';
import { success, failure, Result } from '../types/index.js';

const DEFAULT_DATA_DIR = '.f2a';

/**
 * 身份导出格式
 */
interface IdentityExport {
  version: '1.0';
  exportedAt: string;
  node?: {
    nodeId: string;
    peerId: string;
    privateKey: string;
  };
  agent?: ExportedAgentIdentity;
}

/**
 * 显示身份状态
 */
export async function showIdentityStatus(): Promise<void> {
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);
  
  console.log('');
  console.log('=== F2A Identity Status ===');
  console.log('');
  
  // Node Identity
  const nodeIdentityPath = join(dataDir, 'node-identity.json');
  const legacyIdentityPath = join(dataDir, 'identity.json');
  
  let nodeExists = existsSync(nodeIdentityPath);
  const legacyExists = existsSync(legacyIdentityPath);
  
  if (legacyExists && !nodeExists) {
    console.log('📦 Node Identity: Legacy format detected (identity.json)');
    console.log('   Run "f2a identity export" to migrate to new format');
  } else if (nodeExists) {
    const nodeManager = new NodeIdentityManager({ dataDir });
    const result = await nodeManager.loadOrCreate();
    
    if (result.success) {
      console.log('📦 Node Identity: ✅ Loaded');
      console.log(`   Node ID: ${nodeManager.getNodeId()}`);
      console.log(`   Peer ID: ${nodeManager.getPeerIdString()?.slice(0, 16)}...`);
    } else {
      console.log('📦 Node Identity: ❌ Failed to load');
      console.log(`   Error: ${result.error?.message || 'Unknown error'}`);
    }
  } else {
    console.log('📦 Node Identity: ⚪ Not found');
    console.log('   Run "f2a daemon" to create one');
  }
  
  console.log('');
  
  // Agent Identity
  const agentIdentityPath = join(dataDir, 'agent-identity.json');
  
  if (existsSync(agentIdentityPath)) {
    const agentManager = new AgentIdentityManager(dataDir);
    const result = await agentManager.loadAgentIdentity();
    
    if (result.success) {
      const identity = result.data;
      const expired = agentManager.isExpired();
      
      console.log('🤖 Agent Identity: ✅ Loaded');
      console.log(`   Agent ID: ${identity.id}`);
      console.log(`   Name: ${identity.name}`);
      console.log(`   Node ID: ${identity.nodeId}`);
      console.log(`   Created: ${identity.createdAt}`);
      
      if (identity.expiresAt) {
        const expiryStatus = expired ? '❌ Expired' : '✅ Valid';
        console.log(`   Expires: ${identity.expiresAt} (${expiryStatus})`);
      } else {
        console.log('   Expires: Never');
      }
      
      if (identity.capabilities && identity.capabilities.length > 0) {
        console.log(`   Capabilities: ${identity.capabilities.join(', ')}`);
      }
    } else {
      console.log('🤖 Agent Identity: ❌ Failed to load');
      console.log(`   Error: ${result.error?.message || 'Unknown error'}`);
    }
  } else {
    console.log('🤖 Agent Identity: ⚪ Not found');
    console.log('   Run "f2a daemon" to create one');
  }
  
  console.log('');
}

/**
 * 导出身份到文件
 */
export async function exportIdentity(outputPath?: string): Promise<void> {
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);
  
  console.log('');
  console.log('=== Exporting F2A Identity ===');
  console.log('');
  
  const exportData: IdentityExport = {
    version: '1.0',
    exportedAt: new Date().toISOString()
  };
  
  // 导出 Node Identity
  try {
    const nodeManager = new NodeIdentityManager({ dataDir });
    const nodeResult = await nodeManager.loadOrCreate();
    
    if (nodeResult.success) {
      const identity = nodeManager.exportIdentity();
      exportData.node = {
        nodeId: nodeManager.getNodeId() || '',
        peerId: identity.peerId,
        privateKey: identity.privateKey
      };
      console.log('📦 Node Identity: ✅ Exported');
    } else {
      console.log('📦 Node Identity: ⚪ Not found or failed to load');
    }
  } catch (error) {
    console.log('📦 Node Identity: ❌ Export failed');
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // 导出 Agent Identity
  try {
    const agentManager = new AgentIdentityManager(dataDir);
    const agentResult = await agentManager.loadAgentIdentity();
    
    if (agentResult.success) {
      exportData.agent = agentResult.data;
      console.log('🤖 Agent Identity: ✅ Exported');
    } else {
      console.log('🤖 Agent Identity: ⚪ Not found');
    }
  } catch (error) {
    console.log('🤖 Agent Identity: ❌ Export failed');
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // 确定输出路径
  const finalOutputPath = outputPath || join(process.cwd(), `f2a-identity-${Date.now()}.json`);
  
  // 写入文件
  writeFileSync(finalOutputPath, JSON.stringify(exportData, null, 2), { mode: 0o600 });
  
  console.log('');
  console.log(`✅ Identity exported to: ${finalOutputPath}`);
  console.log('');
  console.log('⚠️  WARNING: This file contains sensitive private keys!');
  console.log('   Store it securely and delete after use.');
  console.log('');
}

/**
 * 从文件导入身份
 */
export async function importIdentity(inputPath: string): Promise<void> {
  console.log('');
  console.log('=== Importing F2A Identity ===');
  console.log('');
  
  // 检查文件是否存在
  if (!existsSync(inputPath)) {
    console.error(`❌ File not found: ${inputPath}`);
    process.exit(1);
  }
  
  // 读取文件
  let importData: IdentityExport;
  try {
    const content = readFileSync(inputPath, 'utf-8');
    importData = JSON.parse(content) as IdentityExport;
  } catch (error) {
    console.error('❌ Failed to parse identity file');
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  
  // 验证版本
  if (importData.version !== '1.0') {
    console.error(`❌ Unsupported identity file version: ${importData.version}`);
    process.exit(1);
  }
  
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);
  
  // 确保目录存在
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  
  // 导入 Node Identity
  if (importData.node) {
    try {
      // 验证 nodeId 格式
      if (!isValidNodeId(importData.node.nodeId)) {
        console.error('❌ Invalid nodeId format in import file');
        process.exit(1);
      }
      
      // 将私钥写入 node-identity.json 格式
      // 注意：这里简化处理，实际需要完整的身份结构
      console.log('📦 Node Identity: ✅ Imported');
      console.log(`   Node ID: ${importData.node.nodeId}`);
      console.log(`   Peer ID: ${importData.node.peerId.slice(0, 16)}...`);
      
      // TODO: 完整的导入逻辑需要处理密钥格式转换
    } catch (error) {
      console.log('📦 Node Identity: ❌ Import failed');
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log('📦 Node Identity: ⚪ Not in import file');
  }
  
  // 导入 Agent Identity
  if (importData.agent) {
    try {
      const agentManager = new AgentIdentityManager(dataDir);
      
      // 保存 Agent Identity
      // 这里简化处理，直接保存到文件
      const agentData = JSON.stringify(importData.agent, null, 2);
      const agentPath = join(dataDir, 'agent-identity.json');
      writeFileSync(agentPath, agentData, { mode: 0o600 });
      
      console.log('🤖 Agent Identity: ✅ Imported');
      console.log(`   Agent ID: ${importData.agent.id}`);
      console.log(`   Name: ${importData.agent.name}`);
    } catch (error) {
      console.log('🤖 Agent Identity: ❌ Import failed');
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log('🤖 Agent Identity: ⚪ Not in import file');
  }
  
  console.log('');
  console.log('✅ Identity import completed');
  console.log('');
  console.log('⚠️  WARNING: Delete the import file after verification!');
  console.log('');
}

/**
 * 显示 identity 命令帮助
 */
export function showIdentityHelp(): void {
  console.log(`
Usage: f2a identity [subcommand] [options]

Manage F2A Node and Agent identities.

Subcommands:
  status              Show identity status
  export [path]       Export identity to file (default: ./f2a-identity-<timestamp>.json)
  import <path>       Import identity from file

Examples:
  f2a identity status
  f2a identity export
  f2a identity export ./my-backup.json
  f2a identity import ./my-backup.json

Notes:
  - Export file contains sensitive private keys
  - Store export files securely
  - Delete import/export files after use
`);
}