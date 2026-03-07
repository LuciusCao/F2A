/**
 * F2A OpenClaw Connector - Core Types
 * 
 * 统一类型定义入口文件
 * - 基础类型定义在此文件
 * - Result 类型从 src/types/result.ts 重新导出（统一错误处理模式）
 */

// ============================================================================
// 统一 Result 类型（从核心库 re-export）
// ============================================================================

// 重新导出核心 Result 类型，确保整个项目使用统一的错误处理模式
export type { Result, F2AError, ErrorCode } from '../../../src/types/result.js';
export { success, failure, failureFromError, createError } from '../../../src/types/result.js';

// ============================================================================
// OpenClaw Plugin SDK Types
// ============================================================================
export interface OpenClawPlugin {
  name: string;
  version: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  getTools(): Tool[];
  shutdown?(): Promise<void>;
  onEvent?(event: string, payload: unknown): Promise<void>;
}

// OpenClaw Plugin API (外部插件可用接口)
export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: Record<string, unknown>;
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
      runCommandWithTimeout: (command: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
    };
    media: {
      loadWebMedia: (url: string) => Promise<Buffer>;
      detectMime: (data: Buffer) => string;
    };
    tts: {
      textToSpeechTelephony: (options: { text: string; cfg: unknown }) => Promise<{ audio: Buffer; sampleRate: number }>;
    };
    stt: {
      transcribeAudioFile: (options: { filePath: string; cfg: unknown; mime?: string }) => Promise<{ text?: string }>;
    };
    logging: {
      shouldLogVerbose: () => boolean;
      getChildLogger: (bindings?: Record<string, unknown>) => unknown;
    };
  };
  logger: {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  registerTool?: (tool: unknown, opts?: { optional?: boolean }) => void;
  registerService?: (service: { id: string; start: () => void | Promise<void>; stop?: () => void | Promise<void> }) => void;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  handler: (params: any, context: SessionContext) => Promise<ToolResult>;
}

export interface ParameterSchema {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface SessionContext {
  sessionId: string;
  workspace: string;
  toJSON(): Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  data?: unknown;
}

// F2A Network Types
export interface F2ANodeConfig {
  nodePath: string;
  controlPort: number;
  controlToken: string;
  p2pPort: number;
  enableMDNS: boolean;
  bootstrapPeers: string[];
  /** 请求超时（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试基础延迟（毫秒），默认 1000 */
  retryDelayMs?: number;
}

// F2A Plugin Configuration
export interface F2APluginConfig {
  autoStart?: boolean;
  webhookPort?: number;
  webhookToken?: string;
  agentName?: string;
  capabilities?: string[];
  f2aPath?: string;
  controlPort?: number;
  controlToken?: string;
  p2pPort?: number;
  enableMDNS?: boolean;
  bootstrapPeers?: string[];
  dataDir?: string;
  maxQueuedTasks?: number;
  /** 兜底轮询间隔（毫秒），默认 60 秒 */
  pollInterval?: number;
  /** Webhook 推送配置 */
  webhookPush?: WebhookPushConfig;
  reputation?: ReputationConfig;
  security?: SecurityConfig;
}

export interface ReputationConfig {
  enabled: boolean;
  initialScore: number;
  minScoreForService: number;
  decayRate: number;
}

export interface SecurityConfig {
  requireConfirmation: boolean;
  whitelist: string[];
  blacklist: string[];
  maxTasksPerMinute: number;
}

export interface AgentInfo {
  peerId: string;
  displayName: string;
  agentType: string;
  version: string;
  capabilities: AgentCapability[];
  multiaddrs: string[];
  lastSeen: number;
  reputation?: number;
}

export interface AgentCapability {
  name: string;
  description: string;
  tools?: string[];
  parameters?: Record<string, ParameterSchema>;
}

export interface PeerInfo {
  peerId: string;
  agentInfo?: AgentInfo;
  multiaddrs: string[];
  connected: boolean;
  reputation: number;
  lastSeen: number;
}

// Task Types
export interface TaskRequest {
  taskId: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  from: string;
  timestamp: number;
  timeout: number;
}

export interface TaskResponse {
  taskId: string;
  status: 'success' | 'error' | 'rejected' | 'timeout';
  result?: unknown;
  error?: string;
  latency?: number;
}

export interface DelegateOptions {
  peerId: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  timeout?: number;
}

// Webhook Types
export interface WebhookEvent {
  type: 'discover' | 'delegate' | 'status' | 'reputation_update';
  payload: unknown;
  timestamp: number;
  signature?: string;
}

export interface DiscoverWebhookPayload {
  query: {
    capability?: string;
    minReputation?: number;
  };
  requester: string;
}

export interface DelegateWebhookPayload extends TaskRequest {
  // TaskRequest 本身已包含所有字段
}

// Result 类型已从核心库 re-export，见文件顶部

// Reputation Types
export interface ReputationEntry {
  peerId: string;
  score: number;
  successfulTasks: number;
  failedTasks: number;
  totalTasks: number;
  avgResponseTime: number;
  lastInteraction: number;
  history: ReputationEvent[];
}

export interface ReputationEvent {
  type: 'task_success' | 'task_failure' | 'task_rejected' | 'timeout' | 'malicious';
  taskId?: string;
  delta: number;
  timestamp: number;
  reason?: string;
}

// Claim Types - 认领模式
export interface TaskAnnouncement {
  announcementId: string;
  taskType: string;
  description: string;
  requiredCapabilities?: string[];
  estimatedComplexity?: number;
  reward?: number;
  timeout: number;
  from: string;
  timestamp: number;
  status: 'open' | 'claimed' | 'delegated' | 'expired';
  claims?: TaskClaim[];
}

export interface TaskClaim {
  claimId: string;
  announcementId: string;
  claimant: string;
  claimantName?: string;
  estimatedTime?: number;
  confidence?: number;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}

// Webhook Push Configuration
export interface WebhookPushConfig {
  /** OpenClaw webhook URL */
  url: string;
  /** Webhook 认证 token */
  token: string;
  /** 推送超时（毫秒） */
  timeout?: number;
  /** 是否启用 webhook 推送 */
  enabled?: boolean;
}

export interface ClaimWebhookPayload {
  announcementId: string;
  claimId: string;
  claimant: string;
  claimantName?: string;
  estimatedTime?: number;
  confidence?: number;
}