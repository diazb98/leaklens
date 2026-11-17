import { describe, expect, it } from 'vitest';
import { quoteLargeIntegers, tryParseJson } from '../src/core/body.js';
import { maskPan, scrubFreeText } from '../src/core/redact.js';
import { ibanValid, isSequential, luhn, nitCheckDigit, nitIsCompany, nitValid, rucIsPerson, rucValid } from '../src/validators/index.js';

describe('Luhn', () => {
  it('acepta tarjetas válidas', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('5555555555554444')).toBe(true);
    expect(luhn('378282246310005')).toBe(true);
  });
  it('rechaza un dígito alterado', () => {
    expect(luhn('4111111111111112')).toBe(false);
  });
});

describe('IBAN', () => {
  it('valida mod 97', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82WEST12345698765433')).toBe(false);
  });
});

describe('RUC (Perú)', () => {
  it('valida el dígito verificador de SUNAT', () => {
    expect(rucValid('20131312955')).toBe(true); // RUC de SUNAT
    expect(rucValid('20131312954')).toBe(false);
    expect(rucValid('10460278975')).toBe(true);
  });
  it('distingue persona natural de empresa', () => {
    expect(rucIsPerson('10460278975')).toBe(true);
    expect(rucIsPerson('20131312955')).toBe(false);
  });
});

describe('NIT (Colombia)', () => {
  it('calcula el dígito de verificación de la DIAN', () => {
    expect(nitCheckDigit('800197268')).toBe(4); // NIT de la DIAN
    expect(nitValid('800197268', '4')).toBe(true);
    expect(nitValid('800197268', '5')).toBe(false);
    expect(nitCheckDigit('1020304050')).toBe(8);
  });
  it('identifica NIT de empresa', () => {
    expect(nitIsCompany('800197268')).toBe(true);
    expect(nitIsCompany('1020304050')).toBe(false);
  });
});

describe('utilidades', () => {
  it('detecta secuencias obvias', () => {
    expect(isSequential('0123456789')).toBe(true);
    expect(isSequential('46027897')).toBe(false);
  });
  it('conserva la precisión de enteros largos en JSON', () => {
    const parsed = tryParseJson('{"numero":4111111111111111,"n":[5555555555554444]}') as { numero: string; n: string[] };
    expect(parsed.numero).toBe('4111111111111111');
    expect(parsed.n[0]).toBe('5555555555554444');
    expect(quoteLargeIntegers('{"monto":150.25}')).toBe('{"monto":150.25}');
  });
  it('enmascara el PAN dejando solo los últimos 4', () => {
    expect(maskPan('4111111111111111')).toBe('•••• •••• •••• 1111');
  });
  it('limpia números largos y JWT en texto libre', () => {
    const out = scrubFreeText('falló con 4111 1111 1111 1111 y eyJhbGciOi.eyJzdWIiOi.abc');
    expect(out).not.toMatch(/4111 1111/);
    expect(out).not.toMatch(/eyJzdWIiOi/);
  });
});
