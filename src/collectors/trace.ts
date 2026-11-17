import { isBinaryMime } from '../core/body.js';
import type { Evidence } from '../core/types.js';
import { exchangeEvidence, harEntryToExchange } from './http.js';
import type { CollectContext } from './types.js';
import { openZip } from './zip.js';

/**
 * Traza de Playwright (trace.zip). Contiene:
 *  - `*.network`: una línea JSON por request (`resource-snapshot` con una entrada HAR).
 *    Los cuerpos se guardan aparte en `resources/<sha1>`.
 *  - `*.trace`: eventos, entre ellos los mensajes de consola.
 */
export async function* collectTrace(file: string, ctx: CollectContext): AsyncGenerator<Evidence> {
  const zip = await openZip(file);
  const resources = new Set(zip.names.filter((n) => n.startsWith('resources/')));
  const readResource = async (sha1: unknown): Promise<string | undefined> => {
    if (typeof sha1 !== 'string') return undefined;
    const name = `resources/${sha1}`;
    if (!resources.has(name)) return undefined;
    const buf = await zip.read(name);
    return buf.length > ctx.maxBodyBytes ? buf.subarray(0, ctx.maxBodyBytes).toString('utf8') : buf.toString('utf8');
  };

  try {
    let networkLines = 0;
    for (const name of zip.names.filter((n) => n.endsWith('.network'))) {
      const text = (await zip.read(name)).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let ev: { type?: string; snapshot?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type !== 'resource-snapshot' || !ev.snapshot) continue;
        networkLines++;
        const snap = ev.snapshot;
        const content = snap.response?.content ?? {};
        if (!content.text && content._sha1 && !isBinaryMime(content.mimeType)) {
          content.text = await readResource(content._sha1);
        }
        const post = snap.request?.postData;
        if (post && !post.text && post._sha1) post.text = await readResource(post._sha1);

        const x = harEntryToExchange(snap);
        if (!x) continue;
        yield* exchangeEvidence(x, { source: 'trace', file: ctx.display, group: ctx.group, maxBodyBytes: ctx.maxBodyBytes });
      }
    }

    for (const name of zip.names.filter((n) => n.endsWith('.trace'))) {
      const text = (await zip.read(name)).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.includes('console')) continue;
        let ev: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const consoleText =
          ev.type === 'console' && typeof ev.text === 'string'
            ? ev.text
            : ev.type === 'event' && ev.method === 'console'
              ? ev.params?.message?.text ?? ev.params?.text
              : undefined;
        if (typeof consoleText === 'string' && consoleText) {
          yield { source: 'trace', location: 'console', file: ctx.display, group: ctx.group, fieldPath: 'console', text: consoleText };
        }
      }
    }

    if (networkLines === 0) {
      ctx.warn(`${ctx.display}: la traza no tiene actividad de red (¿se grabó con snapshots desactivados?).`);
    }
  } finally {
    zip.close();
  }
}
