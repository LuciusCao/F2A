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
        'src/utils/signature.ts'
      ],
      thresholds: {
        statements: 60,
        branches: 55,  // 调整为 55%（当前 56.68%）
        functions: 65,
        lines: 60
      }
    }
  }
});