import type { DataClass, FindingStatus, Location, Severity, SourceKind } from '../core/types.js';

export const DATA_CLASS_LABEL: Record<DataClass, string> = {
  card: 'Tarjeta',
  'card-secret': 'CVV',
  credential: 'Credencial',
  session: 'Sesión',
  identity: 'Identidad',
  contact: 'Contacto',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  info: 'Info',
};

export const LOCATION_LABEL: Record<Location, string> = {
  url: 'Ruta de la URL',
  query: 'Parámetro de URL',
  'request-header': 'Header de request',
  'request-body': 'Body de request',
  'response-header': 'Header de respuesta',
  'response-body': 'Body de respuesta',
  cookie: 'Cookie',
  'local-storage': 'localStorage',
  'session-storage': 'sessionStorage',
  console: 'Consola del navegador',
  'log-line': 'Log',
  dom: 'Pantalla (DOM)',
  screenshot: 'Captura de pantalla',
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  har: 'HAR',
  trace: 'Traza Playwright',
  newman: 'Newman',
  log: 'Log',
  bundle: 'Bundle E2E',
  image: 'Captura (OCR)',
};

export const STATUS_LABEL: Record<FindingStatus, string> = {
  new: 'Nuevo',
  baselined: 'En baseline',
  allowed: 'Aceptado',
};

export const TAG_LABEL: Record<string, string> = {
  sobreexpuesto: 'Sobreexpuesto',
  'tarjeta-sandbox': 'Tarjeta sandbox',
  'alg-none': 'alg: none',
  'sin-expiracion': 'Sin expiración',
  'vigencia-larga': 'Vigencia larga',
  'dentro-de-jwt': 'Dentro de JWT',
  'clave-de-prueba': 'Clave de prueba',
};
