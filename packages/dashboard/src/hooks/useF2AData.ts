import { useState, useEffect, useCallback } from 'react';
import type { AgentInfo, HealthStatus, StatusResponse } from '../types';

interface UseF2ADataOptions {
  apiBaseUrl: string;
  controlToken?: string;
  refreshInterval?: number;
}

interface F2AData {
  health: HealthStatus | null;
  status: StatusResponse | null;
  peers: AgentInfo[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export function useF2AData(options: UseF2ADataOptions): F2AData & { refresh: () => void } {
  const { apiBaseUrl, controlToken, refreshInterval = 5000 } = options;
  
  const [data, setData] = useState<F2AData>({
    health: null,
    status: null,
    peers: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (controlToken) {
      headers['Authorization'] = `Bearer ${controlToken}`;
    }
    return headers;
  }, [controlToken]);

  const fetchData = useCallback(async () => {
    try {
      // Fetch health (no auth required)
      const healthRes = await fetch(`${apiBaseUrl}/health`);
      const health: HealthStatus = healthRes.ok ? await healthRes.json() : null;

      // Fetch status (auth required)
      const statusRes = await fetch(`${apiBaseUrl}/status`, {
        headers: getHeaders(),
      });
      const status: StatusResponse = statusRes.ok ? await statusRes.json() : null;

      // Fetch peers (auth required)
      const peersRes = await fetch(`${apiBaseUrl}/peers`, {
        headers: getHeaders(),
      });
      const peers: AgentInfo[] = peersRes.ok ? await peersRes.json() : [];

      setData({
        health,
        status,
        peers,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch data',
      }));
    }
  }, [apiBaseUrl, getHeaders]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  return { ...data, refresh: fetchData };
}