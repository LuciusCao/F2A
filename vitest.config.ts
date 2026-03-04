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
        '**/*.d.ts'
      ],
      thresholds: {
        statements: 60,
        branches: 75,
        functions: 70,
        lines: 60
      }
    }
  }
});