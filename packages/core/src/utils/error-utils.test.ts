import { describe, it, expect } from 'vitest';
import {
  ensureError,
  getErrorMessage,
  toF2AError,
  toF2AErrorFromUnknown,
} from './error-utils.js';

describe('error-utils', () => {
  describe('ensureError', () => {
    it('应该返回 Error 对象当输入是 Error 时', () => {
      const error = new Error('test error');
      const result = ensureError(error);
      expect(result).toBe(error);
    });

    it('应该将字符串转换为 Error 对象', () => {
      const result = ensureError('string error');
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('string error');
    });

    it('应该将数字转换为 Error 对象', () => {
      const result = ensureError(123);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('123');
    });

    it('应该将对象转换为 Error 对象', () => {
      const result = ensureError({ foo: 'bar' });
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('[object Object]');
    });

    it('应该将 null 转换为 Error 对象', () => {
      const result = ensureError(null);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('null');
    });

    it('应该将 undefined 转换为 Error 对象', () => {
      const result = ensureError(undefined);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('undefined');
    });

    it('应该处理自定义 Error 类', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('custom error');
      const result = ensureError(error);
      expect(result).toBe(error);
      expect(result.name).toBe('CustomError');
    });
  });

  describe('getErrorMessage', () => {
    it('应该返回 Error 的 message', () => {
      const error = new Error('test message');
      const result = getErrorMessage(error);
      expect(result).toBe('test message');
    });

    it('应该直接返回字符串', () => {
      const result = getErrorMessage('string error');
      expect(result).toBe('string error');
    });

    it('应该将数字转换为字符串', () => {
      const result = getErrorMessage(404);
      expect(result).toBe('404');
    });

    it('应该将对象转换为字符串', () => {
      const result = getErrorMessage({ key: 'value' });
      expect(result).toBe('[object Object]');
    });

    it('应该处理 null', () => {
      const result = getErrorMessage(null);
      expect(result).toBe('null');
    });

    it('应该处理 undefined', () => {
      const result = getErrorMessage(undefined);
      expect(result).toBe('undefined');
    });
  });

  describe('toF2AError', () => {
    it('应该创建基本的 F2AError', () => {
      const result = toF2AError('INTERNAL_ERROR', 'Something went wrong');
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Something went wrong');
    });

    it('应该包含 cause', () => {
      const cause = new Error('original error');
      const result = toF2AError('INTERNAL_ERROR', 'Operation failed', cause);
      expect(result.cause).toBe(cause);
    });

    it('应该包含 details', () => {
      const details = { userId: '123', action: 'delete' };
      const result = toF2AError('INTERNAL_ERROR', 'Operation failed', undefined, details);
      expect(result.details).toEqual(details);
    });

    it('应该包含 cause 和 details', () => {
      const cause = new Error('original');
      const details = { retry: true };
      const result = toF2AError('INTERNAL_ERROR', 'Failed', cause, details);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Failed');
      expect(result.cause).toBe(cause);
      expect(result.details).toEqual(details);
    });

    it('应该支持不同的错误码', () => {
      const codes = ['INTERNAL_ERROR', 'NETWORK_ERROR', 'TIMEOUT_ERROR'] as const;
      for (const code of codes) {
        const result = toF2AError(code, 'test');
        expect(result.code).toBe(code);
      }
    });
  });

  describe('toF2AErrorFromUnknown', () => {
    it('应该从 Error 创建 F2AError', () => {
      const error = new Error('test error');
      const result = toF2AErrorFromUnknown('INTERNAL_ERROR', 'Operation failed', error);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Operation failed: test error');
      expect(result.cause).toBe(error);
    });

    it('应该从字符串创建 F2AError', () => {
      const result = toF2AErrorFromUnknown('INTERNAL_ERROR', 'Failed', 'string error');
      expect(result.message).toBe('Failed: string error');
    });

    it('应该从数字创建 F2AError', () => {
      const result = toF2AErrorFromUnknown('INTERNAL_ERROR', 'Failed', 500);
      expect(result.message).toBe('Failed: 500');
    });

    it('应该包含 details', () => {
      const details = { context: 'test' };
      const result = toF2AErrorFromUnknown('INTERNAL_ERROR', 'Failed', 'error', details);
      expect(result.details).toEqual(details);
    });

    it('应该处理空消息的 Error', () => {
      const error = new Error('');
      const result = toF2AErrorFromUnknown('INTERNAL_ERROR', 'Base message', error);
      // 空字符串会被追加，结果为 "Base message: "
      expect(result.message).toContain('Base message');
    });

    it('应该处理没有消息的错误类型', () => {
      const result = toF2AErrorFromUnknown('INTERNAL_ERROR', 'Base', null);
      expect(result.message).toBe('Base: null');
    });
  });
});