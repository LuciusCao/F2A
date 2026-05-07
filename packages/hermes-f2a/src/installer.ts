#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { basename, join, normalize, resolve } from 'path';

export interface HermesInstallerOptions {
  home?: string;
  profile?: string;
  route?: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
}

export interface HermesInstallerResult {
  success: boolean;
  ready: boolean;
  runtime: 'hermes';
  hermesHome: string;
  configPath: string;
  runtimeId: string;
  runtimeAgentId: string;
  route: string;
  port: number;
  webhookUrl: string;
  webhookToken: string;
  actions: string[];
  missing: string[];
  error?: string;
}

const DEFAULT_ROUTE = 'f2a';
const DEFAULT_PORT = 8644;
const F2A_BEGIN = '# F2A webhook route begin';
const F2A_END = '# F2A webhook route end';

export function resolveHermesHome(options: HermesInstallerOptions = {}): { hermesHome: string; runtimeAgentId: string } {
  if (options.home) {
    const hermesHome = resolve(options.home);
    return { hermesHome, runtimeAgentId: inferRuntimeAgentId(hermesHome) };
  }

  if (options.profile) {
    const hermesHome = join(homedir(), '.hermes', 'profiles', options.profile);
    return { hermesHome, runtimeAgentId: options.profile };
  }

  if (options.env?.HERMES_HOME) {
    const hermesHome = resolve(options.env.HERMES_HOME);
    return { hermesHome, runtimeAgentId: inferRuntimeAgentId(hermesHome) };
  }

  return { hermesHome: join(homedir(), '.hermes'), runtimeAgentId: 'default' };
}

function inferRuntimeAgentId(hermesHome: string): string {
  const normalized = normalize(hermesHome);
  const marker = `${normalize(join('.hermes', 'profiles'))}`;
  return normalized.includes(marker) ? basename(normalized) : 'default';
}

function buildWebhookBlock(route: string, port: number, secret: string): string {
  return `${F2A_BEGIN}
platforms:
  webhook:
    enabled: true
    extra:
      host: "127.0.0.1"
      port: ${port}
      secret: "${secret}"
      routes:
        ${route}:
          secret: "${secret}"
          prompt: "{__raw__}"
          deliver: "log"
${F2A_END}
`;
}

function hasRoute(config: string, route: string): boolean {
  const routePattern = new RegExp(`(^|\\n)\\s{8}${route}:\\s*(\\n|$)`);
  return config.includes('platforms:') && config.includes('webhook:') && config.includes('routes:') && routePattern.test(config);
}

function hasTopLevelPlatforms(config: string): boolean {
  return /(^|\n)platforms:\s*(\n|$)/.test(config);
}

function extractManagedSecret(config: string): string | undefined {
  const pattern = new RegExp(`${F2A_BEGIN}[\\s\\S]*?secret:\\s*"([^"]+)"`);
  return config.match(pattern)?.[1];
}

function replaceManagedBlock(config: string, route: string, port: number, secret: string): string {
  const block = buildWebhookBlock(route, port, secret);
  const pattern = new RegExp(`${F2A_BEGIN}[\\s\\S]*?${F2A_END}\\n?`);
  if (pattern.test(config)) {
    return config.replace(pattern, block);
  }
  const suffix = config.endsWith('\n') || config.length === 0 ? '' : '\n';
  return `${config}${suffix}\n${block}`;
}

export function installHermesF2A(options: HermesInstallerOptions = {}): HermesInstallerResult {
  const { hermesHome, runtimeAgentId } = resolveHermesHome(options);
  const route = options.route || DEFAULT_ROUTE;
  const port = options.port || DEFAULT_PORT;
  const configPath = join(hermesHome, 'config.yaml');
  const webhookUrl = `http://127.0.0.1:${port}/webhooks/${route}`;

  try {
    mkdirSync(hermesHome, { recursive: true });
    const current = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
    if (current.trim() && hasTopLevelPlatforms(current) && !current.includes(F2A_BEGIN)) {
      return {
        success: false,
        ready: false,
        runtime: 'hermes',
        hermesHome,
        configPath,
        runtimeId: 'local-hermes',
        runtimeAgentId,
        route,
        port,
        webhookUrl,
        webhookToken: '',
        actions: [],
        missing: ['manual_merge_required'],
        error: 'Hermes config already has a top-level platforms section. Merge the F2A webhook route manually or remove the conflicting section before running install.'
      };
    }

    const secret = extractManagedSecret(current) || randomBytes(32).toString('hex');
    const next = replaceManagedBlock(current, route, port, secret);
    if (next !== current) {
      writeFileSync(configPath, next, { mode: 0o600 });
    }

    return {
      success: true,
      ready: true,
      runtime: 'hermes',
      hermesHome,
      configPath,
      runtimeId: 'local-hermes',
      runtimeAgentId,
      route,
      port,
      webhookUrl,
      webhookToken: secret,
      actions: next === current ? [] : ['updated_hermes_config'],
      missing: []
    };
  } catch (error) {
    return {
      success: false,
      ready: false,
      runtime: 'hermes',
      hermesHome,
      configPath,
      runtimeId: 'local-hermes',
      runtimeAgentId,
      route,
      port,
      webhookUrl,
      webhookToken: '',
      actions: [],
      missing: ['writable_hermes_config'],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function doctorHermesF2A(options: HermesInstallerOptions = {}): HermesInstallerResult {
  const { hermesHome, runtimeAgentId } = resolveHermesHome(options);
  const route = options.route || DEFAULT_ROUTE;
  const port = options.port || DEFAULT_PORT;
  const configPath = join(hermesHome, 'config.yaml');
  const webhookUrl = `http://127.0.0.1:${port}/webhooks/${route}`;
  const missing: string[] = [];
  let webhookToken = '';

  if (!existsSync(configPath)) {
    missing.push('hermes_config');
  } else {
    const config = readFileSync(configPath, 'utf-8');
    webhookToken = extractManagedSecret(config) || '';
    if (!hasRoute(config, route)) missing.push('webhook_route');
    if (!webhookToken) missing.push('webhook_secret');
  }

  return {
    success: true,
    ready: missing.length === 0,
    runtime: 'hermes',
    hermesHome,
    configPath,
    runtimeId: 'local-hermes',
    runtimeAgentId,
    route,
    port,
    webhookUrl,
    webhookToken,
    actions: [],
    missing
  };
}

function parseCliArgs(argv: string[]): { command: string; options: HermesInstallerOptions; json: boolean } {
  const [command = 'doctor', ...args] = argv;
  const options: HermesInstallerOptions = { env: process.env };
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--json') json = true;
    else if (arg === '--home') { options.home = next; i += 1; }
    else if (arg === '--profile') { options.profile = next; i += 1; }
    else if (arg === '--route') { options.route = next; i += 1; }
    else if (arg === '--port') { options.port = Number(next); i += 1; }
  }
  return { command, options, json };
}

function printResult(result: HermesInstallerResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ success: result.success, data: result }, null, 2));
    return;
  }
  console.log(result.ready ? 'Hermes F2A webhook is ready.' : 'Hermes F2A webhook is not ready.');
  console.log(`Config: ${result.configPath}`);
  console.log(`Webhook: ${result.webhookUrl}`);
  if (result.missing.length > 0) console.log(`Missing: ${result.missing.join(', ')}`);
  if (result.error) console.error(result.error);
}

async function main(): Promise<void> {
  const { command, options, json } = parseCliArgs(process.argv.slice(2));
  const result = command === 'install'
    ? installHermesF2A(options)
    : doctorHermesF2A(options);
  printResult(result, json);
  if (!result.success) process.exit(1);
}

if (process.argv[1]?.endsWith('installer.js')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
