# LeakLens 🔐

**Tus pruebas E2E y de API ya ven todo lo que ve un atacante. LeakLens les enseña a mirarlo.**

LeakLens analiza lo que tus suites de Playwright, Cypress, Selenium y Postman/Newman ya generan (HAR, trazas, reportes, logs y capturas) y encuentra datos sensibles fuera de lugar:

- Números de tarjeta (PAN) en una URL
- CVV en una respuesta
- DNI dentro de un JWT
- Contraseñas en los logs de Jenkins
- Una API que devuelve datos que ninguna pantalla muestra

No tienes que reescribir pruebas. Corre en tu máquina, sin red, y **nunca escribe un valor completo en sus reportes**.

```bash
npx leaklens scan
```

---

## Qué detecta

| Detector | Qué busca | Cómo evita falsos positivos |
|---|---|---|
| `pan` | Números de tarjeta | Algoritmo de Luhn, rango y longitud por marca (BIN). Marca aparte las tarjetas de sandbox. |
| `cvv` | CVV/CVC | Solo si el campo o la etiqueta lo identifica (`cvv`, `securityCode`, `código de seguridad`). |
| `secrets` | Contraseñas, OTP, PIN, API keys, claves privadas, tokens de AWS/GitHub/Slack/Google/Stripe, credenciales en URL | Formatos conocidos, nombre del campo y entropía. Ignora placeholders (`****`, `[REDACTED]`). |
| `jwt` | Tokens JWT fuera de lugar, `alg: none`, tokens sin `exp` o con vigencia larga | Decodifica el token y **analiza sus claims** con los demás detectores. |
| `cookie-flags` | Cookies de sesión sin `HttpOnly` o sin `Secure` | Solo cookies con nombre de sesión. |
| `national-id` | **Perú:** DNI, carné de extranjería, RUC de persona natural. **Colombia:** cédula, NIT de persona natural. | RUC y NIT con dígito verificador. DNI y cédula solo con contexto. Ignora RUC 20 y NIT de empresa (son datos públicos). |
| `bank-account` | IBAN, CCI (PE), números de cuenta | IBAN con mod 97. Cuentas y CCI por nombre de campo. |
| `contact` | Correos y celulares de Perú (+51 9…) y Colombia (+57 3…) | Ignora correos técnicos (`noreply@`, `example.com`). |

¿Tu banco tiene un formato propio, como el número de cliente? Agrega un [detector personalizado](#detectores-personalizados).

## La severidad depende de dónde aparece el dato

El mismo PAN es **crítico** en una URL y **bajo** en el body de un pago hacia tu backend. LeakLens combina la familia del dato con su ubicación:

| Ubicación | Tarjeta | CVV | Credencial | Sesión | Identidad | Contacto |
|---|---|---|---|---|---|---|
| URL / parámetro | Crítica | Crítica | Crítica | Alta | Alta | Media |
| Log | Crítica | Crítica | Crítica | Alta | Alta | Baja |
| Consola del navegador | Crítica | Crítica | Crítica | Alta | Media | Baja |
| localStorage | Crítica | Crítica | Crítica | Media | Media | Baja |
| Body de respuesta | Alta | Crítica | Crítica | Info | Baja | Info |
| Body de request | Baja | Baja | *esperado* | Info | Info | Info |
| Header `Authorization` / cookie | Crítica | Crítica | *esperado* | *esperado* | Media | Baja |
| Pantalla / captura | Alta | Crítica | Crítica | Media | Info | Info |

Algunos hallazgos fijan su severidad mínima aunque la ubicación sea la esperada. Por ejemplo, un JWT con `alg: none` es crítico incluso en el header `Authorization`.

### Sobreexposición

Si la API devuelve un dato completo (tarjeta, CVV, documento, cuenta, celular) y **ninguna pantalla de esa prueba lo muestra**, LeakLens lo marca como `sobreexpuesto` y sube su severidad un nivel. Si el front no lo usa, el backend no debería enviarlo.

Para esto necesita el texto de las pantallas, que lo capturan las integraciones de Playwright, Cypress y Selenium.

## Instalación

```bash
npm i -D github:diazb98/leaklens
npx leaklens init      # crea leaklens.config.json
```

Requiere Node 18.18 o superior. Mientras no esté publicado en npm, se instala directo desde GitHub y se compila solo al instalarse.

## Fuentes

| Fuente | Cómo se genera | Config |
|---|---|---|
| HAR | Playwright `recordHar`, DevTools, mitmproxy, BrowserMob, Charles | `sources.har` |
| Traza de Playwright | `trace: 'on'` → `trace.zip` (red + consola) | `sources.trace` |
| Bundle de LeakLens | Integraciones de Playwright, Cypress y Selenium | `sources.bundles` |
| Newman | `newman run … -r json --reporter-json-export newman/reporte.json` | `sources.newman` |
| Logs | Logs de la aplicación, consola de Jenkins | `sources.logs` |
| Capturas (OCR) | Evidencias de prueba en PNG/JPG | `sources.images` + `--ocr` |

Si no configuras fuentes, LeakLens busca en `test-results/`, `cypress/leaklens/` y `newman/`.

## Integraciones

### Playwright

Cambia una sola línea en tus pruebas:

```ts
// antes: import { test, expect } from '@playwright/test';
import { test, expect } from 'leaklens/playwright';
```

Cada prueba deja en su carpeta de `test-results/` un `leaklens.har` (toda la red con cuerpos) y un `leaklens.bundle.json` (texto de las pantallas, storage, cookies y consola). Luego:

```bash
npx playwright test
npx leaklens scan
```

¿Ya tienes fixtures propios? Combínalos:

```ts
import { test as base } from '@playwright/test';
import { leaklensFixtures } from 'leaklens/playwright';
export const test = base.extend(leaklensFixtures).extend({ /* tus fixtures */ });
```

Para desactivarlo sin tocar código, usa `LEAKLENS_DISABLE=1`.

### Cypress

```js
// cypress.config.js
const { defineConfig } = require('cypress');
const { setupLeakLens } = require('leaklens/cypress/plugin');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      setupLeakLens(on, config);
      return config;
    },
  },
});
```

```js
// cypress/support/e2e.js
import 'leaklens/cypress/support';
```

El soporte registra pasivamente la red con `cy.intercept` (no modifica respuestas), la consola, las URLs, el texto visible, el storage y las cookies. Cada prueba deja `cypress/leaklens/<spec>/<prueba>/leaklens.bundle.json`.

### Selenium

Copia [`integrations/selenium/LeakLensSelenium.java`](integrations/selenium/LeakLensSelenium.java) a tu proyecto (Java 8+, sin dependencias extra) y captura la red con un proxy que exporte HAR. Guía completa en [docs/selenium.md](docs/selenium.md).

### Postman / Newman

```bash
newman run coleccion.json -e qa.json -r cli,json --reporter-json-export newman/reporte.json
npx leaklens scan --newman newman/reporte.json
```

### Jenkins

Ver [`integrations/jenkins/Jenkinsfile.example`](integrations/jenkins/Jenkinsfile.example):

- `junit`: cada fuga aparece como un test fallido.
- `recordIssues` (Warnings NG): lee el SARIF y muestra la tendencia entre builds.
- `publishHTML`: publica el reporte navegable.

> Jenkins aplica una CSP estricta a los reportes HTML. El reporte de LeakLens se genera completo en el servidor, así que se lee igual. Sin estilos se ve sin formato y sin JavaScript se pierden solo los filtros.

## CLI

```text
leaklens scan [opciones]       analiza y genera reportes (comando por defecto)
leaklens baseline [opciones]   acepta los hallazgos actuales como conocidos
leaklens init                  crea leaklens.config.json

  -c, --config <archivo>       configuración (por defecto ./leaklens.config.json)
  --har / --trace / --newman / --logs / --bundles / --images <glob>
  --countries pe,co            países para documentos de identidad
  --fail-on <severidad>        critical | high | medium | low | info | none   (por defecto high)
  -o, --out <dir>              carpeta de reportes (por defecto leaklens-report)
  -f, --format <lista>         html,json,sarif,junit
  --baseline <archivo> | --no-baseline
  --ocr                        activa el OCR (requiere: npm i -D tesseract.js)
  -q, --quiet
```

Códigos de salida: `0` sin hallazgos nuevos sobre el umbral, `1` con hallazgos, `2` error de configuración.

## Adopción gradual: baseline

En un proyecto con deuda, el primer análisis va a encontrar mucho. No apagues la herramienta: acepta lo existente y falla solo por lo nuevo.

```bash
npx leaklens baseline     # escribe .leaklens-baseline.json (versiónalo)
npx leaklens scan         # desde ahora, solo fallan los hallazgos nuevos
```

El baseline guarda huellas y metadatos, nunca valores. La huella no depende del valor: `GET /api/clientes/{id} $.dni` es el mismo hallazgo con cualquier cliente.

## Configuración

```jsonc
{
  "sources": { "har": ["test-results/**/*.har"], "newman": ["newman/*.json"] },
  "countries": ["pe", "co"],
  "failOn": "high",
  "baseline": ".leaklens-baseline.json",
  "output": { "dir": "leaklens-report", "formats": ["html", "json", "sarif", "junit"] },

  // Excepciones conscientes. El motivo es obligatorio y se revisa en code review.
  "allowlist": [
    {
      "detector": "pan",
      "location": "request-body",
      "endpoint": "POST **/api/pagos",
      "reason": "El pago va directo a la pasarela certificada PCI."
    }
  ],

  "severityOverrides": { "contact": "info" },
  "detectors": { "disable": [] },
  "overexposure": true,
  "ocr": { "enabled": false, "lang": "spa+eng" }
}
```

### Detectores personalizados

```json
{
  "customDetectors": [
    {
      "id": "codigo-cliente",
      "title": "Código de cliente",
      "pattern": "\\bCLI-(\\d{10})\\b",
      "dataClass": "identity",
      "recommendation": "El código de cliente no debe ir en URLs."
    }
  ]
}
```

`dataClass` define cómo se calcula la severidad: `card`, `card-secret`, `credential`, `session`, `identity` o `contact`. Si la regex tiene un grupo de captura, el grupo 1 es el valor. Con `keys` puedes limitar el detector a ciertos nombres de campo.

## Privacidad de los reportes

LeakLens no puede convertirse en una fuente de fugas:

- **Valores enmascarados:** `•••• •••• •••• 1111`, `a•••@correo.pe`. El CVV y las contraseñas nunca muestran ni un carácter.
- **Hash HMAC del valor:** permite correlacionar hallazgos sin exponerlos. Define `LEAKLENS_SALT` para que el hash sea estable entre builds.
- **Sin red ni telemetría:** el OCR descarga sus modelos de idioma la primera vez, salvo que configures `ocr.langPath`.
- **Ojo con los HAR, trazas y bundles de entrada:** sí contienen los datos completos. No los publiques como artefactos.

Las pruebas automáticas del proyecto verifican que ningún valor sembrado aparezca en los reportes.

## Pruébalo con la demo

```bash
npm install
npm run build
node scripts/generate-samples.mjs
npm run demo
```

La demo analiza datos 100 % sintéticos de una "Banca Demo": un HAR de Playwright con su bundle, un reporte de Newman y un log de servicio. Abre `leaklens-report/leaklens-report.html`.

## Limitaciones conocidas

- El **CCI** de Perú y los números de cuenta locales se detectan por el nombre del campo, sin validar el dígito de control.
- El **DNI** y la **cédula** no tienen dígito verificador en el número: sin un campo o etiqueta que los identifique, no se reportan, para no marcar cualquier número de 8 dígitos.
- La **sobreexposición** necesita el texto de las pantallas (bundle). Con solo HAR o Newman no se evalúa.
- El **OCR** depende de la calidad de la captura.

## API programática

```ts
import { scan, parseConfig, writeReports } from 'leaklens';

const result = await scan({ config: parseConfig({ sources: { har: ['out/*.har'] } }) });
writeReports(result, 'leaklens-report', ['html', 'sarif']);
```

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md). Se agradecen sobre todo perfiles de documentos de otros países y casos de falsos positivos reales (con datos sintéticos).

## Licencia

MIT
