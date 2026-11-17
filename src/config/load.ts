import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigSchema, DEFAULT_SOURCES, type LeakLensConfig, type LeakLensConfigInput } from './schema.js';

export interface LoadedConfig {
  config: LeakLensConfig;
  /** Directorio contra el que se resuelven globs y rutas. */
  baseDir: string;
  configFile?: string;
}

export class ConfigError extends Error {}

export const CONFIG_FILENAME = 'leaklens.config.json';

export function parseConfig(input: unknown, origin = 'configuración'): LeakLensConfig {
  const parsed = ConfigSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`La ${origin} no es válida:\n${issues}`);
  }
  for (const d of parsed.data.customDetectors) {
    try {
      new RegExp(d.pattern, d.flags);
    } catch (e) {
      throw new ConfigError(`El detector personalizado "${d.id}" tiene una regex inválida: ${(e as Error).message}`);
    }
  }
  return parsed.data;
}

export function loadConfig(configPath?: string, cwd = process.cwd()): LoadedConfig {
  const file = configPath
    ? path.resolve(cwd, configPath)
    : existsSync(path.join(cwd, CONFIG_FILENAME))
      ? path.join(cwd, CONFIG_FILENAME)
      : undefined;

  if (configPath && (!file || !existsSync(file))) {
    throw new ConfigError(`No encontré el archivo de configuración: ${configPath}`);
  }

  let raw: unknown = {};
  if (file) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new ConfigError(`No pude leer ${path.relative(cwd, file)}: ${(e as Error).message}`);
    }
  }
  const config = parseConfig(raw, file ? `configuración de ${path.relative(cwd, file) || file}` : 'configuración');
  return { config, baseDir: file ? path.dirname(file) : cwd, configFile: file };
}

/** Aplica flags de la CLI sobre la configuración del archivo. */
export function mergeConfig(base: LeakLensConfig, override: LeakLensConfigInput): LeakLensConfig {
  const sources = { ...base.sources };
  if (override.sources) {
    for (const [k, v] of Object.entries(override.sources)) {
      if (v && v.length) sources[k as keyof typeof sources] = v;
    }
  }
  return parseConfig({
    ...base,
    ...stripUndefined(override),
    sources,
    output: { ...base.output, ...stripUndefined(override.output ?? {}) },
    ocr: { ...base.ocr, ...stripUndefined(override.ocr ?? {}) },
    detectors: { ...base.detectors, ...stripUndefined(override.detectors ?? {}) },
  });
}

export function hasAnySource(config: LeakLensConfig): boolean {
  return Object.values(config.sources).some((v) => v.length > 0);
}

export function withDefaultSources(config: LeakLensConfig): LeakLensConfig {
  if (hasAnySource(config)) return config;
  return { ...config, sources: { ...DEFAULT_SOURCES } };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
