/** Validadores de dígito verificador. Reducen falsos positivos antes de reportar. */

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Algoritmo de Luhn (ISO/IEC 7812) para números de tarjeta. */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** IBAN (ISO 13616): mod 97 = 1. */
export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/**
 * RUC de Perú (SUNAT): 11 dígitos, módulo 11 con pesos 5,4,3,2,7,6,5,4,3,2.
 */
export function rucValid(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * (ruc.charCodeAt(i) - 48), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  else if (check === 11) check = 1;
  return check === ruc.charCodeAt(10) - 48;
}

/** RUC de persona natural (10, 15, 16, 17). El RUC 20 es de empresa y es dato público. */
export function rucIsPerson(ruc: string): boolean {
  return /^(10|15|16|17)/.test(ruc);
}

/**
 * NIT de Colombia (DIAN): dígito de verificación módulo 11
 * con pesos 3,7,13,17,19,23,29,37,41,43,47,53,59,67,71 de derecha a izquierda.
 */
export function nitCheckDigit(base: string): number {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += (base.charCodeAt(base.length - 1 - i) - 48) * weights[i]!;
  }
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

export function nitValid(base: string, dv: string): boolean {
  if (!/^\d{6,15}$/.test(base) || !/^\d$/.test(dv)) return false;
  return nitCheckDigit(base) === Number(dv);
}

/** NIT de persona jurídica: 9 dígitos que empiezan por 8 o 9 (dato público). */
export function nitIsCompany(base: string): boolean {
  return /^[89]\d{8}$/.test(base);
}

/** Entropía de Shannon en bits por carácter (para secretos genéricos). */
export function entropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function allSameChar(s: string): boolean {
  return s.length > 0 && [...s].every((c) => c === s[0]);
}

/** Secuencias obvias como 0123456789 o 9876543210. */
export function isSequential(digits: string): boolean {
  if (digits.length < 6) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < digits.length; i++) {
    const d = digits.charCodeAt(i) - digits.charCodeAt(i - 1);
    if (d !== 1 && d !== -9) up = false;
    if (d !== -1 && d !== 9) down = false;
  }
  return up || down;
}
