/**
 * Lado navegador de la integración con Cypress.
 * En cypress/support/e2e.(js|ts):   import 'leaklens/cypress/support';
 *
 * Registra pasivamente toda la red con cy.intercept (sin modificar respuestas),
 * la consola, las URLs, y al final de cada prueba el texto visible, el storage
 * y las cookies. Lo envía a Node con cy.task('leaklens:write').
 *
 * Cypress.env('LEAKLENS_DISABLE') = true lo desactiva.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Cypress: any;
declare const cy: any;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;

const MAX_BODY = 2_000_000;

interface NetEntry {
  method: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string | string[]>;
  requestBody?: string;
  responseHeaders?: Record<string, string | string[]>;
  responseBody?: string;
}

const state: { network: NetEntry[]; console: Array<{ type: string; text: string }>; urls: string[] } = {
  network: [],
  console: [],
  urls: [],
};

function asText(body: unknown): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body === 'string') return body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return undefined;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return undefined;
  try {
    const s = JSON.stringify(body);
    return s.length > MAX_BODY ? s.slice(0, MAX_BODY) : s;
  } catch {
    return undefined;
  }
}

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

const enabled = () => !Cypress.env('LEAKLENS_DISABLE');

Cypress.on('window:before:load', (win: any) => {
  if (!enabled()) return;
  for (const type of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = win.console[type];
    win.console[type] = (...args: unknown[]) => {
      state.console.push({ type, text: args.map(stringifyArg).join(' ') });
      return original?.apply(win.console, args);
    };
  }
});

Cypress.on('url:changed', (url: string) => {
  if (enabled()) state.urls.push(url);
});

beforeEach(() => {
  state.network = [];
  state.console = [];
  state.urls = [];
  if (!enabled()) return;
  cy.intercept({ url: '**' }, (req: any) => {
    const entry: NetEntry = {
      method: req.method,
      url: req.url,
      requestHeaders: req.headers,
      requestBody: asText(req.body),
    };
    req.on('response', (res: any) => {
      entry.status = res.statusCode;
      entry.responseHeaders = res.headers;
      entry.responseBody = asText(res.body);
      state.network.push(entry);
    });
  });
});

afterEach(() => {
  if (!enabled()) return;
  const test = Cypress.currentTest ?? {};
  const bundle: any = {
    leaklens: 1,
    tool: 'cypress',
    spec: Cypress.spec?.relative ?? Cypress.spec?.name,
    test: { title: test.title ?? 'prueba', titlePath: test.titlePath, file: Cypress.spec?.relative },
    pages: [],
    urls: [],
    console: [],
    network: [],
  };
  cy.document({ log: false }).then((doc: any) => {
    const text = doc?.body?.innerText ?? '';
    if (text) bundle.pages.push({ url: doc.location?.href ?? '', text: text.slice(0, 1_000_000) });
  });
  cy.window({ log: false }).then((win: any) => {
    const dump = (st: any) => {
      const o: Record<string, string> = {};
      try {
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i);
          if (k !== null) o[k] = st.getItem(k) ?? '';
        }
      } catch {
        /* storage no disponible */
      }
      return o;
    };
    bundle.localStorage = dump(win.localStorage);
    bundle.sessionStorage = dump(win.sessionStorage);
  });
  cy.getCookies({ log: false }).then((cookies: any[]) => {
    bundle.cookies = (cookies ?? []).map((c) => ({ name: c.name, value: c.value, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure }));
  });
  cy.then(() => {
    bundle.urls = [...new Set(state.urls)];
    bundle.console = state.console.slice();
    bundle.network = state.network.slice();
  });
  cy.task('leaklens:write', bundle, { log: false });
});

export {};
