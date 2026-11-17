import { maskEmail, maskTail } from '../core/redact.js';
import type { Detector, Match } from '../core/types.js';
import { digitsOnly } from '../validators/index.js';
import { KEY, isPlaceholder, keyIs } from './keys.js';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;
/** Perú: +51 9XX XXX XXX. Colombia: +57 3XX XXX XXXX. */
const PHONE_PE = /(?:\+|\b00)51[\s.-]?(9\d{2})[\s.-]?(\d{3})[\s.-]?(\d{3})(?!\d)/g;
const PHONE_CO = /(?:\+|\b00)57[\s.-]?(3\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;

/** Correos técnicos que no son datos personales. */
const IGNORED_EMAIL = /^(noreply|no-reply|donotreply|support|soporte|info|admin)@|@(example\.(com|org|net)|sentry\.io|users\.noreply\.github\.com)$/i;

export const contactDetector: Detector = {
  id: 'contact',
  name: 'Datos de contacto',
  description: 'Correos electrónicos y celulares de Perú y Colombia.',
  recommendation:
    'Los datos de contacto son datos personales. Evítalos en URLs (quedan en historial, proxies y analítica) y en logs. En respuestas, devuélvelos solo cuando la pantalla los usa.',
  detect(e, ctx) {
    const out: Match[] = [];
    const seen = new Set<string>();
    const push = (kind: string, value: string, masked: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      out.push({ detector: 'contact', title: 'Dato de contacto', kind, dataClass: 'contact', value, masked });
    };

    for (const m of e.text.matchAll(EMAIL_RE)) {
      if (!IGNORED_EMAIL.test(m[0])) push('Correo electrónico', m[0].toLowerCase(), maskEmail(m[0]));
    }
    if (ctx.countries.includes('pe')) {
      for (const m of e.text.matchAll(PHONE_PE)) {
        const d = '51' + m[1] + m[2] + m[3];
        push('Celular (PE)', d, '+51 ' + maskTail(d.slice(2), 3));
      }
    }
    if (ctx.countries.includes('co')) {
      for (const m of e.text.matchAll(PHONE_CO)) {
        const d = '57' + m[1] + m[2] + m[3];
        push('Celular (CO)', d, '+57 ' + maskTail(d.slice(2), 3));
      }
    }
    if (!out.length && keyIs(KEY.phone, e.key)) {
      const raw = e.text.trim();
      if (!isPlaceholder(raw) && /^[+\d\s().-]+$/.test(raw)) {
        const d = digitsOnly(raw);
        if (d.length >= 7 && d.length <= 13) push('Teléfono', d, maskTail(d, 3));
      }
    }
    return out;
  },
};
