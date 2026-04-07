/**
 * OpenClaw Plugin 集成测试
 * 
 * NOTE: 此测试涉及跨包依赖 (openclaw-f2a → @f2a/network)，
 * 应移到 monorepo 根目录运行。
 * 暂时跳过。
 */

import { describe, it, expect } from 'vitest';

describe.skip('F2A OpenClaw Plugin (跨包集成测试)', () => {
  it('应移到 monorepo 根目录运行', () => {
    // 此测试需要同时访问 @f2a/network 和 openclaw-f2a 包
    // 单独在 packages/network 目录下无法运行
    expect(true).toBe(true);
  });
});