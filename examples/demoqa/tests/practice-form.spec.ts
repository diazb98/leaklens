import { expect, test } from './fixtures';

/**
 * Formulario de práctica: los datos viven solo en el navegador (no hay API).
 * LeakLens debería ver los datos en pantalla (DOM), que es una ubicación esperada
 * para el propio usuario: sirve para comprobar que la herramienta no hace ruido.
 */
test.describe('Practice Form', () => {
  test('registra un estudiante con datos sintéticos', async ({ page }) => {
    await page.goto('/automation-practice-form');

    await page.locator('#firstName').fill('Ana');
    await page.locator('#lastName').fill('Torres');
    await page.locator('#userEmail').fill('ana.torres@correo-demo.pe');
    await page.locator('label[for="gender-radio-2"]').click();
    await page.locator('#userNumber').fill('9876543210');
    await page.locator('label[for="hobbies-checkbox-3"]').click();
    await page.locator('#currentAddress').fill('Av. Siempre Viva 742, Lima');

    await page.locator('#submit').click();

    const modal = page.locator('.modal-content');
    await expect(modal.locator('#example-modal-sizes-title-lg')).toHaveText('Thanks for submitting the form');
    await expect(modal).toContainText('Ana Torres');
    await expect(modal).toContainText('ana.torres@correo-demo.pe');
    await expect(modal).toContainText('9876543210');
  });
});
