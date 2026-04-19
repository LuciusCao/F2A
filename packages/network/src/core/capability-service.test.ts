/**
 * CapabilityService Tests
 *
 * Phase 3b: 测试能力服务的核心方法
 * - registerCapability
 * - getCapabilities
 * - getHandler
 * - hasCapability
 * - unregisterCapability
 *
 * 测试覆盖:
 * - 正常路径: 至少 3 个具体值验证
 * - 错误路径: 至少 2 个错误场景
 * - 边界情况: 至少 1 个边界测试
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { CapabilityService } from './capability-service.js';
import { Logger } from '../utils/logger.js';

describe('CapabilityService', () => {
  let service: CapabilityService;
  let mockLogger: { info: Mock; debug: Mock; warn: Mock; error: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    // Create mock logger directly with all required methods
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    service = new CapabilityService({ logger: mockLogger as unknown as Logger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // registerCapability Tests
  // ============================================================================

  describe('registerCapability', () => {
    it('should register capability successfully', async () => {
      // 正常路径 1: 注册后验证具体值
      const cap = { name: 'chat', description: 'Chat capability', tools: [] };
      const result = service.registerCapability(cap, async () => 'ok');

      // Assert - 验证返回结果
      expect(result.success).toBe(true);

      // 验证 getCapabilities 返回包含该能力
      const caps = service.getCapabilities();
      expect(caps.length).toBe(1);
      expect(caps[0].name).toBe('chat');
      expect(caps[0].description).toBe('Chat capability');
      expect(caps[0].tools).toEqual([]);
    });

    it('should register capability with all fields', async () => {
      // 正常路径 2: 注册带所有字段的能力
      const cap = {
        name: 'translate',
        description: 'Translation capability',
        tools: ['translate-text', 'detect-language'],
        parameters: {
          sourceLang: { type: 'string' as const, required: true, description: 'Source language' },
          targetLang: { type: 'string' as const, required: true, description: 'Target language' }
        }
      };
      const result = service.registerCapability(cap, async (p) => `translated: ${p.sourceLang} -> ${p.targetLang}`);

      // Assert
      expect(result.success).toBe(true);

      const caps = service.getCapabilities();
      expect(caps.length).toBe(1);
      expect(caps[0].name).toBe('translate');
      expect(caps[0].description).toBe('Translation capability');
      expect(caps[0].tools).toEqual(['translate-text', 'detect-language']);
      expect(caps[0].parameters).toBeDefined();
      expect(caps[0].parameters?.sourceLang?.type).toBe('string');
      expect(caps[0].parameters?.targetLang?.type).toBe('string');
    });

    it('should reject invalid capability with empty name', async () => {
      // 错误路径 1: 无效定义 - 空名称
      const result = service.registerCapability(
        { name: '', description: 'Invalid', tools: [] },
        async () => {}
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_PARAMS');
        expect(result.error.message).toContain('Invalid capability');
      }
    });

    it('should reject invalid capability with empty description', async () => {
      // 错误路径 2: 无效定义 - 空描述
      const result = service.registerCapability(
        { name: 'test', description: '', tools: [] },
        async () => {}
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_PARAMS');
        expect(result.error.message).toContain('Invalid capability');
      }
    });

    it('should reject capability with invalid name format', async () => {
      // 错误路径 3: 名称格式不正确（包含大写字母或特殊字符）
      const result = service.registerCapability(
        { name: 'InvalidName!', description: 'Test', tools: [] },
        async () => {}
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should overwrite existing capability', async () => {
      // 边界情况: 覆盖已注册的能力
      service.registerCapability(
        { name: 'chat', description: 'Version 1', tools: [] },
        async () => 'v1'
      );
      service.registerCapability(
        { name: 'chat', description: 'Version 2', tools: [] },
        async () => 'v2'
      );

      // 验证 handler 更新
      const handler = service.getHandler('chat');
      expect(handler).toBeDefined();
      const result = await handler!({});
      expect(result).toBe('v2');

      // 验证描述更新
      const caps = service.getCapabilities();
      expect(caps.length).toBe(1);
      expect(caps[0].description).toBe('Version 2');
    });

    it('should trigger update callback on register', async () => {
      // 状态验证: 回调触发
      let callbackCalled = false;
      let callbackCapabilities: ReturnType<typeof service.getCapabilities> = [];

      const serviceWithCallback = new CapabilityService({
        logger: mockLogger as unknown as Logger,
        onCapabilitiesUpdate: (caps) => {
          callbackCalled = true;
          callbackCapabilities = caps;
        }
      });

      serviceWithCallback.registerCapability(
        { name: 'chat', description: 'Chat capability', tools: [] },
        async () => {}
      );

      expect(callbackCalled).toBe(true);
      expect(callbackCapabilities.length).toBe(1);
      expect(callbackCapabilities[0].name).toBe('chat');
    });

    it('should log info on successful registration', async () => {
      // 验证日志调用
      service.registerCapability(
        { name: 'echo', description: 'Echo capability', tools: [] },
        async () => {}
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registered capability',
        { name: 'echo' }
      );
    });
  });

  // ============================================================================
  // getCapabilities Tests
  // ============================================================================

  describe('getCapabilities', () => {
    it('should return empty array initially', () => {
      // 边界情况: 初始状态
      expect(service.getCapabilities()).toHaveLength(0);
    });

    it('should return single capability after registration', async () => {
      // 正常路径: 单个能力
      service.registerCapability(
        { name: 'chat', description: 'Chat', tools: [] },
        async () => {}
      );

      const caps = service.getCapabilities();
      expect(caps.length).toBe(1);
      expect(caps[0].name).toBe('chat');
      expect(caps[0].description).toBe('Chat');
      expect(caps[0].tools).toEqual([]);
    });

    it('should return multiple capabilities with correct values', async () => {
      // 正常路径 2: 多个能力
      service.registerCapability(
        { name: 'chat', description: 'Chat capability', tools: ['send-message', 'receive-message'] },
        async () => {}
      );
      service.registerCapability(
        { name: 'translate', description: 'Translation capability', tools: ['translate-text'] },
        async () => {}
      );
      service.registerCapability(
        { name: 'summarize', description: 'Summarization capability', tools: ['summarize-text'] },
        async () => {}
      );

      const caps = service.getCapabilities();
      expect(caps.length).toBe(3);

      // 验证每个能力
      const chatCap = caps.find(c => c.name === 'chat');
      expect(chatCap?.description).toBe('Chat capability');
      expect(chatCap?.tools).toEqual(['send-message', 'receive-message']);

      const translateCap = caps.find(c => c.name === 'translate');
      expect(translateCap?.description).toBe('Translation capability');
      expect(translateCap?.tools).toEqual(['translate-text']);

      const summarizeCap = caps.find(c => c.name === 'summarize');
      expect(summarizeCap?.description).toBe('Summarization capability');
      expect(summarizeCap?.tools).toEqual(['summarize-text']);
    });

    it('should not include handlers in returned capabilities', async () => {
      // 验证返回的能力不包含 handler
      service.registerCapability(
        { name: 'test', description: 'Test', tools: [] },
        async () => 'secret-result'
      );

      const caps = service.getCapabilities();
      expect(caps.length).toBe(1);
      // handler 不应该在返回值中
      expect((caps[0] as unknown as Record<string, unknown>).handler).toBeUndefined();
    });
  });

  // ============================================================================
  // getHandler Tests
  // ============================================================================

  describe('getHandler', () => {
    it('should return handler that executes correctly', async () => {
      // 正常路径 3: handler 可执行
      service.registerCapability(
        { name: 'echo', description: 'Echo capability', tools: [] },
        async (p) => p.input
      );

      const handler = service.getHandler('echo');
      expect(handler).toBeDefined();

      const result = await handler!({ input: 'hello' });
      expect(result).toBe('hello');  // 具体值验证
    });

    it('should return handler that returns complex values', async () => {
      // 正常路径: 复杂返回值
      service.registerCapability(
        { name: 'compute', description: 'Compute capability', tools: [] },
        async (p) => ({
          result: (p.a as number) + (p.b as number),
          timestamp: Date.now()
        })
      );

      const handler = service.getHandler('compute');
      const result = await handler!({ a: 5, b: 3 });

      expect(result).toHaveProperty('result', 8);
      expect(result).toHaveProperty('timestamp');
    });

    it('should return undefined for unknown capability', () => {
      // 错误路径 2: 未知能力
      expect(service.getHandler('unknown')).toBeUndefined();
    });

    it('should return undefined when no capabilities registered', () => {
      // 边界情况: 空注册表
      expect(service.getHandler('anything')).toBeUndefined();
    });

    it('should return correct handler after overwrite', async () => {
      // 边界情况: 覆盖后的 handler
      service.registerCapability(
        { name: 'test', description: 'V1', tools: [] },
        async () => 'handler-v1'
      );
      service.registerCapability(
        { name: 'test', description: 'V2', tools: [] },
        async () => 'handler-v2'
      );

      const handler = service.getHandler('test');
      expect(await handler!({})).toBe('handler-v2');
    });
  });

  // ============================================================================
  // hasCapability Tests
  // ============================================================================

  describe('hasCapability', () => {
    it('should return false for unregistered capability', () => {
      // 边界情况: 未注册
      expect(service.hasCapability('unknown')).toBe(false);
    });

    it('should return true for registered capability', async () => {
      // 正常路径
      service.registerCapability(
        { name: 'chat', description: 'Chat', tools: [] },
        async () => {}
      );

      expect(service.hasCapability('chat')).toBe(true);
    });

    it('should return false after capability is unregistered', async () => {
      // 正常路径: 注销后
      service.registerCapability(
        { name: 'temp', description: 'Temporary', tools: [] },
        async () => {}
      );

      expect(service.hasCapability('temp')).toBe(true);

      service.unregisterCapability('temp');

      expect(service.hasCapability('temp')).toBe(false);
    });
  });

  // ============================================================================
  // unregisterCapability Tests
  // ============================================================================

  describe('unregisterCapability', () => {
    it('should unregister capability successfully', async () => {
      // 正常路径
      service.registerCapability(
        { name: 'chat', description: 'Chat', tools: [] },
        async () => {}
      );

      const result = service.unregisterCapability('chat');

      expect(result).toBe(true);
      expect(service.hasCapability('chat')).toBe(false);
      expect(service.getCapabilities()).toHaveLength(0);
    });

    it('should return false for unknown capability', () => {
      // 错误路径: 注销不存在的能力
      const result = service.unregisterCapability('unknown');
      expect(result).toBe(false);
    });

    it('should trigger update callback on unregister', async () => {
      // 状态验证: 回调触发
      let callbackCount = 0;

      const serviceWithCallback = new CapabilityService({
        logger: mockLogger as unknown as Logger,
        onCapabilitiesUpdate: () => {
          callbackCount++;
        }
      });

      serviceWithCallback.registerCapability(
        { name: 'chat', description: 'Chat', tools: [] },
        async () => {}
      );
      const registerCallbackCount = callbackCount;

      serviceWithCallback.unregisterCapability('chat');

      expect(callbackCount).toBe(registerCallbackCount + 1);
    });

    it('should not trigger callback when unregistering unknown capability', async () => {
      // 边界情况: 注销不存在的能力不触发回调
      let callbackCount = 0;

      const serviceWithCallback = new CapabilityService({
        logger: mockLogger as unknown as Logger,
        onCapabilitiesUpdate: () => {
          callbackCount++;
        }
      });

      serviceWithCallback.unregisterCapability('unknown');

      expect(callbackCount).toBe(0);
    });

    it('should log info on successful unregistration', async () => {
      service.registerCapability(
        { name: 'test', description: 'Test', tools: [] },
        async () => {}
      );

      service.unregisterCapability('test');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unregistered capability',
        { name: 'test' }
      );
    });
  });
});