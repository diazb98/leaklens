/**
 * API programática de LeakLens.
 *
 *   import { scan, parseConfig, writeReports } from 'leaklens';
 *   const result = await scan({ config: parseConfig({ sources: { har: ['out/*.har'] } }) });
 */
export { scan, resolveSources, type ScanOptions } from './core/pipeline.js';
export { parseConfig, loadConfig, mergeConfig, ConfigError } from './config/load.js';
export { ConfigSchema, type LeakLensConfig, type LeakLensConfigInput, type CustomDetectorConfig, type AllowEntry } from './config/schema.js';
export { writeReports, renderHtml, renderJson, renderJunit, renderSarif, REPORT_FILES, type ReportFormat } from './reporters/index.js';
export { readBaseline, writeBaseline } from './policy/baseline.js';
export { SEVERITY_MATRIX, resolveSeverity } from './policy/severity.js';
export { BUILTIN_DETECTORS, buildDetectors, customDetector } from './detectors/index.js';
export { luhn, ibanValid, rucValid, nitValid, nitCheckDigit } from './validators/index.js';
export { setSalt } from './core/redact.js';
export type { LeakLensBundle, BundleNetworkEntry } from './core/bundle.js';
export { BUNDLE_FILENAME } from './core/bundle.js';
export * from './core/types.js';
export { VERSION } from './version.js';
