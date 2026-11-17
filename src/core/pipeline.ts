import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { COLLECTORS, terminateOcr, type CollectContext } from '../collectors/index.js';
import type { LeakLensConfig } from '../config/schema.js';
import { buildDetectors } from '../detectors/index.js';
import { expandJwtPayloads } from '../detectors/jwt.js';
import { compileAllowlist } from '../policy/allowlist.js';
import { readBaseline } from '../policy/baseline.js';
import { LOCATION_RISK, resolveSeverity } from '../policy/severity.js';
import { VERSION } from '../version.js';
import { embeddedJsonLeaves } from './body.js';
import { normalizeFieldPath } from './endpoint.js';
import { hashValue, isSaltEphemeral, scrubFreeText } from './redact.js';
import {
  bumpSeverity,
  SEVERITY_ORDER,
  severityRank,
  type Detector,
  type Evidence,
  type Finding,
  type FindingStatus,
  type Match,
  type ScanResult,
  type Severity,
  type SourceKind,
} from './types.js';

export interface ScanOptions {
  config: LeakLensConfig;
  /** Directorio contra el que se resuelven los globs (el del archivo de configuración). */
  baseDir?: string;
  /** Directorio para mostrar rutas relativas en los reportes. */
  cwd?: string;
  onFile?: (kind: SourceKind, file: string) => void;
}

const SOURCE_KEYS: Array<[keyof LeakLensConfig['sources'], SourceKind]> = [
  ['har', 'har'],
  ['trace', 'trace'],
  ['newman', 'newman'],
  ['logs', 'log'],
  ['bundles', 'bundle'],
  ['images', 'image'],
];

const MAX_LISTED = 10;
const OVEREXPOSURE_CLASSES = new Set(['card', 'card-secret', 'identity', 'contact']);

export async function resolveSources(config: LeakLensConfig, baseDir: string): Promise<Array<{ kind: SourceKind; file: string }>> {
  const seen = new Set<string>();
  const out: Array<{ kind: SourceKind; file: string }> = [];
  for (const [key, kind] of SOURCE_KEYS) {
    const patterns = config.sources[key];
    if (!patterns.length) continue;
    const literal: string[] = [];
    const globs: string[] = [];
    for (const p of patterns) {
      const abs = path.resolve(baseDir, p);
      if (!fg.isDynamicPattern(p) && existsSync(abs)) literal.push(abs);
      else globs.push(path.isAbsolute(p) ? fg.convertPathToPattern(p) : p.replace(/\\/g, '/'));
    }
    const found = globs.length
      ? await fg(globs, { cwd: baseDir, absolute: true, onlyFiles: true, ignore: ['**/node_modules/**', '**/.git/**'] })
      : [];
    for (const f of [...literal, ...found]) {
      const norm = path.resolve(f);
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({ kind, file: norm });
    }
  }
  return out;
}

function sha(parts: Array<string | undefined>): string {
  return createHash('sha256').update(parts.map((p) => p ?? '').join('␟')).digest('hex').slice(0, 20);
}

/** Plantilla de una línea de log/consola sin datos variables: misma línea en otra ejecución = misma huella. */
function lineTemplate(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, 'JWT')
    .replace(/[A-Za-z0-9+/_-]{20,}={0,2}/g, 'TOKEN')
    .replace(/\d+/g, '#')
    .slice(0, 160);
}

/** Evidencias derivadas del JSON incrustado en una línea de consola o de log. */
function expandEmbeddedJson(e: Evidence): Evidence[] {
  if ((e.location !== 'console' && e.location !== 'log-line') || !e.text.includes('{"')) return [];
  return embeddedJsonLeaves(e.text).map((leaf) => ({
    ...e,
    key: leaf.key,
    text: leaf.value,
    meta: { ...e.meta, lineText: e.text },
  }));
}

function fingerprintFor(e: Evidence, m: Match): string {
  let where: string | undefined;
  // Para hojas de JSON incrustado, la huella es la de su línea original.
  const line = typeof e.meta?.lineText === 'string' ? e.meta.lineText : e.text;
  switch (e.location) {
    case 'log-line':
      where = `${path.basename(e.file)}:${sha([lineTemplate(line)])}`;
      break;
    case 'console':
      // La misma consola llega desde la traza y desde el bundle: la huella no depende del archivo.
      where = sha([lineTemplate(line)]);
      break;
    case 'screenshot':
      where = path.basename(e.file).replace(/\d+/g, '#');
      break;
    case 'dom':
      where = e.endpoint;
      break;
    case 'request-header':
      // El mismo token viaja en todas las requests: un solo hallazgo, no uno por endpoint.
      if (e.meta?.insideJwt || e.key === 'authorization') {
        where = normalizeFieldPath(e.fieldPath);
        break;
      }
      where = `${e.endpoint ?? ''}|${normalizeFieldPath(e.fieldPath) ?? ''}`;
      break;
    default:
      where = `${e.endpoint ?? ''}|${normalizeFieldPath(e.fieldPath) ?? ''}`;
  }
  const kind = m.detector === 'cookie-flags' ? `${m.kind}|${m.value}` : m.kind;
  return sha([m.detector, kind, e.location, where]);
}

/** Dígitos contiguos aunque la pantalla los muestre con espacios, puntos o guiones. */
function digitsJoined(text: string): string {
  return text.replace(/(?<=\d)[\s.\-•*]+(?=\d)/g, '');
}

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const { config } = opts;
  const baseDir = opts.baseDir ?? process.cwd();
  const cwd = opts.cwd ?? process.cwd();

  const warnings: string[] = [];
  const errors: ScanResult['errors'] = [];
  const files: Record<SourceKind, number> = { har: 0, trace: 0, newman: 0, log: 0, bundle: 0, image: 0 };
  const detectors: Detector[] = buildDetectors(config.detectors.disable, config.customDetectors);
  const detectCtx = { countries: config.countries };
  const recommendations = new Map(detectors.map((d) => [d.id, d.recommendation]));

  const findings = new Map<string, Finding>();
  const groupTitles = new Map<string, string>();
  const domText = new Map<string, string[]>();
  const exposureCandidates: Array<{ fingerprint: string; group: string; value: string; digits: boolean }> = [];
  let evidences = 0;

  if (isSaltEphemeral() && config.allowlist.some((a) => a.valueHash)) {
    warnings.push('La allowlist usa valueHash pero LEAKLENS_SALT no está definida: los hashes cambian en cada ejecución y esas excepciones no van a coincidir.');
  }

  let sources = await resolveSources(config, baseDir);
  if (sources.some((s) => s.kind === 'image') && !config.ocr.enabled) {
    warnings.push('Hay capturas configuradas pero el OCR está desactivado (ocr.enabled = false o falta --ocr). Se omitieron.');
    sources = sources.filter((s) => s.kind !== 'image');
  }
  if (!sources.length) warnings.push('No se encontró ningún archivo para analizar. Revisa las rutas de "sources".');

  const record = (e: Evidence, m: Match) => {
    const override = config.severityOverrides[m.detector];
    const severity = resolveSeverity(m.dataClass, e.location, m.forceSeverity, override);
    if (!severity) return;

    const fingerprint = fingerprintFor(e, m);
    // El nombre legible del grupo puede llegar después (el bundle se lee tras el HAR): se resuelve al final.
    const testName = e.test ?? e.group;
    let f = findings.get(fingerprint);
    if (!f) {
      const notes: string[] = [];
      if (m.note) notes.push(m.note);
      notes.push(LOCATION_RISK[e.location]);
      if (e.meta?.insideJwt) {
        notes.push('El dato viaja dentro de un JWT: los claims solo están codificados en base64, cualquiera puede leerlos.');
      }
      f = {
        fingerprint,
        detector: m.detector,
        title: m.title,
        kind: m.kind,
        dataClass: m.dataClass,
        severity,
        location: e.location,
        source: e.source,
        endpoint: e.endpoint,
        fieldPath: e.location === 'log-line' ? `${e.file}:${e.fieldPath?.slice(1)}` : normalizeFieldPath(e.fieldPath),
        key: e.key,
        masked: m.masked,
        valueHash: hashValue(m.value),
        tags: [...(m.tags ?? []), ...(e.meta?.insideJwt ? ['dentro-de-jwt'] : [])],
        notes,
        recommendation: recommendations.get(m.detector) ?? '',
        occurrences: 0,
        files: [],
        tests: [],
        status: 'new',
      };
      findings.set(fingerprint, f);
    } else if (severityRank(severity) > severityRank(f.severity)) {
      f.severity = severity;
    }
    f.occurrences++;
    if (f.files.length < MAX_LISTED && !f.files.includes(e.file)) f.files.push(e.file);
    if (f.tests.length < MAX_LISTED && !f.tests.includes(testName)) f.tests.push(testName);

    if (config.overexposure && e.location === 'response-body' && OVEREXPOSURE_CLASSES.has(m.dataClass)) {
      const digits = /^\d+$/.test(m.value);
      exposureCandidates.push({ fingerprint, group: e.group, value: digits ? m.value : m.value.toLowerCase(), digits });
    }
  };

  for (const { kind, file } of sources) {
    files[kind]++;
    opts.onFile?.(kind, file);
    const display = path.relative(cwd, file).split(path.sep).join('/') || path.basename(file);
    const ctx: CollectContext = {
      display,
      group: path.posix.dirname(display),
      maxBodyBytes: config.maxBodyBytes,
      setGroupTitle: (g, title) => groupTitles.set(g, title),
      warn: (msg) => warnings.push(msg),
      ocr: config.ocr,
    };
    try {
      for await (const e of COLLECTORS[kind](file, ctx)) {
        evidences++;
        if (e.location === 'dom' || e.location === 'screenshot') {
          const list = domText.get(e.group) ?? [];
          list.push(e.text);
          domText.set(e.group, list);
        }
        const isSetCookie = e.location === 'response-header' && e.key === 'set-cookie';
        for (const ev of [e, ...expandJwtPayloads(e), ...expandEmbeddedJson(e)]) {
          for (const d of detectors) {
            if (isSetCookie && d.id !== 'cookie-flags') continue;
            let matches: Match[];
            try {
              matches = d.detect(ev, detectCtx);
            } catch (err) {
              warnings.push(`El detector "${d.id}" falló en ${display}: ${(err as Error).message}`);
              continue;
            }
            for (const m of matches) record(ev, m);
          }
        }
      }
    } catch (err) {
      errors.push({ file: display, message: scrubFreeText((err as Error).message) });
    }
  }
  await terminateOcr();

  // Sobreexposición: la API devolvió el dato completo, pero la pantalla de esa prueba nunca lo mostró.
  const overexposed = new Set<string>();
  for (const c of exposureCandidates) {
    const texts = domText.get(c.group);
    if (!texts?.length || overexposed.has(c.fingerprint)) continue;
    const shown = texts.some((t) => (c.digits ? digitsJoined(t).includes(c.value) : t.toLowerCase().includes(c.value)));
    if (!shown) overexposed.add(c.fingerprint);
  }
  for (const fp of overexposed) {
    const f = findings.get(fp)!;
    f.tags.push('sobreexpuesto');
    f.severity = bumpSeverity(f.severity === 'info' ? 'low' : f.severity);
    f.notes.unshift('Sobreexposición: la API devuelve el dato completo, pero ninguna pantalla de la prueba lo muestra. Si el front no lo usa, el backend no debería enviarlo.');
  }

  for (const f of findings.values()) {
    f.tests = [...new Set(f.tests.map((t) => scrubFreeText(groupTitles.get(t) ?? t)))];
  }

  // Allowlist y baseline.
  const allow = compileAllowlist(config.allowlist);
  let baseline = new Map<string, unknown>();
  if (config.baseline) {
    const file = path.resolve(baseDir, config.baseline);
    try {
      baseline = readBaseline(file);
    } catch (err) {
      warnings.push((err as Error).message);
    }
  }
  for (const f of findings.values()) {
    const a = allow(f);
    if (a) {
      f.status = 'allowed';
      f.allowReason = a.reason;
    } else if (baseline.has(f.fingerprint)) {
      f.status = 'baselined';
    }
  }

  const list = [...findings.values()].sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      severityRank(b.severity) - severityRank(a.severity) ||
      a.detector.localeCompare(b.detector) ||
      (a.endpoint ?? '').localeCompare(b.endpoint ?? ''),
  );

  const zero = () => Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  const bySeverity = zero();
  const newBySeverity = zero();
  const byStatus: Record<FindingStatus, number> = { new: 0, baselined: 0, allowed: 0 };
  for (const f of list) {
    bySeverity[f.severity]++;
    byStatus[f.status]++;
    if (f.status === 'new') newBySeverity[f.severity]++;
  }
  const failed =
    config.failOn !== 'none' &&
    list.some((f) => f.status === 'new' && severityRank(f.severity) >= severityRank(config.failOn as Severity));

  const finished = Date.now();
  return {
    tool: { name: 'LeakLens', version: VERSION },
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    failOn: config.failOn,
    failed,
    countries: [...config.countries],
    stats: { files, evidences, bySeverity, newBySeverity, byStatus },
    findings: list,
    errors,
    warnings,
  };
}

function statusRank(s: FindingStatus): number {
  return s === 'new' ? 0 : s === 'baselined' ? 1 : 2;
}
