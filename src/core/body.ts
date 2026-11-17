/**
 * Convierte cuerpos (JSON, form-urlencoded, texto) en hojas analizables
 * con su ruta de campo, para que los detectores tengan contexto (`key`).
 */

export interface Leaf {
  path: string;
  key?: string;
  value: string;
}

const MAX_LEAVES = 50_000;

/**
 * JSON.parse convierte 4111111111111111 (número) en 4111111111111112 por precisión.
 * Antes de parsear, envolvemos enteros largos en comillas para conservarlos exactos.
 */
export function quoteLargeIntegers(json: string): string {
  return json.replace(/([:\[,]\s*)(-?\d{12,})(?=\s*[,}\]])/g, '$1"$2"');
}

export function tryParseJson(text: string): unknown {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(quoteLargeIntegers(t));
  } catch {
    return undefined;
  }
}

export function flattenJson(value: unknown, path = '$', key?: string, out: Leaf[] = []): Leaf[] {
  if (out.length >= MAX_LEAVES) return out;
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenJson(v, `${path}[${i}]`, key, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
      flattenJson(v, path + safeKey, k, out);
    }
    return out;
  }
  out.push({ path, key, value: String(value) });
  return out;
}

export function parseForm(text: string): Leaf[] | undefined {
  if (!/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(text.trim())) return undefined;
  try {
    const params = new URLSearchParams(text.trim());
    const leaves: Leaf[] = [];
    params.forEach((value, key) => leaves.push({ path: `form.${key}`, key, value }));
    return leaves;
  } catch {
    return undefined;
  }
}

/**
 * JSON incrustado en texto libre: `perfil cargado {"dni":"46027897"}` en consola o logs.
 * Sin esto, un DNI sin etiqueta dentro de un JSON logueado pasaría inadvertido.
 */
export function embeddedJsonLeaves(text: string): Leaf[] {
  const start = text.search(/[{[]["{\[]/);
  if (start < 0) return [];
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end <= start) return [];
  const json = tryParseJson(text.slice(start, end + 1));
  return json === undefined ? [] : flattenJson(json);
}

const BINARY_MIME = /^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|wasm|x-protobuf|grpc)/i;

export function isBinaryMime(mime: string | undefined): boolean {
  return !!mime && BINARY_MIME.test(mime);
}

/**
 * Hojas de un cuerpo: JSON → hojas con ruta; form → parámetros; texto → una sola hoja.
 * Si el JSON contiene strings que a su vez son JSON, también se expanden.
 */
export function bodyLeaves(text: string, mime?: string): Leaf[] {
  if (!text) return [];
  const json = tryParseJson(text);
  if (json !== undefined) {
    const leaves = flattenJson(json);
    const nested: Leaf[] = [];
    for (const leaf of leaves) {
      const inner = leaf.value.length > 1 ? tryParseJson(leaf.value) : undefined;
      if (inner !== undefined) nested.push(...flattenJson(inner, leaf.path + '#json'));
    }
    return leaves.concat(nested);
  }
  if (!mime || /x-www-form-urlencoded/i.test(mime) || /^[^=&\s]+=/.test(text)) {
    const form = parseForm(text);
    if (form) return form;
  }
  return [{ path: 'body', value: text }];
}
