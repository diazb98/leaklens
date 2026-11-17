import { readFile } from 'node:fs/promises';
import type { Evidence } from '../core/types.js';
import { exchangeEvidence, toHeaders, type HttpExchange } from './http.js';
import type { CollectContext } from './types.js';

/**
 * Reporte JSON de Newman: `newman run coleccion.json -r json --reporter-json-export newman/reporte.json`
 * Cada `run.executions[i]` tiene la request y la response con su cuerpo como Buffer serializado.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildUrl(url: any): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (typeof url.raw === 'string' && !Array.isArray(url.host)) return url.raw;
  const protocol = url.protocol ? `${url.protocol}://` : 'https://';
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
  const port = url.port ? `:${url.port}` : '';
  const path = Array.isArray(url.path) ? '/' + url.path.join('/') : (url.path ?? '');
  const query = Array.isArray(url.query)
    ? url.query
        .filter((q: any) => q && !q.disabled && q.key != null)
        .map((q: any) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
        .join('&')
    : '';
  return `${protocol}${host}${port}${path}${query ? '?' + query : ''}`;
}

function requestBody(body: any): HttpExchange['requestBody'] {
  if (!body) return undefined;
  if (body.mode === 'raw' && typeof body.raw === 'string') return { text: body.raw };
  const list = body.mode === 'urlencoded' ? body.urlencoded : body.mode === 'formdata' ? body.formdata : undefined;
  if (Array.isArray(list)) {
    const params = new URLSearchParams();
    for (const p of list) if (p && !p.disabled && p.type !== 'file') params.append(String(p.key), String(p.value ?? ''));
    return { text: params.toString(), mimeType: 'application/x-www-form-urlencoded' };
  }
  if (body.mode === 'graphql' && body.graphql) return { text: JSON.stringify(body.graphql), mimeType: 'application/json' };
  return undefined;
}

function responseText(res: any): string | undefined {
  const stream = res?.stream;
  if (stream?.type === 'Buffer' && Array.isArray(stream.data)) return Buffer.from(stream.data).toString('utf8');
  if (typeof res?.body === 'string') return res.body;
  return undefined;
}

export async function* collectNewman(file: string, ctx: CollectContext): AsyncGenerator<Evidence> {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const executions: any[] = data?.run?.executions;
  if (!Array.isArray(executions)) {
    ctx.warn(`${ctx.display}: no parece un reporte JSON de Newman (falta run.executions).`);
    return;
  }
  const collection = data?.collection?.info?.name;
  for (const ex of executions) {
    if (!ex?.request) continue;
    const name = ex.item?.name ?? 'request';
    const group = `${ctx.display}::${name}`;
    ctx.setGroupTitle(group, collection ? `${collection} › ${name}` : name);
    const x: HttpExchange = {
      method: ex.request.method,
      url: buildUrl(ex.request.url),
      requestHeaders: toHeaders(ex.request.header),
      requestBody: requestBody(ex.request.body),
      status: ex.response?.code,
      responseHeaders: toHeaders(ex.response?.header),
      responseBody: (() => {
        const t = responseText(ex.response);
        return t ? { text: t } : undefined;
      })(),
    };
    yield* exchangeEvidence(x, { source: 'newman', file: ctx.display, group, test: name, maxBodyBytes: ctx.maxBodyBytes });
  }
}
