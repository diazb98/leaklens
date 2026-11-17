import { maskFull, maskToken } from '../core/redact.js';
import type { DataClass, Detector, Match } from '../core/types.js';
import { entropy } from '../validators/index.js';
import { KEY, isPlaceholder, keyIs, normKey } from './keys.js';

interface Pattern {
  kind: string;
  re: RegExp;
  dataClass: DataClass;
  prefix: number;
}

const PATTERNS: Pattern[] = [
  { kind: 'Clave privada', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, dataClass: 'credential', prefix: 0 },
  { kind: 'AWS Access Key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, dataClass: 'credential', prefix: 4 },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, dataClass: 'credential', prefix: 4 },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, dataClass: 'credential', prefix: 5 },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, dataClass: 'credential', prefix: 4 },
  { kind: 'Stripe secret key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, dataClass: 'credential', prefix: 8 },
  { kind: 'Credenciales en URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, dataClass: 'credential', prefix: 0 },
];

/** `Bearer xxx` en texto libre (logs, consola). Los JWT los cubre su propio detector. */
const BEARER = /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g;

/** `password=xxx`, `"api_key": "xxx"` en texto libre. */
const KV_TEXT =
  /\b(password|passwd|pwd|contrase(?:n|ñ)a|clave|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b["']?\s*[:=]\s*["']?([^\s"'&,;]{4,})/gi;

const EXPECTED_AUTH_HEADERS = new Set(['authorization', 'cookie', 'proxyauthorization']);

export const secretsDetector: Detector = {
  id: 'secrets',
  name: 'Credenciales y secretos',
  description: 'Contraseñas, OTP, API keys, claves privadas y tokens de sesión fuera de su lugar.',
  recommendation:
    'Las credenciales solo deben viajar en el cuerpo del login o en headers de autenticación. Revisa los logs de la aplicación y del pipeline, rota cualquier secreto que haya quedado expuesto y usa un gestor de secretos.',
  detect(e) {
    const out: Match[] = [];
    const seen = new Set<string>();
    const push = (m: Omit<Match, 'detector' | 'title'>) => {
      if (seen.has(m.value)) return;
      seen.add(m.value);
      out.push({ detector: 'secrets', title: 'Credencial o secreto', ...m });
    };

    // 1. Por nombre de campo (JSON, query, headers, storage).
    const value = e.text.trim();
    const k = normKey(e.key);
    if (k && !isPlaceholder(value) && value.length >= 4 && !EXPECTED_AUTH_HEADERS.has(k)) {
      if (keyIs(KEY.password, e.key)) {
        push({ kind: k.includes('otp') ? 'OTP' : k.includes('pin') ? 'PIN' : 'Contraseña', dataClass: 'credential', value, masked: maskFull(value) });
      } else if (keyIs(KEY.secret, e.key)) {
        push({ kind: 'Secreto o API key', dataClass: 'credential', value, masked: maskToken(value, 3) });
      } else if (keyIs(KEY.token, e.key) && !value.startsWith('eyJ') && value.length >= 16 && entropy(value) >= 3) {
        push({ kind: 'Token de sesión', dataClass: 'session', value, masked: maskToken(value, 3) });
      }
    }

    // 2. Formatos conocidos en cualquier texto.
    for (const p of PATTERNS) {
      for (const m of e.text.matchAll(p.re)) {
        push({
          kind: p.kind,
          dataClass: p.dataClass,
          value: m[0],
          masked: p.prefix ? maskToken(m[0], p.prefix) : maskFull(m[0]),
          tags: /_test_/.test(m[0]) ? ['clave-de-prueba'] : [],
        });
      }
    }

    // 3. Texto libre: logs, consola, cuerpos sin estructura.
    if (!e.key || e.location === 'log-line' || e.location === 'console') {
      for (const m of e.text.matchAll(BEARER)) {
        const tok = m[1]!;
        if (tok.startsWith('eyJ')) continue;
        push({ kind: 'Bearer token', dataClass: 'session', value: tok, masked: maskToken(tok, 3) });
      }
      for (const m of e.text.matchAll(KV_TEXT)) {
        const v = m[2]!;
        if (isPlaceholder(v) || v.startsWith('eyJ') || v.startsWith('{{') || v.startsWith('${')) continue;
        const isToken = /token/i.test(m[1]!);
        push({
          kind: isToken ? 'Token de sesión' : /key|secret/i.test(m[1]!) ? 'Secreto o API key' : 'Contraseña',
          dataClass: isToken ? 'session' : 'credential',
          value: v,
          masked: isToken ? maskToken(v, 3) : maskFull(v),
        });
      }
    }
    return out;
  },
};
