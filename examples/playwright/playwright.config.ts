import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: 'list',
  use: {
    // LeakLens también lee las trazas: actívalas si quieres la consola y la red en un solo archivo.
    trace: 'on',
  },
  projects: [
    {
      name: 'chromium',
      // PW_CHANNEL=chrome usa el Chrome instalado en lugar de descargar Chromium.
      use: { ...devices['Desktop Chrome'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
  ],
});
