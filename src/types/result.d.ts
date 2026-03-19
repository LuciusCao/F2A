/**
 * 统一的错误类型和错误码
 */
export type ErrorCode = 'NETWORK_NOT_STARTED' | 'NETWORK_ALREADY_RUNNING' | 'PEER_NOT_FOUND' | 'CONNECTION_FAILED' | 'TIMEOUT' | 'DHT_NOT_AVAILABLE' | 'DHT_LOOKUP_FAILED' | 'ENCRYPTION_NOT_READY' | 'ENCRYPTION_FAILED' | 'IDENTITY_LOAD_FAILED' | 'IDENTITY_CREATE_FAILED' | 'IDENTITY_DELETE_FAILED' | 'IDENTITY_PASSWORD_REQUIRED' | 'IDENTITY_DECRYPT_FAILED' | 'IDENTITY_CORRUPTED' | 'TASK_NOT_FOUND' | 'TASK_REJECTED' | 'TASK_FAILED' | 'CAPABILITY_NOT_SUPPORTED' | 'INVALID_OPTIONS' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'INVALID_PARAMS' | 'INTERNAL_ERROR' | 'UNKNOWN';
export interface F2AError {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    cause?: Error;
}
export declare function createError(code: ErrorCode, message: string, details?: Record<string, unknown>, cause?: Error): F2AError;
/**
 * 统一的 Result 类型
 */
export type Result<T> = {
    success: true;
    data: T;
    error?: never;
} | {
    success: false;
    error: F2AError;
    data?: never;
};
export declare function success<T>(data: T): Result<T>;
export declare function failure<T>(error: F2AError): Result<T>;
export declare function failureFromError<T>(code: ErrorCode, message: string, cause?: Error): Result<T>;
export type AsyncResult<T> = Promise<Result<T>>;
//# sourceMappingURL=result.d.ts.map