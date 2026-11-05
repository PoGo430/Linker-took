import { defineConfig } from 'vitest/config';

// Relative base so the build works on any GitHub Pages path (user/repo/).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
