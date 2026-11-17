import type { Detector, Match } from '../core/types.js';
import { KEY, normKey } from './keys.js';

/**
 * Cookies de sesión sin HttpOnly (robables con XSS) o sin Secure (viajan por HTTP).
 * Se revisan en `Set-Cookie` de las respuestas y en las cookies capturadas por los bundles.
 */

const SESSION_NAME = /(sess|sid|token|auth|jwt|jsessionid|phpsessid|aspnet|connect|remember)/i;

function isSessionCookie(name: string): boolean {
  return SESSION_NAME.test(name) || KEY.token.test(normKey(name));
}

export const cookieFlagsDetector: Detector = {
  id: 'cookie-flags',
  name: 'Cookie de sesión insegura',
  description: 'Cookies de sesión sin HttpOnly o sin Secure.',
  recommendation:
    'Emite las cookies de sesión con HttpOnly, Secure y SameSite=Lax o Strict. Sin HttpOnly, un XSS puede robar la sesión; sin Secure, la cookie puede viajar por HTTP.',
  detect(e) {
    const out: Match[] = [];
    const issues: string[] = [];
    let name: string | undefined;

    if (e.location === 'response-header' && e.key === 'set-cookie') {
      for (const line of e.text.split(/\n/)) {
        const n = line.split('=')[0]?.trim();
        if (!n || !isSessionCookie(n)) continue;
        const attrs = line.toLowerCase();
        const missing: string[] = [];
        if (!/;\s*httponly/.test(attrs)) missing.push('HttpOnly');
        if (!/;\s*secure/.test(attrs) && e.meta?.https !== false) missing.push('Secure');
        if (/max-age=0|expires=thu, 01 jan 1970/.test(attrs)) continue;
        if (missing.length) {
          out.push({
            detector: 'cookie-flags',
            title: 'Cookie de sesión insegura',
            kind: `sin ${missing.join(' ni ')}`,
            dataClass: 'session',
            value: n,
            masked: n,
            forceSeverity: missing.includes('HttpOnly') ? 'high' : 'medium',
          });
        }
      }
      return out;
    }

    if (e.location === 'cookie' && e.source === 'bundle' && e.meta && e.meta.httpOnly === false) {
      name = e.key;
      if (name && isSessionCookie(name)) {
        issues.push('accesible desde JavaScript');
        out.push({
          detector: 'cookie-flags',
          title: 'Cookie de sesión insegura',
          kind: issues.join(', '),
          dataClass: 'session',
          value: name,
          masked: name,
          forceSeverity: 'high',
        });
      }
    }
    return out;
  },
};
