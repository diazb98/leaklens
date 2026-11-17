import { flattenJson } from '../core/body.js';
import { maskToken } from '../core/redact.js';
import type { Detector, Evidence, Match } from '../core/types.js';

const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

function b64urlJson(part: string): Record<string, unknown> | undefined {
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface DecodedJwt {
  raw: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export function findJwts(text: string): DecodedJwt[] {
  const out: DecodedJwt[] = [];
  for (const m of text.matchAll(JWT_RE)) {
    const [h, p] = m[0].split('.');
    const header = b64urlJson(h!);
    const payload = b64urlJson(p!);
    if (header && payload) out.push({ raw: m[0], header, payload });
  }
  return out;
}

const DAY = 24 * 60 * 60;

export const jwtDetector: Detector = {
  id: 'jwt',
  name: 'Token JWT',
  description: 'Tokens JWT fuera de su lugar, con alg "none" o con vigencia excesiva.',
  recommendation:
    'Envía los tokens solo en el header Authorization o en cookies HttpOnly + Secure. No los pongas en URLs, logs ni localStorage. Rechaza alg "none" en el backend y usa vigencias cortas con refresh token.',
  detect(e) {
    const out: Match[] = [];
    for (const jwt of findJwts(e.text)) {
      const alg = String(jwt.header.alg ?? '');
      const tags: string[] = [];
      const notes: string[] = [];
      let force: Match['forceSeverity'];

      if (alg.toLowerCase() === 'none') {
        tags.push('alg-none');
        notes.push('El token declara alg "none": si el backend lo acepta, cualquiera puede fabricar tokens.');
        force = 'critical';
      }
      const iat = typeof jwt.payload.iat === 'number' ? jwt.payload.iat : undefined;
      const exp = typeof jwt.payload.exp === 'number' ? jwt.payload.exp : undefined;
      if (exp === undefined) {
        tags.push('sin-expiracion');
        notes.push('El token no tiene "exp": no vence nunca.');
        force = force ?? 'medium';
      } else if (iat !== undefined && exp - iat > DAY) {
        tags.push('vigencia-larga');
        notes.push(`Vigencia de ${Math.round((exp - iat) / 3600)} horas. Para banca se recomiendan minutos.`);
      }

      out.push({
        detector: 'jwt',
        title: 'Token JWT',
        kind: alg ? `alg: ${alg}` : undefined,
        dataClass: 'session',
        value: jwt.raw,
        masked: maskToken(jwt.raw, 3),
        tags,
        note: notes.join(' ') || undefined,
        forceSeverity: force,
      });
    }
    return out;
  },
};

/**
 * Los claims de un JWT viajan en base64, no cifrados.
 * Expandimos el payload como evidencia nueva para que los demás detectores
 * encuentren documentos, correos o tarjetas dentro del token.
 */
export function expandJwtPayloads(e: Evidence): Evidence[] {
  if (!e.text.includes('eyJ')) return [];
  const out: Evidence[] = [];
  for (const jwt of findJwts(e.text)) {
    for (const leaf of flattenJson(jwt.payload)) {
      if (['iat', 'exp', 'nbf', 'iss', 'aud', 'jti', 'alg', 'typ', 'kid', 'scope'].includes(leaf.key ?? '')) continue;
      out.push({
        ...e,
        fieldPath: `${e.fieldPath ?? ''}#jwt${leaf.path.slice(1)}`,
        key: leaf.key,
        text: leaf.value,
        meta: { ...e.meta, insideJwt: true },
      });
    }
  }
  return out;
}
