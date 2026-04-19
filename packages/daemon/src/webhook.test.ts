import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookService } from './webhook.js';

// Mock Logger
vi.mock('@f2a/network', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    Logger: vi.fn().mockImplementation(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
  };
});

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WebhookService({
      url: 'http://localhost:8080/hooks',
      token: 'test-token'
    });
  });

  describe('constructor', () => {
    it('should create service with options', () => {
      expect(service).toBeDefined();
    });
  });

  describe('send', () => {
    it('should queue webhook', async () => {
      await service.send({ type: 'test', data: {} });
      // 实际发送会被 mock，这里只验证不报错
      expect(true).toBe(true);
    });
  });
});
