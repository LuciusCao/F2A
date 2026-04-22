/**
 * F2A Identity CLI Commands
 * 
 * Phase 1: Node/Agent Identity management commands
 * - export: Export identity (for backup/migration)
 * - import: Import identity (for recovery/migration)
 * - status: View identity status
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync } from 'fs';
import { join, basename, dirname, isAbsolute } from 'path';
import { homedir, tmpdir, hostname } from 'os';
import { NodeIdentityManager, isValidNodeId } from '@f2a/network';
import { AgentIdentityManager } from '@f2a/network';
import { IdentityDelegator } from '@f2a/network';
import type { ExportedNodeIdentity, ExportedAgentIdentity, AgentIdentity } from '@f2a/network';
import { success, failure, failureFromError, Result, createError } from '@f2a/network';
import { secureWipe } from '@f2a/network';
import { Logger } from '@f2a/network';
import { isJsonMode, outputJson } from './output.js';

const logger = new Logger({ component: 'IdentityCLI' });

const DEFAULT_DATA_DIR = '.f2a';

/**
 * Identity export format
 */
interface IdentityExport {
  version: '1.0';
  exportedAt: string;
  node?: {
    nodeId: string;
    privateKey: string;
  e2eePublicKey?: string;
    createdAt?: string;
  // peerId field: backward compatibility with old format, ignored during import
  peerId?: string;
  };
  agent?: ExportedAgentIdentity;
}

/**
 * Agent import confirmation information
 * P1-2 fix: Used for CLI layer user confirmation handling
 */
export interface AgentImportConfirmation {
  /** Whether user confirmation is required */
  required: boolean;
  /** Confirmation reason (for display to user) */
  reason: string;
  /** Agent ID (for confirmation message) */
  agentId: string;
  /** Node ID (for confirmation message) */
  nodeId: string;
}

/**
 * importAgentIdentity internal function return type
 * P5 fix: Eliminate 'as any' type assertion
 */
interface AgentImportInternalResult {
  /** Whether import has been confirmed */
  confirmed: boolean;
  /** Whether user confirmation is required (when signature cannot be verified) */
  requiresConfirmation?: boolean;
  /** Warning message */
  warning?: string;
  /** Agent ID */
  agentId?: string;
  /** Node ID */
  nodeId?: string;
}

/**
 * Result of importing identity
 */
export interface ImportResult {
  nodeImported: boolean;
  agentImported: boolean;
  nodeError?: string;
  agentError?: string;
  warnings: string[];
  /** P1-2: Agent import confirmation information */
  agentConfirmation?: AgentImportConfirmation;
}

/**
 * Display identity status
 */
/**
 * Initialize F2A Node Identity
 * 
 * Create Node Identity and basic configuration files
 * - Node Identity: libp2p PeerId (Ed25519 key pair)
 * - config.json: Basic configuration, agentName defaults to hostname
 */
export async function initNodeIdentity(options?: { force?: boolean }): Promise<void> {
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);
  
  console.log('');
  console.log('=== F2A Initialization ===');
  console.log('');
  
  // 1. Ensure ~/.f2a directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`📁 Created data directory: ${dataDir}`);
  } else {
    console.log(`📁 Data directory exists: ${dataDir}`);
  }
  
  // 2. Check Node Identity
  const nodeIdentityPath = join(dataDir, 'node-identity.json');
  const nodeExists = existsSync(nodeIdentityPath);
  
  if (nodeExists && !options?.force) {
    console.log('📦 Node Identity: ✅ Already exists');
    const nodeManager = new NodeIdentityManager({ dataDir });
    const result = await nodeManager.loadOrCreate();
    
    // Issue 4 fix: Get nodeId directly from loadOrCreate() return value
    if (result.success && result.data) {
      console.log(`   Node ID: ${result.data.nodeId}`);
    } else {
      console.log(`   ⚠️ Could not load existing identity: ${result.error?.message}`);
    }
  } else {
    // Create new Node Identity
    console.log('📦 Creating Node Identity...');
    const nodeManager = new NodeIdentityManager({ dataDir });
    const result = await nodeManager.loadOrCreate();
    
    if (result.success && result.data) {
      console.log('   ✅ Node Identity created');
      console.log(`   Node ID: ${result.data.nodeId}`);
    } else {
      console.log(`   ❌ Failed: ${result.error?.message || 'Unknown error'}`);
      process.exit(1);
    }
  }
  
  // 3. Check/create config.json
  const configPath = join(dataDir, 'config.json');
  
  if (!existsSync(configPath)) {
    console.log('');
    console.log('⚙️  Creating config.json...');
    
    const defaultConfig = {
      network: {
        bootstrapPeers: [],
        bootstrapPeerFingerprints: {}
      },
      autoStart: false,
      enableMDNS: true,
      enableDHT: false
    };
    
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log('   ✅ Created');
    console.log('   Note: Run "f2a agent init --name <name>" to create Agent Identity');
  } else {
    console.log('');
    console.log('⚙️  config.json: ✅ Already exists');
  }
  
  // 4. Create control-token (if not exists)
  const tokenPath = join(dataDir, 'control-token');
  if (!existsSync(tokenPath)) {
    const randomToken = Buffer.from(Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 256)
    ))
      .toString('hex')
      .slice(0, 32);
    writeFileSync(tokenPath, randomToken);
    console.log('');
    console.log('🔑 Created control-token');
  }
  
  console.log('');
  console.log('=== Initialization Complete ===');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run "f2a daemon start" to start the F2A daemon');
  console.log('  2. Run "f2a agent register --name <name>" to register an Agent');
  console.log('  3. Run "f2a configure" for advanced configuration');
  console.log('');
}

/**
 * Display identity status
 */
export async function showIdentityStatus(): Promise<void> {
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);
  
  // JSON mode: collect data first, then output
  if (isJsonMode()) {
    const jsonData: {
      nodeIdentity: {
        exists: boolean;
        nodeId?: string;
        path: string;
        legacy?: boolean;
        error?: string;
      };
      agentIdentities: Array<{ agentId: string; name: string; path: string }>;
      agentCount: number;
    } = {
      nodeIdentity: {
        exists: false,
        path: join(dataDir, 'node-identity.json')
      },
      agentIdentities: [],
      agentCount: 0
    };
    
    // Node Identity
    const nodeIdentityPath = join(dataDir, 'node-identity.json');
    const legacyIdentityPath = join(dataDir, 'identity.json');
    
    const nodeExists = existsSync(nodeIdentityPath);
    const legacyExists = existsSync(legacyIdentityPath);
    
    if (legacyExists && !nodeExists) {
      jsonData.nodeIdentity.exists = false;
      jsonData.nodeIdentity.legacy = true;
    } else if (nodeExists) {
      const nodeManager = new NodeIdentityManager({ dataDir });
      const result = await nodeManager.loadOrCreate();
      
      if (result.success && result.data) {
        jsonData.nodeIdentity.exists = true;
        jsonData.nodeIdentity.nodeId = result.data.nodeId;
      } else {
        jsonData.nodeIdentity.exists = true;
        jsonData.nodeIdentity.error = result.error?.message || 'Unknown error';
      }
    }
    
    // Agent Identity - RFC008: Use ~/.f2a/agent-identities/ directory
    const agentsDir = join(dataDir, 'agent-identities');
    
    if (existsSync(agentsDir)) {
      const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.json') && f.startsWith('agent:'));
      jsonData.agentCount = agentFiles.length;
      
      for (const agentFile of agentFiles) {
        try {
          const agentData = JSON.parse(readFileSync(join(agentsDir, agentFile), 'utf-8'));
          jsonData.agentIdentities.push({
            agentId: agentData.agentId,
            name: agentData.name || 'unnamed',
            path: join(agentsDir, agentFile)
          });
        } catch {
          // Skip files that fail to parse
        }
      }
    }
    
    outputJson(jsonData);
    return;
  }
  
  // Human-readable output
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
    console.log('   Run "f2a init" to migrate to new format');
  } else if (nodeExists) {
    const nodeManager = new NodeIdentityManager({ dataDir });
    const result = await nodeManager.loadOrCreate();
    
    // Issue 4 fix: Get nodeId/peerId directly from loadOrCreate() return value
    if (result.success && result.data) {
      console.log('📦 Node Identity: ✅ Loaded');
      console.log(`   Node ID: ${result.data.nodeId}`);
    } else {
      console.log('📦 Node Identity: ❌ Failed to load');
      console.log(`   Error: ${result.error?.message || 'Unknown error'}`);
    }
  } else {
    console.log('📦 Node Identity: ⚪ Not found');
    console.log('   Run "f2a init" to create one');
  }
  
  console.log('');
  
  // Agent Identity - RFC008: Use ~/.f2a/agent-identities/ directory
  const agentsDir = join(dataDir, 'agent-identities');
  
  if (existsSync(agentsDir)) {
    // List files in agents directory
    const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.json') && f.startsWith('agent:'));
    
    if (agentFiles.length > 0) {
      console.log(`🤖 Agent Identity: ✅ ${agentFiles.length} agent(s) found`);
      for (const agentFile of agentFiles) {
        try {
          const agentData = JSON.parse(readFileSync(join(agentsDir, agentFile), 'utf-8'));
          console.log(`   - Agent ID: ${agentData.agentId}`);
          console.log(`     Name: ${agentData.name || 'unnamed'}`);
          console.log(`     Node ID: ${agentData.nodeId?.slice(0, 16)}...`);
        } catch {
          console.log(`   - ${agentFile}: ❌ Failed to read`);
        }
      }
    } else {
      console.log('🤖 Agent Identity: ⚪ No agents found in ~/.f2a/agent-identities/');
      console.log('   Run "f2a agent init --name <name>" to create one');
    }
  } else {
    console.log('🤖 Agent Identity: ⚪ Not found');
    console.log('   Run "f2a agent init --name <name>" to create one');
  }
  
  console.log('');
}

/**
 * Export identity to file
 */
export async function exportIdentity(outputPath?: string): Promise<void> {
  const dataDir = join(homedir(), DEFAULT_DATA_DIR);
  
  const exportData: IdentityExport = {
    version: '1.0',
    exportedAt: new Date().toISOString()
  };
  
  // Track export results for JSON output
  let nodeExported = false;
  let agentExported = false;
  let agentsExported = 0;
  
  // Export Node Identity
  try {
    const nodeManager = new NodeIdentityManager({ dataDir });
    const nodeResult = await nodeManager.loadOrCreate();
    
    if (nodeResult.success && nodeResult.data) {
      // Issue 1 fix: Remove peerId field, only keep privateKey
      // Issue 4 fix: Get nodeId/privateKey directly from loadOrCreate() return value
      exportData.node = {
        nodeId: nodeResult.data.nodeId,
        privateKey: nodeResult.data.privateKey
      };
      nodeExported = true;
    }
  } catch {
    // Export failed, nodeExported remains false
  }
  
  // Export Agent Identity
  try {
    const agentManager = new AgentIdentityManager(dataDir);
    const agentResult = await agentManager.loadAgentIdentity();
    
    if (agentResult.success) {
      exportData.agent = agentResult.data;
      agentExported = true;
      agentsExported = 1;
    }
  } catch {
    // Export failed, agentExported remains false
  }
  
  // Determine output path
  const finalOutputPath = outputPath || join(process.cwd(), `f2a-identity-${Date.now()}.json`);
  
  // Write file
  writeFileSync(finalOutputPath, JSON.stringify(exportData, null, 2), { mode: 0o600 });
  
  // JSON mode output
  if (isJsonMode()) {
    outputJson({
      outputPath: finalOutputPath,
      nodeExported,
      agentExported,
      agentsExported
    });
    return;
  }
  
  // Human-readable output
  console.log('');
  console.log('=== Exporting F2A Identity ===');
  console.log('');
  
  if (nodeExported) {
    console.log('📦 Node Identity: ✅ Exported');
  } else {
    console.log('📦 Node Identity: ⚪ Not found or failed to load');
  }
  
  if (agentExported) {
    console.log('🤖 Agent Identity: ✅ Exported');
  } else {
    console.log('🤖 Agent Identity: ⚪ Not found');
  }
  
  console.log('');
  console.log(`✅ Identity exported to: ${finalOutputPath}`);
  console.log('');
  console.log('⚠️  WARNING: This file contains sensitive private keys!');
  console.log('   Store it securely and delete after use.');
  console.log('');
}

/**
 * Validate import file path is within allowed range
 * P1-4 fix: Prevent path traversal vulnerability
 * 
 * @param inputPath User provided path
 * @returns Resolved safe path, or null indicates unsafe path
 */
function validateImportPath(inputPath: string): { safe: true; resolvedPath: string } | { safe: false; error: string } {
  // Check file extension
  const ext = inputPath.toLowerCase().split('.').pop();
  if (ext !== 'json') {
    return { safe: false, error: 'Import file must be a JSON file (.json extension required)' };
  }
  
  // Get path parts
  const homeDir = homedir();
  const currentDir = process.cwd();
  const systemTmpDir = tmpdir(); // P1-4 fix: Use tmpdir() to get system temp directory
  
  // Resolve absolute path
  let resolvedPath: string;
  try {
    // Handle symbolic links and get absolute path
    if (isAbsolute(inputPath)) {
      resolvedPath = realpathSync(inputPath);
    } else {
      resolvedPath = realpathSync(join(currentDir, inputPath));
    }
  } catch {
    // File does not exist or cannot be resolved
    return { safe: false, error: 'Import file not found or not accessible' };
  }
  
  // Allowed directory prefixes
  // Note: On macOS, /var is a symbolic link to /private/var, realpathSync resolves to /private/var/...
  // while tmpdir() returns /var/folders/..., so need to check both paths
  const allowedPrefixes = [
    homeDir,           // User home directory
    currentDir,        // Current working directory
    systemTmpDir,      // System temp directory (macOS: /var/folders/..., Linux: /tmp)
    '/tmp',            // Generic temp directory
    '/var/tmp',        // System temp directory
    '/private/var',    // macOS: realpathSync(/var/folders/...) actual path
  ];
  
  // P1-1 fix: Ensure exact match or path separator in correct position
  // Avoid /home/user2/file.json matching /home/user prefix issue
  const isAllowed = allowedPrefixes.some(prefix => {
    // Exact match
    if (resolvedPath === prefix) {
      return true;
    }
    // Ensure path separator in correct position, prevent partial match
    const prefixWithSep = prefix.endsWith('/') ? prefix : prefix + '/';
    return resolvedPath.startsWith(prefixWithSep);
  });
  
  if (!isAllowed) {
    logger.warn('P1-4: Import path rejected - outside allowed directories', {
      resolvedPath,
      allowedPrefixes
    });
    return { safe: false, error: 'Import file not found or not accessible' };
  }
  
  // Check suspicious path traversal patterns
  if (inputPath.includes('..') || inputPath.includes('~')) {
    logger.warn('P1-4: Suspicious path pattern detected', { inputPath });
    // If already resolved through realpath and in allowed directory, continue
  }
  
  return { safe: true, resolvedPath };
}

/**
 * Import identity from file (internal implementation, returns Result type)
 * 
 * P2-2 fix: Use Result type to return errors, not process.exit
 * P1-1 fix: Clearly mark Node Identity import limitations
 * P1-2 fix: Verify Agent Identity signature
 * P1-4 fix: Verify import path security
 * P2-7 fix: Do not expose user provided path
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
  
  // P1-4: Verify path security
  const pathValidation = validateImportPath(inputPath);
  if (!pathValidation.safe) {
    // P2-7: Use generic error message, do not expose specific path
    return failure(createError(
      'INVALID_PARAMS',
      pathValidation.error
    ));
  }
  
  const safePath = pathValidation.resolvedPath;
  
  // Read file
  let importData: IdentityExport;
  let fileContent: string;
  try {
    fileContent = readFileSync(safePath, 'utf-8');
    importData = JSON.parse(fileContent) as IdentityExport;
  } catch (error) {
    // P2-7: Use generic error message
    return failure(createError(
      'INVALID_PARAMS',
      'Failed to read or parse identity file'
    ));
  }
  
  // Verify version
  if (importData.version !== '1.0') {
    return failure(createError(
      'INVALID_PARAMS',
      `Unsupported identity file version: ${importData.version}`
    ));
  }
  
  // Ensure directory exists
  if (!existsSync(actualDataDir)) {
    mkdirSync(actualDataDir, { recursive: true });
  }
  
  // Import Node Identity
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
  
  // Import Agent Identity
  if (importData.agent) {
    const agentImportResult = await importAgentIdentity(
      importData.agent, 
      actualDataDir, 
      safePath,
      forceAgentImport
    );
    if (agentImportResult.success) {
      const agentData = agentImportResult.data;
      if (agentData.requiresConfirmation && !agentData.confirmed) {
        // P1-2: Requires user confirmation
        result.agentConfirmation = {
          required: true,
          reason: agentData.warning!,
          agentId: agentData.agentId!,
          nodeId: agentData.nodeId!
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
  
  // P3-2: Clear sensitive data in memory
  if (fileContent) {
    const contentBuffer = Buffer.from(fileContent, 'utf-8');
    secureWipe(contentBuffer);
  }
  
  return success(result);
}

/**
 * Import Node Identity
 * 
 * P1-1 fix: Regenerate E2EE key pair, ensure imported node has end-to-end encryption capability
 * P2-5 fix: Use correct field name privateKey to store private key
 * P2-8 fix: Add security audit log
 */
async function importNodeIdentity(
  nodeData: { nodeId: string; privateKey: string },
  dataDir: string
): Promise<Result<void>> {
  try {
    // Validate nodeId format
    if (!isValidNodeId(nodeData.nodeId)) {
      return failure(createError(
        'INVALID_NODE_ID',
        `Invalid nodeId format in import file`
      ));
    }
    
    // Check if Node Identity already exists
    const nodeIdentityPath = join(dataDir, 'node-identity.json');
    if (existsSync(nodeIdentityPath)) {
      // Load existing Node Identity to check if same
      const existingManager = new NodeIdentityManager({ dataDir });
      const loadResult = await existingManager.loadOrCreate();
      
      if (loadResult.success) {
        const existingNodeId = existingManager.getNodeId();
        if (existingNodeId === nodeData.nodeId) {
          // Same Node Identity, no need to import
          logger.info('P2-8: Node identity import skipped - same identity already exists', {
            nodeId: nodeData.nodeId.slice(0, 8)
          });
          return success(undefined);
        }
        // Different Node Identity, refuse to overwrite
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
    
    // P1-1: Regenerate E2EE key pair
    // Use @noble/curves to generate new X25519 key pair
    const { x25519 } = await import('@noble/curves/ed25519.js');
    const newE2eePrivateKey = x25519.utils.randomSecretKey();
    const newE2eePublicKey = x25519.getPublicKey(newE2eePrivateKey);
    
    // Write Node Identity file
    // Phase 3: Use privateKey field name, remove redundant peerId field
    const nodeIdentityContent = {
      nodeId: nodeData.nodeId,
      privateKey: nodeData.privateKey, // Phase 3: privateKey field name
      e2eePrivateKey: Buffer.from(newE2eePrivateKey).toString('base64'),
      e2eePublicKey: Buffer.from(newE2eePublicKey).toString('base64'),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      // P1-1: Mark E2EE key regenerated
      e2eeKeyRegenerated: true
    };
    
    writeFileSync(nodeIdentityPath, JSON.stringify(nodeIdentityContent, null, 2), { mode: 0o600 });
    
    // P2-8: Security audit log
    logger.info('P2-8: Node identity imported successfully', {
      nodeId: nodeData.nodeId.slice(0, 8),
      e2eeRegenerated: true
    });
    
    // P3-2: Clear sensitive data in memory
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
 * Import Agent Identity
 * 
 * P1-2 fix: Verify signature before writing, require user confirmation when cannot verify
 * P2-8 fix: Add security audit log
 */
async function importAgentIdentity(
  agentData: ExportedAgentIdentity,
  dataDir: string,
  importFilePath: string,
  forceImport: boolean = false
): Promise<Result<AgentImportInternalResult>> {
  try {
    // Validate required fields
    if (!agentData.id || !agentData.name || !agentData.nodeId || 
        !agentData.publicKey || !agentData.signature || !agentData.privateKey) {
      return failure(createError(
        'AGENT_IDENTITY_CORRUPTED',
        'Agent identity file is missing required fields'
      ));
    }
    
    // Check if expired
    if (agentData.expiresAt) {
      const expiresAt = new Date(agentData.expiresAt);
      if (expiresAt < new Date()) {
        return failure(createError(
          'AGENT_IDENTITY_EXPIRED',
          `Agent identity has expired`
        ));
      }
    }
    
    // Try to verify signature
    // If local has same Node Identity, can perform full verification
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
            // Agent from current node, can verify signature
            const delegator = new IdentityDelegator(nodeManager, dataDir);
            
            // Get Node public key for verification
            const privateKey = nodeManager.getPrivateKey();
            if (privateKey) {
              const nodePublicKey = privateKey.publicKey.raw;
              
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
                  // Verify nodeId matches
                  if (nodeId !== currentNodeId) {
                    return null;
                  }
                  return nodePublicKey;
                }
              );
              
              // P1-3: verifyAgent now returns failure instead of success(false)
              if (verifyResult.success) {
                signatureValid = verifyResult.data;
              } else {
                // P3-3: Get specific error reason
                const errorReason = verifyResult.error.message;
                signatureWarning = `Signature verification failed: ${errorReason}`;
              }
            }
          } else {
            // Agent from different node
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
    
    // If signature verification failed and not cross-node import, refuse import
    if (!signatureValid && !signatureWarning) {
      return failure(createError(
        'AGENT_IDENTITY_INVALID_SIGNATURE',
        'Agent identity signature verification failed. The identity may have been tampered with.'
      ));
    }
    
    // P1-2: If user confirmation required but not forced import, return confirmation request
    if (signatureWarning && !forceImport) {
      return success({
        confirmed: false,
        requiresConfirmation: true,
        warning: signatureWarning,
        agentId: agentData.id,
        nodeId: agentData.nodeId
      });
    }
    
    // P2-8: Security audit log
    if (isCrossNodeImport) {
      logger.warn('P2-8: Cross-node agent identity import', {
        agentId: agentData.id.slice(0, 8),
        sourceNodeId: agentData.nodeId.slice(0, 8),
        importFilePath: importFilePath.slice(0, 32) + '...'
      });
    }
    
    // Save Agent Identity
    const agentManager = new AgentIdentityManager(dataDir);
    const agentIdentityPath = join(dataDir, 'agent-identity.json');
    
    // Write file directly
    writeFileSync(agentIdentityPath, JSON.stringify(agentData, null, 2), { mode: 0o600 });
    
    // P2-8: Security audit log
    logger.info('P2-8: Agent identity imported successfully', {
      agentId: agentData.id.slice(0, 8),
      nodeId: agentData.nodeId.slice(0, 8),
      crossNode: isCrossNodeImport,
      signatureValid
    });
    
    // If signature warning, return success but include warning
    if (signatureWarning) {
      console.log(`   ⚠️  Warning: ${signatureWarning}`);
    }
    
    return success({ confirmed: true });
  } catch (error) {
    return failureFromError(
      'AGENT_IDENTITY_LOAD_FAILED',
      `Failed to import Agent Identity`
    );
  }
}

/**
 * Import identity from file (CLI entry point)
 * 
 * P2-2 fix: Call internal implementation, handle errors and exit
 * P1-2 fix: Handle user confirmation when signature verification fails
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
  
  // P1-2: Handle Agent confirmation request
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
  
  // Report Node Identity import result
  if (importResult.nodeImported) {
    console.log('📦 Node Identity: ✅ Imported');
    console.log('   (E2EE keys regenerated for security)');
  } else if (importResult.nodeError) {
    console.log(`📦 Node Identity: ❌ ${importResult.nodeError}`);
  } else {
    console.log('📦 Node Identity: ⚪ Not in import file');
  }
  
  // Report Agent Identity import result
  if (importResult.agentImported) {
    console.log('🤖 Agent Identity: ✅ Imported');
  } else if (importResult.agentError) {
    console.log(`🤖 Agent Identity: ❌ ${importResult.agentError}`);
  } else {
    console.log('🤖 Agent Identity: ⚪ Not in import file');
  }
  
  // Show warnings
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
 * Display identity command help
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