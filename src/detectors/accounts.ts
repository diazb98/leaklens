import { maskTail } from '../core/redact.js';
import type { Detector, Match } from '../core/types.js';
import { allSameChar, digitsOnly, ibanValid } from '../validators/index.js';
import { KEY, isPlaceholder, keyIs } from './keys.js';

const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;

export const accountsDetector: Detector = {
  id: 'bank-account',
  name: 'Cuenta bancaria',
  description: 'IBAN validado con mod 97, CCI de Perú y números de cuenta identificados por el nombre del campo.',
  recommendation:
    'Muestra la cuenta enmascarada (últimos 4 dígitos) salvo en la pantalla donde el cliente la necesita. No la incluyas en URLs ni logs y no la devuelvas en endpoints que no la usan.',
  detect(e) {
    const out: Match[] = [];
    for (const m of e.text.matchAll(IBAN_RE)) {
      if (!ibanValid(m[0])) continue;
      const v = m[0].replace(/\s/g, '');
      out.push({ detector: 'bank-account', title: 'Cuenta bancaria', kind: 'IBAN', dataClass: 'identity', value: v, masked: maskTail(v, 4) });
    }
    if (out.length) return out;

    if (!keyIs(KEY.account, e.key)) return out;
    const raw = e.text.trim();
    if (isPlaceholder(raw) || !/^[\d -]+$/.test(raw)) return out;
    const d = digitsOnly(raw);
    if (d.length < 10 || d.length > 20 || allSameChar(d)) return out;

    const isCci = keyIs(KEY.cci, e.key) || d.length === 20;
    out.push({
      detector: 'bank-account',
      title: 'Cuenta bancaria',
      kind: isCci ? 'CCI (PE)' : 'Número de cuenta',
      dataClass: 'identity',
      value: d,
      masked: maskTail(d, 4),
    });
    return out;
  },
};
