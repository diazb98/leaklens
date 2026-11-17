import { z } from 'zod';
import { DATA_CLASSES, LOCATIONS } from '../core/types.js';

const Level = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const LocationEnum = z.enum(LOCATIONS as [string, ...string[]]);
const DataClassEnum = z.enum(DATA_CLASSES as [string, ...string[]]);

export const SourcesSchema = z
  .object({
    har: z.array(z.string()).default([]),
    trace: z.array(z.string()).default([]),
    newman: z.array(z.string()).default([]),
    logs: z.array(z.string()).default([]),
    bundles: z.array(z.string()).default([]),
    images: z.array(z.string()).default([]),
  })
  .strict()
  .default({});

export const CustomDetectorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'usa minúsculas, números y guiones'),
    title: z.string().min(3),
    /** Expresión regular. Si tiene un grupo de captura, el grupo 1 es el valor. */
    pattern: z.string().min(1),
    flags: z.string().default('gi'),
    /** Si se indica, solo aplica cuando el nombre del campo coincide con alguna de estas regex. */
    keys: z.array(z.string()).optional(),
    dataClass: DataClassEnum.default('identity'),
    recommendation: z.string().optional(),
  })
  .strict();

export const AllowEntrySchema = z
  .object({
    detector: z.string().optional(),
    location: LocationEnum.optional(),
    /** Glob sobre el endpoint normalizado. Ej.: "POST **\/auth/login" */
    endpoint: z.string().optional(),
    /** Glob sobre la ruta del campo. Ej.: "$.cliente.email" */
    fieldPath: z.string().optional(),
    /** Hash del valor (requiere LEAKLENS_SALT fija). */
    valueHash: z.string().optional(),
    reason: z.string().min(3, 'explica por qué se acepta este hallazgo'),
  })
  .strict();

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    sources: SourcesSchema,
    countries: z.array(z.enum(['pe', 'co'])).default(['pe', 'co']),
    detectors: z
      .object({ disable: z.array(z.string()).default([]) })
      .strict()
      .default({}),
    /** Fuerza la severidad de un detector: { "pii-contact": "info" } */
    severityOverrides: z.record(z.string(), Level).default({}),
    customDetectors: z.array(CustomDetectorSchema).default([]),
    allowlist: z.array(AllowEntrySchema).default([]),
    baseline: z.union([z.string(), z.literal(false)]).default('.leaklens-baseline.json'),
    failOn: z.union([Level, z.literal('none')]).default('high'),
    output: z
      .object({
        dir: z.string().default('leaklens-report'),
        formats: z.array(z.enum(['html', 'json', 'sarif', 'junit'])).default(['html', 'json', 'sarif', 'junit']),
      })
      .strict()
      .default({}),
    ocr: z
      .object({
        enabled: z.boolean().default(false),
        lang: z.string().default('spa+eng'),
        langPath: z.string().optional(),
      })
      .strict()
      .default({}),
    /** Marca datos que la API devuelve pero ninguna pantalla muestra. */
    overexposure: z.boolean().default(true),
    maxBodyBytes: z.number().int().positive().default(5_000_000),
  })
  .strict();

export type LeakLensConfig = z.infer<typeof ConfigSchema>;
export type LeakLensConfigInput = z.input<typeof ConfigSchema>;
export type CustomDetectorConfig = z.infer<typeof CustomDetectorSchema>;
export type AllowEntry = z.infer<typeof AllowEntrySchema>;

/** Fuentes por defecto cuando no se configura ninguna. */
export const DEFAULT_SOURCES = {
  har: ['test-results/**/*.har', 'playwright-report/**/*.har'],
  trace: ['test-results/**/trace.zip'],
  newman: ['newman/**/*.json'],
  logs: [],
  bundles: ['test-results/**/leaklens.bundle.json', 'cypress/leaklens/**/leaklens.bundle.json', 'leaklens-bundles/**/*.bundle.json'],
  images: [],
};
