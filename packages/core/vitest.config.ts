import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // E2E 测试配置
    testTimeout: 120000,  // E2E 测试需要更长超时时间
    hookTimeout: 60000,   // beforeAll/afterAll 超时时间
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
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist']
  }
});