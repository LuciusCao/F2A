import { describe, expect, it } from 'vitest';
import { buildConnectArgs, buildInstallerCommand, runSetup, type CommandResult } from './main.js';

describe('f2a-setup', () => {
  it('builds OpenClaw installer command', () => {
    expect(buildInstallerCommand({
      runtime: 'openclaw',
      configPath: '/tmp/openclaw.json',
      runtimeAgentId: 'coder',
      capabilities: ['chat']
    })).toEqual({
      command: 'openclaw-f2a',
      args: ['install', '--json', '--config', '/tmp/openclaw.json', '--runtime-agent-id', 'coder', '--capability', 'chat']
    });
  });

  it('builds Hermes installer command', () => {
    expect(buildInstallerCommand({
      runtime: 'hermes',
      profile: 'coder'
    })).toEqual({
      command: 'hermes-f2a',
      args: ['install', '--json', '--profile', 'coder']
    });
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
      if (command === 'openclaw-f2a') {
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
    expect(calls.map(call => call.command)).toEqual(['openclaw-f2a', 'f2a']);
    expect(calls[1].args).toContain('coder');
    expect(calls[1].args).toContain('--webhook-token');
    expect(calls[1].args).toContain('secret');
  });
});
