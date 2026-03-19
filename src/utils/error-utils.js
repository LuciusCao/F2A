/**
 * 错误处理辅助函数
 * 统一错误处理模式，减少重复代码
 */
import { createError } from '../types/result.js';
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
export function ensureError(error) {
    if (error instanceof Error) {
        return error;
    }
    // 处理字符串错误
    if (typeof error === 'string') {
        return new Error(error);
    }
    // 处理其他类型
    return new Error(String(error));
}
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
export function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return String(error);
}
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
export function toF2AError(code, message, cause, details) {
    return createError(code, message, details, cause);
}
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
export function toF2AErrorFromUnknown(code, message, error, details) {
    const err = ensureError(error);
    // 如果原始错误有消息，追加到基础消息后
    const fullMessage = err.message ? `${message}: ${err.message}` : message;
    return createError(code, fullMessage, details, err);
}
//# sourceMappingURL=error-utils.js.map