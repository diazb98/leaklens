import { severityRank, type Finding, type ScanResult, type Severity } from '../core/types.js';
import { LOCATION_LABEL, SEVERITY_LABEL } from './labels.js';

/**
 * JUnit XML: cada hallazgo es un caso de prueba. Jenkins (`junit`), GitLab y
 * Azure DevOps los muestran en la pestaña de resultados de pruebas.
 *  - nuevo y ≥ failOn  → <failure>
 *  - nuevo y < failOn  → pasa, con el detalle en system-out
 *  - baseline/aceptado → <skipped>
 */

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function failsBuild(f: Finding, failOn: Severity | 'none'): boolean {
  return failOn !== 'none' && f.status === 'new' && severityRank(f.severity) >= severityRank(failOn);
}

function caseName(f: Finding): string {
  const where = [f.endpoint, f.fieldPath].filter(Boolean).join(' ');
  return `[${SEVERITY_LABEL[f.severity]}] ${f.title}${f.kind ? ` (${f.kind})` : ''} · ${LOCATION_LABEL[f.location]}${where ? ` · ${where}` : ''}`;
}

function detail(f: Finding): string {
  return [
    `Valor: ${f.masked}`,
    `Ubicación: ${LOCATION_LABEL[f.location]}`,
    f.endpoint ? `Endpoint: ${f.endpoint}` : '',
    f.fieldPath ? `Campo: ${f.fieldPath}` : '',
    `Ocurrencias: ${f.occurrences}`,
    f.tests.length ? `Pruebas: ${f.tests.join(' | ')}` : '',
    f.files.length ? `Archivos: ${f.files.join(', ')}` : '',
    ...f.notes,
    `Recomendación: ${f.recommendation}`,
    `Huella: ${f.fingerprint}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderJunit(result: ScanResult): string {
  const bySuite = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const list = bySuite.get(f.title) ?? [];
    list.push(f);
    bySuite.set(f.title, list);
  }
  const seconds = (result.durationMs / 1000).toFixed(3);
  let failures = 0;
  let skipped = 0;
  const suites: string[] = [];
  for (const [title, list] of bySuite) {
    let sf = 0;
    let ss = 0;
    const cases = list.map((f) => {
      const name = xml(caseName(f));
      const cls = `leaklens.${f.detector}`;
      if (f.status !== 'new') {
        ss++;
        const why = f.status === 'allowed' ? `Aceptado: ${f.allowReason ?? ''}` : 'En baseline';
        return `    <testcase classname="${cls}" name="${name}" time="0"><skipped message="${xml(why)}"/></testcase>`;
      }
      if (failsBuild(f, result.failOn)) {
        sf++;
        return `    <testcase classname="${cls}" name="${name}" time="0">\n      <failure message="${xml(`${f.title}: ${f.masked}`)}" type="${f.severity}">${xml(detail(f))}</failure>\n    </testcase>`;
      }
      return `    <testcase classname="${cls}" name="${name}" time="0"><system-out>${xml(detail(f))}</system-out></testcase>`;
    });
    failures += sf;
    skipped += ss;
    suites.push(
      `  <testsuite name="LeakLens · ${xml(title)}" tests="${list.length}" failures="${sf}" errors="0" skipped="${ss}" time="0">\n${cases.join('\n')}\n  </testsuite>`,
    );
  }
  if (!suites.length) {
    suites.push(
      `  <testsuite name="LeakLens" tests="1" failures="0" errors="0" skipped="0" time="${seconds}">\n    <testcase classname="leaklens" name="Sin fugas de datos sensibles" time="${seconds}"/>\n  </testsuite>`,
    );
  }
  const total = Math.max(1, result.findings.length);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="LeakLens" tests="${total}" failures="${failures}" errors="${result.errors.length}" skipped="${skipped}" time="${seconds}">\n` +
    suites.join('\n') +
    `\n</testsuites>\n`
  );
}
