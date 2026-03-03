/**
 * F2A OpenClaw Connector - Core Types
 */

// OpenClaw Plugin SDK Types
export interface OpenClawPlugin {
  name: string;
  version: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  getTools(): Tool[];
  onEvent?(event: string, payload: unknown): Promise<void>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  handler: (params: Record<string, unknown>, context: SessionContext) => Promise<ToolResult>;
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
}

export interface F2APluginConfig {
  autoStart: boolean;
  webhookPort: number;
  agentName: string;
  capabilities: string[];
  reputation: ReputationConfig;
  security: SecurityConfig;
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

// Result Types
export interface Result<T> {
  success: boolean;
  data?: T;
  error?: string;
}

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