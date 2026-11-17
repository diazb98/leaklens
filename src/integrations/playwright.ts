import { writeFileSync } from 'node:fs';
import {
  test as base,
  type BrowserContext,
  type Fixtures,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
} from '@playwright/test';
import { BUNDLE_FILENAME, type LeakLensBundle } from '../core/bundle.js';

/**
 * Integración con Playwright: cambia una sola línea en tus pruebas.
 *
 *   - import { test, expect } from '@playwright/test';
 *   + import { test, expect } from 'leaklens/playwright';
 *
 * Por cada prueba, en su carpeta de `test-results/`, deja:
 *   - leaklens.har          → toda la red, con cuerpos (recordHar)
 *   - leaklens.bundle.json  → texto visible de cada pantalla, storage, cookies y consola
 *
 * Después: `npx leaklens scan`
 *
 * Variable LEAKLENS_DISABLE=1 para desactivarlo sin tocar el código.
 */

const MAX_TEXT = 1_000_000;
const disabled = () => process.env.LEAKLENS_DISABLE === '1' || process.env.LEAKLENS_DISABLE === 'true';

interface Recorder {
  pages: Array<{ url: string; text: string }>;
  urls: string[];
  console: Array<{ type: string; text: string }>;
  pending: Set<Promise<void>>;
}

async function pageText(page: Page): Promise<string | undefined> {
  try {
    const t = await page.evaluate(() => document.body?.innerText ?? '');
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
  } catch {
    return undefined;
  }
}

function attach(page: Page, rec: Recorder) {
  page.on('console', (m) => rec.console.push({ type: m.type(), text: m.text() }));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) rec.urls.push(frame.url());
  });
  page.on('load', () => {
    const p = (async () => {
      const text = await pageText(page);
      if (text) rec.pages.push({ url: page.url(), text });
    })();
    rec.pending.add(p);
    void p.finally(() => rec.pending.delete(p));
  });
}

async function snapshot(context: BrowserContext, rec: Recorder): Promise<Pick<LeakLensBundle, 'localStorage' | 'sessionStorage' | 'cookies'>> {
  const localStorage: Record<string, string> = {};
  const sessionStorage: Record<string, string> = {};
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    const text = await pageText(page);
    if (text) rec.pages.push({ url: page.url(), text });
    try {
      const s = await page.evaluate(() => {
        const dump = (st: Storage) => {
          const o: Record<string, string> = {};
          for (let i = 0; i < st.length; i++) {
            const k = st.key(i);
            if (k !== null) o[k] = st.getItem(k) ?? '';
          }
          return o;
        };
        return { l: dump(window.localStorage), s: dump(window.sessionStorage) };
      });
      Object.assign(localStorage, s.l);
      Object.assign(sessionStorage, s.s);
    } catch {
      /* about:blank u origen opaco: sin storage */
    }
  }
  let cookies: LeakLensBundle['cookies'] = [];
  try {
    cookies = (await context.cookies()).map((c) => ({ name: c.name, value: c.value, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure }));
  } catch {
    /* contexto cerrado */
  }
  return { localStorage, sessionStorage, cookies };
}

type LeakLensFixtures = { leaklensRecorder: void };

export const leaklensFixtures: Fixtures<
  LeakLensFixtures,
  object,
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = {
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    if (disabled()) return use(contextOptions);
    await use({
      ...contextOptions,
      recordHar: { path: testInfo.outputPath('leaklens.har'), content: 'embed', mode: 'full' },
    });
  },
  leaklensRecorder: [
    async ({ context }, use, testInfo) => {
      if (disabled()) return use();
      const rec: Recorder = { pages: [], urls: [], console: [], pending: new Set() };
      for (const p of context.pages()) attach(p, rec);
      context.on('page', (p) => attach(p, rec));

      await use();

      await Promise.allSettled([...rec.pending]);
      const state = await snapshot(context, rec);
      const bundle: LeakLensBundle = {
        leaklens: 1,
        tool: 'playwright',
        test: {
          title: testInfo.title,
          titlePath: testInfo.titlePath.slice(1),
          file: testInfo.file,
          status: testInfo.status,
        },
        pages: rec.pages,
        urls: [...new Set(rec.urls.filter((u) => u && u !== 'about:blank'))],
        console: rec.console,
        ...state,
      };
      writeFileSync(testInfo.outputPath(BUNDLE_FILENAME), JSON.stringify(bundle));
    },
    { auto: true },
  ],
};

export const test = base.extend<LeakLensFixtures>(leaklensFixtures);
export { expect } from '@playwright/test';
