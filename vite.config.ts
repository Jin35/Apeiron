import { defineConfig } from 'vitest/config';

// Relative base so `vite dev`, `vite preview`, and GitHub project pages
// all resolve assets without a hardcoded repository name.
export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
