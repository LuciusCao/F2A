import { describe, it, expect } from 'vitest';
import { WebhookService } from './webhook';

describe('WebhookService', () => {
  it('should skip notification when token not set', async () => {
    const service = new WebhookService({
      url: 'http://localhost:8080/hooks',
      token: ''
    });

    const result = await service.send({ message: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Token not set');
  });

  it('should create service with default options', () => {
    const service = new WebhookService({
      url: 'http://localhost:8080/hooks',
      token: 'test-token'
    });

    // Service created successfully
    expect(service).toBeDefined();
  });
});