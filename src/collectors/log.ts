import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Evidence } from '../core/types.js';
import type { CollectContext } from './types.js';

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const MAX_LINE = 100_000;

/** Logs de aplicación y consola de Jenkins, línea por línea (sin cargar el archivo completo). */
export async function* collectLog(file: string, ctx: CollectContext): AsyncGenerator<Evidence> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const raw of rl) {
    n++;
    if (!raw) continue;
    const line = (raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) : raw).replace(ANSI, '');
    if (line.length < 4) continue;
    yield {
      source: 'log',
      location: 'log-line',
      file: ctx.display,
      group: ctx.display,
      fieldPath: `L${n}`,
      text: line,
    };
  }
}
