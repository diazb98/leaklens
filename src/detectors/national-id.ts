import { maskTail } from '../core/redact.js';
import type { Detector, Match } from '../core/types.js';
import { allSameChar, digitsOnly, isSequential, nitIsCompany, nitValid, rucIsPerson, rucValid } from '../validators/index.js';
import { KEY, isPlaceholder, keyIs } from './keys.js';

/**
 * Documentos de identidad de Perú y Colombia.
 *
 * - RUC (PE) y NIT (CO) tienen dígito verificador: se detectan en cualquier texto.
 *   Los de empresa (RUC 20…, NIT 8xx/9xx) son públicos y se ignoran.
 * - DNI (PE), CE (PE) y Cédula (CO) no tienen verificador en el número:
 *   solo se detectan por el nombre del campo o por su etiqueta en texto libre,
 *   para no marcar cualquier número de 8 dígitos.
 */

const RUC_RE = /(?<!\d)(?:10|15|16|17|20)\d{9}(?!\d)/g;
const NIT_RE = /(?<![\d.])(\d{1,3}(?:\.?\d{3}){1,4})\s?-\s?(\d)(?!\d)/g;
const DNI_TEXT = /\bDNI\s*(?:N[°º.o]*\s*)?[:#-]?\s*(\d{8})(?!\d)/gi;
const CC_TEXT = /(?:\bC\.\s?C\.|\bCC\b|\bc[eé]dula(?:\s+de\s+ciudadan[ií]a)?)\s*(?:No\.?|N[°º])?\s*[:#]?\s*(\d{1,3}(?:[.\s]?\d{3}){1,3})(?![\d])/gi;
// (?!\d) tras la base: sin él, "1020304050-7" retrocede a "102030405" y lo reporta sin verificador.
const NIT_TEXT = /\bNIT\b\s*(?:No\.?|N[°º])?\s*[:#]?\s*(\d{1,3}(?:\.?\d{3}){1,4})(?![\d.])(?:\s?-\s?(\d))?/gi;

function plausible(d: string): boolean {
  return !allSameChar(d) && !isSequential(d);
}

export const nationalIdDetector: Detector = {
  id: 'national-id',
  name: 'Documento de identidad',
  description: 'DNI, RUC de persona natural y carné de extranjería (Perú); cédula y NIT de persona natural (Colombia).',
  recommendation:
    'El documento de identidad es dato personal (Ley 29733 en Perú, Ley 1581 en Colombia). No lo pongas en URLs, logs ni claims de JWT, y devuélvelo solo en los endpoints que lo necesitan.',
  detect(e, ctx) {
    const pe = ctx.countries.includes('pe');
    const co = ctx.countries.includes('co');
    const out: Match[] = [];
    const seen = new Set<string>();
    const push = (kind: string, value: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      out.push({ detector: 'national-id', title: 'Documento de identidad', kind, dataClass: 'identity', value, masked: maskTail(value, 3) });
    };

    // 1. Por nombre de campo.
    const raw = e.text.trim();
    if (e.key && !isPlaceholder(raw) && /^[\d.\s-]+$/.test(raw)) {
      const nitKey = co && keyIs(KEY.coNit, e.key);
      const m = raw.match(/^([\d.]+)\s?-\s?(\d)$/);
      if (nitKey || m) {
        const base = digitsOnly(m ? m[1]! : raw);
        const dv = m?.[2];
        if (co && dv && nitValid(base, dv) && !nitIsCompany(base)) push('NIT (CO)', base + dv);
        else if (nitKey && !dv && base.length >= 6 && !nitIsCompany(base) && plausible(base)) push('NIT (CO)', base);
      } else {
        const d = digitsOnly(raw);
        const kinds: string[] = [];
        if (pe && d.length === 8 && keyIs(KEY.peDni, e.key)) kinds.push('DNI (PE)');
        if (pe && d.length >= 9 && d.length <= 12 && keyIs(KEY.peCe, e.key)) kinds.push('Carné de extranjería (PE)');
        if (co && d.length >= 6 && d.length <= 10 && keyIs(KEY.coCc, e.key)) kinds.push('Cédula (CO)');
        if (pe && d.length === 11 && rucValid(d) && rucIsPerson(d)) kinds.splice(0, kinds.length, 'RUC persona natural (PE)');
        if (kinds.length && plausible(d)) push(kinds.join(' / '), d);
      }
      if (out.length) return out;
    }

    // 2. Texto libre.
    if (pe) {
      for (const m of e.text.matchAll(RUC_RE)) {
        if (rucValid(m[0]) && rucIsPerson(m[0])) push('RUC persona natural (PE)', m[0]);
      }
      for (const m of e.text.matchAll(DNI_TEXT)) if (plausible(m[1]!)) push('DNI (PE)', m[1]!);
    }
    if (co) {
      for (const m of e.text.matchAll(NIT_RE)) {
        const base = digitsOnly(m[1]!);
        // Sin etiqueta exigimos 8+ dígitos: con menos, "123456-7" coincide por azar 1 de cada 11 veces.
        if (base.length >= 8 && nitValid(base, m[2]!) && !nitIsCompany(base) && plausible(base)) push('NIT (CO)', base + m[2]);
      }
      for (const m of e.text.matchAll(NIT_TEXT)) {
        const base = digitsOnly(m[1]!);
        if (nitIsCompany(base) || base.length < 6 || !plausible(base)) continue;
        if (m[2] ? nitValid(base, m[2]) : true) push('NIT (CO)', base + (m[2] ?? ''));
      }
      for (const m of e.text.matchAll(CC_TEXT)) {
        const d = digitsOnly(m[1]!);
        if (d.length >= 6 && d.length <= 10 && plausible(d)) push('Cédula (CO)', d);
      }
    }
    return out;
  },
};
