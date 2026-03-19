/**
 * 错误处理辅助函数
 * 统一错误处理模式，减少重复代码
 */
import { F2AError, ErrorCode } from '../types/result.js';
/**
 * 确保返回 Error 对象
 * 将 unknown 类型的错误转换为 Error 对象
 *
 * @param error - 捕获的未知错误
 * @returns Error 对象
 *
 * @example
 * try {
 *   // ... some operation
 * } catch (error) {
 *   const err = ensureError(error);
 *   logger.error('Operation failed', { message: err.message });
 * }
 */
export declare function ensureError(error: unknown): Error;
/**
 * 获取错误消息字符串
 * 从 unknown 类型的错误中提取可读的错误消息
 *
 * @param error - 捕获的未知错误
 * @returns 错误消息字符串
 *
 * @example
 * try {
 *   // ... some operation
 * } catch (error) {
 *   logger.error('Failed', { error: getErrorMessage(error) });
 * }
 */
export declare function getErrorMessage(error: unknown): string;
/**
 * 创建 F2AError 对象
 * 用于构建标准化的错误响应
 *
 * @param code - 错误码
 * @param message - 错误消息
 * @param cause - 原始错误（可选）
 * @param details - 附加详情（可选）
 * @returns F2AError 对象
 *
 * @example
 * try {
 *   // ... some operation
 * } catch (error) {
 *   return failure(toF2AError('INTERNAL_ERROR', 'Operation failed', ensureError(error)));
 * }
 */
export declare function toF2AError(code: ErrorCode, message: string, cause?: Error, details?: Record<string, unknown>): F2AError;
/**
 * 从 unknown 错误创建 F2AError
 * 便捷方法，自动处理错误转换
 *
 * @param code - 错误码
 * @param message - 基础错误消息
 * @param error - 原始错误（unknown 类型）
 * @param details - 附加详情（可选）
 * @returns F2AError 对象
 *
 * @example
 * try {
 *   // ... some operation
 * } catch (error) {
 *   return failure(toF2AErrorFromUnknown('INTERNAL_ERROR', 'Operation failed', error));
 * }
 */
export declare function toF2AErrorFromUnknown(code: ErrorCode, message: string, error: unknown, details?: Record<string, unknown>): F2AError;
//# sourceMappingURL=error-utils.d.ts.map