import { expect, test } from './fixtures';

/**
 * Book Store: el catálogo se carga desde una API real (GET /BookStore/v1/Books).
 * Es público, así que no debería haber datos personales. Sirve como línea base.
 */
test.describe('Book Store · catálogo', () => {
  test('lista los libros desde la API y busca uno', async ({ page }) => {
    const api = page.waitForResponse((r) => r.url().includes('/BookStore/v1/Books') && r.status() === 200);
    await page.goto('/books');
    const books = (await (await api).json()) as { books: Array<{ title: string; isbn: string }> };
    expect(books.books.length).toBeGreaterThan(0);

    const first = books.books[0]!;
    await expect(page.getByRole('link', { name: first.title })).toBeVisible();

    await page.locator('#searchBox').fill('Git');
    await expect(page.getByRole('link', { name: 'Git Pocket Guide' })).toBeVisible();
  });

  test('abre el detalle de un libro', async ({ page }) => {
    await page.goto('/books');
    await page.getByRole('link', { name: 'Git Pocket Guide' }).click();
    await expect(page).toHaveURL(/search=|book=/);
    await expect(page.locator('#ISBN-wrapper')).toContainText('9781449325862');
  });
});
