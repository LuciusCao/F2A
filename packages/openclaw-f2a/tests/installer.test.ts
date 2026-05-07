import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { doctorOpenClawF2A, installOpenClawF2A } from '../src/installer.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'f2a-openclaw-installer-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('openclaw-f2a installer', () => {
  it('writes plugin config and per-agent webhook metadata', () => withTempDir(dir => {
    const configPath = join(dir, 'openclaw.config.json');
    writeFileSync(configPath, JSON.stringify({ agents: { list: [{ id: 'coder' }] } }));

    const result = installOpenClawF2A({
      configPath,
      runtimeAgentId: 'coder',
      name: 'OpenClaw Coder',
      capabilities: ['chat', 'code']
    });

    expect(result.success).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.webhookUrl).toBe('http://127.0.0.1:18789/f2a/webhook/agents/coder');
    expect(result.webhookToken).toMatch(/^[a-f0-9]{64}$/);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const plugin = config.plugins.entries['openclaw-f2a'];
    expect(plugin.enabled).toBe(true);
    expect(plugin.config.autoRegister).toBe(false);
    expect(plugin.config.webhookToken).toBe(result.webhookToken);
    expect(plugin.config.runtimeId).toBe('local-openclaw');
    expect(plugin.config.agents).toEqual([
      {
        openclawAgentId: 'coder',
        name: 'OpenClaw Coder',
        capabilities: ['chat', 'code']
      }
    ]);
  }));

  it('preserves existing agent entries', () => withTempDir(dir => {
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      plugins: {
        entries: {
          'openclaw-f2a': {
            enabled: true,
            config: {
              webhookPath: '/f2a/webhook',
              webhookToken: 'existing-secret',
              runtimeId: 'local-openclaw',
              autoRegister: false,
              agents: [{ openclawAgentId: 'researcher', name: 'Researcher' }]
            }
          }
        }
      }
    }));

    installOpenClawF2A({ configPath, runtimeAgentId: 'coder' });

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.plugins.entries['openclaw-f2a'].config.webhookToken).toBe('existing-secret');
    expect(config.plugins.entries['openclaw-f2a'].config.agents.map((agent: { openclawAgentId: string }) => agent.openclawAgentId)).toEqual([
      'researcher',
      'coder'
    ]);
  }));

  it('doctor reports missing config without writing', () => withTempDir(dir => {
    mkdirSync(join(dir, 'nested'));
    const result = doctorOpenClawF2A({ cwd: join(dir, 'nested'), runtimeAgentId: 'coder' });
    expect(result.success).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('openclaw_config');
  }));

  it('doctor reports ready config', () => withTempDir(dir => {
    const configPath = join(dir, 'openclaw.config.json');
    installOpenClawF2A({ configPath, runtimeAgentId: 'coder' });

    const result = doctorOpenClawF2A({ configPath, runtimeAgentId: 'coder' });

    expect(result.ready).toBe(true);
    expect(result.webhookToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.missing).toEqual([]);
  }));

  it('doctor reports missing webhook token', () => withTempDir(dir => {
    const configPath = join(dir, 'openclaw.config.json');
    writeFileSync(configPath, JSON.stringify({
      plugins: {
        entries: {
          'openclaw-f2a': {
            enabled: true,
            config: {
              webhookPath: '/f2a/webhook',
              runtimeId: 'local-openclaw',
              autoRegister: false,
              agents: [{ openclawAgentId: 'coder' }]
            }
          }
        }
      }
    }));

    const result = doctorOpenClawF2A({ configPath, runtimeAgentId: 'coder' });

    expect(result.ready).toBe(false);
    expect(result.missing).toContain('webhook_token');
  }));
});
