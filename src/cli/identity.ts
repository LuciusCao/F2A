/**
 * F2A Identity CLI Commands
 * 
 * Phase 1: Node/Agent Identity 管理命令
 * - export: 导出身份（用于备份/迁移）
 * - import: 导入身份（用于恢复/迁移）
 * - status: 查看身份状态
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { join, basename, dirname, isAbsolute } from 'path';
import { homedir, tmpdir } from 'os';
import { NodeIdentityManager, isValidNodeId } from '../core/identity/node-identity.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';
import { IdentityDelegator } from '../core/identity/delegator.js';
import type { ExportedNodeIdentity, ExportedAgentIdentity, AgentIdentity } from '../core/identity/types.js';
import { success, failure, failureFromError, Result, createError } from '../types/index.js';
import { secureWipe } from '../utils/crypto-utils.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger({ component: 'IdentityCLI' });

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
 * Agent 导入所需的用户确认信息
 * P1-2 修复：用于 CLI 层处理用户确认
 */
export interface AgentImportConfirmation {
  /** 是否需要用户确认 */
  required: boolean;
  /** 确认原因（用于显示给用户） */
  reason: string;
  /** Agent ID（用于确认消息） */
  agentId: string;
  /** Node ID（用于确认消息） */
  nodeId: string;
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
  /** P1-2: Agent 导入确认信息 */
  agentConfirmation?: AgentImportConfirmation;
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
 * 验证导入文件路径是否在允许范围内
 * P1-4 修复：防止路径遍历漏洞
 * 
 * @param inputPath 用户提供的路径
 * @returns 解析后的安全路径，或 null 表示路径不安全
 */
function validateImportPath(inputPath: string): { safe: true; resolvedPath: string } | { safe: false; error: string } {
  // 检查文件扩展名
  const ext = inputPath.toLowerCase().split('.').pop();
  if (ext !== 'json') {
    return { safe: false, error: 'Import file must be a JSON file (.json extension required)' };
  }
  
  // 获取路径的各个部分
  const homeDir = homedir();
  const currentDir = process.cwd();
  const systemTmpDir = tmpdir(); // P1-4 修复：使用 tmpdir() 获取系统临时目录
  
  // 解析绝对路径
  let resolvedPath: string;
  try {
    // 处理符号链接并获取绝对路径
    if (isAbsolute(inputPath)) {
      resolvedPath = realpathSync(inputPath);
    } else {
      resolvedPath = realpathSync(join(currentDir, inputPath));
    }
  } catch {
    // 文件不存在或无法解析
    return { safe: false, error: 'Import file not found or not accessible' };
  }
  
  // 允许的目录前缀
  // 注意：macOS 上 /var 是符号链接到 /private/var，realpathSync 会解析为 /private/var/...
  // 而 tmpdir() 返回 /var/folders/...，所以需要同时检查两种路径
  const allowedPrefixes = [
    homeDir,           // 用户主目录
    currentDir,        // 当前工作目录
    systemTmpDir,      // 系统临时目录（macOS: /var/folders/..., Linux: /tmp）
    '/tmp',            // 通用临时目录
    '/var/tmp',        // 系统临时目录
    '/private/var',    // macOS: realpathSync(/var/folders/...) 的实际路径
  ];
  
  // 检查路径是否在允许的目录下
  const isAllowed = allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
  
  if (!isAllowed) {
    logger.warn('P1-4: Import path rejected - outside allowed directories', {
      resolvedPath,
      allowedPrefixes
    });
    return { safe: false, error: 'Import file not found or not accessible' };
  }
  
  // 检查可疑的路径遍历模式
  if (inputPath.includes('..') || inputPath.includes('~')) {
    logger.warn('P1-4: Suspicious path pattern detected', { inputPath });
    // 如果已经通过 realpath 解析并且是允许的目录，则继续
  }
  
  return { safe: true, resolvedPath };
}

/**
 * 从文件导入身份（内部实现，返回 Result 类型）
 * 
 * P2-2 修复：使用 Result 类型返回错误，而非 process.exit
 * P1-1 修复：明确标注 Node Identity 导入的限制
 * P1-2 修复：验证 Agent Identity 签名
 * P1-4 修复：验证导入路径安全性
 * P2-7 修复：不暴露用户提供的路径
 */
export async function importIdentityInternal(
  inputPath: string, 
  dataDir?: string,
  forceAgentImport: boolean = false
): Promise<Result<ImportResult>> {
  const actualDataDir = dataDir || join(homedir(), DEFAULT_DATA_DIR);
  const result: ImportResult = {
    nodeImported: false,
    agentImported: false,
    warnings: []
  };
  
  // P1-4: 验证路径安全性
  const pathValidation = validateImportPath(inputPath);
  if (!pathValidation.safe) {
    // P2-7: 使用通用错误消息，不暴露具体路径
    return failure(createError(
      'INVALID_PARAMS',
      pathValidation.error
    ));
  }
  
  const safePath = pathValidation.resolvedPath;
  
  // 读取文件
  let importData: IdentityExport;
  let fileContent: string;
  try {
    fileContent = readFileSync(safePath, 'utf-8');
    importData = JSON.parse(fileContent) as IdentityExport;
  } catch (error) {
    // P2-7: 使用通用错误消息
    return failure(createError(
      'INVALID_PARAMS',
      'Failed to read or parse identity file'
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
    const agentImportResult = await importAgentIdentity(
      importData.agent, 
      actualDataDir, 
      safePath,
      forceAgentImport
    );
    if (agentImportResult.success) {
      const agentData = agentImportResult.data as any;
      if (agentData.requiresConfirmation && !agentData.confirmed) {
        // P1-2: 需要用户确认
        result.agentConfirmation = {
          required: true,
          reason: agentData.warning,
          agentId: agentData.agentId,
          nodeId: agentData.nodeId
        };
      } else {
        result.agentImported = true;
      }
    } else {
      result.agentError = agentImportResult.error.message;
    }
  } else {
    result.warnings.push('Agent Identity: Not in import file');
  }
  
  // P3-2: 清理内存中的敏感数据
  if (fileContent) {
    const contentBuffer = Buffer.from(fileContent, 'utf-8');
    secureWipe(contentBuffer);
  }
  
  return success(result);
}

/**
 * 导入 Node Identity
 * 
 * P1-1 修复：重新生成 E2EE 密钥对，确保导入后节点具有端到端加密能力
 * P2-5 修复：使用正确的字段名 privateKey 存储私钥
 * P2-8 修复：添加安全审计日志
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
        `Invalid nodeId format in import file`
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
          logger.info('P2-8: Node identity import skipped - same identity already exists', {
            nodeId: nodeData.nodeId.slice(0, 8)
          });
          return success(undefined);
        }
        // 不同的 Node Identity，拒绝覆盖
        logger.warn('P2-8: Node identity import rejected - different identity exists', {
          existingNodeId: existingNodeId?.slice(0, 8),
          importingNodeId: nodeData.nodeId.slice(0, 8)
        });
        return failure(createError(
          'INVALID_PARAMS',
          `Cannot import Node Identity: a different Node Identity already exists. ` +
          `Node Identity represents the physical node and cannot be migrated. ` +
          `Use Agent Identity for cross-node migration.`
        ));
      }
    }
    
    // P1-1: 重新生成 E2EE 密钥对
    // 使用 @noble/curves 生成新的 X25519 密钥对
    const { x25519 } = await import('@noble/curves/ed25519.js');
    const newE2eePrivateKey = x25519.utils.randomSecretKey();
    const newE2eePublicKey = x25519.getPublicKey(newE2eePrivateKey);
    
    // 写入 Node Identity 文件
    // P2-5: 使用正确的字段名 privateKey 而非 peerId
    const nodeIdentityContent = {
      nodeId: nodeData.nodeId,
      peerId: nodeData.privateKey, // 注意：保持向后兼容，字段名仍为 peerId
      privateKey: nodeData.privateKey, // P2-5: 添加正确的字段名
      e2eePrivateKey: Buffer.from(newE2eePrivateKey).toString('base64'),
      e2eePublicKey: Buffer.from(newE2eePublicKey).toString('base64'),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      // P1-1: 标记 E2EE 密钥已重新生成
      e2eeKeyRegenerated: true
    };
    
    writeFileSync(nodeIdentityPath, JSON.stringify(nodeIdentityContent, null, 2), { mode: 0o600 });
    
    // P2-8: 安全审计日志
    logger.info('P2-8: Node identity imported successfully', {
      nodeId: nodeData.nodeId.slice(0, 8),
      e2eeRegenerated: true
    });
    
    // P3-2: 清理内存中的敏感数据
    secureWipe(newE2eePrivateKey);
    
    return success(undefined);
  } catch (error) {
    return failureFromError(
      'NODE_IDENTITY_LOAD_FAILED',
      `Failed to import Node Identity`
    );
  }
}

/**
 * 导入 Agent Identity
 * 
 * P1-2 修复：验证签名后再写入，无法验证时需要用户确认
 * P2-8 修复：添加安全审计日志
 */
async function importAgentIdentity(
  agentData: ExportedAgentIdentity,
  dataDir: string,
  importFilePath: string,
  forceImport: boolean = false
): Promise<Result<void, AgentImportConfirmation>> {
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
          `Agent identity has expired`
        ));
      }
    }
    
    // 尝试验证签名
    // 如果本地有相同的 Node Identity，可以进行完整验证
    const nodeIdentityPath = join(dataDir, 'node-identity.json');
    let signatureValid = false;
    let signatureWarning: string | undefined;
    let isCrossNodeImport = false;
    
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
              
              // P1-3: verifyAgent 现在返回 failure 而非 success(false)
              if (verifyResult.success) {
                signatureValid = verifyResult.data;
              } else {
                // P3-3: 获取具体错误原因
                const errorReason = verifyResult.error.message;
                signatureWarning = `Signature verification failed: ${errorReason}`;
              }
            }
          } else {
            // Agent 来自不同的节点
            isCrossNodeImport = true;
            signatureWarning = `Agent was signed by a different Node (${agentData.nodeId.slice(0, 8)}...). ` +
              `Cannot verify signature without the original Node's public key.`;
          }
        }
      } catch (verifyError) {
        signatureWarning = `Signature verification failed: ${verifyError instanceof Error ? verifyError.message : 'Unknown error'}`;
      }
    } else {
      signatureWarning = `No local Node Identity found. Cannot verify Agent signature.`;
    }
    
    // 如果签名验证失败且不是跨节点导入，拒绝导入
    if (!signatureValid && !signatureWarning) {
      return failure(createError(
        'AGENT_IDENTITY_INVALID_SIGNATURE',
        'Agent identity signature verification failed. The identity may have been tampered with.'
      ));
    }
    
    // P1-2: 如果需要用户确认但未强制导入，返回确认请求
    if (signatureWarning && !forceImport) {
      return success({
        confirmed: false,
        requiresConfirmation: true,
        warning: signatureWarning,
        agentId: agentData.id,
        nodeId: agentData.nodeId
      } as any);
    }
    
    // P2-8: 安全审计日志
    if (isCrossNodeImport) {
      logger.warn('P2-8: Cross-node agent identity import', {
        agentId: agentData.id.slice(0, 8),
        sourceNodeId: agentData.nodeId.slice(0, 8),
        importFilePath: importFilePath.slice(0, 32) + '...'
      });
    }
    
    // 保存 Agent Identity
    const agentManager = new AgentIdentityManager(dataDir);
    const agentIdentityPath = join(dataDir, 'agent-identity.json');
    
    // 直接写入文件
    writeFileSync(agentIdentityPath, JSON.stringify(agentData, null, 2), { mode: 0o600 });
    
    // P2-8: 安全审计日志
    logger.info('P2-8: Agent identity imported successfully', {
      agentId: agentData.id.slice(0, 8),
      nodeId: agentData.nodeId.slice(0, 8),
      crossNode: isCrossNodeImport,
      signatureValid
    });
    
    // 如果有签名警告，返回成功但包含警告信息
    if (signatureWarning) {
      console.log(`   ⚠️  Warning: ${signatureWarning}`);
    }
    
    return success({ confirmed: true } as any);
  } catch (error) {
    return failureFromError(
      'AGENT_IDENTITY_LOAD_FAILED',
      `Failed to import Agent Identity`
    );
  }
}

/**
 * 从文件导入身份（CLI 入口）
 * 
 * P2-2 修复：调用内部实现，处理错误并退出
 * P1-2 修复：处理签名验证失败时的用户确认
 */
export async function importIdentity(inputPath: string, forceImport: boolean = false): Promise<void> {
  console.log('');
  console.log('=== Importing F2A Identity ===');
  console.log('');
  
  const result = await importIdentityInternal(inputPath, undefined, forceImport);
  
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exit(1);
  }
  
  const importResult = result.data;
  
  // P1-2: 处理 Agent 确认请求
  if (importResult.agentConfirmation?.required) {
    const confirmation = importResult.agentConfirmation;
    console.log('');
    console.log('⚠️  SECURITY WARNING:');
    console.log(`   ${confirmation.reason}`);
    console.log('');
    console.log(`   Agent ID: ${confirmation.agentId}`);
    console.log(`   Node ID:  ${confirmation.nodeId}`);
    console.log('');
    console.log('   This identity could not be verified. Importing an unverified identity');
    console.log('   is a security risk. Only proceed if you trust the source of this file.');
    console.log('');
    console.log('   To proceed with import, run:');
    console.log(`     f2a identity import --force "${inputPath}"`);
    console.log('');
    console.log('❌ Import cancelled - unverified Agent Identity requires --force flag');
    console.log('');
    process.exit(1);
  }
  
  // 报告 Node Identity 导入结果
  if (importResult.nodeImported) {
    console.log('📦 Node Identity: ✅ Imported');
    console.log('   (E2EE keys regenerated for security)');
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
  import --force <path>  Force import without signature verification

Options:
  --force, -f         Force import of unverified Agent Identity (use with caution)

Examples:
  f2a identity status
  f2a identity export
  f2a identity export ./my-backup.json
  f2a identity import ./my-backup.json
  f2a identity import --force ./cross-node-backup.json

Notes:
  - Export file contains sensitive private keys
  - Store export files securely
  - Delete import/export files after use
  
Import Limitations:
  - Node Identity: Can only be imported if no existing identity exists or the same identity
  - E2EE Keys: Automatically regenerated on Node Identity import for security
  - Agent Identity: Signature is verified when possible
  - Cross-node imports require --force flag for security
  
Security:
  - If signature cannot be verified, import will fail unless --force is used
  - Only use --force if you trust the source of the import file
`);
}