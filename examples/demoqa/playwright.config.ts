import { defineConfig, devices } from '@playwright/test';

/**
 * Ejemplo real: LeakLens contra https://demoqa.com (sitio público de práctica).
 *
 *   npm run test:demoqa                 # corre las pruebas
 *   npm run scan:demoqa                 # analiza lo que vieron
 *
 * El login del Book Store solo corre si defines DEMOQA_USER y DEMOQA_PASS
 * con una cuenta que crees tú en https://demoqa.com/register.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'https://demoqa.com',
    // Con DemoQA, guardar la traza se cuelga al cerrar el contexto (Playwright 1.49 + Chrome).
    // LeakLens no la necesita: ya captura el HAR y el bundle de cada prueba.
    trace: 'off',
    viewport: { width: 1366, height: 900 },
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      // PW_CHANNEL=chrome usa el Chrome instalado en lugar de descargar Chromium.
      use: { ...devices['Desktop Chrome'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
  ],
});
