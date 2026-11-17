// Genera examples/sample-results: datos 100 % sintéticos con fugas sembradas.
// Sirve como demo (`npm run demo`) y como corpus de las pruebas automáticas.
// Uso: node scripts/generate-samples.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'examples', 'sample-results');

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (header, payload, sig = 'c2lnbmF0dXJhLWRlLXBydWViYQ') => `${b64url(header)}.${b64url(payload)}.${sig}`;

const now = 1_763_000_000;
const tokenOk = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'cli-001', iat: now, exp: now + 900 });
const tokenConDni = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'cli-001', dni: '46027897', iat: now, exp: now + 30 * 86400 });
const tokenNone = jwt({ alg: 'none', typ: 'JWT' }, { sub: 'cli-001', rol: 'cliente', iat: now, exp: now + 900 }, '');

const host = 'https://banca-demo.test';
const json = (o) => ({ mimeType: 'application/json', text: JSON.stringify(o) });

function entry({ method = 'GET', url, reqHeaders = [], body, status = 200, resHeaders = [], content }) {
  return {
    startedDateTime: '2026-11-17T10:00:00.000Z',
    time: 42,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'accept', value: 'application/json' }, ...reqHeaders],
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: body ? body.text.length : 0,
      ...(body ? { postData: body } : {}),
    },
    response: {
      status,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'content-type', value: content?.mimeType ?? 'application/json' }, ...resHeaders],
      cookies: [],
      content: { size: content?.text.length ?? 0, ...(content ?? { mimeType: 'application/json', text: '' }) },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 1, wait: 40, receive: 1 },
  };
}

const auth = [{ name: 'authorization', value: `Bearer ${tokenConDni}` }];

const har = {
  log: {
    version: '1.2',
    creator: { name: 'Playwright', version: '1.49.1' },
    entries: [
      // Login: la contraseña en el body es esperada; el token en la respuesta también.
      entry({
        method: 'POST',
        url: `${host}/api/auth/login`,
        body: json({ usuario: 'ana.torres', password: 'Secreta123!' }),
        content: json({ access_token: tokenOk, expires_in: 900 }),
        resHeaders: [{ name: 'set-cookie', value: 'SESSIONID=s3ss10n-4b9f2c71d8e04a6f; Path=/' }],
      }),
      // Perfil: devuelve datos que la pantalla no muestra (sobreexposición).
      // El PAN va como número JSON para probar la conservación de precisión.
      entry({
        url: `${host}/api/clientes/me`,
        reqHeaders: auth,
        content: {
          mimeType: 'application/json',
          text:
            '{"nombre":"Ana Torres","dni":"46027897","email":"ana.torres@correo-demo.pe","celular":"+51 987 654 321",' +
            '"tarjetas":[{"numero":4111111111111111,"vence":"12/29","cvv":"123","marca":"VISA"}],' +
            '"cuentaCci":"00219300123456789012","ruc":"10460278975"}',
        },
      }),
      // PAN en query string.
      entry({ url: `${host}/api/tarjetas/movimientos?pan=5555555555554444&desde=2026-11-01`, reqHeaders: auth, content: json({ movimientos: [] }) }),
      // Pago: el PAN viaja en el body hacia el backend (baja: revisar alcance PCI).
      entry({
        method: 'POST',
        url: `${host}/api/pagos`,
        reqHeaders: auth,
        body: json({ monto: '150.00', tarjeta: '4111 1111 1111 1111', cvv: '123' }),
        content: json({ estado: 'APROBADO', referencia: 'PAG-20261117-0001' }),
      }),
      // Empresa proveedora: RUC 20 es público, no debe reportarse.
      entry({ url: `${host}/api/proveedores/20131312955`, reqHeaders: auth, content: json({ razonSocial: 'Proveedor Demo SAC', ruc: '20131312955' }) }),
      // Ruido que NO debe reportarse: timestamps, ids y montos.
      entry({ url: `${host}/api/estado?ts=1731800000000`, content: json({ pedido: 1731800000000, id: '8f14e45f-ceea-467f-a2c4-1b2b3c4d5e6f', total: 1234567.89 }) }),
    ],
  },
};

const bundle = {
  leaklens: 1,
  tool: 'playwright',
  test: { title: 'el cliente ve su perfil y paga con tarjeta', titlePath: ['perfil.spec.ts', 'Perfil del cliente', 'el cliente ve su perfil y paga con tarjeta'] },
  pages: [
    { url: `${host}/perfil`, text: 'Hola, Ana Torres\nCorreo: ana.torres@correo-demo.pe\nTarjeta VISA •••• 1111\nCuenta •••• 9012' },
    { url: `${host}/pago/confirmacion`, text: 'Pago aprobado\nReferencia PAG-20261117-0001\nTarjeta •••• 1111' },
  ],
  urls: [`${host}/perfil`, `${host}/pago?token=${tokenNone}`, `${host}/pago/confirmacion`],
  localStorage: {
    token: tokenConDni,
    ultimaTarjeta: '4111 1111 1111 1111',
    preferencias: JSON.stringify({ tema: 'oscuro', idioma: 'es-PE' }),
  },
  sessionStorage: { paso: 'confirmacion' },
  cookies: [
    { name: 'SESSIONID', value: 's3ss10n-4b9f2c71d8e04a6f', domain: 'banca-demo.test', httpOnly: false, secure: false },
    { name: '_ga', value: 'GA1.1.123456789.1731800000', domain: 'banca-demo.test', httpOnly: false, secure: false },
  ],
  console: [
    { type: 'log', text: 'Respuesta de pago: {"estado":"APROBADO","pan":"378282246310005"}' },
    { type: 'info', text: 'Render perfil en 120ms' },
  ],
};

const newman = {
  collection: { info: { name: 'Banca Demo API' } },
  run: {
    executions: [
      {
        item: { name: 'Consultar cliente Colombia' },
        request: {
          method: 'GET',
          url: { protocol: 'https', host: ['api', 'banca-demo', 'test'], path: ['v1', 'clientes', 'co', '7788'], query: [] },
          header: [{ key: 'x-api-key', value: 'AKIAIOSFODNN7EXAMPLE' }],
        },
        response: {
          code: 200,
          header: [{ key: 'Content-Type', value: 'application/json' }],
          stream: {
            type: 'Buffer',
            data: [...Buffer.from(JSON.stringify({ nombre: 'Carlos Ruiz', cedula: '1020304050', nit: '1020304050-8', celular: '+57 310 555 1234' }))],
          },
        },
      },
      {
        item: { name: 'Consultar empresa' },
        request: {
          method: 'GET',
          url: { protocol: 'https', host: ['api', 'banca-demo', 'test'], path: ['v1', 'empresas', '800197268'], query: [{ key: 'incluir', value: 'contactos' }] },
          header: [],
        },
        response: {
          code: 200,
          header: [{ key: 'Content-Type', value: 'application/json' }],
          stream: { type: 'Buffer', data: [...Buffer.from(JSON.stringify({ razonSocial: 'Empresa Demo SAS', nit: '800197268-4' }))] },
        },
      },
      {
        item: { name: 'Recuperar clave' },
        request: {
          method: 'GET',
          url: { protocol: 'https', host: ['api', 'banca-demo', 'test'], path: ['v1', 'clave', 'recuperar'], query: [{ key: 'otp', value: '482915' }, { key: 'email', value: 'carlos.ruiz@correo-demo.co' }] },
          header: [],
        },
        response: { code: 204, header: [] },
      },
    ],
  },
};

const log = [
  '\x1b[32m[INFO]\x1b[0m 2026-11-17 10:00:01 Iniciando servicio de pagos v3.2.1',
  `+ curl -s -H "Authorization: Bearer ${tokenOk}" ${host}/api/salud`,
  '[INFO] 2026-11-17 10:00:05 Procesando pago tarjeta=4111 1111 1111 1111 cvv=123 monto=150.00',
  '[DEBUG] 2026-11-17 10:00:05 Conectando a core con password=Secreta123!',
  '[INFO] 2026-11-17 10:00:06 Cliente DNI 46027897 creado correctamente',
  '[INFO] 2026-11-17 10:00:07 Pedido 1731800000000 procesado en 45ms',
  '[INFO] 2026-11-17 10:00:08 Factura emitida al proveedor RUC 20131312955',
  '[WARN] 2026-11-17 10:00:09 Validación manual para persona natural con RUC 10460278975',
  '[INFO] 2026-11-17 10:00:10 Notificación enviada a +51 987 654 321',
  '[INFO] 2026-11-17 10:00:11 Total conciliado 1234567.89 en 3 lotes',
].join('\n');

const perfil = path.join(out, 'playwright', 'perfil-el-cliente-ve-su-perfil-chromium');
mkdirSync(perfil, { recursive: true });
writeFileSync(path.join(perfil, 'leaklens.har'), JSON.stringify(har, null, 2));
writeFileSync(path.join(perfil, 'leaklens.bundle.json'), JSON.stringify(bundle, null, 2));
mkdirSync(path.join(out, 'newman'), { recursive: true });
writeFileSync(path.join(out, 'newman', 'reporte.json'), JSON.stringify(newman, null, 2));
mkdirSync(path.join(out, 'logs'), { recursive: true });
writeFileSync(path.join(out, 'logs', 'pagos-service.log'), log + '\n');

console.log('Muestras generadas en', path.relative(process.cwd(), out));
