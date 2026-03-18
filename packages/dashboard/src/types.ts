/**
 * F2A Dashboard Types
 */

export interface AgentCapability {
  name: string;
  description: string;
  tools?: string[];
  parameters?: Record<string, unknown>;
}

export interface AgentInfo {
  peerId: string;
  displayName?: string;
  agentType: 'openclaw' | 'custom' | 'assistant';
  version: string;
  capabilities: AgentCapability[];
  protocolVersion: string;
  lastSeen: number;
  multiaddrs: string[];
}

export interface HealthStatus {
  status: 'ok' | 'error';
  peerId: string;
}

export interface StatusResponse {
  success: boolean;
  peerId: string;
  multiaddrs: string[];
}

export interface DashboardConfig {
  apiBaseUrl: string;
  controlToken?: string;
  refreshInterval: number;
}