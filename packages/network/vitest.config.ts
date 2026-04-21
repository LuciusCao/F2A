import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 单元测试超时配置（E2E 测试用 test:integration 命令）
    testTimeout: 30000,   // 单元测试 30s
    hookTimeout: 10000,   // beforeAll/afterAll 10s
    // 使用 threads 模式并行运行（更快）
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,  // 并行运行
        minThreads: 2,
        maxThreads: 4
      }
    },
    // 跳过的测试不应导致失败
    passWithNoTests: true,
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        'src/utils/benchmark.ts',
        'src/utils/middleware.ts',
        'src/utils/signature.ts',
        'src/index.ts',  // 只是导出文件，不需要测试
        'tests/e2e/**',  // E2E 测试不计入覆盖率
      ],
      thresholds: {
        statements: 60,
        branches: 55,  // 调整为 55%（当前 57.71%）
        functions: 65,
        lines: 60
      }
    },
    // 项目引用配置
    // 默认只跑单元测试（排除 E2E/integration）
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/**']
  },
  resolve: {
    alias: {
      '../../packages/openclaw-f2a/src/connector.js': path.resolve(__dirname, '../openclaw-f2a/src/connector.ts'),
      '../../packages/openclaw-f2a/src/node-manager.js': path.resolve(__dirname, '../openclaw-f2a/src/node-manager.ts'),
    },
  },
});