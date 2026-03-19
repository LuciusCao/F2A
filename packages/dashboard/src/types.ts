/**
 * F2A Dashboard Types
 */

// ============================================================================
// F2A 核心类型（从 @f2a/network 重新导出，避免重复定义）
// ============================================================================
export type { AgentInfo, AgentCapability } from '@f2a/network';

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