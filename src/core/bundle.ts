/**
 * Formato "LeakLens bundle" v1: lo que una prueba E2E ve además de la red.
 * Lo escriben las integraciones de Playwright, Cypress y Selenium.
 * Especificación completa en docs/bundle-format.md.
 */

export interface BundleNetworkEntry {
  method?: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string | string[]> | Array<{ name: string; value: string }>;
  requestBody?: string;
  responseHeaders?: Record<string, string | string[]> | Array<{ name: string; value: string }>;
  responseBody?: string;
  responseMimeType?: string;
}

export interface LeakLensBundle {
  leaklens: 1;
  tool: 'playwright' | 'cypress' | 'selenium' | string;
  test: { title: string; titlePath?: string[]; file?: string; status?: string };
  /** Texto visible de cada pantalla (document.body.innerText). */
  pages?: Array<{ url: string; text: string }>;
  /** URLs por las que navegó la prueba. */
  urls?: string[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookies?: Array<{ name: string; value: string; domain?: string; httpOnly?: boolean; secure?: boolean }>;
  console?: Array<{ type?: string; text: string }>;
  /** Solo Cypress/Selenium: Playwright guarda la red en un HAR junto al bundle. */
  network?: BundleNetworkEntry[];
}

export const BUNDLE_FILENAME = 'leaklens.bundle.json';
