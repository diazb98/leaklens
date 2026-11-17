# Ejemplo real: LeakLens con DemoQA

[DemoQA](https://demoqa.com) es un sitio público para practicar automatización. Este ejemplo corre pruebas de Playwright reales contra él con LeakLens activado.

```bash
npm install
npm run build
npm run test:demoqa       # 3 pruebas, más 1 opcional con login
npm run scan:demoqa       # reporte en examples/demoqa/leaklens-report/
```

Si no quieres descargar Chromium, usa el Chrome que ya tienes instalado:

```bash
PW_CHANNEL=chrome npm run test:demoqa
```

## Qué prueba

| Prueba | Qué hace | Qué debería ver LeakLens |
|---|---|---|
| `practice-form.spec.ts` | Llena el formulario de práctica con datos sintéticos | Solo datos en pantalla que escribió el propio usuario (Info). Comprueba que la herramienta no hace ruido. |
| `bookstore.spec.ts` | Carga el catálogo desde la API real `GET /BookStore/v1/Books`, busca y abre un libro | Nada: el catálogo es público. Sirve como línea base. |
| `bookstore-login.spec.ts` | Inicia sesión y abre el perfil | La sesión queda en cookies que crea JavaScript (sin `HttpOnly`): LeakLens debería marcarla. |

## Lo que encontramos después del login

Revisamos una sesión real del Book Store (noviembre 2026), leyendo solo nombres y estructura, nunca valores:

| Hallazgo | Detalle | Severidad |
|---|---|---|
| **Contraseña dentro del JWT** | La cookie `token` es un JWT con payload `{ userName, password, iat }`. Un JWT no está cifrado: cualquiera que vea el token lee la contraseña. | Crítica |
| **Sesión accesible desde JavaScript** | La cookie `token` se crea sin `HttpOnly`: un XSS o cualquier script de terceros puede robarla. | Alta |
| **Token sin vencimiento** | El JWT no tiene `exp`: si se filtra, sirve para siempre. | Media |

La prueba [`test/demoqa-replica.test.ts`](../test/demoqa-replica.test.ts) reproduce ese patrón con datos inventados y verifica que LeakLens detecta los tres hallazgos, que rompe el build y que ni la contraseña ni el token aparecen en los reportes.

## El login es opcional

Necesita una cuenta propia. Créala tú en https://demoqa.com/register y pasa las credenciales por variables de entorno, nunca en el código:

```bash
DEMOQA_USER=tu_usuario DEMOQA_PASS=tu_clave PW_CHANNEL=chrome npm run test:demoqa
```

Sin esas variables, la prueba se marca como omitida.

## Dos lecciones de usar un sitio real

1. **Bloquear la publicidad.** DemoQA carga decenas de anuncios y trackers. El fixture de `tests/fixtures.ts` los bloquea: las pruebas son más rápidas y estables, y el reporte no se llena de tráfico de terceros.
2. **Desactivar la traza de Playwright en este sitio.** Con Playwright 1.49 y Chrome, guardar `trace.zip` en DemoQA se cuelga al cerrar el contexto. LeakLens no la necesita, porque ya captura el HAR y el bundle de cada prueba.

Además, este ejemplo sacó a la luz un falso positivo real: el JavaScript minificado de DemoQA contiene `{userName:r,password:a}`. Desde entonces LeakLens trata los cuerpos JS, CSS y HTML como código: sigue detectando claves reales incrustadas (AWS, GitHub, Stripe…) pero no confunde variables con contraseñas.
