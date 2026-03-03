import { describe, it, expect } from 'vitest';
import {
  validateMessage,
  IdentityChallengeSchema,
  IdentityResponseSchema,
  TextMessageSchema
} from './messages';

describe('Message Validation', () => {
  it('should validate identity challenge', () => {
    const message = {
      type: 'identity_challenge',
      agentId: 'test-agent',
      publicKey: 'test-key',
      challenge: 'test-challenge',
      timestamp: Date.now()
    };

    const result = IdentityChallengeSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate identity response', () => {
    const message = {
      type: 'identity_response',
      agentId: 'test-agent',
      publicKey: 'test-key',
      signature: 'test-signature',
      timestamp: Date.now()
    };

    const result = IdentityResponseSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should validate text message', () => {
    const message = {
      type: 'message',
      id: '550e8400-e29b-41d4-a716-446655440000',
      from: 'agent-a',
      to: 'agent-b',
      content: 'Hello',
      timestamp: Date.now()
    };

    const result = TextMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should reject invalid message', () => {
    const result = validateMessage({ type: 'invalid_type' });
    expect(result.success).toBe(false);
  });

  it('should accept valid message', () => {
    const result = validateMessage({
      type: 'identity_challenge',
      agentId: 'test',
      publicKey: 'key',
      challenge: 'challenge',
      timestamp: Date.now()
    });
    expect(result.success).toBe(true);
  });
});