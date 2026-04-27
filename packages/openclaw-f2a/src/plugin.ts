/**
 * F2A Webhook Plugin (Refactored per Issue #140)
 * 
 * Changes:
 * - Removed self-built HTTP server (9002 port)
 * - Use OpenClaw Gateway's registerHttpRoute API
 * - Removed webhookPort config
 * - Gateway handles rate limiting, auth, deduplication
 *
 * Architecture per RFC004 + Issue #140:
 * - register() saves config, registers HTTP route with Gateway
 * - registerService() starts daemon registration in background
 * - handleWebhookRequest() processes incoming messages and forwards to Agent
 */

import type { OpenClawPluginApi, WebhookConfig, ApiLogger } from './types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { signChallenge } from '@f2a/network';
import type { Challenge, ChallengeResponse } from '@f2a/network';

/**
 * Agent Identity 文件结构
 * RFC011: 包含 selfSignature 字段
 */
interface AgentIdentityFileData {
  agentId: string;
  name?: string;
  publicKey: string;
  privateKey?: string;
  /** RFC011: Agent 自签名 (证明公钥所有权) */
  selfSignature?: string;
  peerId?: string;
  signature?: string;
  nodeSignature?: string;
  nodeId?: string;
  e2eePublicKey?: string;
  webhook?: { url: string; token?: string };
  capabilities?: { name: string; version?: string }[];
  createdAt: string;
  lastActiveAt: string;
  token?: string;
}

/**
 * 读取最新的 identity 文件
 * 返回完整的 identity 对象，按 lastActiveAt 排序选择最新的
 */
function readLatestIdentity(agentIdentitiesDir: string): AgentIdentityFileData | null {
  if (!existsSync(agentIdentitiesDir)) {
    return null;
  }
  
  const files = readdirSync(agentIdentitiesDir)
    .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
  
  if (files.length === 0) {
    return null;
  }
  
  let latestIdentity: AgentIdentityFileData | null = null;
  
  for (const file of files) {
    try {
      const content = readFileSync(join(agentIdentitiesDir, file), 'utf-8');
      const identity = JSON.parse(content) as AgentIdentityFileData;
      
      if (identity && identity.agentId) {
        if (!latestIdentity || (identity.lastActiveAt && identity.lastActiveAt > (latestIdentity.lastActiveAt || ''))) {
          latestIdentity = identity;
        }
      }
    } catch (err) {
      // 跳过无效文件
    }
  }
  
  return latestIdentity;
}

/**
 * 初始化 Agent Identity
 * 如果 identity 文件不存在，调用 CLI 创建
 * 
 * @param config 插件配置
 * @param logger 日志记录器
 * @returns identity 对象或 null（失败时）
 */
function initializeAgentIdentity(
  config: Required<WebhookConfig>,
  logger?: ApiLogger
): AgentIdentityFileData | null {
  const agentIdentitiesDir = join(homedir(), '.f2a', 'agent-identities');
  
  // 检查是否存在 identity 文件
  const identity = readLatestIdentity(agentIdentitiesDir);
  
  if (identity) {
    logger?.info('[F2A] Found existing agent identity:', identity.agentId.slice(0, 16));
    return identity;
  }
  
  // 没有 identity，调用 CLI 创建
  logger?.info('[F2A] No agent identity found, creating new one via CLI...');
  
  // 注意: init 不传 webhook，在 register 时传入
  try {
    const cmd = `f2a agent init --name "${config.agentName}"`;
    logger?.info('[F2A] Running:', cmd);
    
    const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
    logger?.info('[F2A] CLI output:', output.trim());
    
    // 重新读取创建的 identity
    const newIdentity = readLatestIdentity(agentIdentitiesDir);
    
    if (newIdentity) {
      logger?.info('[F2A] Agent identity created successfully:', newIdentity.agentId.slice(0, 16));
      return newIdentity;
    } else {
      logger?.error('[F2A] Failed to read newly created identity');
      return null;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger?.error('[F2A] Failed to create agent identity:', errorMsg);
    return null;
  }
}

/**
 * 读取已保存的 Agent Identity
 * Phase 6: 支持身份恢复
 */
function readSavedAgentId(): string | null {
  const identity = readLatestIdentity(join(homedir(), '.f2a', 'agent-identities'));
  return identity?.agentId || null;
}

/** Default configuration */
const DEFAULT_CONFIG: Required<WebhookConfig> = {
  webhookPath: '/f2a/webhook',
  webhookToken: '',
  agentTimeout: 60000,
  controlPort: 9001,
  agentName: 'OpenClaw Agent',
  agentCapabilities: ['chat', 'task'],
  runtimeId: 'local-openclaw',
  agents: [],
  autoRegister: true,
  registerRetryInterval: 5000,
  registerMaxRetries: 3,
  _registeredAgentId: ''
};

/**
 * OpenClaw Plugin entry point
 * This is called by OpenClaw Gateway when loading the plugin
 *
 * ⚠️ Important: Must be synchronous, Gateway doesn't support async register()
 * 
 * Issue #140: Use registerHttpRoute instead of self-built HTTP server
 */
export default function register(api: OpenClawPluginApi) {
  // Get plugin config from OpenClaw
  const pluginsConfig = api.config.plugins;
  const rawConfig = pluginsConfig?.entries?.['openclaw-f2a']?.config || {};

  // Merge with defaults
  const config: Required<WebhookConfig> = {
    ...DEFAULT_CONFIG,
    ...rawConfig
  };

  api.logger?.info(`[F2A Webhook] Initializing... webhookPath=${config.webhookPath}`);

  // Issue #140: Register HTTP route with OpenClaw Gateway
  // Gateway handles rate limiting, auth validation, deduplication
  if (api.registerHttpRoute) {
    api.registerHttpRoute({
      path: config.webhookPath,
      auth: 'plugin',  // Plugin handles its own auth (token check)
      handler: (req, res) => handleWebhookRequest(api, config, req, res)
    });
    api.logger?.info(`[F2A Webhook] HTTP route registered: ${config.webhookPath}`);
  } else {
    api.logger?.warn('[F2A Webhook] registerHttpRoute not available, webhook will not work');
  }

  // Register service for daemon registration
  api.registerService?.({
    id: 'f2a-daemon-registration',
    start: () => {
      api.logger?.info('[F2A Webhook] Service started');

      // Start daemon registration asynchronously
      setImmediate(async () => {
        if (config.autoRegister) {
          // Task 3: 初始化 Agent Identity（如果不存在则自动创建）
          const identity = initializeAgentIdentity(config, api.logger);
          if (!identity) {
            api.logger?.error('[F2A] Failed to initialize Agent identity, registration aborted');
            return;
          }
          
          // 存储 identity agentId 到 config（用于后续注销）
          // @ts-ignore
          config._initializedAgentId = identity.agentId;
          
          const result = await registerToDaemon(api, config);
          if (result.success && result.agent?.agentId) {
            api.logger?.info('[F2A] Registered successfully:', result.agent.agentId);
            // @ts-ignore - store agentId for cleanup
            config._registeredAgentId = result.agent.agentId;
          } else {
            api.logger?.warn('[F2A] Registration failed, will retry later');
          }
        }
      });
    },
    stop: async () => {
      // 🔑 注销 Agent
      // @ts-ignore
      if (config._registeredAgentId) {
        await unregisterFromDaemon(api, config, config._registeredAgentId);
      }
      api.logger?.info('[F2A Webhook] Service stopped');
    }
  });

  api.logger?.info('[F2A Webhook] Registered successfully');
}

/**
 * Handle webhook request from OpenClaw Gateway
 * Issue #140: Replaces startWebhookListener (self-built HTTP server)
 */
async function handleWebhookRequest(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>,
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const { exec } = await import('child_process');

  // Parse URL path - support both global webhook and agent-specific webhook
  // Global: /f2a/webhook
  // Agent-specific: /f2a/webhook/agent:<id_prefix>
  const urlPath = req.url || '';
  
  // Check for agent-specific webhook path
  // Agent ID prefix can include lowercase letters, numbers, and uppercase
  const agentMatch = urlPath.match(/^\/f2a\/webhook\/agent:([a-zA-Z0-9]+)(?:\/|$)/);
  const isAgentWebhook = agentMatch !== null;
  const isGlobalWebhook = urlPath === config.webhookPath || urlPath === '/f2a/webhook';
  
  // Only handle POST to webhook paths
  if (req.method !== 'POST' || (!isGlobalWebhook && !isAgentWebhook)) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }
  
  // Extract agent ID prefix if present
  const agentIdPrefix = isAgentWebhook ? agentMatch![1] : null;

  // Validate token (plugin handles its own auth)
  const authHeader = req.headers['authorization'] || req.headers['x-f2a-token'];
  const token = typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : '';
  if (config.webhookToken && token !== config.webhookToken) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return true;
  }

  // Parse body
  let body = '';
  for await (const chunk of req) body += chunk;
  
  let payload: { 
    from?: string | { agentId?: string; name?: string }; 
    fromAgentId?: string; 
    content?: string; 
    message?: string;
    topic?: string;
    type?: string;
    to?: { agentId?: string; name?: string };
    messageId?: string;
  };
  try {
    payload = JSON.parse(body);
  } catch {
    res.statusCode = 400;
    res.end('Invalid JSON');
    return true;
  }

  // 兼容 MessageRouter 的 payload 格式：
  // - from 可以是字符串或 { agentId, name } 对象
  // - content 或 message 字段
  const fromAgentId = typeof payload.from === 'string' 
    ? payload.from 
    : payload.from?.agentId || payload.fromAgentId || '';
  const message = payload.content || payload.message || '';
  
  if (!fromAgentId || !message) {
    res.statusCode = 400;
    res.end('Missing from or content');
    return true;
  }

  // Log with webhook type info
  const webhookType = isAgentWebhook ? `agent:${agentIdPrefix}` : 'global';
  api.logger?.info(`[F2A Webhook] Received message (${webhookType}) from ${fromAgentId.slice(0, 16)}, length=${message.length}`);

  // Invoke Agent to generate reply
  // Use agentIdPrefix as session key if available, otherwise use fromAgentId prefix
  const sessionKeyPrefix = agentIdPrefix || fromAgentId.slice(0, 16);
  const reply = await invokeAgent(api, sessionKeyPrefix, message, config.agentTimeout);

  // Send reply via f2a CLI
  if (reply) {
    try {
      exec(`f2a send --to "${fromAgentId}" --message "${reply.replace(/"/g, '\\"')}"`, {
        timeout: 10000
      });
      api.logger?.info(`[F2A Webhook] Reply sent to ${fromAgentId.slice(0, 16)}`);
    } catch (err) {
      api.logger?.error(`[F2A Webhook] Failed to send reply: ${String(err)}`);
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true }));
  return true;
}

/**
 * 自动注册到 F2A Daemon
 * Phase 6: 支持恢复已有身份
 * Phase 7: 使用 Challenge-Response 验证身份
 * Phase 4: 保存 token 到 identity 文件
 * 
 * Issue #140: Webhook URL now uses Gateway's base URL
 */
export async function registerToDaemon(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>
): Promise<{ success: boolean; restored?: boolean; verified?: boolean; agent?: { agentId: string }; token?: string }> {
  const controlPort = config.controlPort || 9001;
  
  // Issue #140: Construct webhook URL using Gateway's base URL
  const gatewayBaseUrl = api.runtime?.gatewayBaseUrl || 'http://127.0.0.1:18789';
  const webhookUrl = `${gatewayBaseUrl}${config.webhookPath}`;
  
  // 检测 Daemon 是否运行
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${controlPort}/health`, {
      signal: AbortSignal.timeout(2000)
    });
    
    if (!healthResponse.ok) {
      api.logger?.warn('[F2A] Daemon health check failed');
      return { success: false };
    }
  } catch (err) {
    api.logger?.warn('[F2A] Daemon not running or unreachable:', String(err));
    return { success: false };
  }
  
  // 🔑 Phase 7: 查找已保存的 AgentId，尝试 Challenge-Response 验证
  // RFC008: 使用 Agent privateKey 进行签名验证
  const savedAgentId = readSavedAgentId();
  if (savedAgentId) {
    const identity = readIdentityFile(savedAgentId);
    
    // RFC008: 检查 Agent privateKey 是否存在（用于 Ed25519 签名）
    if (identity && identity.privateKey) {
      api.logger?.info('[F2A] Found saved agentId with privateKey, attempting Challenge-Response...', savedAgentId.slice(0, 16));
      
      const result = await verifyIdentity(api, config, identity, webhookUrl);
      if (result.success && result.agent?.agentId) {
        api.logger?.info('[F2A] Identity verified via Challenge-Response:', result.agent.agentId.slice(0, 16));
        // Phase 4: token 已在 verifyIdentity 中保存
        return { success: true, restored: true, verified: true, agent: result.agent, token: result.sessionToken };
      } else {
        api.logger?.warn('[F2A] Challenge-Response failed, falling back to new registration');
      }
    }
  }
  
  // 正常注册新 Agent
  try {
    const response = await fetch(`http://127.0.0.1:${controlPort}/api/v1/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': config.webhookToken
      },
      body: JSON.stringify({
        name: config.agentName || 'OpenClaw Agent',
        agentId: savedAgentId,  // 🔑 如果有已保存的，传给 daemon
        capabilities: (config.agentCapabilities || ['chat', 'task']).map(name => ({
          name,
          version: '1.0.0'
        })),
        webhook: {
          url: webhookUrl,  // Issue #140: Use Gateway URL
          token: config.webhookToken
        }
      }),
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      api.logger?.warn('[F2A] Registration API failed:', response.status);
      return { success: false };
    }
    
    // Phase 4: 解析包含 token 的响应
    const result = await response.json() as { success?: boolean; restored?: boolean; agent?: { agentId: string }; token?: string };
    
    // Phase 4: 保存 token 到 identity 文件
    if (result.token && result.agent?.agentId) {
      if (saveIdentityWithToken(result.agent.agentId, result.token)) {
        api.logger?.info('[F2A] Token saved to identity file:', result.agent.agentId.slice(0, 16));
      } else {
        api.logger?.warn('[F2A] Failed to save token to identity file');
      }
    }
    
    if (result.restored) {
      api.logger?.info('[F2A] Agent identity restored:', result.agent?.agentId);
    } else {
      api.logger?.info('[F2A] New agent registered:', result.agent?.agentId);
    }
    
    return { success: result.success ?? false, restored: result.restored, agent: result.agent, token: result.token };
  } catch (err) {
    api.logger?.error('[F2A] Registration request failed:', String(err));
    return { success: false };
  }
}

/**
 * 注销 Agent
 */
export async function unregisterFromDaemon(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>,
  agentId: string
): Promise<void> {
  const controlPort = config.controlPort || 9001;
  
  try {
    await fetch(`http://127.0.0.1:${controlPort}/api/v1/agents/${agentId}`, {
      method: 'DELETE',
      headers: {
        'X-F2A-Token': config.webhookToken
      },
      signal: AbortSignal.timeout(5000)
    });
    
    api.logger?.info('[F2A] Agent unregistered:', agentId);
  } catch (err) {
    api.logger?.warn('[F2A] Unregister failed:', String(err));
  }
}

/**
 * Invoke Agent to generate reply
 * Uses OpenClaw subagent API if available
 * 
 * @param api - OpenClaw plugin API
 * @param sessionKeyPrefix - Prefix for session key (agentId or from prefix)
 * @param message - Message content
 * @param timeout - Timeout in milliseconds
 */
async function invokeAgent(
  api: OpenClawPluginApi,
  sessionKeyPrefix: string,
  message: string,
  timeout: number
): Promise<string | undefined> {
  const logger = api.logger;

  // Check if subagent API is available
  if (api.runtime?.subagent?.run && api.runtime?.subagent?.waitForRun) {
    try {
      const sessionKey = `f2a-webhook-${sessionKeyPrefix}`;
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { runId } = await api.runtime.subagent.run({
        sessionKey,
        message,
        deliver: true,
        idempotencyKey
      });

      const result = await api.runtime.subagent.waitForRun({
        runId,
        timeoutMs: timeout
      });

      if (result.status === 'ok') {
        const messagesResult = await api.runtime.subagent.getSessionMessages({
          sessionKey,
          limit: 10
        });

        const messages = messagesResult.messages as any[];
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === 'assistant' && msg.content) {
            const reply = typeof msg.content === 'string'
              ? msg.content
              : msg.content.find((c: any) => c.type === 'text')?.text;
            if (reply) {
              logger?.info(`[F2A Webhook] Got Agent reply, length=${reply.length}`);
              return reply;
            }
          }
        }
      }

      if (result.status === 'timeout') {
        logger?.warn('[F2A Webhook] Agent timeout');
        return 'Sorry, I took too long to respond.';
      }

      logger?.error(`[F2A Webhook] Agent error: ${result.error}`);
      return undefined;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger?.error(`[F2A Webhook] Failed to invoke Agent: ${msg}`);
      return undefined;
    }
  }

  // No subagent API available
  logger?.warn('[F2A Webhook] Subagent API not available, cannot invoke Agent');
  return undefined;
}

// ========== Phase 7: Challenge-Response 辅助函数 ==========

/**
 * Agent Identity 结构（简化版）
 * Phase 4: 添加 token 字段
 * RFC008: 添加 privateKey 和 publicKey 字段
 * RFC011: 添加 selfSignature 字段
 */
interface AgentIdentityFile {
  agentId: string;
  name: string;
  peerId: string;
  signature: string;
  /** RFC011: Agent 自签名 (证明公钥所有权) */
  selfSignature?: string;
  /** Agent Ed25519 公钥 (Base64) - RFC008 */
  publicKey?: string;
  /** Agent Ed25519 私钥 (Base64) - RFC008 */
  privateKey?: string;
  e2eePublicKey?: string;
  webhook?: { url: string; token?: string };
  capabilities?: { name: string; version?: string }[];
  createdAt: string;
  lastActiveAt: string;
  /** Phase 4: Agent Token（用于 API 认证） */
  token?: string;
}

/**
 * 读取 Identity 文件
 */
function readIdentityFile(agentId: string): AgentIdentityFile | null {
  try {
    const dataDir = join(homedir(), '.f2a');
    const identityFile = join(dataDir, 'agent-identities', `${agentId}.json`);
    if (existsSync(identityFile)) {
      return JSON.parse(readFileSync(identityFile, 'utf-8')) as AgentIdentityFile;
    }
  } catch {
    // 忽略错误
  }
  return null;
}

/**
 * Phase 4: 保存 Identity 文件（含 token）
 * 更新 identity 文件中的 token 字段
 */
function saveIdentityWithToken(agentId: string, token: string): boolean {
  try {
    const dataDir = join(homedir(), '.f2a');
    const agentIdentitiesDir = join(dataDir, 'agent-identities');
    
    // 确保目录存在
    if (!existsSync(agentIdentitiesDir)) {
      mkdirSync(agentIdentitiesDir, { recursive: true });
    }
    
    const identityFile = join(agentIdentitiesDir, `${agentId}.json`);
    
    // 读取现有 identity（如果存在）
    let identity: AgentIdentityFile;
    if (existsSync(identityFile)) {
      identity = JSON.parse(readFileSync(identityFile, 'utf-8')) as AgentIdentityFile;
    } else {
      // 如果不存在，创建基本的 identity 结构
      identity = {
        agentId,
        name: 'OpenClaw Agent',
        peerId: '',
        signature: '',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };
    }
    
    // 更新 token 和 lastActiveAt
    identity.token = token;
    identity.lastActiveAt = new Date().toISOString();
    
    // 写入文件
    writeFileSync(identityFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return true;
  } catch (err) {
    // 忽略错误
    return false;
  }
}

/**
 * Challenge-Response 验证
 * Issue #140: Added webhookUrl parameter (using Gateway URL)
 * RFC008: 使用 Agent Ed25519 私钥签名
 */
async function verifyIdentity(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>,
  identity: AgentIdentityFile,
  webhookUrl: string
): Promise<{ success: boolean; agent?: { agentId: string }; sessionToken?: string }> {
  const controlPort = config.controlPort || 9001;
  
  try {
    // 1️⃣ 请求挑战
    const challengeReq = await fetch(`http://127.0.0.1:${controlPort}/api/v1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: identity.agentId,
        webhook: { url: webhookUrl, token: config.webhookToken },  // Issue #140: Use Gateway URL
        requestChallenge: true
      }),
      signal: AbortSignal.timeout(5000)
    });
    
    if (!challengeReq.ok) {
      api.logger?.warn('[F2A] Challenge request failed:', challengeReq.status);
      return { success: false };
    }
    
    const challengeResult = await challengeReq.json() as { challenge?: boolean; nonce?: string; expiresIn?: number };
    if (!challengeResult.challenge || !challengeResult.nonce) {
      api.logger?.warn('[F2A] No challenge returned from daemon');
      return { success: false };
    }
    
    const nonce = challengeResult.nonce;
    api.logger?.info('[F2A] Challenge received, nonce prefix:', nonce.slice(0, 8));
    
    // 2️⃣ RFC008: 使用 Agent Ed25519 私钥签名
    const privateKeyBase64 = identity.privateKey;
    if (!privateKeyBase64) {
      api.logger?.error('[F2A] No Agent private key found in identity file');
      return { success: false };
    }
    
    // 构建符合 RFC008 的 Challenge 对象
    // 签名数据格式: `${challenge}:${timestamp}:${operation}`
    const challenge: Challenge = {
      challenge: nonce,  // 使用 daemon 返回的 nonce
      timestamp: new Date().toISOString(),
      expiresInSeconds: challengeResult.expiresIn || 60,
      operation: 'verify_identity'
    };
    
    // 使用 Ed25519 签名
    const response: ChallengeResponse = signChallenge(challenge, privateKeyBase64);
    
    api.logger?.info('[F2A] Challenge signed with Ed25519, signature prefix:', response.signature.slice(0, 8));
    
    // 3️⃣ 发送响应 - RFC008 格式
    const verifyReq = await fetch(`http://127.0.0.1:${controlPort}/api/v1/agents/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: identity.agentId,
        challenge: challenge,
        response: {
          signature: response.signature,
          publicKey: response.publicKey
        }
      }),
      signal: AbortSignal.timeout(5000)
    });
    
    if (!verifyReq.ok) {
      api.logger?.warn('[F2A] Verify request failed:', verifyReq.status);
      return { success: false };
    }
    
    const result = await verifyReq.json() as { success?: boolean; verified?: boolean; agentToken?: string; sessionToken?: string; agent?: { agentId: string } };
    
    // Phase 4: 服务器返回 agentToken，兼容旧的 sessionToken 字段名
    const token = result.agentToken || result.sessionToken;
    
    if (result.success && result.verified && token) {
      // Phase 4: 保存 token 到 identity 文件
      if (saveIdentityWithToken(identity.agentId, token)) {
        api.logger?.info('[F2A] Token saved to identity file:', identity.agentId.slice(0, 16));
      } else {
        api.logger?.warn('[F2A] Failed to save token to identity file');
      }
      
      api.logger?.info('[F2A] Identity verified via Challenge-Response (Ed25519):', identity.agentId.slice(0, 16));
      return { success: true, sessionToken: token, agent: result.agent };
    }
    
    api.logger?.warn('[F2A] Identity verification failed:', JSON.stringify(result));
    return { success: false };
  } catch (err) {
    api.logger?.error('[F2A] Challenge-Response failed:', String(err));
    return { success: false };
  }
}

// Re-export types
export * from './types.js';

// Task 3: Export initialization functions for testing
export { initializeAgentIdentity, readLatestIdentity };
export type { AgentIdentityFileData };
