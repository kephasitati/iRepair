import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts'],
    // DB tests share one Postgres database and reset it; run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
