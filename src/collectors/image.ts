import path from 'node:path';
import type { Evidence } from '../core/types.js';
import type { CollectContext } from './types.js';

/**
 * OCR de capturas de pantalla con tesseract.js (dependencia opcional).
 * Las evidencias de prueba, los tickets y los reportes suelen llevar capturas
 * con datos completos que ningún análisis de red ve.
 */

interface OcrWorker {
  recognize(image: string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}

let workerPromise: Promise<OcrWorker> | undefined;
let workerKey = '';

async function getWorker(lang: string, langPath?: string): Promise<OcrWorker> {
  const key = `${lang}|${langPath ?? ''}`;
  if (workerPromise && workerKey === key) return workerPromise;
  workerKey = key;
  workerPromise = (async () => {
    let mod: { createWorker: (lang: string, oem?: number, options?: Record<string, unknown>) => Promise<OcrWorker> };
    try {
      const name = 'tesseract.js';
      mod = (await import(name)) as typeof mod;
    } catch {
      throw new Error('El OCR necesita tesseract.js. Instálalo con: npm i -D tesseract.js');
    }
    const create = mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker;
    return create(lang, 1, langPath ? { langPath } : {});
  })();
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    await (await workerPromise).terminate();
  } catch {
    /* el worker nunca arrancó */
  }
  workerPromise = undefined;
}

export async function* collectImage(file: string, ctx: CollectContext): AsyncGenerator<Evidence> {
  const worker = await getWorker(ctx.ocr.lang, ctx.ocr.langPath);
  const { data } = await worker.recognize(file);
  // Cada línea por separado: el OCR mete saltos que cortarían un PAN con espacios si se uniera todo.
  const lines = (data.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    yield {
      source: 'image',
      location: 'screenshot',
      file: ctx.display,
      group: ctx.group,
      fieldPath: `${path.basename(file)}:L${i + 1}`,
      text: line,
    };
  }
}
