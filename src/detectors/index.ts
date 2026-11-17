import type { CustomDetectorConfig } from '../config/schema.js';
import { maskTail } from '../core/redact.js';
import type { DataClass, Detector, Match } from '../core/types.js';
import { accountsDetector } from './accounts.js';
import { contactDetector } from './contact.js';
import { cookieFlagsDetector } from './cookie-flags.js';
import { cvvDetector } from './cvv.js';
import { jwtDetector } from './jwt.js';
import { normKey } from './keys.js';
import { nationalIdDetector } from './national-id.js';
import { panDetector } from './pan.js';
import { secretsDetector } from './secrets.js';

export const BUILTIN_DETECTORS: readonly Detector[] = [
  panDetector,
  cvvDetector,
  secretsDetector,
  jwtDetector,
  cookieFlagsDetector,
  nationalIdDetector,
  accountsDetector,
  contactDetector,
];

export function customDetector(cfg: CustomDetectorConfig): Detector {
  const keyRes = cfg.keys?.map((k) => new RegExp(k, 'i'));
  const flags = cfg.flags.includes('g') ? cfg.flags : cfg.flags + 'g';
  return {
    id: cfg.id,
    name: cfg.title,
    description: `Detector personalizado: ${cfg.title}`,
    recommendation: cfg.recommendation ?? 'Revisa si este dato debe estar en esta ubicación.',
    detect(e) {
      if (keyRes && !keyRes.some((r) => r.test(e.key ?? '') || r.test(normKey(e.key)))) return [];
      const re = new RegExp(cfg.pattern, flags);
      const out: Match[] = [];
      for (const m of e.text.matchAll(re)) {
        const value = m[1] ?? m[0];
        if (!value) continue;
        out.push({
          detector: cfg.id,
          title: cfg.title,
          dataClass: cfg.dataClass as DataClass,
          value,
          masked: maskTail(value, 3),
        });
      }
      return out;
    },
  };
}

export function buildDetectors(disable: string[], custom: CustomDetectorConfig[]): Detector[] {
  const off = new Set(disable);
  return [...BUILTIN_DETECTORS.filter((d) => !off.has(d.id)), ...custom.map(customDetector)];
}

export {
  accountsDetector,
  contactDetector,
  cookieFlagsDetector,
  cvvDetector,
  jwtDetector,
  nationalIdDetector,
  panDetector,
  secretsDetector,
};
