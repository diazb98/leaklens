# Contribuir a LeakLens

## Reglas que no se negocian

1. **Nunca datos reales.** Ni en issues, ni en pruebas, ni en ejemplos. Usa tarjetas de sandbox, documentos con dígito verificador válido calculado a mano y nombres inventados.
2. **Ningún valor completo sale a disco.** Todo lo que llega a un reporte pasa por `src/core/redact.ts`. La prueba `ningún reporte contiene valores sensibles completos` debe seguir pasando.
3. **Cada detector nuevo trae pruebas de falsos positivos**, no solo de aciertos.

## Arquitectura

```
Collectors → Evidence → Detectors → Match → Policy (severidad, sobreexposición, allowlist, baseline) → Finding → Reporters
```

- `src/collectors/`: convierten cada fuente en `Evidence`. Las fuentes HTTP pasan por `http.ts`.
- `src/detectors/`: reciben una `Evidence` y devuelven `Match[]`. No conocen la fuente.
- `src/policy/severity.ts`: matriz familia del dato × ubicación.
- `src/reporters/`: solo reciben `Finding`, que nunca contiene el valor original.

## Agregar un país

1. Agrega el código a `countries` en `src/config/schema.ts`.
2. Agrega validadores en `src/validators/index.ts`, con fuente oficial del algoritmo en un comentario.
3. Agrega reglas en `src/detectors/national-id.ts` y nombres de campo en `src/detectors/keys.ts`.
4. Agrega pruebas en `test/detectors.test.ts`: válido, inválido y documento de empresa si aplica.

## Desarrollo

```bash
npm install
node scripts/generate-samples.mjs
npm run typecheck
npm test
npm run build
npm run demo
npx playwright install chromium   # solo para la prueba E2E
npm run test:e2e
```
