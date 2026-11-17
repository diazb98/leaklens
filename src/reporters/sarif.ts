import type { Finding, ScanResult, Severity } from '../core/types.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';
import { LOCATION_LABEL, SEVERITY_LABEL } from './labels.js';

/**
 * SARIF 2.1.0: lo leen Jenkins (Warnings NG), GitHub Code Scanning, GitLab y Azure DevOps.
 */

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

/** security-severity (0–10) que usan GitHub y otras herramientas para ordenar. */
const SCORE: Record<Severity, string> = { critical: '9.5', high: '8.0', medium: '5.5', low: '3.0', info: '1.0' };

function ruleId(f: Finding): string {
  return `leaklens/${f.detector}`;
}

export function renderSarif(result: ScanResult): string {
  const detectors = new Map(BUILTIN_DETECTORS.map((d) => [d.id, d]));
  const ruleIds = [...new Set(result.findings.map((f) => f.detector))];
  const rules = ruleIds.map((id) => {
    const d = detectors.get(id);
    const sample = result.findings.find((f) => f.detector === id)!;
    return {
      id: `leaklens/${id}`,
      name: d?.name ?? sample.title,
      shortDescription: { text: d?.name ?? sample.title },
      fullDescription: { text: d?.description ?? sample.title },
      help: { text: d?.recommendation ?? sample.recommendation },
      properties: { tags: ['security', 'privacy', 'data-leak'] },
    };
  });

  const results = result.findings.map((f) => ({
    ruleId: ruleId(f),
    level: LEVEL[f.severity],
    message: {
      text:
        `${f.title}${f.kind ? ` (${f.kind})` : ''} en ${LOCATION_LABEL[f.location]}` +
        `${f.endpoint ? ` · ${f.endpoint}` : ''}${f.fieldPath ? ` · ${f.fieldPath}` : ''}` +
        ` · valor ${f.masked} · ${f.occurrences} ocurrencia(s) · severidad ${SEVERITY_LABEL[f.severity]}`,
    },
    locations: [
      {
        physicalLocation: { artifactLocation: { uri: f.files[0] ?? 'unknown' } },
        logicalLocations: [{ name: f.endpoint ?? f.location, fullyQualifiedName: [f.endpoint, f.fieldPath].filter(Boolean).join(' ') || f.location }],
      },
    ],
    partialFingerprints: { leaklens: f.fingerprint },
    baselineState: f.status === 'new' ? 'new' : 'unchanged',
    suppressions: f.status === 'allowed' ? [{ kind: 'external', justification: f.allowReason ?? '' }] : undefined,
    properties: {
      severity: f.severity,
      'security-severity': SCORE[f.severity],
      location: f.location,
      tags: f.tags,
      status: f.status,
      tests: f.tests,
    },
  }));

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'LeakLens',
            version: result.tool.version,
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: result.errors.length === 0,
            startTimeUtc: result.startedAt,
            endTimeUtc: result.finishedAt,
            toolExecutionNotifications: result.errors.map((e) => ({ level: 'error', message: { text: `${e.file}: ${e.message}` } })),
          },
        ],
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + '\n';
}
