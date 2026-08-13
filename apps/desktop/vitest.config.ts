import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const shared = {
  clearMocks: true,
  restoreMocks: true,
  mockReset: true,
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  resolve: {
    alias: {
      electron: resolve(import.meta.dirname, 'test/helpers/electron-mock.ts'),
    },
  },
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          ...shared,
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        plugins: [react()],
        test: {
          ...shared,
          name: 'renderer',
          environment: 'jsdom',
          include: ['test/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['test/renderer/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/renderer/src/**/*.{ts,tsx}'],
      exclude: ['src/main/index.ts', 'src/renderer/src/main.tsx'],
      thresholds: {
        statements: 50,
        branches: 43,
        functions: 40,
        lines: 55,
      },
    },
  },
});
