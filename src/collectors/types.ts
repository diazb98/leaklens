import type { Evidence, SourceKind } from '../core/types.js';

export interface CollectContext {
  /** Ruta relativa para mostrar en reportes. */
  display: string;
  /** Grupo por defecto: el directorio del archivo (una prueba = un directorio). */
  group: string;
  maxBodyBytes: number;
  /** Registra el nombre legible de una prueba para su grupo. */
  setGroupTitle(group: string, title: string): void;
  warn(message: string): void;
  ocr: { lang: string; langPath?: string };
}

export type Collector = (file: string, ctx: CollectContext) => AsyncIterable<Evidence>;

export type CollectorMap = Record<SourceKind, Collector>;
