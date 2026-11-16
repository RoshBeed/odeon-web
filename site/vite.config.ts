import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the site works under any GitHub Pages address.
  base: './',
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
});
