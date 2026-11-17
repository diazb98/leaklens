import { expect, test } from './fixtures';

/**
 * Login del Book Store. Aquí es donde LeakLens tiene más que decir:
 * la sesión (un token) queda en cookies que crea JavaScript, sin HttpOnly.
 *
 * Requiere una cuenta propia creada en https://demoqa.com/register:
 *   DEMOQA_USER=tu_usuario DEMOQA_PASS=tu_clave npm run test:demoqa
 *
 * Las credenciales nunca se escriben en el código ni en el repositorio.
 */
const user = process.env.DEMOQA_USER;
const pass = process.env.DEMOQA_PASS;

test.describe('Book Store · sesión', () => {
  test.skip(!user || !pass, 'Define DEMOQA_USER y DEMOQA_PASS para correr el login');

  test('inicia sesión y ve su perfil', async ({ page, context }) => {
    await page.goto('/login');
    await page.locator('#userName').fill(user!);
    await page.locator('#password').fill(pass!);
    await page.locator('#login').click();

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.locator('#userName-value')).toHaveText(user!);

    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toContain('token');

    await page.goto('/books');
    await expect(page.getByRole('link', { name: 'Git Pocket Guide' })).toBeVisible();
  });
});
