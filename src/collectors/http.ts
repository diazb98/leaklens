import { bodyLeaves, isBinaryMime } from '../core/body.js';
import { normalizeEndpoint, safeUrl } from '../core/endpoint.js';
import type { Evidence, Location, SourceKind } from '../core/types.js';

/**
 * Forma común de una petición HTTP. HAR, trazas de Playwright, Newman y los
 * bundles de Cypress/Selenium se convierten a esto y comparten la misma lógica.
 */
export interface HttpExchange {
  method?: string;
  url: string;
  requestHeaders: Array<{ name: string; value: string }>;
  requestBody?: { text: string; mimeType?: string };
  status?: number;
  responseHeaders: Array<{ name: string; value: string }>;
  responseBody?: { text: string; mimeType?: string };
}

export interface ExchangeBase {
  source: SourceKind;
  file: string;
  group: string;
  test?: string;
  maxBodyBytes: number;
}

const CODE_MIME = /javascript|ecmascript|typescript|text\/css|text\/html|application\/xhtml/i;

function header(headers: HttpExchange['responseHeaders'], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name)?.value;
}

/** Evidencias de una URL: la ruta (sin query) y cada parámetro por separado. */
export function* urlEvidence(rawUrl: string, base: Omit<Evidence, 'location' | 'text'>): Generator<Evidence> {
  const u = safeUrl(rawUrl);
  if (!u) {
    yield { ...base, location: 'url', text: rawUrl };
    return;
  }
  let pathText = u.pathname;
  try {
    pathText = decodeURIComponent(u.pathname);
  } catch {
    /* ruta mal codificada: se analiza tal cual */
  }
  yield { ...base, location: 'url', fieldPath: 'path', text: `${u.host}${pathText}` };
  for (const [key, value] of u.searchParams) {
    yield { ...base, location: 'query', key, fieldPath: `?${key}`, text: value };
  }
  // Fragmento: OAuth implícito deja tokens en #access_token=...
  if (u.hash.length > 1) {
    const frag = new URLSearchParams(u.hash.slice(1));
    let any = false;
    for (const [key, value] of frag) {
      any = true;
      yield { ...base, location: 'query', key, fieldPath: `#${key}`, text: value };
    }
    if (!any) yield { ...base, location: 'url', fieldPath: 'hash', text: u.hash.slice(1) };
  }
}

function* bodyEvidence(
  body: { text: string; mimeType?: string } | undefined,
  location: Location,
  base: Omit<Evidence, 'location' | 'text'>,
  maxBytes: number,
): Generator<Evidence> {
  if (!body?.text || isBinaryMime(body.mimeType)) return;
  const text = body.text.length > maxBytes ? body.text.slice(0, maxBytes) : body.text;
  // JS, CSS y HTML son código: `password: a` es una variable, no una contraseña.
  const meta = CODE_MIME.test(body.mimeType ?? '') ? { code: true } : undefined;
  for (const leaf of bodyLeaves(text, body.mimeType)) {
    yield { ...base, location, key: leaf.key, fieldPath: leaf.path, text: leaf.value, meta };
  }
}

export function* exchangeEvidence(x: HttpExchange, b: ExchangeBase): Generator<Evidence> {
  const endpoint = normalizeEndpoint(x.method, x.url);
  const https = x.url.startsWith('https:');
  const base = { source: b.source, file: b.file, group: b.group, test: b.test, endpoint };

  yield* urlEvidence(x.url, base);

  for (const h of x.requestHeaders) {
    const name = h.name.toLowerCase();
    if (name.startsWith(':')) continue; // pseudo-headers HTTP/2
    if (name === 'cookie') {
      for (const part of h.value.split(';')) {
        const i = part.indexOf('=');
        if (i <= 0) continue;
        const key = part.slice(0, i).trim();
        yield { ...base, location: 'cookie', key, fieldPath: `cookie:${key}`, text: part.slice(i + 1).trim() };
      }
      continue;
    }
    yield { ...base, location: 'request-header', key: name, fieldPath: `header:${name}`, text: h.value };
  }
  yield* bodyEvidence(x.requestBody, 'request-body', base, b.maxBodyBytes);

  const setCookies: string[] = [];
  for (const h of x.responseHeaders) {
    const name = h.name.toLowerCase();
    if (name === 'set-cookie') {
      setCookies.push(...h.value.split('\n'));
      continue;
    }
    yield { ...base, location: 'response-header', key: name, fieldPath: `header:${name}`, text: h.value };
  }
  if (setCookies.length) {
    yield { ...base, location: 'response-header', key: 'set-cookie', fieldPath: 'header:set-cookie', text: setCookies.join('\n'), meta: { https } };
    for (const line of setCookies) {
      const first = line.split(';')[0] ?? '';
      const i = first.indexOf('=');
      if (i <= 0) continue;
      const key = first.slice(0, i).trim();
      yield { ...base, location: 'cookie', key, fieldPath: `set-cookie:${key}`, text: first.slice(i + 1).trim() };
    }
  }

  const mime = x.responseBody?.mimeType ?? header(x.responseHeaders, 'content-type');
  yield* bodyEvidence(x.responseBody && { ...x.responseBody, mimeType: mime }, 'response-body', base, b.maxBodyBytes);
}

/** Entrada HAR 1.2 → HttpExchange. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function harEntryToExchange(entry: any): HttpExchange | undefined {
  const req = entry?.request;
  if (!req?.url) return undefined;
  const res = entry.response ?? {};
  const content = res.content ?? {};
  let responseText: string | undefined = typeof content.text === 'string' ? content.text : undefined;
  if (responseText && content.encoding === 'base64' && !isBinaryMime(content.mimeType)) {
    responseText = Buffer.from(responseText, 'base64').toString('utf8');
  } else if (content.encoding === 'base64') {
    responseText = undefined;
  }
  let requestText: string | undefined = req.postData?.text;
  if (!requestText && Array.isArray(req.postData?.params)) {
    requestText = new URLSearchParams(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req.postData.params.map((p: any) => [String(p.name), String(p.value ?? '')]),
    ).toString();
  }
  return {
    method: req.method,
    url: req.url,
    requestHeaders: toHeaders(req.headers),
    requestBody: requestText ? { text: requestText, mimeType: req.postData?.mimeType } : undefined,
    status: res.status,
    responseHeaders: toHeaders(res.headers),
    responseBody: responseText ? { text: responseText, mimeType: content.mimeType } : undefined,
  };
}

/** Acepta `[{name,value}]`, `[{key,value}]` o `{ nombre: valor | valor[] }`. */
export function toHeaders(h: unknown): Array<{ name: string; value: string }> {
  if (!h) return [];
  if (Array.isArray(h)) {
    return h
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((x: any) => x && (x.name ?? x.key) !== undefined && !x.disabled)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((x: any) => ({ name: String(x.name ?? x.key), value: String(x.value ?? '') }));
  }
  if (typeof h === 'object') {
    return Object.entries(h as Record<string, unknown>).map(([name, v]) => ({
      name,
      value: Array.isArray(v) ? v.join('\n') : String(v ?? ''),
    }));
  }
  return [];
}
