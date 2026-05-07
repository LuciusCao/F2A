#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join, resolve } from 'path';

export interface OpenClawInstallerOptions {
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runtimeId?: string;
  runtimeAgentId?: string;
  name?: string;
  capabilities?: string[];
  gatewayBaseUrl?: string;
}

export interface OpenClawInstallerResult {
  success: boolean;
  ready: boolean;
  runtime: 'openclaw';
  configPath?: string;
  runtimeId: string;
  runtimeAgentId?: string;
  webhookUrl?: string;
  webhookToken?: string;
  actions: string[];
  missing: string[];
  error?: string;
}

interface OpenClawPluginEntry {
  enabled?: boolean;
  config?: {
    webhookPath?: string;
    webhookToken?: string;
    runtimeId?: string;
    controlPort?: number;
    autoRegister?: boolean;
    agents?: Array<{
      openclawAgentId: string;
      name?: string;
      capabilities?: string[];
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface OpenClawConfig {
  plugins?: {
    entries?: {
      'openclaw-f2a'?: OpenClawPluginEntry;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const DEFAULT_RUNTIME_ID = 'local-openclaw';
const DEFAULT_WEBHOOK_PATH = '/f2a/webhook';
const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:18789';

export function locateOpenClawConfig(options: OpenClawInstallerOptions = {}): string | undefined {
  if (options.configPath) return resolve(options.configPath);
  if (options.env?.OPENCLAW_CONFIG) return resolve(options.env.OPENCLAW_CONFIG);

  const cwd = options.cwd || process.cwd();
  const candidates = [
    join(cwd, 'openclaw.config.json'),
    join(cwd, 'config.json')
  ];
  return candidates.find(path => existsSync(path));
}

function webhookUrl(baseUrl: string, webhookPath: string, runtimeAgentId?: string): string | undefined {
  if (!runtimeAgentId) return undefined;
  return `${baseUrl}${webhookPath}/agents/${encodeURIComponent(runtimeAgentId)}`;
}

function ensureOpenClawConfig(config: OpenClawConfig, options: OpenClawInstallerOptions): { actions: string[]; runtimeId: string; runtimeAgentId?: string; webhookPath: string; webhookToken: string } {
  const actions: string[] = [];
  config.plugins ??= {};
  config.plugins.entries ??= {};

  const entries = config.plugins.entries;
  const existing = entries['openclaw-f2a'] as OpenClawPluginEntry | undefined;
  const entry: OpenClawPluginEntry = existing || {};
  if (!existing) actions.push('created_plugin_entry');

  entry.enabled = true;
  entry.config ??= {};
  entry.config.webhookPath ??= DEFAULT_WEBHOOK_PATH;
  entry.config.webhookToken ??= randomBytes(32).toString('hex');
  entry.config.runtimeId = options.runtimeId || entry.config.runtimeId || DEFAULT_RUNTIME_ID;
  entry.config.autoRegister = false;
  entry.config.agents ??= [];

  if (options.runtimeAgentId) {
    const existingAgent = entry.config.agents.find(agent => agent.openclawAgentId === options.runtimeAgentId);
    if (existingAgent) {
      if (options.name) existingAgent.name = options.name;
      if (options.capabilities?.length) existingAgent.capabilities = options.capabilities;
      actions.push('updated_agent_entry');
    } else {
      entry.config.agents.push({
        openclawAgentId: options.runtimeAgentId,
        ...(options.name ? { name: options.name } : {}),
        ...(options.capabilities?.length ? { capabilities: options.capabilities } : {})
      });
      actions.push('added_agent_entry');
    }
  }

  entries['openclaw-f2a'] = entry;
  actions.push('enabled_plugin', 'set_auto_register_false');

  return {
    actions,
    runtimeId: entry.config.runtimeId,
    runtimeAgentId: options.runtimeAgentId,
    webhookPath: entry.config.webhookPath,
    webhookToken: entry.config.webhookToken
  };
}

export function installOpenClawF2A(options: OpenClawInstallerOptions = {}): OpenClawInstallerResult {
  const configPath = locateOpenClawConfig(options);
  const runtimeId = options.runtimeId || DEFAULT_RUNTIME_ID;
  const baseUrl = options.gatewayBaseUrl || DEFAULT_GATEWAY_BASE_URL;

  if (!configPath) {
    return {
      success: false,
      ready: false,
      runtime: 'openclaw',
      runtimeId,
      runtimeAgentId: options.runtimeAgentId,
      actions: [],
      missing: ['openclaw_config'],
      error: 'OpenClaw config not found. Pass --config or set OPENCLAW_CONFIG.'
    };
  }

  try {
    const raw = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '{}';
    const config = raw.trim() ? JSON.parse(raw) as OpenClawConfig : {};
    const ensured = ensureOpenClawConfig(config, options);
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

    return {
      success: true,
      ready: true,
      runtime: 'openclaw',
      configPath,
      runtimeId: ensured.runtimeId,
      runtimeAgentId: ensured.runtimeAgentId,
      webhookUrl: webhookUrl(baseUrl, ensured.webhookPath, ensured.runtimeAgentId),
      webhookToken: ensured.webhookToken,
      actions: ['updated_openclaw_config', ...ensured.actions],
      missing: []
    };
  } catch (error) {
    return {
      success: false,
      ready: false,
      runtime: 'openclaw',
      configPath,
      runtimeId,
      runtimeAgentId: options.runtimeAgentId,
      actions: [],
      missing: ['valid_openclaw_config'],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function doctorOpenClawF2A(options: OpenClawInstallerOptions = {}): OpenClawInstallerResult {
  const configPath = locateOpenClawConfig(options);
  const runtimeId = options.runtimeId || DEFAULT_RUNTIME_ID;
  const baseUrl = options.gatewayBaseUrl || DEFAULT_GATEWAY_BASE_URL;

  if (!configPath || !existsSync(configPath)) {
    return {
      success: true,
      ready: false,
      runtime: 'openclaw',
      runtimeId,
      runtimeAgentId: options.runtimeAgentId,
      actions: [],
      missing: ['openclaw_config']
    };
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as OpenClawConfig;
    const entry = config.plugins?.entries?.['openclaw-f2a'] as OpenClawPluginEntry | undefined;
    const missing: string[] = [];
    if (!entry) missing.push('plugin_entry');
    if (entry?.enabled !== true) missing.push('plugin_enabled');
    if (entry?.config?.autoRegister !== false) missing.push('auto_register_false');
    if (!entry?.config?.webhookPath) missing.push('webhook_path');
    if (!entry?.config?.webhookToken) missing.push('webhook_token');
    if (!entry?.config?.runtimeId) missing.push('runtime_id');
    if (options.runtimeAgentId && !entry?.config?.agents?.some(agent => agent.openclawAgentId === options.runtimeAgentId)) {
      missing.push('runtime_agent_entry');
    }

    const webhookPath = entry?.config?.webhookPath || DEFAULT_WEBHOOK_PATH;
    const resolvedRuntimeId = entry?.config?.runtimeId || runtimeId;

    return {
      success: true,
      ready: missing.length === 0,
      runtime: 'openclaw',
      configPath,
      runtimeId: resolvedRuntimeId,
      runtimeAgentId: options.runtimeAgentId,
      webhookUrl: webhookUrl(baseUrl, webhookPath, options.runtimeAgentId),
      webhookToken: entry?.config?.webhookToken,
      actions: [],
      missing
    };
  } catch (error) {
    return {
      success: true,
      ready: false,
      runtime: 'openclaw',
      configPath,
      runtimeId,
      runtimeAgentId: options.runtimeAgentId,
      actions: [],
      missing: ['valid_openclaw_config'],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseCliArgs(argv: string[]): { command: string; options: OpenClawInstallerOptions; json: boolean } {
  const [command = 'doctor', ...args] = argv;
  const options: OpenClawInstallerOptions = { env: process.env };
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--json') json = true;
    else if (arg === '--config') { options.configPath = next; i += 1; }
    else if (arg === '--runtime-id') { options.runtimeId = next; i += 1; }
    else if (arg === '--runtime-agent-id') { options.runtimeAgentId = next; i += 1; }
    else if (arg === '--name') { options.name = next; i += 1; }
    else if (arg === '--gateway-base-url') { options.gatewayBaseUrl = next; i += 1; }
    else if (arg === '--capability') {
      options.capabilities ??= [];
      options.capabilities.push(next);
      i += 1;
    }
  }
  return { command, options, json };
}

function printResult(result: OpenClawInstallerResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ success: result.success, data: result }, null, 2));
    return;
  }
  console.log(result.ready ? 'OpenClaw F2A integration is ready.' : 'OpenClaw F2A integration is not ready.');
  if (result.configPath) console.log(`Config: ${result.configPath}`);
  if (result.webhookUrl) console.log(`Webhook: ${result.webhookUrl}`);
  if (result.missing.length > 0) console.log(`Missing: ${result.missing.join(', ')}`);
  if (result.error) console.error(result.error);
}

async function main(): Promise<void> {
  const { command, options, json } = parseCliArgs(process.argv.slice(2));
  const result = command === 'install'
    ? installOpenClawF2A(options)
    : doctorOpenClawF2A(options);
  printResult(result, json);
  if (!result.success) process.exit(1);
}

if (process.argv[1]?.endsWith('installer.js')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
