import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Root package - node environment
  {
    extends: './vitest.config.ts',
    test: {
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
      exclude: ['tests/integration/**', 'packages/**'],
    },
  },
  // Dashboard package - jsdom environment (has its own config)
  'packages/dashboard/vitest.config.ts',
  // MCP Server package
  'packages/mcp-server/vitest.config.ts',
]);