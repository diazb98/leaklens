import { createReadStream } from 'node:fs';
import StreamArray from 'stream-json/streamers/StreamArray.js';
import Pick from 'stream-json/filters/Pick.js';
import Parser from 'stream-json/Parser.js';
import type { Evidence } from '../core/types.js';
import { exchangeEvidence, harEntryToExchange } from './http.js';
import type { CollectContext } from './types.js';

/**
 * HAR 1.2 (Playwright recordHar, DevTools, mitmproxy, BrowserMob, Charles…).
 * Se lee en streaming: un HAR de cientos de MB no se carga completo en memoria.
 */
export async function* collectHar(file: string, ctx: CollectContext): AsyncGenerator<Evidence> {
  const pipeline = createReadStream(file)
    .pipe(new Parser())
    .pipe(new Pick({ filter: 'log.entries' }))
    .pipe(new StreamArray());

  for await (const item of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
    const x = harEntryToExchange(item.value);
    if (!x) continue;
    yield* exchangeEvidence(x, {
      source: 'har',
      file: ctx.display,
      group: ctx.group,
      maxBodyBytes: ctx.maxBodyBytes,
    });
  }
}
