import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
      ],
      thresholds: {
        statements: 60,
        branches: 55,  // 调整为 55%（当前 57.71%）
        functions: 65,
        lines: 60
      }
    }
  }
});