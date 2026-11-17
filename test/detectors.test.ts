import { describe, expect, it } from 'vitest';
import type { Evidence, Match } from '../src/core/types.js';
import {
  accountsDetector,
  contactDetector,
  cookieFlagsDetector,
  cvvDetector,
  jwtDetector,
  nationalIdDetector,
  panDetector,
  secretsDetector,
} from '../src/detectors/index.js';
import { expandJwtPayloads } from '../src/detectors/jwt.js';
import { resolveSeverity } from '../src/policy/severity.js';

const ctx = { countries: ['pe', 'co'] as const };

function ev(text: string, extra: Partial<Evidence> = {}): Evidence {
  return { source: 'har', location: 'response-body', file: 'x.har', group: 'g', text, ...extra };
}

const run = (d: { detect: (e: Evidence, c: typeof ctx) => Match[] }, e: Evidence) => d.detect(e, ctx);
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('PAN', () => {
  it('encuentra tarjetas con espacios o guiones y marca las de sandbox', () => {
    const m = run(panDetector, ev('pago con 4111-1111-1111-1111 aprobado'));
    expect(m).toHaveLength(1);
    expect(m[0]!.kind).toBe('Visa');
    expect(m[0]!.tags).toContain('tarjeta-sandbox');
    expect(m[0]!.masked).toBe('•••• •••• •••• 1111');
  });
  it('ignora timestamps, secuencias y números que no pasan Luhn', () => {
    expect(run(panDetector, ev('ts=1731800000000 pedido 1234567890123456'))).toHaveLength(0);
    expect(run(panDetector, ev('0000000000000000'))).toHaveLength(0);
  });
  it('acepta marcas no identificadas solo si el campo indica tarjeta', () => {
    const luhnOnly = '8000000000000003'; // pasa Luhn, pero ninguna marca empieza por 8
    expect(run(panDetector, ev(luhnOnly))).toHaveLength(0);
    expect(run(panDetector, ev(luhnOnly, { key: 'numeroTarjeta' }))).toHaveLength(1);
  });
});

describe('CVV', () => {
  it('por nombre de campo y por etiqueta en texto', () => {
    expect(run(cvvDetector, ev('123', { key: 'cvv' }))).toHaveLength(1);
    expect(run(cvvDetector, ev('tarjeta ok cvv=4321', { location: 'log-line' }))).toHaveLength(1);
  });
  it('no confunde cualquier número de 3 dígitos', () => {
    expect(run(cvvDetector, ev('123', { key: 'monto' }))).toHaveLength(0);
  });
});

describe('Secretos', () => {
  it('contraseñas por campo y en logs', () => {
    expect(run(secretsDetector, ev('Secreta123!', { key: 'password', location: 'query' }))[0]?.kind).toBe('Contraseña');
    expect(run(secretsDetector, ev('login password=Secreta123! ok', { location: 'log-line' }))).toHaveLength(1);
  });
  it('ignora placeholders y el header Authorization', () => {
    expect(run(secretsDetector, ev('********', { key: 'password' }))).toHaveLength(0);
    expect(run(secretsDetector, ev('Basic dXNlcjpwYXNz', { key: 'authorization', location: 'request-header' }))).toHaveLength(0);
  });
  it('en código JS no confunde variables con contraseñas, pero sí detecta claves reales', () => {
    const js = { meta: { code: true } };
    expect(run(secretsDetector, ev('T({userName:r,password:a}),s({password:C})', js))).toHaveLength(0);
    expect(run(secretsDetector, ev('const k="AKIAIOSFODNN7EXAMPLE";', js))[0]?.kind).toBe('AWS Access Key');
  });
  it('formatos conocidos', () => {
    expect(run(secretsDetector, ev('key AKIAIOSFODNN7EXAMPLE'))[0]?.kind).toBe('AWS Access Key');
    expect(run(secretsDetector, ev('-----BEGIN RSA PRIVATE KEY-----'))[0]?.kind).toBe('Clave privada');
  });
});

describe('JWT', () => {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({ sub: '1', dni: '46027897', iat: 1, exp: 1000 });
  const token = `${header}.${payload}.`;

  it('alg none es crítico aunque esté en una ubicación esperada', () => {
    const m = run(jwtDetector, ev(`Bearer ${token}`, { location: 'request-header', key: 'authorization' }));
    expect(m[0]!.tags).toContain('alg-none');
    expect(resolveSeverity(m[0]!.dataClass, 'request-header', m[0]!.forceSeverity)).toBe('critical');
  });
  it('expande los claims para que otros detectores los vean', () => {
    const expanded = expandJwtPayloads(ev(token, { location: 'local-storage', key: 'token', fieldPath: 'token' }));
    const dni = expanded.find((e) => e.key === 'dni')!;
    expect(dni.fieldPath).toBe('token#jwt.dni');
    expect(run(nationalIdDetector, dni)[0]?.kind).toBe('DNI (PE)');
  });
});

describe('Documentos de identidad (PE y CO)', () => {
  it('DNI solo con contexto', () => {
    expect(run(nationalIdDetector, ev('46027897', { key: 'nroDocumento' }))[0]?.kind).toBe('DNI (PE) / Cédula (CO)');
    expect(run(nationalIdDetector, ev('46027897', { key: 'dni' }))[0]?.kind).toBe('DNI (PE)');
    expect(run(nationalIdDetector, ev('pedido 46027897'))).toHaveLength(0);
    expect(run(nationalIdDetector, ev('Cliente DNI: 46027897 creado'))[0]?.kind).toBe('DNI (PE)');
  });
  it('RUC: persona natural sí, empresa no', () => {
    expect(run(nationalIdDetector, ev('RUC 10460278975'))[0]?.kind).toBe('RUC persona natural (PE)');
    expect(run(nationalIdDetector, ev('RUC 20131312955'))).toHaveLength(0);
  });
  it('NIT: persona natural sí, empresa no', () => {
    expect(run(nationalIdDetector, ev('1020304050-8', { key: 'nit' }))[0]?.kind).toBe('NIT (CO)');
    expect(run(nationalIdDetector, ev('NIT 800197268-4'))).toHaveLength(0);
    expect(run(nationalIdDetector, ev('NIT 1020304050-7'))).toHaveLength(0);
  });
  it('cédula colombiana con puntos', () => {
    expect(run(nationalIdDetector, ev('C.C. 1.020.304.050'))[0]?.kind).toBe('Cédula (CO)');
  });
  it('respeta los países configurados', () => {
    expect(nationalIdDetector.detect(ev('46027897', { key: 'dni' }), { countries: ['co'] })).toHaveLength(0);
  });
});

describe('Cuentas y contacto', () => {
  it('CCI por campo', () => {
    expect(run(accountsDetector, ev('00219300123456789012', { key: 'cuentaCci' }))[0]?.kind).toBe('CCI (PE)');
  });
  it('celulares de Perú y Colombia', () => {
    expect(run(contactDetector, ev('llamar al +51 987 654 321'))[0]?.kind).toBe('Celular (PE)');
    expect(run(contactDetector, ev('+57 310 555 1234'))[0]?.kind).toBe('Celular (CO)');
  });
  it('ignora correos técnicos', () => {
    expect(run(contactDetector, ev('noreply@banco.pe'))).toHaveLength(0);
  });
});

describe('Cookies', () => {
  it('cookie de sesión sin HttpOnly', () => {
    const m = run(cookieFlagsDetector, ev('SESSIONID=abc; Path=/; Secure', { location: 'response-header', key: 'set-cookie' }));
    expect(m[0]?.kind).toBe('sin HttpOnly');
  });
  it('cookie de sesión bien configurada', () => {
    expect(run(cookieFlagsDetector, ev('SESSIONID=abc; Path=/; Secure; HttpOnly; SameSite=Lax', { location: 'response-header', key: 'set-cookie' }))).toHaveLength(0);
  });
});
