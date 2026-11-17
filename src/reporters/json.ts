import type { ScanResult } from '../core/types.js';

export function renderJson(result: ScanResult): string {
  return JSON.stringify({ reportFormat: 'leaklens-report-v1', ...result }, null, 2) + '\n';
}
