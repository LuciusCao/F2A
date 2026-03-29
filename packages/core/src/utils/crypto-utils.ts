/**
 * 共享加密工具函数
 * 
 * P2-5 修复：提取 isValidBase64 到共享模块，避免重复定义
 */

/**
 * 验证字符串是否为有效的 Base64 格式
 * @param str 要验证的字符串
 * @returns 是否为有效的 Base64 格式
 */
export function isValidBase64(str: unknown): str is string {
  if (typeof str !== 'string' || str.length === 0) {
    return false;
  }
  // Base64 regex: allows A-Z, a-z, 0-9, +, /, and optional = padding
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str);
}

/**
 * 安全清零 Uint8Array/Buffer
 * @param data 要清零的数据
 */
export function secureWipe(data: Uint8Array | Buffer | null | undefined): void {
  if (data) {
    data.fill(0);
  }
}