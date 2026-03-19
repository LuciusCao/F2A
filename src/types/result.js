/**
 * 统一的错误类型和错误码
 */
export function createError(code, message, details, cause) {
    return { code, message, details, cause };
}
export function success(data) {
    return { success: true, data };
}
export function failure(error) {
    return { success: false, error };
}
export function failureFromError(code, message, cause) {
    return { success: false, error: createError(code, message, undefined, cause) };
}
//# sourceMappingURL=result.js.map