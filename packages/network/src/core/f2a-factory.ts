/**
 * F2A Factory - F2A 实例创建工厂
 *
 * Phase 4a: 从 f2a.ts 提取的静态工厂方法
 * 负责创建和初始化 F2A 实例的所有依赖
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { P2PNetwork } from './p2p-network.js';
import { NodeIdentityManager } from './identity/node-identity.js';
import { AgentIdentityManager } from './identity/agent-identity.js';
import { IdentityDelegator } from './identity/delegator.js';
import { CapabilityManager } from './capability-manager.js';
import { AgentRegistry } from './agent-registry.js';
import { MessageRouter } from './message-router.js';
import { MessageService } from './message-service.js';
import { Ed25519Signer } from './identity/ed25519-signer.js';
import { IdentityService } from './identity-service.js';
import { CapabilityService } from './capability-service.js';
import { Logger } from '../utils/logger.js';
import {
  F2AOptions,
  AgentInfo,
  Result,
  failureFromError
} from '../types/index.js';
import type { ExportedAgentIdentity } from './identity/types.js';
import { F2A } from './f2a.js';

// P1-1 修复:从 package.json 读取版本号
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');

let F2A_VERSION = '0.0.0';
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  F2A_VERSION = packageJson.version || '0.0.0';
} catch {
  // 如果无法读取 package.json,使用默认值
}
const PROTOCOL_VERSION = 'f2a/1.0';

/**
 * F2A 工厂类
 *
 * 负责创建和初始化 F2A 实例的所有依赖：
 * 1. NodeIdentityManager - 节点身份管理
 * 2. P2PNetwork - P2P 网络
 * 3. IdentityDelegator - 身份委托
 * 4. AgentIdentity - Agent 身份
 * 5. Ed25519Signer - Ed25519 签名器
 * 6. 各 Service 实例
 */
export class F2AFactory {
  /**
   * 创建 F2A 实例的静态工厂方法
   *
   * Phase 1: 使用 Node/Agent Identity 系统
   * - NodeIdentityManager 管理物理节点身份
   * - IdentityDelegator 创建和管理 Agent 身份
   *
   * @param options F2A 配置选项
   * @returns Promise<Result<F2A>> 创建结果
   */
  static async create(options: F2AOptions = {}): Promise<Result<F2A>> {
    try {
      // 默认配置
      const mergedOptions: Required<F2AOptions> = {
        displayName: options.displayName || 'F2A Agent',
        agentType: options.agentType || 'openclaw',
        network: {
          listenPort: 0,
          enableMDNS: true,
          enableDHT: false,
          ...options.network
        },
        security: {
          level: 'medium',
          requireConfirmation: true,
          verifySignatures: true,
          ...options.security
        },
        logLevel: options.logLevel || 'INFO',
        dataDir: options.dataDir || './f2a-data',
        messageHandlerUrl: options.messageHandlerUrl || ''
      };

      // Phase 1: 创建 NodeIdentityManager 并加载节点身份
      const dataDir = mergedOptions.dataDir;
      const nodeIdentityManager = new NodeIdentityManager({ dataDir });
      const nodeIdentityResult = await nodeIdentityManager.loadOrCreate();

      if (!nodeIdentityResult.success) {
        return failureFromError('NODE_IDENTITY_LOAD_FAILED', 
          `Failed to load or create node identity: ${JSON.stringify(nodeIdentityResult.error)}`);
      }

      const nodeId = nodeIdentityManager.getNodeId();
      const nodePeerId = nodeIdentityManager.getPeerIdString();

      if (!nodeId || !nodePeerId) {
        return failureFromError('NODE_IDENTITY_LOAD_FAILED', 'Failed to get node ID or peer ID');
      }

      // Phase 1: 创建 IdentityDelegator(传入 dataDir)
      const identityDelegator = new IdentityDelegator(nodeIdentityManager, dataDir);

      // Phase 1: 创建或加载 Agent 身份
      const agentIdentityManager = new AgentIdentityManager(dataDir);
      let agentIdentity: ExportedAgentIdentity;

      // 尝试加载已有的 Agent 身份
      const loadResult = await agentIdentityManager.loadAgentIdentity();

      if (loadResult.success) {
        agentIdentity = loadResult.data;
      } else {
        // 创建新的 Agent 身份
        // Agent 名称只能包含字母、数字、下划线、连字符和冒号
        // 将 displayName 转换为有效的 Agent 名称
        let agentName = mergedOptions.displayName
          .replace(/[^a-zA-Z0-9_\-:]/g, '-')  // 替换无效字符为连字符
          .replace(/-+/g, '-')                 // 合并连续连字符
          .replace(/^-|-$/g, '')               // 移除首尾连字符
          .slice(0, 64);                       // 限制长度

        // 如果名称为空,使用默认名称
        if (!agentName) {
          agentName = `Agent-${nodeId.slice(0, 8)}`;
        }

        const createResult = await identityDelegator.createAgent({
          name: agentName,
          capabilities: []
        });

        if (!createResult.success) {
          return failureFromError('AGENT_IDENTITY_CREATE_FAILED', 
            `Failed to create agent identity: ${JSON.stringify(createResult.error)}`);
        }

        agentIdentity = {
          id: createResult.data.agentIdentity.id,
          name: createResult.data.agentIdentity.name,
          capabilities: createResult.data.agentIdentity.capabilities,
          nodeId: createResult.data.agentIdentity.nodeId,
          publicKey: createResult.data.agentIdentity.publicKey,
          signature: createResult.data.agentIdentity.signature,
          createdAt: createResult.data.agentIdentity.createdAt,
          expiresAt: createResult.data.agentIdentity.expiresAt,
          privateKey: createResult.data.agentPrivateKey
        };

        // IdentityDelegator.createAgent 会保存到文件,我们需要重新加载
        // 确保 agentIdentityManager 实例持有正确的身份
        const reloadResult = await agentIdentityManager.loadAgentIdentity();
        if (!reloadResult.success) {
          // 如果重新加载失败,记录警告但继续
          console.warn('Warning: Failed to reload agent identity after creation');
        }
      }

      // 创建 AgentInfo
      const agentInfo: AgentInfo = {
        peerId: '', // 启动后由 P2P 网络填充
        displayName: mergedOptions.displayName,  // 保留原始 displayName
        agentType: mergedOptions.agentType as AgentInfo['agentType'],
        version: F2A_VERSION,
        capabilities: [],
        protocolVersion: PROTOCOL_VERSION,
        lastSeen: Date.now(),
        multiaddrs: [],
        // Phase 1: 添加 Agent ID
        agentId: agentIdentity.id,
        // Phase 1 修复:添加加密公钥用于 E2EE
        encryptionPublicKey: agentIdentity.publicKey
      };

      // 创建 P2P 网络
      const p2pNetwork = new P2PNetwork(agentInfo, mergedOptions.network);

      // 注入 IdentityManager(使用 NodeIdentityManager 作为基础身份管理器)
      // NodeIdentityManager 继承自 IdentityManager,可以直接使用
      p2pNetwork.setIdentityManager(nodeIdentityManager);

      // 创建 CapabilityManager(智能调度)
      const capabilityManager = new CapabilityManager({
        peerId: nodePeerId,
        baseCapabilities: [],
      });

      // 创建实例
      const f2a = new F2A(agentInfo, p2pNetwork, mergedOptions, nodeIdentityManager, capabilityManager);

      // Phase 1: 设置新的身份管理组件
      f2a.nodeIdentityManager = nodeIdentityManager;
      f2a.agentIdentityManager = agentIdentityManager;
      f2a.identityDelegator = identityDelegator;

      // RFC 003 P0 修复: 从 NodeIdentityManager 获取私钥，初始化 Ed25519Signer
      const privateKey = nodeIdentityManager.getPrivateKey();
      if (privateKey) {
        // libp2p Ed25519 PrivateKey.raw 是 64 字节扩展私钥 (scalar + prefix)
        // @noble/curves/ed25519 需要的是 32 字节 seed (前 32 字节)
        const rawBytes = Buffer.from(privateKey.raw);
        const seedBytes = rawBytes.slice(0, 32);  // 取前 32 字节作为 seed
        const seedBase64 = seedBytes.toString('base64');
        f2a.ed25519Signer = new Ed25519Signer(seedBase64);
        f2a.logger.info('Ed25519Signer initialized from node identity', { 
          rawLength: rawBytes.length,
          seedLength: seedBytes.length 
        });
      } else {
        // 如果无法获取私钥，生成新的密钥对（不推荐，但保证向后兼容）
        f2a.ed25519Signer = new Ed25519Signer();
        f2a.logger.warn('Ed25519Signer initialized with new key pair (node private key not available)');
      }

      // Phase 2a: 初始化 IdentityService
      f2a.identityService = new IdentityService({
        nodeIdentityManager,
        agentIdentityManager,
        identityDelegator,
        ed25519Signer: f2a.ed25519Signer,
        logger: f2a.logger
      });

      // Phase 1: 初始化 AgentRegistry 和 MessageRouter
      // 使用 nodePeerId 和 F2A 实例的 signData 方法
      // Phase 3: 传递 dataDir 以支持持久化
      // P0 修复:使用异步工厂方法避免同步 I/O 阻塞
      f2a.agentRegistry = await AgentRegistry.create(nodePeerId, f2a.signData.bind(f2a), { dataDir });

      // RFC 005: MessageRouter 接收 AgentRegistry 的内部 Map
      // 通过 getAgentRegistryMap() 获取(需在 AgentRegistry 中添加)
      f2a.messageRouter = new MessageRouter(f2a.agentRegistry.getAgentsMap(), p2pNetwork);

      // RFC 003: 设置 AgentRegistry 到 P2P 网络,启用签名携带
      p2pNetwork.setAgentRegistry(f2a.agentRegistry);

      // Phase 1a: 创建 MessageService
      f2a.messageService = new MessageService(
        {
          p2pNetwork,
          messageRouter: f2a.messageRouter,
          agentRegistry: f2a.agentRegistry,
          messageHandlerUrl: mergedOptions.messageHandlerUrl,
          logLevel: mergedOptions.logLevel,
        },
        f2a // EventEmitter<F2AEvents>
      );

      return { success: true, data: f2a };
    } catch (error) {
      return failureFromError('INTERNAL_ERROR', 
        `Failed to create F2A instance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}