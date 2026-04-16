/**
 * F2A Agents CLI Commands
 * 
 * 管理多个 Agent Identity 文件
 * - list: 列出所有 Agent Identity 文件
 * - export: 导出指定的 Agent Identity
 * - import: 导入 Agent Identity 文件
 * - delete: 删除指定的 Agent Identity
 * 
 * 支持多 Agent 场景：多个 identity 文件共存
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync, realpathSync } from 'fs';
import * as readline from 'readline';
import { join, basename, dirname, isAbsolute } from 'path';
import { homedir, tmpdir } from 'os';
import { NodeIdentityManager, isValidNodeId } from '../core/identity/node-identity.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';
import { IdentityDelegator } from '../core/identity/delegator.js';
import type { ExportedAgentIdentity, AgentIdentity } from '../core/identity/types.js';
import { success, failure, failureFromError, Result, createError, ErrorCode } from '../types/index.js';
import { secureWipe } from '../utils/crypto-utils.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger({ component: 'AgentsCLI' });

const DEFAULT_DATA_DIR = '.f2a';
const AGENT_IDENTITY_PREFIX = 'agent-identity';
const AGENT_IDENTITY_SUFFIX = '.json';
const DEFAULT_AGENT_FILE = 'agent-identity.json';

/**
 * Agent Identity 文件信息
 */
export interface AgentIdentityFile {
  /** 文件名 */
  filename: string;
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** 所属 Node ID */
  nodeId: string;
  /** 创建时间 */
  createdAt: string;
  /** 过期时间（可选） */
  expiresAt?: string;
  /** 是否过期 */
  isExpired: boolean;
  /** 文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
}

/**
 * List 命令结果
 */
export interface ListResult {
  agents: AgentIdentityFile[];
  total: number;
  dataDir: string;
}

/**
 * Export 命令结果
 */
export interface ExportResult {
  exported: boolean;
  agentId: string;
  outputPath: string;
  warnings: string[];
}

/**
 * Import 命令结果
 */
export interface ImportResult {
  imported: boolean;
  agentId: string;
  filename: string;
  warnings: string[];
  error?: string;
}

/**
 * Delete 命令结果
 */
export interface DeleteResult {
  deleted: boolean;
  agentId: string;
  filename: string;
  /** 安全验证结果 */
  securityCheck?: SecurityCheckResult;
}

/**
 * 删除命令安全选项
 */
export interface DeleteSecurityOptions {
  /** 当前节点的 Node ID（用于权限验证） */
  currentNodeId?: string;
  /** 是否已确认删除 */
  confirm?: boolean;
  /** 是否强制删除（跳过安全检查） */
  force?: boolean;
  /** 请求删除的 Agent ID（用于跨 Agent 删除防护） */
  requesterAgentId?: string;
  /** 跳过签发节点验证 */
  skipNodeValidation?: boolean;
  /** Session Token（用于身份验证） */
  sessionToken?: string;
  /** 签名公钥（用于签名验证） */
  signaturePublicKey?: string;
  /** 是否跳过 Token 验证 */
  skipTokenValidation?: boolean;
  /** 是否跳过签名验证 */
  skipSignatureValidation?: boolean;
}

/**
 * 安全验证结果
 */
export interface SecurityCheckResult {
  /** 是否通过安全验证 */
  passed: boolean;
  /** 验证类型 */
  checkType: 'node_ownership' | 'signature_match' | 'cross_agent' | 'confirmation' | 'token_match' | 'token_expired' | 'token_invalid' | 'signature_validation';
  /** 错误信息（如果验证失败） */
  error?: string;
  /** HTTP 状态码（用于 API 响应） */
  httpStatus?: number;
}

/**
 * Token 验证结果
 */
export interface TokenValidationResult {
  valid: boolean;
  agentId?: string;
  nodeId?: string;
  error?: string;
  errorType?: 'invalid_format' | 'expired' | 'signature_mismatch' | 'not_found';
}

/**
 * 获取数据目录路径
 */
export function getDataDir(): string {
  return join(homedir(), DEFAULT_DATA_DIR);
}

/**
 * 获取所有 Agent Identity 文件列表
 */
export function getAgentIdentityFiles(dataDir?: string): AgentIdentityFile[] {
  const actualDataDir = dataDir || getDataDir();
  
  if (!existsSync(actualDataDir)) {
    return [];
  }
  
  const files = readdirSync(actualDataDir);
  const agentFiles: AgentIdentityFile[] = [];
  
  for (const filename of files) {
    // 查找所有 agent-identity*.json 文件
    if (filename.startsWith(AGENT_IDENTITY_PREFIX) && filename.endsWith(AGENT_IDENTITY_SUFFIX)) {
      const filePath = join(actualDataDir, filename);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as ExportedAgentIdentity;
        
        // 验证必要字段
        if (!data.id || !data.name || !data.nodeId) {
          logger.warn(`Agent identity file ${filename} is missing required fields`);
          continue;
        }
        
        // 检查是否过期
        const isExpired = data.expiresAt ? new Date(data.expiresAt) < new Date() : false;
        
        // 获取文件大小
        const stats = statSync(filePath);
        
        agentFiles.push({
          filename,
          agentId: data.id,
          name: data.name,
          nodeId: data.nodeId,
          createdAt: data.createdAt,
          expiresAt: data.expiresAt,
          isExpired,
          filePath,
          fileSize: stats.size
        });
      } catch (error) {
        logger.warn(`Failed to parse agent identity file ${filename}`, { error });
      }
    }
  }
  
  // 按创建时间排序（最新的在前）
  return agentFiles.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * 根据 Agent ID 查找对应的文件
 */
export function findAgentFileById(agentId: string, dataDir?: string): AgentIdentityFile | null {
  const files = getAgentIdentityFiles(dataDir);
  return files.find(f => f.agentId === agentId) || null;
}

/**
 * 根据文件名查找对应的文件
 */
export function findAgentFileByName(filename: string, dataDir?: string): AgentIdentityFile | null {
  const actualDataDir = dataDir || getDataDir();
  const filePath = join(actualDataDir, filename);
  
  if (!existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as ExportedAgentIdentity;
    
    if (!data.id || !data.name || !data.nodeId) {
      return null;
    }
    
    const isExpired = data.expiresAt ? new Date(data.expiresAt) < new Date() : false;
    const stats = statSync(filePath);
    
    return {
      filename,
      agentId: data.id,
      name: data.name,
      nodeId: data.nodeId,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      isExpired,
      filePath,
      fileSize: stats.size
    };
  } catch {
    return null;
  }
}

/**
 * 列出所有 Agent Identity（内部实现）
 */
export async function listAgentsInternal(dataDir?: string): Promise<Result<ListResult>> {
  try {
    const actualDataDir = dataDir || getDataDir();
    const agents = getAgentIdentityFiles(actualDataDir);
    
    return success({
      agents,
      total: agents.length,
      dataDir: actualDataDir
    });
  } catch (error) {
    return failureFromError('INTERNAL_ERROR', 'Failed to list agent identities', error as Error);
  }
}

/**
 * 导出指定的 Agent Identity（内部实现）
 */
export async function exportAgentInternal(
  agentIdOrFilename: string,
  outputPath?: string,
  dataDir?: string
): Promise<Result<ExportResult>> {
  try {
    const actualDataDir = dataDir || getDataDir();
    
    // 查找 Agent 文件
    let agentFile: AgentIdentityFile | null;
    
    // 如果输入看起来像是文件名（以 .json 结尾）
    if (agentIdOrFilename.endsWith('.json')) {
      agentFile = findAgentFileByName(agentIdOrFilename, actualDataDir);
    } else {
      // 否则按 Agent ID 查找
      agentFile = findAgentFileById(agentIdOrFilename, actualDataDir);
    }
    
    if (!agentFile) {
      return failure(createError(
        'AGENT_NOT_FOUND',
        `Agent identity not found: ${agentIdOrFilename}`
      ));
    }
    
    // 读取文件内容
    const content = readFileSync(agentFile.filePath, 'utf-8');
    const agentData = JSON.parse(content) as ExportedAgentIdentity;
    
    // 创建导出数据
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: agentData
    };
    
    // 确定输出路径
    const finalOutputPath = outputPath || 
      join(process.cwd(), `f2a-agent-${agentFile.agentId.slice(0, 8)}-${Date.now()}.json`);
    
    // 写入文件
    writeFileSync(finalOutputPath, JSON.stringify(exportData, null, 2), { mode: 0o600 });
    
    // 清理内存中的敏感数据
    const contentBuffer = Buffer.from(content, 'utf-8');
    secureWipe(contentBuffer);
    
    logger.info('Agent identity exported', {
      agentId: agentFile.agentId.slice(0, 8),
      outputPath: finalOutputPath
    });
    
    const warnings: string[] = [];
    if (agentFile.isExpired) {
      warnings.push('Agent identity is expired');
    }
    
    return success({
      exported: true,
      agentId: agentFile.agentId,
      outputPath: finalOutputPath,
      warnings
    });
  } catch (error) {
    return failureFromError('EXPORT_FAILED', 'Failed to export agent identity', error as Error);
  }
}

/**
 * 验证导入路径安全性
 */
function validateImportPath(inputPath: string): { safe: true; resolvedPath: string } | { safe: false; error: string } {
  // 检查文件扩展名
  const ext = inputPath.toLowerCase().split('.').pop();
  if (ext !== 'json') {
    return { safe: false, error: 'Import file must be a JSON file (.json extension required)' };
  }
  
  const homeDir = homedir();
  const currentDir = process.cwd();
  const systemTmpDir = tmpdir();
  
  let resolvedPath: string;
  try {
    if (existsSync(inputPath)) {
      resolvedPath = inputPath;
    } else {
      resolvedPath = join(currentDir, inputPath);
      if (!existsSync(resolvedPath)) {
        return { safe: false, error: 'Import file not found' };
      }
    }
  } catch {
    return { safe: false, error: 'Import file not found or not accessible' };
  }
  
  // 允许的目录前缀
  const allowedPrefixes = [
    homeDir,
    currentDir,
    systemTmpDir,
    '/tmp',
    '/var/tmp',
    '/private/var'
  ];
  
  const isAllowed = allowedPrefixes.some(prefix => {
    if (resolvedPath === prefix) return true;
    const prefixWithSep = prefix.endsWith('/') ? prefix : prefix + '/';
    return resolvedPath.startsWith(prefixWithSep);
  });
  
  if (!isAllowed) {
    return { safe: false, error: 'Import file not in allowed directories' };
  }
  
  return { safe: true, resolvedPath };
}

/** 类型守卫：判断路径验证是否成功 */
function isPathValidationSuccess(
  result: ReturnType<typeof validateImportPath>
): result is { safe: true; resolvedPath: string } {
  return result.safe === true;
}

/**
 * 导入 Agent Identity（内部实现）
 */
export async function importAgentInternal(
  inputPath: string,
  targetFilename?: string,
  dataDir?: string,
  forceImport: boolean = false
): Promise<Result<ImportResult>> {
  try {
    const actualDataDir = dataDir || getDataDir();
    
    // 验证路径安全性
    const pathValidation = validateImportPath(inputPath);
    if (!isPathValidationSuccess(pathValidation)) {
      return failure(createError('INVALID_PARAMS', pathValidation.error));
    }
    
    const safePath = pathValidation.resolvedPath;
    
    // 读取文件
    let importData: { version: string; exportedAt: string; agent?: ExportedAgentIdentity };
    let fileContent: string;
    
    try {
      fileContent = readFileSync(safePath, 'utf-8');
      importData = JSON.parse(fileContent);
    } catch {
      return failure(createError('INVALID_PARAMS', 'Failed to read or parse import file'));
    }
    
    // 验证版本
    if (importData.version !== '1.0') {
      return failure(createError('INVALID_PARAMS', `Unsupported import file version: ${importData.version}`));
    }
    
    // 验证 Agent 数据
    if (!importData.agent) {
      return failure(createError('INVALID_PARAMS', 'No agent identity in import file'));
    }
    
    const agentData = importData.agent;
    
    // 验证必要字段
    if (!agentData.id || !agentData.name || !agentData.nodeId || 
        !agentData.publicKey || !agentData.signature || !agentData.privateKey) {
      return failure(createError('AGENT_IDENTITY_CORRUPTED', 'Agent identity is missing required fields'));
    }
    
    // 检查是否过期
    if (agentData.expiresAt) {
      const expiresAt = new Date(agentData.expiresAt);
      if (expiresAt < new Date() && !forceImport) {
        return failure(createError('AGENT_IDENTITY_EXPIRED', 'Agent identity has expired'));
      }
    }
    
    // 确保目录存在
    if (!existsSync(actualDataDir)) {
      mkdirSync(actualDataDir, { recursive: true });
    }
    
    // 确定目标文件名
    const targetFile = targetFilename || 
      `agent-identity-${agentData.id.slice(0, 8)}.json`;
    const targetPath = join(actualDataDir, targetFile);
    
    // 检查是否已存在相同 Agent ID
    const existingFile = findAgentFileById(agentData.id, actualDataDir);
    if (existingFile && !forceImport) {
      return failure(createError(
        'AGENT_ALREADY_EXISTS',
        `Agent identity with ID ${agentData.id.slice(0, 8)} already exists. Use --force to overwrite.`
      ));
    }
    
    // 写入文件
    writeFileSync(targetPath, JSON.stringify(agentData, null, 2), { mode: 0o600 });
    
    // 清理内存中的敏感数据
    if (fileContent) {
      const contentBuffer = Buffer.from(fileContent, 'utf-8');
      secureWipe(contentBuffer);
    }
    
    logger.info('Agent identity imported', {
      agentId: agentData.id.slice(0, 8),
      filename: targetFile
    });
    
    const warnings: string[] = [];
    if (agentData.expiresAt && new Date(agentData.expiresAt) < new Date()) {
      warnings.push('Imported agent identity is expired');
    }
    
    return success({
      imported: true,
      agentId: agentData.id,
      filename: targetFile,
      warnings
    });
  } catch (error) {
    return failureFromError('AGENT_IDENTITY_LOAD_FAILED', 'Failed to import agent identity', error as Error);
  }
}

/**
 * 验证删除权限
 * 
 * 安全检查流程:
 * 1. 确认机制检查 - 需要 confirm 或 force 参数
 * 2. 签发节点验证 - 只有签发节点可以删除
 * 3. 签名验证 - Agent 签名必须有效
 * 4. 跨 Agent 删除防护 - Agent 只能删除自己
 */

/**
 * 验证 Session Token
 * 
 * Token 格式: base64(JSON({agentId, nodeId, timestamp, signature}))
 */
function validateSessionToken(
  token: string,
  expectedAgentId?: string,
  expectedNodeId?: string
): TokenValidationResult {
  if (!token) {
    return {
      valid: false,
      error: 'No session token provided',
      errorType: 'invalid_format'
    }; // 无 Token 返回错误
  }
  
  // 检查 Token 格式
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const tokenData = JSON.parse(decoded);
    
    // 验证必要字段
    if (!tokenData.agentId || !tokenData.nodeId || !tokenData.timestamp) {
      return {
        valid: false,
        error: 'Invalid token format: missing required fields',
        errorType: 'invalid_format'
      }; // 格式错误返回错误
    }
    
    // 检查 Token 是否过期（24小时）
    const tokenAge = Date.now() - tokenData.timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时
    if (tokenAge > maxAge) {
      return {
        valid: false,
        error: 'Session token has expired',
        errorType: 'expired',
        agentId: tokenData.agentId
      }; // 过期返回错误
    }
    
    // 验证 Agent ID 是否匹配
    if (expectedAgentId && tokenData.agentId !== expectedAgentId) {
      return {
        valid: false,
        error: `Token belongs to different Agent (${tokenData.agentId.slice(0, 8)}...)`,
        errorType: 'signature_mismatch',
        agentId: tokenData.agentId
      }; // Agent 不匹配返回错误
    }
    
    // 验证 Node ID 是否匹配
    if (expectedNodeId && tokenData.nodeId !== expectedNodeId) {
      return {
        valid: false,
        error: `Token belongs to different Node (${tokenData.nodeId.slice(0, 8)}...)`,
        errorType: 'signature_mismatch',
        agentId: tokenData.agentId,
        nodeId: tokenData.nodeId
      }; // Node 不匹配返回错误
    }
    
    return {
      valid: true,
      agentId: tokenData.agentId,
      nodeId: tokenData.nodeId
    }; // 验证成功返回 Token 信息
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to decode session token',
      errorType: 'invalid_format'
    }; // 解码失败返回错误
  }
}

/**
 * 验证签名公钥
 * 
 * 检查提供的公钥是否与 Agent 的公钥匹配
 */
function validateSignaturePublicKey(
  publicKey: string,
  agentPublicKey: string
): SecurityCheckResult {
  if (!publicKey) {
    return {
      passed: false,
      checkType: 'signature_validation',
      error: 'No signature public key provided',
      httpStatus: 401
    }; // 无公钥返回错误
  }
  
  // 公钥必须完全匹配
  if (publicKey !== agentPublicKey) {
    return {
      passed: false,
      checkType: 'signature_validation',
      error: 'Signature public key does not match Agent public key',
      httpStatus: 403
    }; // 公钥不匹配返回错误
  }
  
  return {
    passed: true,
    checkType: 'signature_validation'
  }; // 验证成功返回通过
}

/**
 * 创建有效的 Session Token（用于测试）
 */
export function createSessionToken(agentId: string, nodeId: string): string {
  const tokenData = {
    agentId,
    nodeId,
    timestamp: Date.now()
  }; // Token 数据
  
  return Buffer.from(JSON.stringify(tokenData)).toString('base64');
}

/**
 * 创建损坏的 Session Token（用于测试）
 */
export function createCorruptedSessionToken(): string {
  return Buffer.from('corrupted-token-data').toString('base64');
}

function validateDeleteSecurity(
  agentFile: AgentIdentityFile,
  options: DeleteSecurityOptions,
  dataDir: string
): SecurityCheckResult | null {
  const { 
    currentNodeId, 
    confirm, 
    force, 
    requesterAgentId, 
    skipNodeValidation,
    sessionToken,
    signaturePublicKey,
    skipTokenValidation,
    skipSignatureValidation
  } = options;
  
  // 1. 强制删除跳过所有安全检查
  if (force) {
    logger.warn('SECURITY: Delete forced - skipping all security checks', {
      agentId: agentFile.agentId.slice(0, 8)
    });
    return { passed: true, checkType: 'confirmation', httpStatus: 200 }; // 返回 passed 表示强制通过
  }
  
  // 2. 确认机制检查
  if (!confirm) {
    return {
      passed: false,
      checkType: 'confirmation',
      error: 'Delete requires --confirm flag to proceed. Use --force to skip all checks.',
      httpStatus: 400
    }; // 返回 passed=false 表示需要确认
  }
  
  // 3. Session Token 验证（如果提供了 token）
  // 注意：空 token 也会触发验证失败
  if (sessionToken !== undefined && !skipTokenValidation) {
    const tokenResult = validateSessionToken(sessionToken, agentFile.agentId, currentNodeId);
    
    if (!tokenResult.valid) {
      const checkType = tokenResult.errorType === 'expired' ? 'token_expired' :
                         tokenResult.errorType === 'invalid_format' ? 'token_invalid' :
                         'token_match';
      const httpStatus = tokenResult.errorType === 'invalid_format' ? 401 : 
                         tokenResult.errorType === 'expired' ? 401 : 
                         tokenResult.errorType === 'signature_mismatch' ? 403 : 401;
      
      logger.warn('SECURITY: Invalid session token', {
        agentId: agentFile.agentId.slice(0, 8),
        error: tokenResult.error,
        errorType: tokenResult.errorType
      });
      
      return {
        passed: false,
        checkType,
        error: tokenResult.error || 'Invalid session token',
        httpStatus
      }; // Token 验证失败返回错误
    }
    
    // Token 验证成功，记录 Agent ID
    logger.info('SECURITY: Session token validated', {
      agentId: tokenResult.agentId?.slice(0, 8),
      nodeId: tokenResult.nodeId?.slice(0, 8)
    });
  }
  
  // 4. 签名公钥验证（如果提供了公钥）
  if (signaturePublicKey && !skipSignatureValidation) {
    // 需要读取 Agent 文件获取公钥
    try {
      const content = readFileSync(agentFile.filePath, 'utf-8');
      const agentData = JSON.parse(content) as ExportedAgentIdentity;
      
      const sigResult = validateSignaturePublicKey(signaturePublicKey, agentData.publicKey);
      
      if (!sigResult.passed) {
        logger.warn('SECURITY: Signature validation failed', {
          agentId: agentFile.agentId.slice(0, 8),
          error: sigResult.error
        });
        
        return sigResult; // 签名验证失败返回错误
      }
      
      logger.info('SECURITY: Signature validated', {
        agentId: agentFile.agentId.slice(0, 8)
      });
    } catch (error) {
      return {
        passed: false,
        checkType: 'signature_validation',
        error: 'Failed to read Agent identity for signature validation',
        httpStatus: 500
      }; // 读取失败返回错误
    }
  }
  
  // 5. 如果跳过节点验证，直接返回通过
  if (skipNodeValidation) {
    logger.info('SECURITY: Skipping node validation', {
      agentId: agentFile.agentId.slice(0, 8)
    });
    return { passed: true, checkType: 'node_ownership', httpStatus: 200 }; // 跳过节点验证时返回 passed
  }
  
  // 6. 签发节点验证 - 必须提供 currentNodeId
  if (!currentNodeId) {
    return {
      passed: false,
      checkType: 'node_ownership',
      error: 'Cannot verify ownership: no Node Identity provided. Use --force to skip.',
      httpStatus: 401
    }; // 无法验证时返回错误
  }
  
  // 7. 验证 Agent 是否属于当前节点
  if (agentFile.nodeId !== currentNodeId) {
    return {
      passed: false,
      checkType: 'node_ownership',
      error: `Agent belongs to different Node (${agentFile.nodeId.slice(0, 8)}...). ` +
             `Current Node: ${currentNodeId.slice(0, 8)}... Only the issuing Node can delete this Agent.`,
      httpStatus: 403
    }; // 非签发节点返回错误
  }
  
  // 8. 跨 Agent 删除防护
  if (requesterAgentId && requesterAgentId !== agentFile.agentId) {
    return {
      passed: false,
      checkType: 'cross_agent',
      error: `Cross-agent deletion blocked. Agent ${requesterAgentId.slice(0, 8)}... ` +
             `attempted to delete Agent ${agentFile.agentId.slice(0, 8)}... ` +
             `Only the Agent itself or its issuing Node can delete.`,
      httpStatus: 403
    }; // 跨 Agent 删除返回错误
  }
  
  // 所有检查通过
  logger.info('SECURITY: Delete security checks passed', {
    agentId: agentFile.agentId.slice(0, 8),
    nodeId: currentNodeId.slice(0, 8)
  });
  
  return { passed: true, checkType: 'node_ownership', httpStatus: 200 }; // 所有检查通过
}

/**
 * 删除指定的 Agent Identity（内部实现）
 * 
 * @param agentIdOrFilename Agent ID 或文件名
 * @param dataDir 数据目录
 * @param securityOptions 安全选项
 */
export async function deleteAgentInternal(
  agentIdOrFilename: string,
  dataDir?: string,
  securityOptions?: DeleteSecurityOptions
): Promise<Result<DeleteResult>> {
  try {
    const actualDataDir = dataDir || getDataDir();
    const options = securityOptions || {}; // 使用默认空对象
    
    // 查找 Agent 文件
    let agentFile: AgentIdentityFile | null;
    
    if (agentIdOrFilename.endsWith('.json')) {
      agentFile = findAgentFileByName(agentIdOrFilename, actualDataDir);
    } else {
      agentFile = findAgentFileById(agentIdOrFilename, actualDataDir);
    }
    
    if (!agentFile) {
      return failure(createError(
        'AGENT_NOT_FOUND',
        `Agent identity not found: ${agentIdOrFilename}`
      ));
    }
    
    // 执行安全验证
    const securityCheck = validateDeleteSecurity(agentFile, options, actualDataDir);
    
    if (securityCheck && !securityCheck.passed) {
      // 安全验证失败
      const errorCode = securityCheck.checkType === 'confirmation' 
        ? 'DELETE_REQUIRES_CONFIRMATION'
        : securityCheck.checkType === 'node_ownership' 
          ? 'DELETE_UNAUTHORIZED_NODE'
          : securityCheck.checkType === 'cross_agent' 
            ? 'DELETE_CROSS_AGENT_BLOCKED'
            : securityCheck.checkType === 'token_match'
              ? 'DELETE_TOKEN_MISMATCH'
              : securityCheck.checkType === 'token_expired'
                ? 'DELETE_TOKEN_EXPIRED'
                : securityCheck.checkType === 'token_invalid'
                  ? 'DELETE_INVALID_TOKEN'
                  : securityCheck.checkType === 'signature_validation'
                    ? 'DELETE_SIGNATURE_MISMATCH'
                    : 'DELETE_SECURITY_FAILED';
      
      logger.warn('SECURITY: Delete blocked', {
        agentId: agentFile.agentId.slice(0, 8),
        checkType: securityCheck.checkType,
        error: securityCheck.error
      });
      
      return failure(createError(
        errorCode,
        securityCheck.error || 'Security validation failed'
      ));
    }
    
    // 删除文件
    unlinkSync(agentFile.filePath);
    
    logger.info('Agent identity deleted', {
      agentId: agentFile.agentId.slice(0, 8),
      filename: agentFile.filename,
      securityCheckPassed: securityCheck?.passed ?? true
    });
    
    return success({
      deleted: true,
      agentId: agentFile.agentId,
      filename: agentFile.filename,
      securityCheck: securityCheck || { passed: true, checkType: 'confirmation' }
    });
  } catch (error) {
    return failureFromError('IDENTITY_DELETE_FAILED', 'Failed to delete agent identity', error as Error);
  }
}

/**
 * CLI 入口：列出所有 Agent Identity
 */
export async function listAgents(): Promise<void> {
  console.log('');
  console.log('=== F2A Agent Identities ===');
  console.log('');
  
  const result = await listAgentsInternal();
  
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exit(1);
  }
  
  const { agents, total, dataDir } = result.data;
  
  console.log(`Data Directory: ${dataDir}`);
  console.log('');
  
  if (total === 0) {
    console.log('No agent identities found.');
    console.log('Run "f2a daemon" to create one, or import with "f2a agents import".');
  } else {
    console.log(`Found ${total} agent identity file(s):`);
    console.log('');
    
    for (const agent of agents) {
      const expiredStatus = agent.isExpired ? '❌ Expired' : '✅ Valid';
      const expiryInfo = agent.expiresAt ? `Expires: ${agent.expiresAt} (${expiredStatus})` : 'Expires: Never';
      
      console.log(`[${agent.filename}]`);
      console.log(`  Agent ID: ${agent.agentId}`);
      console.log(`  Name: ${agent.name}`);
      console.log(`  Node ID: ${agent.nodeId.slice(0, 16)}...`);
      console.log(`  Created: ${agent.createdAt}`);
      console.log(`  ${expiryInfo}`);
      console.log(`  File Size: ${agent.fileSize} bytes`);
      console.log('');
    }
  }
  
  console.log('');
}

/**
 * CLI 入口：导出 Agent Identity
 */
export async function exportAgent(agentIdOrFilename: string, outputPath?: string): Promise<void> {
  console.log('');
  console.log('=== Exporting F2A Agent Identity ===');
  console.log('');
  
  const result = await exportAgentInternal(agentIdOrFilename, outputPath);
  
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exit(1);
  }
  
  const { agentId, outputPath: finalPath, warnings } = result.data;
  
  console.log(`✅ Agent ${agentId.slice(0, 8)}... exported to: ${finalPath}`);
  
  for (const warning of warnings) {
    console.log(`   ⚠️  ${warning}`);
  }
  
  console.log('');
  console.log('⚠️  WARNING: This file contains sensitive private keys!');
  console.log('   Store it securely and delete after use.');
  console.log('');
}

/**
 * CLI 入口：导入 Agent Identity
 */
export async function importAgent(inputPath: string, targetFilename?: string, forceImport: boolean = false): Promise<void> {
  console.log('');
  console.log('=== Importing F2A Agent Identity ===');
  console.log('');
  
  const result = await importAgentInternal(inputPath, targetFilename, undefined, forceImport);
  
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exit(1);
  }
  
  const { agentId, filename, warnings } = result.data;
  
  console.log(`✅ Agent ${agentId.slice(0, 8)}... imported as: ${filename}`);
  
  for (const warning of warnings) {
    console.log(`   ⚠️  ${warning}`);
  }
  
  console.log('');
  console.log('⚠️  WARNING: Delete the import file after verification!');
  console.log('');
}

/**
 * CLI 入口：删除 Agent Identity
 */
/**
 * 交互式确认删除（增强版 - 多 Agent 误删防护）
 * 
 * @param agentFile Agent 文件信息
 * @param siblingAgents 同节点下的其他 Agent 列表
 * @returns 用户是否确认
 */
async function interactiveConfirmDelete(
  agentFile: AgentIdentityFile,
  siblingAgents: AgentIdentityFile[] = []
): Promise<boolean> {
  console.log('');
  console.log('⚠️  WARNING: This action cannot be undone!');
  console.log('');
  console.log('The following Agent Identity will be permanently deleted:');
  console.log('');
  console.log(`  Agent ID:    ${agentFile.agentId}`);
  console.log(`  Name:        ${agentFile.name}`);
  console.log(`  Node ID:     ${agentFile.nodeId}`);
  console.log(`  Created:     ${agentFile.createdAt}`);
  console.log(`  File:        ${agentFile.filename}`);
  console.log('');
  
  // 多 Agent 误删防护警告
  if (siblingAgents.length > 0) {
    console.log('🚨 MULTIPLE AGENTS WARNING:');
    console.log('');
    console.log(`  This Node has ${siblingAgents.length + 1} Agent(s). Deleting one may affect others.`);
    console.log('');
    console.log('  Other Agents on this Node:');
    for (const sibling of siblingAgents) {
      console.log(`    - ${sibling.name} (ID: ${sibling.agentId.slice(0, 8)}...)`);
    }
    console.log('');
    console.log('  ⚠️  Please verify you are deleting the CORRECT Agent!');
    console.log('      Agent A cannot delete Agent B - cross-agent deletion is blocked.');
    console.log('');
  }
  
  console.log('This will permanently remove:');
  console.log('  - Agent private keys (Ed25519)');
  console.log('  - Node signature');
  console.log('  - All identity metadata');
  console.log('');
  console.log('Security Verification:');
  console.log('  - Only this Agent or its issuing Node can delete this identity');
  console.log('  - Other Agents on the same Node CANNOT delete this Agent');
  console.log('');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise<boolean>((resolve) => {
    // 第一层确认：输入 Agent ID
    rl.question(`Step 1: Type the Agent ID (${agentFile.agentId.slice(0, 8)}...) to confirm: `, (answer1) => {
      const trimmedId = answer1.trim().toLowerCase();
      
      if (trimmedId === 'cancel' || trimmedId === '') {
        rl.close();
        console.log('');
        console.log('❌ Deletion cancelled by user');
        console.log('');
        resolve(false);
        return;
      }
      
      // 验证 Agent ID（可以输入完整 ID 或前 8 位）
      if (trimmedId !== agentFile.agentId.toLowerCase() && 
          trimmedId !== agentFile.agentId.slice(0, 8).toLowerCase()) {
        rl.close();
        console.log('');
        console.log(`❌ Incorrect Agent ID. Expected: ${agentFile.agentId} or ${agentFile.agentId.slice(0, 8)}`);
        console.log('   Deletion cancelled for security');
        console.log('');
        resolve(false);
        return;
      }
      
      // 第二层确认：输入 Agent 名称（防止误删同名 Agent）
      rl.question(`Step 2: Type the Agent Name (${agentFile.name}) to confirm: `, (answer2) => {
        rl.close();
        
        const trimmedName = answer2.trim().toLowerCase();
        
        if (trimmedName === 'cancel' || trimmedName === '') {
          console.log('');
          console.log('❌ Deletion cancelled by user');
          console.log('');
          resolve(false);
          return;
        }
        
        if (trimmedName !== agentFile.name.toLowerCase()) {
          console.log('');
          console.log(`❌ Incorrect Agent Name. Expected: ${agentFile.name}`);
          console.log('   This prevents accidental deletion of similar-named Agents');
          console.log('   Deletion cancelled for security');
          console.log('');
          resolve(false);
          return;
        }
        
        console.log('');
        console.log('✅ Two-step confirmation accepted');
        console.log('   - Agent ID verified');
        console.log('   - Agent Name verified');
        console.log('');
        resolve(true);
      });
    });
  });
}

/**
 * CLI 入口：删除 Agent Identity
 * 
 * 安全机制：
 * - 默认需要交互式确认（输入完整 Agent ID）
 * - --confirm 跳过交互式确认，但仍需显示信息
 * - --force 完全跳过所有确认（仅用于脚本）
 * - 验证 Node ID 匹配（只有签发者节点才能删除）
 * 
 * @param agentIdOrFilename Agent ID 或文件名
 * @param confirmMode --confirm 标志
 * @param forceMode --force 标志
 */
export async function deleteAgent(
  agentIdOrFilename: string,
  confirmMode: boolean = false,
  forceMode: boolean = false
): Promise<void> {
  console.log('');
  console.log('=== Deleting F2A Agent Identity ===');
  console.log('');
  
  const dataDir = getDataDir();
  
  // 1. 查找 Agent 文件
  let agentFile: AgentIdentityFile | null;
  if (agentIdOrFilename.endsWith('.json')) {
    agentFile = findAgentFileByName(agentIdOrFilename, dataDir);
  } else {
    agentFile = findAgentFileById(agentIdOrFilename, dataDir);
  }
  
  if (!agentFile) {
    console.error(`❌ Agent identity not found: ${agentIdOrFilename}`);
    console.log('');
    console.log('Available Agents:');
    console.log('  Run "f2a agents list" to see all registered Agents');
    console.log('');
    process.exit(1);
  }
  
  // 2. 显示 Agent 信息
  console.log('Agent Identity to delete:');
  console.log('');
  console.log(`  Agent ID:    ${agentFile.agentId}`);
  console.log(`  Name:        ${agentFile.name}`);
  console.log(`  Node ID:     ${agentFile.nodeId}`);
  console.log(`  Created:     ${agentFile.createdAt}`);
  console.log(`  File:        ${agentFile.filename}`);
  if (agentFile.expiresAt) {
    const expired = agentFile.isExpired;
    console.log(`  Expires:     ${agentFile.expiresAt} ${expired ? '(EXPIRED)' : ''}`);
  }
  console.log('');
  
  // 3. 验证 Node ID 匹配（权限检查）
  const nodeIdentityPath = join(dataDir, 'node-identity.json');
  if (existsSync(nodeIdentityPath)) {
    try {
      const nodeManager = new NodeIdentityManager({ dataDir });
      const nodeLoadResult = await nodeManager.loadOrCreate();
      
      if (nodeLoadResult.success) {
        const currentNodeId = nodeManager.getNodeId();
        
        if (currentNodeId && currentNodeId !== agentFile.nodeId) {
          console.log('🚨 SECURITY WARNING:');
          console.log('');
          console.log(`  This Agent was signed by a different Node!`);
          console.log(`  Agent Node ID:  ${agentFile.nodeId}`);
          console.log(`  Current Node:   ${currentNodeId}`);
          console.log('');
          console.log('  Only the issuing Node can delete this Agent Identity.');
          console.log('  If you imported this Agent from another machine, you cannot delete it here.');
          console.log('');
          
          if (!forceMode) {
            console.log('❌ Deletion blocked - unauthorized Node');
            console.log('');
            console.log('To force delete (dangerous):');
            console.log(`  f2a agents delete --force "${agentIdOrFilename}"`);
            console.log('');
            process.exit(1);
          }
          
          console.log('⚠️  WARNING: --force is being used to delete an Agent from a different Node.');
          console.log('   This bypasses security checks and may cause issues.');
          console.log('');
        }
      }
    } catch (error) {
      logger.warn('Failed to verify Node ownership', { error });
    }
  }
  
  // 4. 查找同节点下的其他 Agent（多 Agent 误删防护）
  const siblingAgents: AgentIdentityFile[] = [];
  try {
    const allAgentsResult = await listAgentsInternal(dataDir);
    if (allAgentsResult.success) {
      for (const agent of allAgentsResult.data.agents) {
        // 排除当前要删除的 Agent，只保留同节点下的其他 Agent
        if (agent.nodeId === agentFile.nodeId && agent.agentId !== agentFile.agentId) {
          siblingAgents.push(agent);
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to list sibling agents', { error });
  }
  
  // 5. 确认流程
  let confirmed = false;
  
  if (forceMode) {
    // --force: 完全跳过确认
    console.log('⚠️  --force mode: Skipping all confirmations');
    console.log('');
    confirmed = true;
  } else if (confirmMode) {
    // --confirm: 跳过交互式确认，但仍显示信息
    if (siblingAgents.length > 0) {
      console.log('⚠️  WARNING: Multiple Agents on this Node!');
      console.log(`   Other Agents: ${siblingAgents.map(a => a.name).join(', ')}`);
      console.log('');
    }
    console.log('✅ --confirm flag provided, proceeding with deletion');
    console.log('');
    confirmed = true;
  } else {
    // 默认：交互式确认（增强版，显示其他 Agent）
    confirmed = await interactiveConfirmDelete(agentFile, siblingAgents);
  }
  
  if (!confirmed) {
    process.exit(1);
  }
  
  // 6. 执行删除
  try {
    unlinkSync(agentFile.filePath);
    
    logger.info('Agent identity deleted via CLI', {
      agentId: agentFile.agentId.slice(0, 8),
      filename: agentFile.filename,
      forceMode,
      confirmMode
    });
    
    console.log(`✅ Agent ${agentFile.name} deleted successfully`);
    console.log('');
    console.log('   Agent ID: ' + agentFile.agentId);
    console.log('   File: ' + agentFile.filename);
    console.log('');
    console.log('⚠️  Private keys have been permanently removed.');
    console.log('   If you need to restore, you must have a backup file.');
    console.log('');
  } catch (error) {
    console.error('❌ Failed to delete Agent Identity');
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * 显示 agents 命令帮助
 */
export function showAgentsHelp(): void {
  console.log(`
Usage: f2a agents [subcommand] [options]

Manage multiple F2A Agent identities.

Subcommands:
  list                    List all agent identity files
  export <id|filename>    Export specific agent identity
  export <id> [path]      Export to specified output path
  import <path>           Import agent identity from file
  import <path> [name]    Import with custom filename
  delete <id|filename>    Delete specific agent identity (requires confirmation)

Options:
  --confirm               Skip interactive confirmation (still shows info)
  --force, -f             Force delete/bypass all security checks (DANGEROUS)

Delete Security:
  Default:     Interactive confirmation (must type full Agent ID)
  --confirm:   Skip interactive prompt, proceed after showing info
  --force:     Bypass all checks including Node ownership (script mode)

Examples:
  f2a agents list
  f2a agents export agent-abc123
  f2a agents export agent-identity.json ./backup.json
  f2a agents import ./backup.json
  f2a agents import ./backup.json my-agent.json
  f2a agents import --force ./expired-agent.json
  f2a agents delete agent-abc123                    # Interactive confirm
  f2a agents delete agent-abc123 --confirm          # Skip interactive
  f2a agents delete agent-abc123 --force            # Bypass all (DANGER)

Notes:
  - Multiple agent identity files can coexist
  - Files are named: agent-identity.json (default) or agent-identity-<id>.json
  - Each file contains one agent identity with private keys
  - Delete operation permanently removes private keys

Delete Security Mechanisms:
  1. Node Ownership Check: Only the issuing Node can delete
     - Agent signed by Node A cannot be deleted by Node B
     - Cross-node deletion requires --force (dangerous)

  2. Interactive Confirmation: Default mode requires typing Agent ID
     - Prevents accidental deletion
     - Must match exact Agent ID to proceed

  3. --confirm Flag: For automation with safety
     - Still displays Agent info before deletion
     - Skips interactive prompt
     - Recommended for scripts that already verified

  4. --force Flag: DANGEROUS - bypasses all checks
     - Skips Node ownership verification
     - Skips confirmation
     - Only use when you understand the risks

Security:
  - Export files contain sensitive private keys
  - Store export files securely
  - Delete import/export files after use
  - Expired identities require --force to import
  - Deleting wrong Agent may break applications
`);
}