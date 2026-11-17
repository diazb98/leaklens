/**
 * Modelo central de LeakLens.
 *
 * Collectors → Evidence → Detectors → Match → Policy → Finding → Reporters
 *
 * Regla de oro: `Evidence.text` y `Match.value` solo viven en memoria.
 * Nada que salga a disco puede contener el valor original: los reporters
 * únicamente reciben `Finding`, que lleva el valor enmascarado y un hash.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** De menor a mayor. */
export const SEVERITY_ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

export function bumpSeverity(s: Severity, steps = 1): Severity {
  const i = Math.min(SEVERITY_ORDER.length - 1, severityRank(s) + steps);
  return SEVERITY_ORDER[i]!;
}

export type SourceKind = 'har' | 'trace' | 'newman' | 'log' | 'bundle' | 'image';

export type Location =
  | 'url'
  | 'query'
  | 'request-header'
  | 'request-body'
  | 'response-header'
  | 'response-body'
  | 'cookie'
  | 'local-storage'
  | 'session-storage'
  | 'console'
  | 'log-line'
  | 'dom'
  | 'screenshot';

export const LOCATIONS: readonly Location[] = [
  'url', 'query', 'request-header', 'request-body', 'response-header', 'response-body',
  'cookie', 'local-storage', 'session-storage', 'console', 'log-line', 'dom', 'screenshot',
];

/** Familia del dato. La severidad final sale de la matriz familia × ubicación. */
export type DataClass = 'card' | 'card-secret' | 'credential' | 'session' | 'identity' | 'contact';

export const DATA_CLASSES: readonly DataClass[] = [
  'card', 'card-secret', 'credential', 'session', 'identity', 'contact',
];

export interface Evidence {
  source: SourceKind;
  location: Location;
  /** Archivo de origen, relativo al directorio de trabajo. */
  file: string;
  /** Agrupa la evidencia de una misma prueba (para detectar sobreexposición). */
  group: string;
  /** Nombre de la prueba o request, si se conoce. */
  test?: string;
  /** Endpoint normalizado: `GET banca.test/api/clientes/{id}`. */
  endpoint?: string;
  /** Ruta del campo: `$.tarjetas[*].numero`, `?pan`, `L42`. */
  fieldPath?: string;
  /** Nombre del campo, header, cookie o clave de storage. */
  key?: string;
  /** Datos adicionales del collector (flags de cookies, método HTTP…). */
  meta?: Record<string, unknown>;
  /** Contenido a analizar. Nunca se escribe a disco. */
  text: string;
}

export interface Match {
  detector: string;
  /** Título legible: "Número de tarjeta (PAN)". */
  title: string;
  /** Subtipo: "Visa", "DNI (PE)", "alg: none"… */
  kind?: string;
  dataClass: DataClass;
  /** Valor original (solo en memoria). */
  value: string;
  /** Valor enmascarado, seguro para mostrar. */
  masked: string;
  /** Fuerza una severidad mínima, aunque la ubicación sea "esperada". */
  forceSeverity?: Severity;
  tags?: string[];
  note?: string;
}

export interface DetectContext {
  countries: ReadonlyArray<'pe' | 'co'>;
}

export interface Detector {
  id: string;
  name: string;
  description: string;
  recommendation: string;
  detect(e: Evidence, ctx: DetectContext): Match[];
}

export type FindingStatus = 'new' | 'baselined' | 'allowed';

export interface Finding {
  /** Huella estable entre ejecuciones (no incluye el valor). */
  fingerprint: string;
  detector: string;
  title: string;
  kind?: string;
  dataClass: DataClass;
  severity: Severity;
  location: Location;
  source: SourceKind;
  endpoint?: string;
  fieldPath?: string;
  key?: string;
  masked: string;
  /** HMAC del valor: permite correlacionar sin exponerlo. */
  valueHash: string;
  tags: string[];
  notes: string[];
  recommendation: string;
  occurrences: number;
  files: string[];
  tests: string[];
  status: FindingStatus;
  allowReason?: string;
}

export interface ScanError {
  file: string;
  message: string;
}

export interface ScanResult {
  tool: { name: string; version: string };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  failOn: Severity | 'none';
  failed: boolean;
  countries: Array<'pe' | 'co'>;
  stats: {
    files: Record<SourceKind, number>;
    evidences: number;
    bySeverity: Record<Severity, number>;
    newBySeverity: Record<Severity, number>;
    byStatus: Record<FindingStatus, number>;
  };
  findings: Finding[];
  errors: ScanError[];
  warnings: string[];
}
