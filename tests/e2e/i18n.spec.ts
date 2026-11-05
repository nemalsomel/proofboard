import { expect, test, type Page } from '@playwright/test';

/* Nyelvváltás (előkészítés): a statikus felület angolra fordul, vissza magyarra pontosan; a választás megmarad. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

test('Fájl → Nyelv: English, majd vissza Magyar; újratöltés után is megmarad', async ({ page }) => {
  await page.click('#bFile');
  await expect(page.locator('[data-lang-set="hu"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-lang-set="en"]');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#bFile')).toContainText('File');
  await expect(page.locator('#bExamples')).toContainText('Examples…');
  await expect(page.locator('[data-lang-set="hu"]')).toHaveText('Magyar'); // a nyelvek neve nem fordul
  await expect(page.locator('#toast')).toContainText('in progress');
  await expect(page.locator('#bUndo')).toHaveAttribute('title', 'Undo (Ctrl+Z)');
  await expect(page.locator('#exSearch')).toHaveAttribute('placeholder', 'Search the examples');
  // a program által épített részek is (eszközsáv, állapotsor)
  await expect(page.locator('[data-tool="select"] .tl')).toHaveText('Select');
  await expect(page.locator('[data-tool="erase"]')).toHaveAttribute('aria-label', 'Delete');
  await expect(page.locator('#status')).toContainText('parts: 0');
  await expect(page.locator('#sbTool')).toContainText('Tool: Select');
  expect(await page.evaluate(() => (window as any).pcb.lang())).toBe('en');
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await expect(page.locator('#bFile')).toContainText('File');
  await page.evaluate(() => (window as any).pcb.lang('hu'));
  await expect(page.locator('#bFile')).toContainText('Fájl');
  await expect(page.locator('#bExamples')).toContainText('Példák…');
  await expect(page.locator('#exSearch')).toHaveAttribute('placeholder', 'Keresés a példák között');
  await expect(page.locator('[data-tool="select"] .tl')).toHaveText('Kijelölés');
  await expect(page.locator('#status')).toContainText('0 alkatrész');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
});
