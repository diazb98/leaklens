import { maxSeverity, type DataClass, type Location, type Severity } from '../core/types.js';

/**
 * Matriz de severidad: el mismo dato pesa distinto según dónde aparece.
 *
 * `null` = ubicación esperada para ese dato (no es hallazgo).
 * Ej.: un JWT en el header Authorization, una contraseña en el body del login.
 */
type Cell = Severity | null;
type Row = Record<DataClass, Cell>;

export const SEVERITY_MATRIX: Record<Location, Row> = {
  //                   tarjeta      CVV            credencial    sesión      identidad    contacto
  url:               { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: 'high',   identity: 'high',   contact: 'medium' },
  query:             { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: 'high',   identity: 'high',   contact: 'medium' },
  'log-line':        { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: 'high',   identity: 'high',   contact: 'low' },
  console:           { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: 'high',   identity: 'medium', contact: 'low' },
  'local-storage':   { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: 'medium', identity: 'medium', contact: 'low' },
  'session-storage': { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: 'low',    identity: 'medium', contact: 'low' },
  cookie:            { card: 'critical', 'card-secret': 'critical', credential: 'critical', session: null,     identity: 'medium', contact: 'low' },
  'request-header':  { card: 'critical', 'card-secret': 'critical', credential: 'high',     session: null,     identity: 'medium', contact: 'low' },
  'response-header': { card: 'critical', 'card-secret': 'critical', credential: 'high',     session: 'low',    identity: 'medium', contact: 'low' },
  'response-body':   { card: 'high',     'card-secret': 'critical', credential: 'critical', session: 'info',   identity: 'low',    contact: 'info' },
  'request-body':    { card: 'low',      'card-secret': 'low',      credential: null,       session: 'info',   identity: 'info',   contact: 'info' },
  dom:               { card: 'high',     'card-secret': 'critical', credential: 'critical', session: 'medium', identity: 'info',   contact: 'info' },
  screenshot:        { card: 'high',     'card-secret': 'critical', credential: 'critical', session: 'medium', identity: 'info',   contact: 'info' },
};

/** Explicación corta de por qué esa ubicación es riesgosa. */
export const LOCATION_RISK: Record<Location, string> = {
  url: 'Las URLs quedan en el historial del navegador, logs de proxies, CDN, APM y en el header Referer.',
  query: 'Los parámetros de URL quedan en el historial, logs de servidores, proxies, analítica y en el header Referer.',
  'log-line': 'Los logs se copian a herramientas centralizadas, los lee mucha gente y se retienen por años.',
  console: 'La consola del navegador la ve cualquiera con DevTools y muchas herramientas de monitoreo la capturan.',
  'local-storage': 'localStorage persiste sin vencimiento y cualquier script de la página (o un XSS) puede leerlo.',
  'session-storage': 'sessionStorage es accesible para cualquier script de la página, incluido un XSS.',
  cookie: 'Las cookies viajan en cada request al dominio y, sin HttpOnly, las lee JavaScript.',
  'request-header': 'Los headers suelen quedar en logs de gateways, WAF y APM.',
  'response-header': 'Los headers de respuesta los ven proxies, CDN y el navegador.',
  'response-body': 'La API entrega el dato al navegador: cualquiera con DevTools lo ve.',
  'request-body': 'El dato viaja hacia el backend. Verifica que el alcance PCI/protección de datos lo permita.',
  dom: 'El dato se muestra completo en pantalla.',
  screenshot: 'El dato aparece en una captura de pantalla (evidencias de prueba, tickets, reportes).',
};

/**
 * Severidad final, o null si la ubicación es la esperada.
 * `force` (p. ej. JWT con alg none) gana siempre, incluso en ubicaciones esperadas.
 */
export function resolveSeverity(
  dataClass: DataClass,
  location: Location,
  force?: Severity,
  override?: Severity,
): Severity | null {
  if (override) return override;
  const base = SEVERITY_MATRIX[location][dataClass];
  if (force) return base ? maxSeverity(base, force) : force;
  return base;
}
