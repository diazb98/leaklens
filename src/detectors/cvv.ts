import { maskFull } from '../core/redact.js';
import type { Detector, Match } from '../core/types.js';
import { KEY, keyIs } from './keys.js';

/** `cvv=123`, `"cvc": "1234"`, `código de seguridad: 123` en texto libre. */
const CVV_TEXT =
  /\b(?:cvv2?|cvc2?|cid|csc|security[_ -]?code|c[oó]digo[_ -]de[_ -]seguridad)\b["']?\s*[:=]\s*["']?(\d{3,4})(?!\d)/gi;

export const cvvDetector: Detector = {
  id: 'cvv',
  name: 'Código de seguridad (CVV/CVC)',
  description: 'CVV/CVC identificado por el nombre del campo o por la etiqueta en texto libre.',
  recommendation:
    'El CVV no se puede almacenar después de la autorización, ni siquiera cifrado (PCI DSS 3.3.1). Envíalo solo a la pasarela, nunca lo devuelvas en respuestas ni lo registres en logs.',
  detect(e) {
    const out: Match[] = [];
    const push = (value: string) =>
      out.push({
        detector: 'cvv',
        title: 'Código de seguridad (CVV/CVC)',
        dataClass: 'card-secret',
        value,
        masked: maskFull(value),
      });

    if (keyIs(KEY.cvv, e.key) && /^\d{3,4}$/.test(e.text.trim())) {
      push(e.text.trim());
      return out;
    }
    for (const m of e.text.matchAll(CVV_TEXT)) push(m[1]!);
    return out;
  },
};
