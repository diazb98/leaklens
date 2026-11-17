import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Finding } from '../core/types.js';

/**
 * Baseline: hallazgos conocidos que no deben romper el build.
 * Permite adoptar LeakLens en un proyecto con deuda: falla solo lo nuevo.
 * Guarda huellas y metadatos, nunca valores.
 */

export interface BaselineEntry {
  fingerprint: string;
  detector: string;
  kind?: string;
  location: string;
  endpoint?: string;
  fieldPath?: string;
  severity: string;
  firstSeen: string;
}

export interface BaselineFile {
  leaklens: 1;
  generatedAt: string;
  findings: BaselineEntry[];
}

export function readBaseline(file: string): Map<string, BaselineEntry> {
  if (!existsSync(file)) return new Map();
  const data = JSON.parse(readFileSync(file, 'utf8')) as BaselineFile;
  if (!data || !Array.isArray(data.findings)) {
    throw new Error(`El baseline ${file} no tiene el formato esperado.`);
  }
  return new Map(data.findings.map((f) => [f.fingerprint, f]));
}

export function writeBaseline(file: string, findings: Finding[], previous = new Map<string, BaselineEntry>()): number {
  const now = new Date().toISOString();
  const entries: BaselineEntry[] = findings
    .filter((f) => f.status !== 'allowed')
    .map((f) => ({
      fingerprint: f.fingerprint,
      detector: f.detector,
      kind: f.kind,
      location: f.location,
      endpoint: f.endpoint,
      fieldPath: f.fieldPath,
      severity: f.severity,
      firstSeen: previous.get(f.fingerprint)?.firstSeen ?? now,
    }))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const out: BaselineFile = { leaklens: 1, generatedAt: now, findings: entries };
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return entries.length;
}
