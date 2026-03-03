import { describe, it, expect } from 'vitest';
import {
  AgentCapability,
  AgentInfo,
  F2AMessage,
  F2AOptions,
  Result,
  TaskDelegateOptions,
  WebhookConfig
} from './index';

describe('Types', () => {
  it('should allow creating AgentCapability', () => {
    const cap: AgentCapability = {
      name: 'test-cap',
      description: 'Test capability',
      tools: ['tool1'],
      parameters: {
        param1: { type: 'string', required: true }
      }
    };
    expect(cap.name).toBe('test-cap');
  });

  it('should allow creating AgentInfo', () => {
    const info: AgentInfo = {
      peerId: 'test-peer-id',
      displayName: 'Test Agent',
      agentType: 'openclaw',
      version: '1.0.0',
      capabilities: [],
      protocolVersion: 'f2a/1.0',
      lastSeen: Date.now(),
      multiaddrs: []
    };
    expect(info.peerId).toBe('test-peer-id');
  });

  it('should allow creating F2AOptions', () => {
    const options: F2AOptions = {
      displayName: 'Test',
      agentType: 'openclaw',
      network: {
        listenPort: 9000,
        enableMDNS: true
      }
    };
    expect(options.displayName).toBe('Test');
  });

  it('should allow creating Result types', () => {
    const successResult: Result<string> = {
      success: true,
      data: 'test'
    };
    expect(successResult.success).toBe(true);

    const errorResult: Result<string> = {
      success: false,
      error: 'Error message'
    };
    expect(errorResult.success).toBe(false);
  });

  it('should allow creating TaskDelegateOptions', () => {
    const options: TaskDelegateOptions = {
      capability: 'test-cap',
      description: 'Test task',
      parameters: { key: 'value' },
      timeout: 30000,
      parallel: true,
      minResponses: 2
    };
    expect(options.capability).toBe('test-cap');
  });

  it('should allow creating WebhookConfig', () => {
    const config: WebhookConfig = {
      url: 'http://localhost:8080',
      token: 'test-token',
      timeout: 5000,
      retries: 3,
      retryDelay: 1000
    };
    expect(config.url).toBe('http://localhost:8080');
  });
});
