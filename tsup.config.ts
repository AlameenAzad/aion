import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  clean: true,
  bundle: true,
  minify: false,
  sourcemap: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
