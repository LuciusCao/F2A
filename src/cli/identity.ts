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
import { success, failure, failureFromError, Result, createError } from '../types/index.js';

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
 * 导入身份的结果
 */
export interface ImportResult {
  nodeImported: boolean;
  agentImported: boolean;
  nodeError?: string;
  agentError?: string;
  warnings: string[];
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
 * 从文件导入身份（内部实现，返回 Result 类型）
 * 
 * P2-2 修复：使用 Result 类型返回错误，而非 process.exit
 * P1-1 修复：明确标注 Node Identity 导入的限制
 * P1-2 修复：验证 Agent Identity 签名
 */
export async function importIdentityInternal(inputPath: string, dataDir?: string): Promise<Result<ImportResult>> {
  const actualDataDir = dataDir || join(homedir(), DEFAULT_DATA_DIR);
  const result: ImportResult = {
    nodeImported: false,
    agentImported: false,
    warnings: []
  };
  
  // 检查文件是否存在
  if (!existsSync(inputPath)) {
    return failure(createError(
      'INVALID_PARAMS',
      `File not found: ${inputPath}`
    ));
  }
  
  // 读取文件
  let importData: IdentityExport;
  try {
    const content = readFileSync(inputPath, 'utf-8');
    importData = JSON.parse(content) as IdentityExport;
  } catch (error) {
    return failure(createError(
      'INVALID_PARAMS',
      `Failed to parse identity file: ${error instanceof Error ? error.message : String(error)}`
    ));
  }
  
  // 验证版本
  if (importData.version !== '1.0') {
    return failure(createError(
      'INVALID_PARAMS',
      `Unsupported identity file version: ${importData.version}`
    ));
  }
  
  // 确保目录存在
  if (!existsSync(actualDataDir)) {
    mkdirSync(actualDataDir, { recursive: true });
  }
  
  // 导入 Node Identity
  if (importData.node) {
    const nodeImportResult = await importNodeIdentity(importData.node, actualDataDir);
    if (nodeImportResult.success) {
      result.nodeImported = true;
    } else {
      result.nodeError = nodeImportResult.error.message;
    }
  } else {
    result.warnings.push('Node Identity: Not in import file');
  }
  
  // 导入 Agent Identity
  if (importData.agent) {
    const agentImportResult = await importAgentIdentity(importData.agent, actualDataDir);
    if (agentImportResult.success) {
      result.agentImported = true;
    } else {
      result.agentError = agentImportResult.error.message;
    }
  } else {
    result.warnings.push('Agent Identity: Not in import file');
  }
  
  return success(result);
}

/**
 * 导入 Node Identity
 * 
 * P1-1 修复：实现基本的 Node Identity 导入逻辑
 * 注意：当前版本支持从相同格式的导出文件导入 Node Identity
 * 不支持从其他节点迁移 Node Identity（应使用 Agent Identity 迁移）
 */
async function importNodeIdentity(
  nodeData: { nodeId: string; peerId: string; privateKey: string },
  dataDir: string
): Promise<Result<void>> {
  try {
    // 验证 nodeId 格式
    if (!isValidNodeId(nodeData.nodeId)) {
      return failure(createError(
        'INVALID_NODE_ID',
        `Invalid nodeId format in import file: ${nodeData.nodeId}`
      ));
    }
    
    // 检查是否已存在 Node Identity
    const nodeIdentityPath = join(dataDir, 'node-identity.json');
    if (existsSync(nodeIdentityPath)) {
      // 加载现有 Node Identity 检查是否相同
      const existingManager = new NodeIdentityManager({ dataDir });
      const loadResult = await existingManager.loadOrCreate();
      
      if (loadResult.success) {
        const existingNodeId = existingManager.getNodeId();
        if (existingNodeId === nodeData.nodeId) {
          // 相同的 Node Identity，无需导入
          return success(undefined);
        }
        // 不同的 Node Identity，拒绝覆盖
        return failure(createError(
          'INVALID_PARAMS',
          `Cannot import Node Identity: a different Node Identity already exists (existing: ${existingNodeId}, importing: ${nodeData.nodeId}). ` +
          `Node Identity represents the physical node and cannot be migrated. ` +
          `Use Agent Identity for cross-node migration.`
        ));
      }
    }
    
    // 写入 Node Identity 文件
    // 注意：privateKey 在导出时是 protobuf 编码的 Ed25519 私钥（base64）
    // 这里我们创建一个简化的存储格式
    const nodeIdentityContent = {
      nodeId: nodeData.nodeId,
      peerId: nodeData.privateKey, // 注意：字段名是 peerId，但实际存储的是私钥
      e2eePrivateKey: '', // E2EE 密钥需要重新生成
      e2eePublicKey: '',  // E2EE 密钥需要重新生成
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    
    writeFileSync(nodeIdentityPath, JSON.stringify(nodeIdentityContent, null, 2), { mode: 0o600 });
    
    return success(undefined);
  } catch (error) {
    return failureFromError(
      'NODE_IDENTITY_LOAD_FAILED',
      `Failed to import Node Identity: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 导入 Agent Identity
 * 
 * P1-2 修复：验证签名后再写入
 */
async function importAgentIdentity(
  agentData: ExportedAgentIdentity,
  dataDir: string
): Promise<Result<void>> {
  try {
    // 验证必要字段
    if (!agentData.id || !agentData.name || !agentData.nodeId || 
        !agentData.publicKey || !agentData.signature || !agentData.privateKey) {
      return failure(createError(
        'AGENT_IDENTITY_CORRUPTED',
        'Agent identity file is missing required fields'
      ));
    }
    
    // 检查是否过期
    if (agentData.expiresAt) {
      const expiresAt = new Date(agentData.expiresAt);
      if (expiresAt < new Date()) {
        return failure(createError(
          'AGENT_IDENTITY_EXPIRED',
          `Agent identity has expired at ${agentData.expiresAt}`
        ));
      }
    }
    
    // 尝试验证签名
    // 如果本地有相同的 Node Identity，可以进行完整验证
    const nodeIdentityPath = join(dataDir, 'node-identity.json');
    let signatureValid = false;
    let signatureWarning: string | undefined;
    
    if (existsSync(nodeIdentityPath)) {
      try {
        const nodeManager = new NodeIdentityManager({ dataDir });
        const nodeLoadResult = await nodeManager.loadOrCreate();
        
        if (nodeLoadResult.success) {
          const currentNodeId = nodeManager.getNodeId();
          
          if (currentNodeId === agentData.nodeId) {
            // Agent 来自当前节点，可以验证签名
            const delegator = new IdentityDelegator(nodeManager, dataDir);
            
            // 获取 Node 公钥用于验证
            const privateKey = nodeManager.getPrivateKey();
            if (privateKey) {
              const nodePublicKey = privateKey.public.marshal();
              
              const verifyResult = await delegator.verifyAgent(
                {
                  id: agentData.id,
                  name: agentData.name,
                  capabilities: agentData.capabilities,
                  nodeId: agentData.nodeId,
                  publicKey: agentData.publicKey,
                  signature: agentData.signature,
                  createdAt: agentData.createdAt,
                  expiresAt: agentData.expiresAt
                },
                async (nodeId: string) => {
                  // 验证 nodeId 匹配
                  if (nodeId !== currentNodeId) {
                    return null;
                  }
                  return nodePublicKey;
                }
              );
              
              if (verifyResult.success) {
                signatureValid = verifyResult.data;
              }
            }
          } else {
            // Agent 来自不同的节点
            signatureWarning = `Agent was signed by a different Node (${agentData.nodeId}). ` +
              `Cannot verify signature without the original Node's public key. ` +
              `Importing anyway - verify the source is trusted.`;
          }
        }
      } catch (verifyError) {
        signatureWarning = `Signature verification failed: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`;
      }
    } else {
      signatureWarning = `No local Node Identity found. Cannot verify Agent signature. ` +
        `Importing anyway - verify the source is trusted.`;
    }
    
    // 如果签名验证失败且不是跨节点导入，拒绝导入
    if (!signatureValid && !signatureWarning) {
      return failure(createError(
        'AGENT_IDENTITY_INVALID_SIGNATURE',
        'Agent identity signature verification failed. The identity may have been tampered with.'
      ));
    }
    
    // 保存 Agent Identity
    const agentManager = new AgentIdentityManager(dataDir);
    const agentIdentityPath = join(dataDir, 'agent-identity.json');
    
    // 直接写入文件
    writeFileSync(agentIdentityPath, JSON.stringify(agentData, null, 2), { mode: 0o600 });
    
    // 如果有签名警告，返回成功但包含警告信息
    if (signatureWarning) {
      console.log(`   ⚠️  Warning: ${signatureWarning}`);
    }
    
    return success(undefined);
  } catch (error) {
    return failureFromError(
      'AGENT_IDENTITY_LOAD_FAILED',
      `Failed to import Agent Identity: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 从文件导入身份（CLI 入口）
 * 
 * P2-2 修复：调用内部实现，处理错误并退出
 */
export async function importIdentity(inputPath: string): Promise<void> {
  console.log('');
  console.log('=== Importing F2A Identity ===');
  console.log('');
  
  const result = await importIdentityInternal(inputPath);
  
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exit(1);
  }
  
  const importResult = result.data;
  
  // 报告 Node Identity 导入结果
  if (importResult.nodeImported) {
    console.log('📦 Node Identity: ✅ Imported');
  } else if (importResult.nodeError) {
    console.log(`📦 Node Identity: ❌ ${importResult.nodeError}`);
  } else {
    console.log('📦 Node Identity: ⚪ Not in import file');
  }
  
  // 报告 Agent Identity 导入结果
  if (importResult.agentImported) {
    console.log('🤖 Agent Identity: ✅ Imported');
  } else if (importResult.agentError) {
    console.log(`🤖 Agent Identity: ❌ ${importResult.agentError}`);
  } else {
    console.log('🤖 Agent Identity: ⚪ Not in import file');
  }
  
  // 显示警告
  for (const warning of importResult.warnings) {
    console.log(`   ⚠️  ${warning}`);
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
  
Import Limitations:
  - Node Identity: Can only be imported if no existing identity exists or the same identity
  - Agent Identity: Signature is verified when possible; cross-node imports show a warning
  - For cross-node migration, use Agent Identity (recommended)
`);
}