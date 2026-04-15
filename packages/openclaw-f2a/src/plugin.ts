/**
 * F2A Webhook Plugin (Simplified)
 * Minimal OpenClaw plugin for F2A webhook handling
 *
 * Architecture per RFC004:
 * - register() saves config, does not start services
 * - registerService() starts webhook listener in background
 * - handleWebhook() processes incoming messages and forwards to Agent
 */

import type { OpenClawPluginApi, WebhookConfig, ApiLogger } from './types.js';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { createHmac } from 'crypto';

/**
 * 读取已保存的 Agent Identity
 * Phase 6: 支持身份恢复
 */
function readSavedAgentId(): string | null {
  const agentsDir = join(homedir(), '.f2a', 'agents');
  
  if (!existsSync(agentsDir)) {
    return null;
  }
  
  // 查找第一个有效的 Agent Identity 文件
  // 每个节点通常只有一个 agent，所以直接查找第一个即可
  const files = readdirSync(agentsDir)
    .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
  
  if (files.length === 0) {
    return null;
  }
  
  // 查找最新的 identity 文件（按最后活跃时间排序）
  let latestIdentity: { agentId: string; lastActiveAt: string } | null = null;
  
  for (const file of files) {
    try {
      const content = readFileSync(join(agentsDir, file), 'utf-8');
      const identity = JSON.parse(content);
      
      if (identity && identity.agentId) {
        if (!latestIdentity || identity.lastActiveAt > latestIdentity.lastActiveAt) {
          latestIdentity = identity;
        }
      }
    } catch (err) {
      // 跳过无效文件
    }
  }
  
  return latestIdentity?.agentId || null;
}

/** Default configuration */
const DEFAULT_CONFIG: Required<WebhookConfig> = {
  webhookPath: '/f2a/webhook',
  webhookPort: 9002,
  webhookToken: '',
  agentTimeout: 60000,
  controlPort: 9001,
  agentName: 'OpenClaw Agent',
  agentCapabilities: ['chat', 'task'],
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

  api.logger?.info(`[F2A Webhook] Initializing... webhookPath=${config.webhookPath} webhookPort=${config.webhookPort}`);

  // Register service for webhook handling
  api.registerService?.({
    id: 'f2a-webhook-service',
    start: () => {
      api.logger?.info('[F2A Webhook] Service started');

      // Start webhook listener asynchronously
      setImmediate(async () => {
        try {
          await startWebhookListener(api, config);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          api.logger?.warn(`[F2A Webhook] Webhook listener failed to start: ${msg}`);
        }
      });
    },
    stop: async () => {
      // 🔑 注销 Agent（新增）
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
 * 自动注册到 F2A Daemon
 * Phase 6: 支持恢复已有身份
 * Phase 7: 使用 Challenge-Response 验证身份
 */
export async function registerToDaemon(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>
): Promise<{ success: boolean; restored?: boolean; verified?: boolean; agent?: { agentId: string } }> {
  const controlPort = config.controlPort || 9001;
  
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
  const savedAgentId = readSavedAgentId();
  if (savedAgentId) {
    const identity = readIdentityFile(savedAgentId);
    
    if (identity && identity.e2eePublicKey) {
      api.logger?.info('[F2A] Found saved agentId with e2eePublicKey, attempting Challenge-Response...', savedAgentId.slice(0, 16));
      
      const result = await verifyIdentity(api, config, identity);
      if (result.success && result.agent?.agentId) {
        api.logger?.info('[F2A] Identity verified via Challenge-Response:', result.agent.agentId.slice(0, 16));
        return { success: true, restored: true, verified: true, agent: result.agent };      } else {
        api.logger?.warn('[F2A] Challenge-Response failed, falling back to new registration');
      }
    }
  }
  
  // 正常注册新 Agent
  try {
    const response = await fetch(`http://127.0.0.1:${controlPort}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': config.webhookToken
      },
      body: JSON.stringify({
        name: config.agentName || 'OpenClaw Agent',
        agentId: savedAgentId,  // 🔑 如果有已保存的，传给 daemon（可能只是恢复而不需要 Challenge-Response）
        capabilities: (config.agentCapabilities || ['chat', 'task']).map(name => ({
          name,
          version: '1.0.0'
        })),
        webhook: {
          url: `http://127.0.0.1:${config.webhookPort}${config.webhookPath}`,
          token: config.webhookToken
        }
      }),
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      api.logger?.warn('[F2A] Registration API failed:', response.status);
      return { success: false };
    }
    
    const result = await response.json() as { success?: boolean; restored?: boolean; agent?: { agentId: string } };
    
    if (result.restored) {
      api.logger?.info('[F2A] Agent identity restored:', result.agent?.agentId);
    } else {
      api.logger?.info('[F2A] New agent registered:', result.agent?.agentId);
    }
    
    return { success: result.success ?? false, restored: result.restored, agent: result.agent };
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
    await fetch(`http://127.0.0.1:${controlPort}/api/agents/${agentId}`, {
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
 * Start webhook listener
 * Creates a simple HTTP server to receive F2A webhook requests
 */
async function startWebhookListener(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>
): Promise<void> {
  const http = await import('http');
  const { exec } = await import('child_process');

  const server = http.createServer(async (req, res) => {
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
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    
    // Extract agent ID prefix if present
    const agentIdPrefix = isAgentWebhook ? agentMatch![1] : null;

    // Validate token
    const authHeader = req.headers['authorization'] || req.headers['x-f2a-token'];
    const token = typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : '';
    if (config.webhookToken && token !== config.webhookToken) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    // Parse body
    let body = '';
    for await (const chunk of req) body += chunk;
    
    let payload: { from?: string; fromAgentId?: string; content?: string; topic?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }

    const from = payload.from || payload.fromAgentId || '';
    const message = payload.content || '';
    
    if (!from || !message) {
      res.writeHead(400);
      res.end('Missing from or content');
      return;
    }

    // Log with webhook type info
    const webhookType = isAgentWebhook ? `agent:${agentIdPrefix}` : 'global';
    api.logger?.info(`[F2A Webhook] Received message (${webhookType}) from ${from.slice(0, 16)}, length=${message.length}`);

    // Invoke Agent to generate reply
    // Use agentIdPrefix as session key if available, otherwise use from prefix
    const sessionKeyPrefix = agentIdPrefix || from.slice(0, 16);
    const reply = await invokeAgent(api, sessionKeyPrefix, message, config.agentTimeout);

    // Send reply via f2a CLI
    if (reply) {
      try {
        exec(`f2a send --to "${from}" --message "${reply.replace(/"/g, '\\"')}"`, {
          timeout: 10000
        });
        api.logger?.info(`[F2A Webhook] Reply sent to ${from.slice(0, 16)}`);
      } catch (err) {
        api.logger?.error(`[F2A Webhook] Failed to send reply: ${String(err)}`);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });

  // Use unref() to allow Gateway to exit cleanly
  server.listen(config.webhookPort, '127.0.0.1', () => {
    api.logger?.info(`[F2A Webhook] Listening on http://127.0.0.1:${config.webhookPort}${config.webhookPath}`);
    server.unref();
    
    // 🔑 自动注册（新增）
    if (config.autoRegister) {
      setImmediate(async () => {
        const result = await registerToDaemon(api, config);
        if (result.success && result.agent?.agentId) {
          api.logger?.info('[F2A] Registered successfully:', result.agent.agentId);
          // @ts-ignore - store agentId for cleanup
          config._registeredAgentId = result.agent.agentId;
        } else {
          api.logger?.warn('[F2A] Registration failed, will retry later');
        }
      });
    }
  });
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
 */
interface AgentIdentityFile {
  agentId: string;
  name: string;
  peerId: string;
  signature: string;
  e2eePublicKey?: string;
  webhook?: { url: string; token?: string };
  capabilities?: { name: string; version?: string }[];
  createdAt: string;
  lastActiveAt: string;
}

/**
 * 读取 Identity 文件
 */
function readIdentityFile(agentId: string): AgentIdentityFile | null {
  try {
    const dataDir = join(homedir(), '.f2a');
    const identityFile = join(dataDir, 'agents', `${agentId}.json`);
    if (existsSync(identityFile)) {
      return JSON.parse(readFileSync(identityFile, 'utf-8')) as AgentIdentityFile;
    }
  } catch {
    // 忽略错误
  }
  return null;
}

/**
 * 读取节点 E2EE 私钥
 */
function readNodePrivateKey(): string | null {
  try {
    const nodeIdentityPath = join(homedir(), '.f2a', 'node-identity.json');
    if (existsSync(nodeIdentityPath)) {
      const nodeIdentity = JSON.parse(readFileSync(nodeIdentityPath, 'utf-8'));
      // node-identity.json 包含 e2eeKeyPair.privateKey
      if (nodeIdentity.e2eeKeyPair?.privateKey) {
        return nodeIdentity.e2eeKeyPair.privateKey;
      }
    }
  } catch {
    // 忽略错误
  }
  return null;
}

/**
 * 签名 nonce（使用 E2EE 私钥）
 * X25519 不能直接签名，使用 HMAC-SHA256
 */
function signNonce(nonce: string, privateKeyBase64: string): string {
  const privateKey = Buffer.from(privateKeyBase64, 'base64');
  const signature = createHmac('sha256', privateKey)
    .update(nonce, 'utf-8')
    .digest('base64');
  return signature;
}

/**
 * Challenge-Response 验证
 */
async function verifyIdentity(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>,
  identity: AgentIdentityFile
): Promise<{ success: boolean; agent?: { agentId: string }; sessionToken?: string }> {
  const controlPort = config.controlPort || 9001;
  
  try {
    // 1️⃣ 请求挑战
    const challengeReq = await fetch(`http://127.0.0.1:${controlPort}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: identity.agentId,
        webhook: { url: `http://127.0.0.1:${config.webhookPort}${config.webhookPath}`, token: config.webhookToken },
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
    
    // 2️⃣ 签名 nonce（用节点 E2EE 私钥）
    const nodePrivateKey = readNodePrivateKey();
    if (!nodePrivateKey) {
      api.logger?.warn('[F2A] No node private key found, cannot sign nonce');
      return { success: false };
    }
    
    const nonceSignature = signNonce(nonce, nodePrivateKey);
    
    // 3️⃣ 发送响应
    const verifyReq = await fetch(`http://127.0.0.1:${controlPort}/api/agents/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: identity.agentId,
        nonce,
        nonceSignature
      }),
      signal: AbortSignal.timeout(5000)
    });
    
    if (!verifyReq.ok) {
      api.logger?.warn('[F2A] Verify request failed:', verifyReq.status);
      return { success: false };
    }
    
    const result = await verifyReq.json() as { success?: boolean; verified?: boolean; sessionToken?: string; agent?: { agentId: string } };
    
    if (result.success && result.verified && result.sessionToken) {
      api.logger?.info('[F2A] Identity verified via Challenge-Response:', identity.agentId.slice(0, 16));
      return { success: true, sessionToken: result.sessionToken, agent: result.agent };
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