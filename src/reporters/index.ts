import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ScanResult } from '../core/types.js';
import { renderHtml } from './html.js';
import { renderJson } from './json.js';
import { renderJunit } from './junit.js';
import { renderSarif } from './sarif.js';

export type ReportFormat = 'html' | 'json' | 'sarif' | 'junit';

export const REPORT_FILES: Record<ReportFormat, string> = {
  html: 'leaklens-report.html',
  json: 'leaklens-report.json',
  sarif: 'leaklens.sarif',
  junit: 'leaklens-junit.xml',
};

const RENDERERS: Record<ReportFormat, (r: ScanResult) => string> = {
  html: renderHtml,
  json: renderJson,
  sarif: renderSarif,
  junit: renderJunit,
};

export function writeReports(result: ScanResult, dir: string, formats: ReportFormat[]): string[] {
  mkdirSync(dir, { recursive: true });
  return formats.map((fmt) => {
    const file = path.join(dir, REPORT_FILES[fmt]);
    writeFileSync(file, RENDERERS[fmt](result));
    return file;
  });
}

export { renderHtml, renderJson, renderJunit, renderSarif };
