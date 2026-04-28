/**
 * RuntimeAgentBinding 存储
 *
 * 记录一个 runtime-hosted agent slot 与 F2A AgentIdentity 的绑定关系。
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, normalize } from 'path';
import { homedir } from 'os';

export type RuntimeType = 'openclaw' | 'hermes' | 'other';

export interface RuntimeBindingKey {
  runtimeType: RuntimeType;
  runtimeId: string;
  runtimeAgentId: string;
}

export interface RuntimeAgentBinding extends RuntimeBindingKey {
  agentId: string;
  webhook?: {
    url: string;
    token?: string;
  };
  nodeId?: string;
  nodeSignature?: string;
  status: 'initialized' | 'registered';
  createdAt: string;
  lastSeenAt: string;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_');
}

export function getRuntimeBindingPath(dataDir: string, key: RuntimeBindingKey): string {
  return join(
    dataDir,
    'runtime-bindings',
    sanitizePathPart(key.runtimeType),
    sanitizePathPart(key.runtimeId),
    `${sanitizePathPart(key.runtimeAgentId)}.json`
  );
}

export async function saveRuntimeBinding(dataDir: string, binding: RuntimeAgentBinding): Promise<void> {
  const filePath = getRuntimeBindingPath(dataDir, binding);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(binding, null, 2), { mode: 0o600 });
}

export async function loadRuntimeBinding(
  dataDir: string,
  key: RuntimeBindingKey
): Promise<RuntimeAgentBinding | null> {
  const filePath = getRuntimeBindingPath(dataDir, key);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as RuntimeAgentBinding;
  } catch {
    return null;
  }
}

function normalizeForRuntimeMatch(path: string): string {
  return normalize(path).replace(/\\/g, '/').replace(/\/+$/g, '');
}

export function resolveHermesRuntimeAgentId(hermesHome?: string, homeDir = homedir()): string {
  if (!hermesHome) {
    return 'default';
  }

  const normalizedHome = normalizeForRuntimeMatch(homeDir);
  const normalizedHermesHome = normalizeForRuntimeMatch(hermesHome);
  const defaultHermesHome = normalizeForRuntimeMatch(join(normalizedHome, '.hermes'));

  if (normalizedHermesHome === defaultHermesHome) {
    return 'default';
  }

  const profilesPrefix = `${defaultHermesHome}/profiles/`;
  if (normalizedHermesHome.startsWith(profilesPrefix)) {
    const rest = normalizedHermesHome.slice(profilesPrefix.length);
    const profileName = rest.split('/')[0];
    return profileName || 'default';
  }

  return normalizedHermesHome.split('/').filter(Boolean).at(-1) || 'default';
}
