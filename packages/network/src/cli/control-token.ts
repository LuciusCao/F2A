/**
 * Control Token management for F2A CLI
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 获取控制 Token
 * 优先从环境变量读取，其次从默认文件位置读取
 * @returns 控制 Token，如果未找到返回空字符串
 */
export function getControlToken(): string {
  // 1. 优先使用环境变量
  const envToken = process.env.F2A_CONTROL_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. 从默认文件位置读取
  const tokenPath = join(homedir(), '.f2a', 'control-token');
  if (existsSync(tokenPath)) {
    const fileToken = readFileSync(tokenPath, 'utf-8').trim();
    if (fileToken) {
      return fileToken;
    }
  }

  // 3. 如果都没有，返回空字符串（会导致认证失败）
  console.warn('⚠️  Warning: F2A_CONTROL_TOKEN not set and no token file found.');
  console.warn('    Token file location:', tokenPath);
  console.warn('    Please start the F2A daemon first, or set F2A_CONTROL_TOKEN.');
  return '';
}

// 惰性获取 token，避免模块加载时立即验证（init/config 命令不需要 token）
let _controlToken: string | undefined;
let _tokenFileMtime: number | undefined;

/**
 * 获取 token 文件修改时间
 */
function getTokenFileMtime(): number | undefined {
  const tokenPath = join(homedir(), '.f2a', 'control-token');
  if (existsSync(tokenPath)) {
    try {
      const stats = statSync(tokenPath);
      return stats.mtimeMs;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 检查 token 文件是否已修改
 */
function hasTokenFileChanged(): boolean {
  const currentMtime = getTokenFileMtime();
  return currentMtime !== _tokenFileMtime;
}

/**
 * 惰性获取 token，支持文件变更检测
 */
export function getControlTokenLazy(): string {
  // 如果 token 文件已修改，强制重新加载
  if (_controlToken !== undefined && hasTokenFileChanged()) {
    _controlToken = undefined;
  }
  
  if (_controlToken === undefined) {
    _controlToken = getControlToken();
    _tokenFileMtime = getTokenFileMtime();
  }
  return _controlToken;
}

/**
 * 重置 token 缓存，强制下次调用重新加载
 */
export function resetControlTokenCache(): void {
  _controlToken = undefined;
  _tokenFileMtime = undefined;
}