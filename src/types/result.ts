/**
 * 统一的错误类型和错误码
 */

export type ErrorCode = 
  // 网络错误
  | 'NETWORK_NOT_STARTED'
  | 'NETWORK_ALREADY_RUNNING'
  | 'PEER_NOT_FOUND'
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  // DHT 错误
  | 'DHT_NOT_AVAILABLE'
  | 'DHT_LOOKUP_FAILED'
  // 加密错误
  | 'ENCRYPTION_NOT_READY'
  | 'ENCRYPTION_FAILED'
  // 身份错误
  | 'IDENTITY_LOAD_FAILED'
  | 'IDENTITY_CREATE_FAILED'
  | 'IDENTITY_DELETE_FAILED'
  // 任务错误
  | 'TASK_NOT_FOUND'
  | 'TASK_REJECTED'
  | 'TASK_FAILED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'INVALID_OPTIONS'
  // 安全错误
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  // 通用错误
  | 'INVALID_PARAMS'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

export interface F2AError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
}

export function createError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  cause?: Error
): F2AError {
  return { code, message, details, cause };
}

/**
 * 统一的 Result 类型
 */
export type Result<T> = 
  | { success: true; data: T; error?: never }
  | { success: false; error: F2AError; data?: never };

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure<T>(error: F2AError): Result<T> {
  return { success: false, error };
}

export function failureFromError<T>(code: ErrorCode, message: string, cause?: Error): Result<T> {
  return { success: false, error: createError(code, message, undefined, cause) };
}

export type AsyncResult<T> = Promise<Result<T>>;
