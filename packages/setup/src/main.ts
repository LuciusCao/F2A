#!/usr/bin/env node
import { spawnSync } from 'child_process';

export type RuntimeType = 'openclaw' | 'hermes';

export interface SetupOptions {
  runtime: RuntimeType;
  runtimeId?: string;
  runtimeAgentId?: string;
  name?: string;
  configPath?: string;
  hermesHome?: string;
  profile?: string;
  capabilities?: string[];
  json?: boolean;
}

export interface CommandResult {
  command: string;
  args: string[];
  status: number;
  stdout: string;
  stderr: string;
}

export interface SetupResult {
  success: boolean;
  runtime: RuntimeType;
  commands: CommandResult[];
  installer?: Record<string, unknown>;
  connect?: Record<string, unknown>;
  error?: string;
}

export type Runner = (command: string, args: string[]) => CommandResult;

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf-8' });
  return {
    command,
    args,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseJsonOutput(output: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return (parsed.data && typeof parsed.data === 'object') ? parsed.data as Record<string, unknown> : parsed;
  } catch {
    return undefined;
  }
}

function value(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = data?.[key];
  return typeof item === 'string' ? item : undefined;
}

export function buildInstallerCommand(options: SetupOptions): { command: string; args: string[] } {
  if (options.runtime === 'openclaw') {
    const args = ['install', '--json'];
    if (options.configPath) args.push('--config', options.configPath);
    if (options.runtimeId) args.push('--runtime-id', options.runtimeId);
    if (options.runtimeAgentId) args.push('--runtime-agent-id', options.runtimeAgentId);
    if (options.name) args.push('--name', options.name);
    for (const capability of options.capabilities || []) args.push('--capability', capability);
    return { command: 'openclaw-f2a', args };
  }

  const args = ['install', '--json'];
  if (options.hermesHome) args.push('--home', options.hermesHome);
  if (options.profile) args.push('--profile', options.profile);
  return { command: 'hermes-f2a', args };
}

export function buildConnectArgs(options: SetupOptions, installer: Record<string, unknown> | undefined): string[] {
  const runtimeId = options.runtimeId || value(installer, 'runtimeId') || (options.runtime === 'openclaw' ? 'local-openclaw' : 'local-hermes');
  const runtimeAgentId = options.runtimeAgentId || value(installer, 'runtimeAgentId') || 'default';
  const name = options.name || (options.runtime === 'openclaw' ? `OpenClaw ${runtimeAgentId}` : `Hermes ${runtimeAgentId}`);
  const webhookUrl = value(installer, 'webhookUrl');
  const webhookToken = value(installer, 'webhookToken');

  const args = [
    'agent',
    'connect',
    '--runtime',
    options.runtime,
    '--runtime-id',
    runtimeId,
    '--runtime-agent-id',
    runtimeAgentId,
    '--name',
    name,
    '--json'
  ];
  if (webhookUrl) args.push('--webhook', webhookUrl);
  if (webhookToken) args.push('--webhook-token', webhookToken);
  for (const capability of options.capabilities || []) args.push('--capability', capability);
  return args;
}

export function runSetup(options: SetupOptions, runner: Runner = runCommand): SetupResult {
  const commands: CommandResult[] = [];
  const installerCommand = buildInstallerCommand(options);
  const installerRun = runner(installerCommand.command, installerCommand.args);
  commands.push(installerRun);
  if (installerRun.status !== 0) {
    return {
      success: false,
      runtime: options.runtime,
      commands,
      error: installerRun.stderr || installerRun.stdout || 'Runtime installer failed'
    };
  }

  const installer = parseJsonOutput(installerRun.stdout);
  const connectArgs = buildConnectArgs(options, installer);
  const connectRun = runner('f2a', connectArgs);
  commands.push(connectRun);
  if (connectRun.status !== 0) {
    return {
      success: false,
      runtime: options.runtime,
      commands,
      installer,
      error: connectRun.stderr || connectRun.stdout || 'f2a agent connect failed'
    };
  }

  return {
    success: true,
    runtime: options.runtime,
    commands,
    installer,
    connect: parseJsonOutput(connectRun.stdout)
  };
}

function parseArgs(argv: string[]): SetupOptions {
  const [command = 'install', ...args] = argv;
  if (command !== 'install') {
    throw new Error('Usage: f2a-setup install --runtime <openclaw|hermes> [options]');
  }

  const options: Partial<SetupOptions> = { capabilities: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--json') options.json = true;
    else if (arg === '--runtime') { options.runtime = next as RuntimeType; i += 1; }
    else if (arg === '--runtime-id') { options.runtimeId = next; i += 1; }
    else if (arg === '--runtime-agent-id') { options.runtimeAgentId = next; i += 1; }
    else if (arg === '--name') { options.name = next; i += 1; }
    else if (arg === '--config') { options.configPath = next; i += 1; }
    else if (arg === '--home') { options.hermesHome = next; i += 1; }
    else if (arg === '--profile') { options.profile = next; i += 1; }
    else if (arg === '--capability') { options.capabilities?.push(next); i += 1; }
  }

  if (options.runtime !== 'openclaw' && options.runtime !== 'hermes') {
    throw new Error('Missing or invalid --runtime. Expected openclaw or hermes.');
  }

  return options as SetupOptions;
}

function printResult(result: SetupResult, json: boolean | undefined): void {
  if (json) {
    console.log(JSON.stringify({ success: result.success, data: result }, null, 2));
    return;
  }
  console.log(result.success ? 'F2A setup completed.' : 'F2A setup failed.');
  if (result.error) console.error(result.error);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = runSetup(options);
  printResult(result, options.json);
  if (!result.success) process.exit(1);
}

if (process.argv[1]?.endsWith('main.js')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
