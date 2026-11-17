import { maskPan } from '../core/redact.js';
import type { Detector, Match } from '../core/types.js';
import { allSameChar, digitsOnly, isSequential, luhn } from '../validators/index.js';
import { KEY, keyIs } from './keys.js';

interface Brand {
  name: string;
  test: RegExp;
  lengths: number[];
}

const BRANDS: Brand[] = [
  { name: 'American Express', test: /^3[47]/, lengths: [15] },
  { name: 'Diners Club', test: /^(36|38|30[0-5])/, lengths: [14, 15, 16, 17, 18, 19] },
  { name: 'Discover', test: /^(6011|65|64[4-9])/, lengths: [16, 17, 18, 19] },
  { name: 'JCB', test: /^35(2[89]|[3-8]\d)/, lengths: [16, 17, 18, 19] },
  { name: 'UnionPay', test: /^62/, lengths: [16, 17, 18, 19] },
  { name: 'Mastercard', test: /^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/, lengths: [16] },
  { name: 'Visa', test: /^4/, lengths: [13, 16, 19] },
];

/** Tarjetas de prueba publicadas por pasarelas (Stripe, Adyen, Braintree, etc.). */
export const SANDBOX_PANS = new Set([
  '4111111111111111', '4242424242424242', '4000056655665556', '4012888888881881', '4000000000000002',
  '5555555555554444', '5105105105105100', '5200828282828210', '2223003122003222',
  '378282246310005', '371449635398431', '378734493671000',
  '6011111111111117', '6011000990139424', '3056930009020004', '36227206271667',
  '3566002020360505', '6200000000000005',
]);

export function cardBrand(digits: string): Brand | undefined {
  return BRANDS.find((b) => b.test.test(digits));
}

/** 13 a 19 dígitos, con espacios o guiones simples entre ellos. */
const PAN_RE = /(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g;

export function findPans(text: string, keyHint: boolean): Array<{ digits: string; brand?: string }> {
  const out: Array<{ digits: string; brand?: string }> = [];
  for (const m of text.matchAll(PAN_RE)) {
    const digits = digitsOnly(m[0]);
    if (digits.length < 13 || digits.length > 19) continue;
    if (allSameChar(digits) || isSequential(digits)) continue;
    if (!luhn(digits)) continue;
    const brand = cardBrand(digits);
    const brandOk = !!brand && brand.lengths.includes(digits.length);
    if (!brandOk && !keyHint) continue;
    out.push({ digits, brand: brandOk ? brand!.name : undefined });
  }
  return out;
}

export const panDetector: Detector = {
  id: 'pan',
  name: 'Número de tarjeta (PAN)',
  description: 'Números de tarjeta completos validados con Luhn y rango de marca (BIN).',
  recommendation:
    'Muestra y devuelve solo los últimos 4 dígitos. Usa tokens de la pasarela en lugar del PAN. Nunca lo envíes en URLs, logs, consola ni storage del navegador (PCI DSS 3.3 y 3.4).',
  detect(e) {
    const keyHint = keyIs(KEY.card, e.key);
    const matches: Match[] = [];
    for (const p of findPans(e.text, keyHint)) {
      const sandbox = SANDBOX_PANS.has(p.digits);
      matches.push({
        detector: 'pan',
        title: 'Número de tarjeta (PAN)',
        kind: p.brand ?? 'Marca no identificada',
        dataClass: 'card',
        value: p.digits,
        masked: maskPan(p.digits),
        tags: sandbox ? ['tarjeta-sandbox'] : [],
        note: sandbox
          ? 'Es una tarjeta de prueba, pero el defecto es real: con una tarjeta verdadera se expondría igual.'
          : undefined,
      });
    }
    return matches;
  },
};
