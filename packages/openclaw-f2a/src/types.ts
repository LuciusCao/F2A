/**
 * F2A Webhook Plugin Types
 * Minimal type definitions for the simplified F2A webhook plugin
 */

// ============================================================================
// Logger Types
// ============================================================================

/**
 * API Logger interface
 */
export interface ApiLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

// ============================================================================
// OpenClaw Config Types
// ============================================================================

/**
 * OpenClaw configuration structure
 */
export interface OpenClawConfig extends Record<string, unknown> {
  plugins?: {
    entries?: Record<string, { config?: Record<string, unknown> }>;
  };
  agents?: {
    defaults?: {
      workspace?: string;
    };
  };
}

// ============================================================================
// OpenClaw Plugin API Types
// ============================================================================

/**
 * OpenClaw Plugin API
 * The interface provided by OpenClaw Gateway to plugins
 */
export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: {
    version: string;
    config: {
      loadConfig: (path?: string) => Promise<Record<string, unknown>>;
      writeConfigFile: (path: string, config: unknown) => Promise<void>;
    };
    system: {
      enqueueSystemEvent: (event: string, payload?: unknown) => void;
      requestHeartbeatNow: () => void;
    };
    /** Subagent API for spawning child agents */
    subagent?: {
      run: (params: { 
        sessionKey: string; 
        message: string; 
        provider?: string; 
        model?: string; 
        deliver?: boolean;
        idempotencyKey?: string;
      }) => Promise<{ runId: string }>;
      waitForRun: (params: { runId: string; timeoutMs?: number }) => Promise<{ status: 'ok' | 'error' | 'timeout'; error?: string }>;
      getSessionMessages: (params: { sessionKey: string; limit?: number }) => Promise<{ messages: unknown[] }>;
    };
  };
  logger?: ApiLogger;
  registerTool?: (tool: unknown, opts?: { optional?: boolean }) => void;
  registerService?: (service: { id: string; start: () => void | Promise<void>; stop?: () => void | Promise<void> }) => void;
}

// ============================================================================
// Webhook Config Types
// ============================================================================

/**
 * Webhook plugin configuration
 */
export interface WebhookConfig {
  /** Webhook endpoint path */
  webhookPath?: string;
  /** Webhook listener port */
  webhookPort?: number;
  /** Auth token for webhook requests */
  webhookToken?: string;

  /** Agent response timeout (milliseconds) */
  agentTimeout?: number;

  /** F2A Daemon control port */
  controlPort?: number;
  /** Agent name for registration */
  agentName?: string;
  /** Agent capabilities */
  agentCapabilities?: string[];
  /** Auto-register to Daemon on start */
  autoRegister?: boolean;
  /** Retry interval for registration (milliseconds) */
  registerRetryInterval?: number;
  /** Max retries for registration */
  registerMaxRetries?: number;

  /** Internal: registered agent ID for cleanup (set after successful registration) */
  _registeredAgentId?: string;
}

// ============================================================================
// Webhook Payload Types
// ============================================================================

/**
 * Incoming webhook payload from F2A daemon
 */
export interface WebhookPayload {
  /** Sender Peer ID or Agent ID */
  from?: string;
  fromAgentId?: string;
  /** Message content */
  content?: string;
  /** Topic/channel */
  topic?: string;
  /** Message metadata */
  metadata?: Record<string, unknown>;
  /** Message ID for reply tracking */
  messageId?: string;
}