import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import { scan } from '../src/core/pipeline.js';
import type { ScanResult } from '../src/core/types.js';
import { writeReports } from '../src/reporters/index.js';

/**
 * Réplica del patrón real observado en el Book Store de demoqa.com (noviembre 2026):
 * tras el login, la cookie `token` es un JWT cuyo payload es { userName, password, iat },
 * la crea JavaScript (sin HttpOnly) y el token no tiene `exp`.
 *
 * Todos los valores son inventados: ningún dato de una cuenta real.
 */
const FAKE_USER = 'usuario.demo';
const FAKE_PASS = 'ClaveFalsa#2026';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ userName: FAKE_USER, password: FAKE_PASS, iat: 1_763_000_000 })}.ZmlybWEtZmFsc2E`;

let dir: string;
let result: ScanResult;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'leaklens-demoqa-'));
  const testDir = path.join(dir, 'bookstore-login');
  mkdirSync(testDir);
  writeFileSync(
    path.join(testDir, 'leaklens.bundle.json'),
    JSON.stringify({
      leaklens: 1,
      tool: 'playwright',
      test: { title: 'Book Store › inicia sesión y ve su perfil' },
      pages: [{ url: 'https://demoqa.com/profile', text: `Books\nUser Name : ${FAKE_USER}\nLogout` }],
      cookies: [
        { name: 'token', value: TOKEN, domain: 'demoqa.com', httpOnly: false, secure: false },
        { name: 'userName', value: FAKE_USER, domain: 'demoqa.com', httpOnly: false, secure: false },
        { name: 'expires', value: '2026-11-24T12:00:00.000Z', domain: 'demoqa.com', httpOnly: false, secure: false },
        { name: '_ga', value: 'GA1.1.123456789.1763000000', domain: 'demoqa.com', httpOnly: false, secure: false },
      ],
    }),
  );
  result = await scan({
    config: parseConfig({ sources: { bundles: ['**/leaklens.bundle.json'] }, baseline: false }),
    baseDir: dir,
    cwd: dir,
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('réplica de la sesión de DemoQA', () => {
  it('detecta la contraseña dentro del JWT como crítica', () => {
    const f = result.findings.find((x) => x.detector === 'secrets' && x.tags.includes('dentro-de-jwt'));
    expect(f).toBeDefined();
    expect(f!.kind).toBe('Contraseña');
    expect(f!.severity).toBe('critical');
    expect(f!.location).toBe('cookie');
    expect(f!.fieldPath).toBe('cookie:token#jwt.password');
    expect(f!.masked).toBe('•••• (15 caracteres)');
  });

  it('detecta la cookie de sesión accesible desde JavaScript', () => {
    const f = result.findings.find((x) => x.detector === 'cookie-flags');
    expect(f?.masked).toBe('token');
    expect(f?.severity).toBe('high');
  });

  it('detecta que el token no vence', () => {
    const f = result.findings.find((x) => x.detector === 'jwt');
    expect(f?.tags).toContain('sin-expiracion');
  });

  it('no reporta cookies de analítica ni el nombre de usuario', () => {
    expect(result.findings.some((x) => x.key === '_ga' || x.key === 'userName' || x.key === 'expires')).toBe(false);
  });

  it('rompe el build y no escribe la contraseña ni el token en ningún reporte', () => {
    expect(result.failed).toBe(true);
    const out = path.join(dir, 'report');
    writeReports(result, out, ['html', 'json', 'sarif', 'junit']);
    for (const file of readdirSync(out)) {
      const content = readFileSync(path.join(out, file), 'utf8');
      expect(content).not.toContain(FAKE_PASS);
      expect(content).not.toContain(TOKEN);
    }
  });
});
