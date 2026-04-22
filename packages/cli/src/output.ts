/**
 * F2A CLI JSON Output Module
 * 
 * Provides structured JSON output for CLI commands.
 * When --json flag is set, all output is formatted as JSON.
 */

/**
 * Global state for JSON output mode
 */
let jsonModeEnabled = false;

/**
 * JSON output format for successful operations
 */
interface JsonSuccess {
  success: true;
  data: unknown;
}

/**
 * JSON output format for errors
 */
interface JsonError {
  success: false;
  error: string;
  code?: string;
}

/**
 * Enable or disable JSON output mode
 * @param enabled - Whether JSON mode should be enabled
 */
export function setJsonMode(enabled: boolean): void {
  jsonModeEnabled = enabled;
}

/**
 * Check if JSON output mode is enabled
 * @returns true if --json flag was set
 */
export function isJsonMode(): boolean {
  return jsonModeEnabled;
}

/**
 * Output a JSON success response to stdout
 * @param data - The data to include in the response
 */
export function outputJson(data: unknown): void {
  const response: JsonSuccess = {
    success: true,
    data
  };
  console.log(JSON.stringify(response));
}

/**
 * Output a JSON error response to stderr and exit
 * @param error - Error message
 * @param code - Optional error code
 * @param exitCode - Process exit code (default: 1)
 */
export function outputError(error: string, code?: string, exitCode: number = 1): never {
  const response: JsonError = {
    success: false,
    error,
    ...(code && { code })
  };
  console.error(JSON.stringify(response));
  process.exit(exitCode);
}

/**
 * Output a JSON error response without exiting (for non-fatal errors)
 * @param error - Error message
 * @param code - Optional error code
 */
export function outputErrorNonFatal(error: string, code?: string): void {
  const response: JsonError = {
    success: false,
    error,
    ...(code && { code })
  };
  console.error(JSON.stringify(response));
}