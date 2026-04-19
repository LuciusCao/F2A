import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Package 结构验证测试
 *
 * 验证移除 API 导出后的 package.json 结构正确性
 */
describe('Package Structure', () => {
  const packagePath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

  describe('bin 字段', () => {
    it('should have bin field pointing to dist/main.js', () => {
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.f2a).toBe('./dist/main.js');
    });

    it('should have exactly one bin entry named f2a', () => {
      expect(Object.keys(pkg.bin)).toHaveLength(1);
      expect(pkg.bin).toHaveProperty('f2a');
    });
  });

  describe('main 和 types 字段（API 导出）', () => {
    it('should NOT have main field (API exports removed)', () => {
      // CLI 包移除 API 导出后不应有 main 字段
      // 只保留 bin 字段作为 CLI 入口
      expect(pkg.main).toBeUndefined();
    });

    it('should NOT have types field (API exports removed)', () => {
      // CLI 包移除 API 导出后不应有 types 字段
      // CLI 工具不需要类型声明文件导出
      expect(pkg.types).toBeUndefined();
    });
  });

  describe('其他 package.json 字段', () => {
    it('should have correct package name', () => {
      expect(pkg.name).toBe('@f2a/cli');
    });

    it('should have version field', () => {
      expect(pkg.version).toBeDefined();
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have type module', () => {
      expect(pkg.type).toBe('module');
    });

    it('should have required dependencies', () => {
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies['@f2a/network']).toBeDefined();
      expect(pkg.dependencies['@f2a/daemon']).toBeDefined();
    });

    it('should have test script', () => {
      expect(pkg.scripts.test).toBe('vitest run');
    });

    it('should have build script', () => {
      expect(pkg.scripts.build).toBe('tsc');
    });
  });
});

/**
 * 构建输出验证测试
 *
 * 验证 dist 目录中只有 CLI 入口文件，没有 index.js（API 导出）
 */
describe('Build Output Structure', () => {
  const distPath = join(__dirname, '..', 'dist');

  describe('CLI 入口文件', () => {
    it('should have main.js (CLI entry point)', () => {
      // main.js 应存在（CLI 入口）
      expect(() => {
        readFileSync(join(distPath, 'main.js'), 'utf-8');
      }).not.toThrow();
    });

    it('should have main.js with shebang', () => {
      const mainContent = readFileSync(join(distPath, 'main.js'), 'utf-8');
      expect(mainContent.startsWith('#!/usr/bin/env node')).toBe(true);
    });
  });

  describe('API 导出文件（index.js）', () => {
    it('should NOT have index.js (API exports removed)', () => {
      // 移除 API 导出后，index.js 不应存在于 dist 目录
      // 注意：由于 TypeScript 增量编译，孤立文件不会被编译
      // 所以 index.ts 如果不被导入就不会生成 index.js
      expect(() => {
        readFileSync(join(distPath, 'index.js'), 'utf-8');
      }).toThrow();
    });
  });
});