# Formato LeakLens bundle v1

El bundle guarda lo que una prueba E2E ve **además de la red**. Lo escriben las integraciones de Playwright, Cypress y Selenium, y cualquier herramienta puede generarlo.

**Archivo:** `leaklens.bundle.json`, uno por prueba y **en su propia carpeta**. LeakLens agrupa la evidencia por directorio: el HAR y el bundle de una misma prueba deben estar juntos para evaluar la sobreexposición.

```jsonc
{
  "leaklens": 1,                          // obligatorio
  "tool": "playwright",                   // playwright | cypress | selenium | <otro>
  "test": {
    "title": "muestra la tarjeta enmascarada",
    "titlePath": ["perfil.spec.ts", "Perfil", "muestra la tarjeta enmascarada"],
    "file": "tests/perfil.spec.ts",
    "status": "passed"
  },

  // Texto visible de cada pantalla (document.body.innerText).
  "pages": [{ "url": "https://qa.banco.test/perfil", "text": "Hola, Ana\nTarjeta •••• 1111" }],

  // URLs por las que navegó la prueba (incluye query y fragmento).
  "urls": ["https://qa.banco.test/perfil?tab=tarjetas"],

  "localStorage": { "clave": "valor" },
  "sessionStorage": { "clave": "valor" },

  // httpOnly: false en una cookie de sesión → hallazgo "accesible desde JavaScript".
  "cookies": [{ "name": "SESSIONID", "value": "…", "domain": "qa.banco.test", "httpOnly": true, "secure": true }],

  "console": [{ "type": "log", "text": "…" }],

  // Opcional. Playwright guarda la red en un HAR aparte; Cypress y Selenium pueden usar este campo.
  "network": [
    {
      "method": "GET",
      "url": "https://qa.banco.test/api/clientes/me",
      "status": 200,
      "requestHeaders": { "accept": "application/json" },  // objeto o [{ "name", "value" }]
      "requestBody": "…",
      "responseHeaders": { "content-type": "application/json" },
      "responseBody": "{\"nombre\":\"Ana\"}",
      "responseMimeType": "application/json"
    }
  ]
}
```

**Valores de storage:** si un valor es JSON, LeakLens lo expande campo por campo. Por ejemplo, `perfil.$.dni`.

**Tamaños:** el texto de pantalla se trunca a 1 MB y los cuerpos a `maxBodyBytes` (5 MB por defecto).
