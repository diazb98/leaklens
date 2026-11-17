import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'integrations/playwright': 'src/integrations/playwright.ts',
      'integrations/cypress-plugin': 'src/integrations/cypress-plugin.ts',
      'integrations/cypress-support': 'src/integrations/cypress-support.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    external: ['@playwright/test', 'tesseract.js'],
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    external: ['tesseract.js'],
  },
]);
