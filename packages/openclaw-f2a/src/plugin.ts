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

/** Default configuration */
const DEFAULT_CONFIG: Required<WebhookConfig> = {
  webhookPath: '/f2a/webhook',
  webhookToken: '',
  controlPort: 9001,
  controlToken: '',
  agentTimeout: 60000
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

  api.logger?.info('[F2A Webhook] Initializing...', {
    webhookPath: config.webhookPath,
    controlPort: config.controlPort
  });

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
          api.logger?.warn('[F2A Webhook] Webhook listener failed to start', { error: msg });
        }
      });
    },
    stop: async () => {
      api.logger?.info('[F2A Webhook] Service stopped');
    }
  });

  api.logger?.info('[F2A Webhook] Registered successfully');
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
  const { readFile } = await import('fs/promises');
  const { homedir } = await import('os');

  // Load control token from ~/.f2a/control-token if not provided
  let controlToken = config.controlToken;
  if (!controlToken) {
    try {
      controlToken = await readFile(`${homedir()}/.f2a/control-token`, 'utf-8').then(s => s.trim());
    } catch {
      api.logger?.warn('[F2A Webhook] Could not load control token from ~/.f2a/control-token');
    }
  }

  const server = http.createServer(async (req, res) => {
    // Only handle POST to webhook path
    if (req.method !== 'POST' || req.url !== config.webhookPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

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

    api.logger?.info('[F2A Webhook] Received message', { from: from.slice(0, 16), length: message.length });

    // Invoke Agent to generate reply
    const reply = await invokeAgent(api, from, message, config.agentTimeout);

    // Send reply via f2a CLI
    if (reply) {
      try {
        exec(`f2a send --to "${from}" --message "${reply.replace(/"/g, '\\"')}"`, {
          timeout: 10000
        });
        api.logger?.info('[F2A Webhook] Reply sent', { to: from.slice(0, 16) });
      } catch (err) {
        api.logger?.error('[F2A Webhook] Failed to send reply', { error: String(err) });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });

  // Use unref() to allow Gateway to exit cleanly
  server.listen(0, () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      api.logger?.info('[F2A Webhook] Listening on port', { port: addr.port });
    }
  });
  server.unref();
}

/**
 * Invoke Agent to generate reply
 * Uses OpenClaw subagent API if available
 */
async function invokeAgent(
  api: OpenClawPluginApi,
  from: string,
  message: string,
  timeout: number
): Promise<string | undefined> {
  const logger = api.logger;

  // Check if subagent API is available
  if (api.runtime?.subagent?.run && api.runtime?.subagent?.waitForRun) {
    try {
      const sessionKey = `f2a-webhook-${from.slice(0, 16)}`;

      const { runId } = await api.runtime.subagent.run({
        sessionKey,
        message,
        deliver: true
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
              logger?.info('[F2A Webhook] Got Agent reply', { length: reply.length });
              return reply;
            }
          }
        }
      }

      if (result.status === 'timeout') {
        logger?.warn('[F2A Webhook] Agent timeout');
        return 'Sorry, I took too long to respond.';
      }

      logger?.error('[F2A Webhook] Agent error', { error: result.error });
      return undefined;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger?.error('[F2A Webhook] Failed to invoke Agent', { error: msg });
      return undefined;
    }
  }

  // No subagent API available
  logger?.warn('[F2A Webhook] Subagent API not available, cannot invoke Agent');
  return undefined;
}

// Re-export types
export * from './types.js';