import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 15000,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@f2a/network': path.resolve(__dirname, '../network/src'),
    },
  },
});