import { describe, it, expect } from 'vitest';
import { F2A, P2PNetwork, OpenClawF2AAdapter, VERSION } from './index';

describe('Index exports', () => {
  it('should export F2A class', () => {
    expect(F2A).toBeDefined();
    expect(typeof F2A.create).toBe('function');
  });

  it('should export P2PNetwork class', () => {
    expect(P2PNetwork).toBeDefined();
  });

  it('should export OpenClawF2AAdapter class', () => {
    expect(OpenClawF2AAdapter).toBeDefined();
  });

  it('should export VERSION', () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toBe('1.0.0');
  });
});
