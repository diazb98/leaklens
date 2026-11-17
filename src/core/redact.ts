import { createHmac, randomBytes } from 'node:crypto';

/**
 * Único módulo que transforma valores sensibles en algo publicable.
 * Todo lo que llega a un reporte pasa por aquí.
 */

const DOT = '•';

/** Sal del HMAC. Con LEAKLENS_SALT fija, el mismo valor da el mismo hash entre ejecuciones. */
let salt: string = process.env.LEAKLENS_SALT ?? randomBytes(16).toString('hex');
let saltIsEphemeral = !process.env.LEAKLENS_SALT;

export function setSalt(value: string): void {
  salt = value;
  saltIsEphemeral = false;
}

export function isSaltEphemeral(): boolean {
  return saltIsEphemeral;
}

export function hashValue(value: string): string {
  return createHmac('sha256', salt).update(value).digest('hex').slice(0, 16);
}

/** `4111111111111111` → `•••• •••• •••• 1111` (solo últimos 4, más estricto que PCI). */
export function maskPan(digits: string): string {
  const last = digits.slice(-4);
  const hidden = Math.max(0, digits.length - 4);
  const groups = Math.ceil(hidden / 4);
  return Array.from({ length: groups }, () => DOT.repeat(4)).join(' ') + ' ' + last;
}

/** Deja visibles los últimos `keep` caracteres. Valores cortos se ocultan por completo. */
export function maskTail(value: string, keep = 3): string {
  const v = value.trim();
  if (v.length <= keep + 3) return DOT.repeat(Math.max(4, v.length));
  return DOT.repeat(Math.min(8, v.length - keep)) + v.slice(-keep);
}

/** Nunca muestra ni un carácter (CVV, contraseñas, claves privadas). */
export function maskFull(value: string): string {
  return `${DOT.repeat(4)} (${value.length} caracteres)`;
}

/** `ana.torres@correo.pe` → `a•••@correo.pe` */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return maskFull(email);
  return email[0] + DOT.repeat(3) + email.slice(at);
}

/** Tokens: muestra el prefijo de tipo (eyJ, AKIA, ghp_) y la longitud. */
export function maskToken(value: string, prefixLen = 4): string {
  return `${value.slice(0, prefixLen)}${DOT.repeat(4)} (${value.length} caracteres)`;
}

/**
 * Red de seguridad para cualquier texto libre que un reporte quiera mostrar
 * (mensajes de error, nombres de prueba): reemplaza secuencias de 6+ dígitos.
 */
export function scrubFreeText(text: string): string {
  return text
    .replace(/\d(?:[ -]?\d){5,}/g, (m) => DOT.repeat(Math.min(m.length, 8)))
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*\.?[A-Za-z0-9_-]*/g, 'eyJ' + DOT.repeat(4));
}
