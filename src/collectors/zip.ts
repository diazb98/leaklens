import yauzl from 'yauzl';

/** Acceso aleatorio de solo lectura a un .zip (trazas de Playwright). */
export interface ZipReader {
  names: string[];
  read(name: string): Promise<Buffer>;
  close(): void;
}

export function openZip(file: string): Promise<ZipReader> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('No se pudo abrir el zip'));
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('error', reject);
      zip.on('end', () =>
        resolve({
          names: [...entries.keys()],
          read(name) {
            const entry = entries.get(name);
            if (!entry) return Promise.reject(new Error(`No existe ${name} en el zip`));
            return new Promise((res, rej) => {
              zip.openReadStream(entry, (e, stream) => {
                if (e || !stream) return rej(e ?? new Error('stream vacío'));
                const chunks: Buffer[] = [];
                stream.on('data', (c: Buffer) => chunks.push(c));
                stream.on('error', rej);
                stream.on('end', () => res(Buffer.concat(chunks)));
              });
            });
          },
          close() {
            zip.close();
          },
        }),
      );
      zip.readEntry();
    });
  });
}
