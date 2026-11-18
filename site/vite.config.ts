import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the site works under any GitHub Pages address.
  base: './',
  // The browser tests in e2e/ are Playwright's, not Vitest's.
  test: { include: ['src/**/*.test.ts'] },
});
