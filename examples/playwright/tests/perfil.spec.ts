// Ejemplo autocontenido: una "banca" falsa servida con page.route, sin backend real.
// En tu proyecto solo cambia el import:  import { test, expect } from 'leaklens/playwright';
import { expect, test } from '../../../src/integrations/playwright';

const HOST = 'https://banca-demo.test';

const PERFIL_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body>
<h1>Mi perfil</h1>
<p id="saludo">Cargando…</p>
<p id="tarjeta"></p>
<script>
  fetch('/api/clientes/me').then(r => r.json()).then(c => {
    document.getElementById('saludo').textContent = 'Hola, ' + c.nombre;
    var t = c.tarjetas[0].numero;
    document.getElementById('tarjeta').textContent = 'Tarjeta •••• ' + t.slice(-4);
    // Fugas típicas de un front:
    localStorage.setItem('ultimaTarjeta', t);
    console.log('perfil cargado', JSON.stringify({ dni: c.dni, pan: t }));
  });
</script>
</body></html>`;

test.beforeEach(async ({ page }) => {
  await page.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/perfil') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: { 'set-cookie': 'SESSIONID=s3ss10n-e2e-7f3a9c1d; Path=/' },
        body: PERFIL_HTML,
      });
    }
    if (url.pathname === '/api/clientes/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nombre: 'Ana Torres',
          dni: '46027897',
          email: 'ana.torres@correo-demo.pe',
          tarjetas: [{ numero: '4111111111111111', cvv: '123' }],
        }),
      });
    }
    return route.fulfill({ status: 404, body: 'no encontrado' });
  });
});

test.describe('Perfil del cliente', () => {
  test('muestra la tarjeta enmascarada', async ({ page }) => {
    await page.goto(`${HOST}/perfil?documento=46027897`);
    await expect(page.locator('#saludo')).toHaveText('Hola, Ana Torres');
    await expect(page.locator('#tarjeta')).toHaveText('Tarjeta •••• 1111');
  });
});
