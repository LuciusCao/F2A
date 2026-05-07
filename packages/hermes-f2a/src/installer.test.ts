import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { doctorHermesF2A, installHermesF2A, resolveHermesHome } from './installer.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'f2a-hermes-installer-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('hermes-f2a installer', () => {
  it('writes webhook route into default Hermes home', () => withTempDir(dir => {
    const result = installHermesF2A({ home: dir });

    expect(result.success).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.runtimeAgentId).toBe('default');
    expect(result.webhookUrl).toBe('http://127.0.0.1:8644/webhooks/f2a');

    const config = readFileSync(join(dir, 'config.yaml'), 'utf-8');
    expect(config).toContain('platforms:');
    expect(config).toContain('webhook:');
    expect(config).toContain('f2a:');
    expect(config).not.toContain('INSECURE_NO_AUTH');
    expect(result.webhookToken).toMatch(/^[a-f0-9]{64}$/);
  }));

  it('uses custom port and route when requested', () => withTempDir(dir => {
    const result = installHermesF2A({ home: dir, port: 9876, route: 'f2a.local' });

    expect(result.success).toBe(true);
    expect(result.port).toBe(9876);
    expect(result.route).toBe('f2a.local');
    expect(result.webhookUrl).toBe('http://127.0.0.1:9876/webhooks/f2a.local');

    const after = doctorHermesF2A({ home: dir, port: 9876, route: 'f2a.local' });
    expect(after.ready).toBe(true);
    expect(after.missing).toEqual([]);
  }));

  it('resolves named profile home from explicit profile', () => {
    const resolved = resolveHermesHome({ profile: 'coder' });
    expect(resolved.hermesHome).toContain(join('.hermes', 'profiles', 'coder'));
    expect(resolved.runtimeAgentId).toBe('coder');
  });

  it('infers runtimeAgentId from HERMES_HOME profile path', () => withTempDir(dir => {
    const home = join(dir, '.hermes', 'profiles', 'researcher');
    const resolved = resolveHermesHome({ env: { HERMES_HOME: home } });
    expect(resolved.runtimeAgentId).toBe('researcher');
  }));

  it('doctor reports missing route before install and ready after install', () => withTempDir(dir => {
    const before = doctorHermesF2A({ home: dir });
    expect(before.ready).toBe(false);
    expect(before.missing).toContain('hermes_config');

    installHermesF2A({ home: dir });
    const after = doctorHermesF2A({ home: dir });
    expect(after.ready).toBe(true);
    expect(after.webhookToken).toMatch(/^[a-f0-9]{64}$/);
    expect(after.missing).toEqual([]);
  }));

  it('does not duplicate managed route on repeated install', () => withTempDir(dir => {
    installHermesF2A({ home: dir });
    installHermesF2A({ home: dir });

    const config = readFileSync(join(dir, 'config.yaml'), 'utf-8');
    expect(config.match(/F2A webhook route begin/g)).toHaveLength(1);
  }));

  it('preserves the managed secret on repeated install', () => withTempDir(dir => {
    const first = installHermesF2A({ home: dir });
    const second = installHermesF2A({ home: dir });
    expect(second.webhookToken).toBe(first.webhookToken);
  }));

  it('refuses to append a duplicate top-level platforms section', () => withTempDir(dir => {
    writeFileSync(join(dir, 'config.yaml'), 'platforms:\n  discord:\n    enabled: true\n');

    const result = installHermesF2A({ home: dir });

    expect(result.success).toBe(false);
    expect(result.missing).toContain('manual_merge_required');
    const config = readFileSync(join(dir, 'config.yaml'), 'utf-8');
    expect(config.match(/^platforms:/gm)).toHaveLength(1);
  }));

  it('requires manual merge when config already has a non-F2A webhook route', () => withTempDir(dir => {
    writeFileSync(join(dir, 'config.yaml'), [
      'platforms:',
      '  webhook:',
      '    enabled: true',
      '    extra:',
      '      routes:',
      '        lark:',
      '          prompt: "{__raw__}"',
      ''
    ].join('\n'));

    const result = installHermesF2A({ home: dir });

    expect(result.success).toBe(false);
    expect(result.error).toContain('top-level platforms');
    expect(result.missing).toContain('manual_merge_required');
  }));
});
