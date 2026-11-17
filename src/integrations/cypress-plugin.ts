import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BUNDLE_FILENAME, type LeakLensBundle } from '../core/bundle.js';

/**
 * Lado Node de la integración con Cypress. En cypress.config.(js|ts):
 *
 *   import { setupLeakLens } from 'leaklens/cypress/plugin';
 *   export default defineConfig({
 *     e2e: {
 *       setupNodeEvents(on, config) {
 *         setupLeakLens(on, config);
 *         return config;
 *       },
 *     },
 *   });
 *
 * Y en cypress/support/e2e.(js|ts):  import 'leaklens/cypress/support';
 *
 * Cada prueba deja cypress/leaklens/<spec>/<prueba>/leaklens.bundle.json
 */

export interface LeakLensCypressOptions {
  /** Carpeta de salida. Por defecto `<proyecto>/cypress/leaklens`. */
  outDir?: string;
}

type CypressOn = (event: 'task', tasks: Record<string, (arg: unknown) => unknown>) => void;

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'prueba'
  );
}

export function setupLeakLens(on: CypressOn, config: { projectRoot?: string }, options: LeakLensCypressOptions = {}): void {
  const outDir = options.outDir ?? path.join(config.projectRoot ?? process.cwd(), 'cypress', 'leaklens');
  on('task', {
    'leaklens:write'(arg: unknown) {
      const bundle = arg as LeakLensBundle & { spec?: string };
      const spec = slug(bundle.spec ?? bundle.test?.file ?? 'spec');
      const name = slug((bundle.test?.titlePath ?? [bundle.test?.title ?? 'prueba']).join(' -- '));
      const dir = path.join(outDir, spec, name);
      mkdirSync(dir, { recursive: true });
      const { spec: _spec, ...rest } = bundle;
      writeFileSync(path.join(dir, BUNDLE_FILENAME), JSON.stringify(rest));
      return null;
    },
  });
}

export default setupLeakLens;
