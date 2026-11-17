import { readFile } from 'node:fs/promises';
import { bodyLeaves } from '../core/body.js';
import type { LeakLensBundle } from '../core/bundle.js';
import { normalizeEndpoint, pageEndpoint } from '../core/endpoint.js';
import type { Evidence, Location } from '../core/types.js';
import { exchangeEvidence, toHeaders, urlEvidence } from './http.js';
import type { CollectContext } from './types.js';

const MAX_DOM = 1_000_000;

export async function* collectBundle(file: string, ctx: CollectContext): AsyncGenerator<Evidence> {
  const b = JSON.parse(await readFile(file, 'utf8')) as LeakLensBundle;
  if (!b || b.leaklens !== 1) {
    ctx.warn(`${ctx.display}: no es un bundle de LeakLens v1.`);
    return;
  }
  const test = b.test?.titlePath?.filter(Boolean).join(' › ') || b.test?.title;
  if (test) ctx.setGroupTitle(ctx.group, test);
  const base = { source: 'bundle' as const, file: ctx.display, group: ctx.group, test };

  for (const p of b.pages ?? []) {
    if (!p?.text) continue;
    yield {
      ...base,
      location: 'dom',
      endpoint: pageEndpoint(p.url ?? ''),
      fieldPath: 'innerText',
      text: p.text.length > MAX_DOM ? p.text.slice(0, MAX_DOM) : p.text,
    };
  }

  // Mismo endpoint que la navegación registrada en el HAR, para que la fuga cuente una sola vez.
  for (const url of new Set(b.urls ?? [])) {
    yield* urlEvidence(url, { ...base, endpoint: normalizeEndpoint('GET', url) });
  }

  const storage: Array<[Location, Record<string, string> | undefined]> = [
    ['local-storage', b.localStorage],
    ['session-storage', b.sessionStorage],
  ];
  for (const [location, store] of storage) {
    for (const [key, value] of Object.entries(store ?? {})) {
      if (typeof value !== 'string') continue;
      const leaves = bodyLeaves(value);
      if (leaves.length === 1 && leaves[0]!.path === 'body') {
        yield { ...base, location, key, fieldPath: key, text: value };
      } else {
        for (const leaf of leaves) {
          yield { ...base, location, key: leaf.key ?? key, fieldPath: `${key}${leaf.path.slice(1)}`, text: leaf.value };
        }
      }
    }
  }

  for (const c of b.cookies ?? []) {
    if (!c?.name) continue;
    yield {
      ...base,
      location: 'cookie',
      key: c.name,
      fieldPath: `cookie:${c.name}`,
      text: String(c.value ?? ''),
      meta: { httpOnly: c.httpOnly, secure: c.secure },
    };
  }

  for (const [i, m] of (b.console ?? []).entries()) {
    if (m?.text) yield { ...base, location: 'console', fieldPath: `console[${i}]`, text: m.text };
  }

  for (const n of b.network ?? []) {
    if (!n?.url) continue;
    yield* exchangeEvidence(
      {
        method: n.method,
        url: n.url,
        status: n.status,
        requestHeaders: toHeaders(n.requestHeaders),
        requestBody: n.requestBody ? { text: n.requestBody } : undefined,
        responseHeaders: toHeaders(n.responseHeaders),
        responseBody: n.responseBody ? { text: n.responseBody, mimeType: n.responseMimeType } : undefined,
      },
      { source: 'bundle', file: ctx.display, group: ctx.group, test, maxBodyBytes: ctx.maxBodyBytes },
    );
  }
}
