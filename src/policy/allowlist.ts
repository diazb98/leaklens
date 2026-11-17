import picomatch from 'picomatch';
import type { AllowEntry } from '../config/schema.js';
import type { Finding } from '../core/types.js';

/**
 * Excepciones aceptadas conscientemente, cada una con su motivo.
 * A diferencia del baseline, la allowlist vive en la configuración y se revisa en code review.
 */
export function compileAllowlist(entries: AllowEntry[]): (f: Finding) => AllowEntry | undefined {
  const compiled = entries.map((e) => ({
    entry: e,
    endpoint: e.endpoint ? picomatch(e.endpoint, { nocase: true, dot: true }) : undefined,
    field: e.fieldPath ? picomatch(e.fieldPath, { nocase: true, dot: true, literalBrackets: true }) : undefined,
  }));
  return (f) => {
    for (const c of compiled) {
      const e = c.entry;
      if (e.detector && e.detector !== f.detector) continue;
      if (e.location && e.location !== f.location) continue;
      if (c.endpoint && !(f.endpoint && c.endpoint(f.endpoint))) continue;
      if (c.field && !(f.fieldPath && c.field(f.fieldPath))) continue;
      if (e.valueHash && e.valueHash !== f.valueHash) continue;
      return e;
    }
    return undefined;
  };
}
