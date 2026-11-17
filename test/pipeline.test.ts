import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.js';
import { scan } from '../src/core/pipeline.js';
import type { ScanResult } from '../src/core/types.js';
import { readBaseline, writeBaseline } from '../src/policy/baseline.js';
import { writeReports } from '../src/reporters/index.js';

/**
 * Corpus: examples/sample-results (generado por scripts/generate-samples.mjs).
 * Valores sembrados que NUNCA deben aparecer en un reporte.
 */
const PLANTED = ['4111111111111111', '4111 1111 1111 1111', '5555555555554444', '378282246310005', '46027897', 'Secreta123!', 'AKIAIOSFODNN7EXAMPLE', '482915', '00219300123456789012', '10460278975', '1020304050', 's3ss10n-4b9f2c71d8e04a6f'];

const examples = path.resolve(__dirname, '..', 'examples');
const baseConfig = {
  sources: {
    har: ['sample-results/**/*.har'],
    bundles: ['sample-results/**/leaklens.bundle.json'],
    newman: ['sample-results/newman/*.json'],
    logs: ['sample-results/logs/*.log'],
  },
  baseline: false as const,
};

let tmp: string;
let result: ScanResult;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'leaklens-'));
  result = await scan({ config: parseConfig(baseConfig), baseDir: examples, cwd: examples });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const find = (pred: (f: ScanResult['findings'][number]) => boolean) => result.findings.filter(pred);

describe('pipeline sobre el corpus de ejemplo', () => {
  it('lee todas las fuentes sin errores', () => {
    expect(result.errors).toEqual([]);
    expect(result.stats.files).toMatchObject({ har: 1, bundle: 1, newman: 1, log: 1 });
  });

  it('PAN en query string es crítico', () => {
    const f = find((f) => f.detector === 'pan' && f.location === 'query');
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('critical');
    expect(f[0]!.fieldPath).toBe('?pan');
  });

  it('marca sobreexposición: la API devuelve datos que la pantalla no muestra', () => {
    const over = find((f) => f.tags.includes('sobreexpuesto')).map((f) => f.fieldPath);
    expect(over).toEqual(expect.arrayContaining(['$.tarjetas[*].numero', '$.tarjetas[*].cvv', '$.dni', '$.cuentaCci']));
  });

  it('no marca como sobreexpuesto lo que la pantalla sí muestra', () => {
    const email = find((f) => f.fieldPath === '$.email');
    expect(email[0]?.tags ?? []).not.toContain('sobreexpuesto');
  });

  it('conserva la precisión del PAN enviado como número JSON', () => {
    const f = find((f) => f.fieldPath === '$.tarjetas[*].numero');
    expect(f[0]!.masked).toBe('•••• •••• •••• 1111');
  });

  it('JWT con alg none en la URL es crítico', () => {
    const f = find((f) => f.detector === 'jwt' && f.tags.includes('alg-none'));
    expect(f[0]!.severity).toBe('critical');
  });

  it('ubicaciones esperadas no generan hallazgos', () => {
    // Contraseña en el body del login y JWT en el header Authorization.
    expect(find((f) => f.detector === 'secrets' && f.location === 'request-body')).toHaveLength(0);
    expect(find((f) => f.detector === 'jwt' && f.location === 'request-header')).toHaveLength(0);
  });

  it('el DNI dentro del JWT es un solo hallazgo, no uno por endpoint', () => {
    const f = find((f) => f.tags.includes('dentro-de-jwt') && f.location === 'request-header');
    expect(f).toHaveLength(1);
    expect(f[0]!.occurrences).toBeGreaterThan(1);
  });

  it('no reporta ruido: timestamps, RUC/NIT de empresa, cookies de analítica, UUIDs', () => {
    const text = JSON.stringify(result.findings);
    expect(find((f) => f.endpoint?.includes('/api/estado') ?? false)).toHaveLength(0);
    expect(find((f) => !!f.endpoint?.includes('/api/proveedores') && f.detector === 'national-id')).toHaveLength(0);
    expect(find((f) => f.endpoint?.includes('/v1/empresas') ?? false)).toHaveLength(0);
    expect(find((f) => f.key === '_ga')).toHaveLength(0);
    expect(text).not.toContain('PAG-20261117');
  });

  it('analiza JSON incrustado en la consola sin duplicar el hallazgo', () => {
    const pans = find((f) => f.detector === 'pan' && f.location === 'console');
    expect(pans).toHaveLength(1);
  });

  it('detecta documentos de Colombia en Newman', () => {
    const kinds = find((f) => f.source === 'newman' && f.detector === 'national-id').map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['Cédula (CO)', 'NIT (CO)']));
  });

  it('usa el nombre de la prueba del bundle para los hallazgos del HAR', () => {
    const f = find((f) => f.fieldPath === '$.dni');
    expect(f[0]!.tests[0]).toContain('el cliente ve su perfil');
  });

  it('falla con umbral alto', () => {
    expect(result.failed).toBe(true);
  });
});

describe('reportes', () => {
  it('ningún reporte contiene valores sensibles completos', () => {
    const files = writeReports(result, tmp, ['html', 'json', 'sarif', 'junit']);
    expect(files).toHaveLength(4);
    for (const file of readdirSync(tmp)) {
      const content = readFileSync(path.join(tmp, file), 'utf8');
      for (const raw of PLANTED) expect(content, `${file} contiene ${raw.slice(0, 3)}…`).not.toContain(raw);
    }
  });

  it('SARIF y JUnit tienen la estructura esperada', () => {
    const sarif = JSON.parse(readFileSync(path.join(tmp, 'leaklens.sarif'), 'utf8'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results.length).toBe(result.findings.length);
    const junit = readFileSync(path.join(tmp, 'leaklens-junit.xml'), 'utf8');
    const failures = Number(/<testsuites[^>]*failures="(\d+)"/.exec(junit)![1]);
    const expected = result.findings.filter((f) => f.status === 'new' && ['critical', 'high'].includes(f.severity)).length;
    expect(failures).toBe(expected);
  });
});

describe('baseline y allowlist', () => {
  it('después del baseline, el build pasa y solo fallan hallazgos nuevos', async () => {
    const file = path.join(tmp, 'baseline.json');
    writeBaseline(file, result.findings);
    const saved = readFileSync(file, 'utf8');
    for (const raw of PLANTED) expect(saved).not.toContain(raw);
    expect(readBaseline(file).size).toBe(result.findings.length);

    const again = await scan({ config: parseConfig({ ...baseConfig, baseline: file }), baseDir: examples, cwd: examples });
    expect(again.failed).toBe(false);
    expect(again.stats.byStatus.new).toBe(0);
    expect(again.stats.byStatus.baselined).toBe(result.findings.length);
  });

  it('la allowlist exige un motivo y marca el hallazgo como aceptado', async () => {
    expect(() => parseConfig({ allowlist: [{ detector: 'pan' }] })).toThrow(/motivo|reason|explica/i);
    const allowed = await scan({
      config: parseConfig({ ...baseConfig, allowlist: [{ detector: 'pan', location: 'request-body', reason: 'Pago directo a la pasarela certificada PCI' }] }),
      baseDir: examples,
      cwd: examples,
    });
    const f = allowed.findings.find((f) => f.detector === 'pan' && f.location === 'request-body')!;
    expect(f.status).toBe('allowed');
    expect(f.allowReason).toContain('PCI');
  });

  it('severityOverrides y detectores desactivados', async () => {
    const r = await scan({
      config: parseConfig({ ...baseConfig, detectors: { disable: ['contact'] }, severityOverrides: { 'cookie-flags': 'low' } }),
      baseDir: examples,
      cwd: examples,
    });
    expect(r.findings.some((f) => f.detector === 'contact')).toBe(false);
    expect(r.findings.filter((f) => f.detector === 'cookie-flags').every((f) => f.severity === 'low')).toBe(true);
  });

  it('detectores personalizados', async () => {
    const r = await scan({
      config: parseConfig({
        ...baseConfig,
        customDetectors: [{ id: 'referencia-pago', title: 'Referencia de pago', pattern: '\\bPAG-(\\d{8}-\\d{4})\\b', dataClass: 'identity' }],
      }),
      baseDir: examples,
      cwd: examples,
    });
    expect(r.findings.some((f) => f.detector === 'referencia-pago')).toBe(true);
  });
});
