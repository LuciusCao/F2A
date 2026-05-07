import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { buildConnectArgs, buildInstallerCommand, redactSetupResult, runSetup, type CommandResult } from './main.js';

describe('f2a-setup', () => {
  it('builds OpenClaw installer command', () => {
    const result = buildInstallerCommand({
      runtime: 'openclaw',
      configPath: '/tmp/openclaw.json',
      runtimeAgentId: 'coder',
      capabilities: ['chat']
    });

    expect(result.command).toBe(process.execPath);
    expect(result.args[0]).toContain(join('packages', 'openclaw-f2a', 'dist', 'installer.js'));
    expect(result.args.slice(1)).toEqual(['install', '--json', '--config', '/tmp/openclaw.json', '--runtime-agent-id', 'coder', '--capability', 'chat']);
  });

  it('builds Hermes installer command', () => {
    const result = buildInstallerCommand({
      runtime: 'hermes',
      profile: 'coder'
    });

    expect(result.command).toBe(process.execPath);
    expect(result.args[0]).toContain(join('packages', 'hermes-f2a', 'dist', 'installer.js'));
    expect(result.args.slice(1)).toEqual(['install', '--json', '--profile', 'coder']);
  });

  it('builds f2a agent connect args from installer output', () => {
    const args = buildConnectArgs({ runtime: 'openclaw' }, {
      runtimeId: 'local-openclaw',
      runtimeAgentId: 'coder',
      webhookUrl: 'http://127.0.0.1:18789/f2a/webhook/agents/coder',
      webhookToken: 'secret'
    });

    expect(args).toContain('--runtime');
    expect(args).toContain('openclaw');
    expect(args).toContain('--runtime-agent-id');
    expect(args).toContain('coder');
    expect(args).toContain('--webhook');
    expect(args).toContain('http://127.0.0.1:18789/f2a/webhook/agents/coder');
    expect(args).toContain('--webhook-token');
    expect(args).toContain('secret');
  });

  it('runs installer then connect', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = (command: string, args: string[]): CommandResult => {
      calls.push({ command, args });
      if (args[0].endsWith('openclaw-f2a/dist/installer.js')) {
        return {
          command,
          args,
          status: 0,
          stdout: JSON.stringify({
            success: true,
            data: {
              runtimeId: 'local-openclaw',
              runtimeAgentId: 'coder',
              webhookUrl: 'http://127.0.0.1:18789/f2a/webhook/agents/coder',
              webhookToken: 'secret'
            }
          }),
          stderr: ''
        };
      }
      return {
        command,
        args,
        status: 0,
        stdout: JSON.stringify({ success: true, data: { agentId: 'agent:abc' } }),
        stderr: ''
      };
    };

    const result = runSetup({ runtime: 'openclaw', runtimeAgentId: 'coder' }, runner);

    expect(result.success).toBe(true);
    expect(calls.map(call => call.command)).toEqual([process.execPath, process.execPath]);
    expect(calls[1].args[0]).toContain(join('packages', 'cli', 'dist', 'main.js'));
    expect(calls[1].args).toContain('coder');
    expect(calls[1].args).toContain('--webhook-token');
    expect(calls[1].args).toContain('secret');
  });

  it('redacts webhook tokens from setup result', () => {
    const result = redactSetupResult({
      success: true,
      runtime: 'hermes',
      commands: [
        {
          command: process.execPath,
          args: ['f2a', 'agent', 'connect', '--webhook-token', 'secret'],
          status: 0,
          stdout: '{"webhookToken":"secret"}',
          stderr: ''
        }
      ],
      installer: { webhookToken: 'secret', webhookUrl: 'http://127.0.0.1:8644/webhooks/f2a' }
    });

    expect(result.commands[0].args).toContain('<redacted>');
    expect(result.commands[0].args).not.toContain('secret');
    expect(result.commands[0].stdout).toBe('<redacted>');
    expect(result.installer?.webhookToken).toBe('<redacted>');
  });
});
