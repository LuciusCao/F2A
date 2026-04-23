/**
 * F2A MCP Server - Identity 文件管理
 * 读取本地 Agent Identity 信息
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { RFC008IdentityFile } from '@f2a/network';

/** Identity 文件扩展类型（兼容任务描述中的 token 字段） */
type IdentityFileWithToken = RFC008IdentityFile & { token?: string };

/** 默认 F2A 数据目录 */
const F2A_DATA_DIR = join(homedir(), '.f2a');

/** Agent Identity 文件存储目录 */
const AGENT_IDENTITIES_DIR = join(F2A_DATA_DIR, 'agent-identities');

/**
 * 读取指定 Agent 的 Identity 文件
 *
 * @param agentId Agent ID
 * @returns Identity 文件内容或 null
 */
export function getIdentityFile(agentId: string): IdentityFileWithToken | null {
  if (!agentId) {
    return null;
  }

  const identityPath = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);
  if (!existsSync(identityPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(identityPath, 'utf-8')) as IdentityFileWithToken;
  } catch {
    return null;
  }
}

/**
 * 获取默认 Agent ID
 * 查找 ~/.f2a/agent-identities/ 下第一个有效的 identity 文件
 *
 * @returns Agent ID 或 null
 */
export function getDefaultAgentId(): string | null {
  const identities = listLocalIdentities();
  if (identities.length === 0) {
    return null;
  }
  return identities[0].agentId;
}

/**
 * 获取指定 Agent 的 Token
 *
 * @param agentId Agent ID
 * @returns Token 字符串或 null
 */
export function getAgentToken(agentId: string): string | null {
  const identity = getIdentityFile(agentId);
  if (!identity || !identity.token) {
    return null;
  }
  return identity.token;
}

/**
 * 列出本地所有有效的 Agent Identity
 *
 * @returns Identity 列表（agentId 和 name）
 */
export function listLocalIdentities(): Array<{ agentId: string; name: string }> {
  if (!existsSync(AGENT_IDENTITIES_DIR)) {
    return [];
  }

  const files = readdirSync(AGENT_IDENTITIES_DIR).filter(
    (f) => f.endsWith('.json') && f.startsWith('agent:')
  );

  const identities: Array<{ agentId: string; name: string }> = [];

  for (const file of files) {
    try {
      const path = join(AGENT_IDENTITIES_DIR, file);
      const content = JSON.parse(readFileSync(path, 'utf-8')) as IdentityFileWithToken;
      if (content.agentId) {
        identities.push({
          agentId: content.agentId,
          name: content.name || 'unnamed',
        });
      }
    } catch {
      // 忽略解析失败的文件
    }
  }

  return identities;
}
