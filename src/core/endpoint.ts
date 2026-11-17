/**
 * Normaliza endpoints para que `GET /api/clientes/123` y `GET /api/clientes/456`
 * cuenten como el mismo lugar (misma huella, mismo hallazgo).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{16,}$/i;
const NUM = /^\d+$/;
const MIXED_ID = /^(?=.*\d)[A-Za-z0-9_-]{12,}$/;

export function normalizePath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      let s: string;
      try {
        s = decodeURIComponent(seg);
      } catch {
        s = seg;
      }
      if (NUM.test(s.replace(/[ -]/g, ''))) return '{id}';
      if (UUID.test(s)) return '{uuid}';
      if (HEX.test(s)) return '{hash}';
      if (MIXED_ID.test(s)) return '{token}';
      return seg;
    })
    .join('/');
}

export function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(raw, 'http://localhost');
    } catch {
      return null;
    }
  }
}

export function normalizeEndpoint(method: string | undefined, rawUrl: string): string {
  const u = safeUrl(rawUrl);
  if (!u) return `${(method ?? 'GET').toUpperCase()} ${rawUrl.split('?')[0]}`;
  const host = u.host && u.host !== 'localhost' ? u.host : '';
  return `${(method ?? 'GET').toUpperCase()} ${host}${normalizePath(u.pathname)}`;
}

export function pageEndpoint(rawUrl: string): string {
  const u = safeUrl(rawUrl);
  if (!u) return 'PAGE ' + rawUrl.split('?')[0];
  return `PAGE ${u.host}${normalizePath(u.pathname)}`;
}

/** `$.tarjetas[3].numero` → `$.tarjetas[*].numero` */
export function normalizeFieldPath(fieldPath: string | undefined): string | undefined {
  return fieldPath?.replace(/\[\d+\]/g, '[*]');
}
