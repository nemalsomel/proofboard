import { expect, test, type Page } from '@playwright/test';

/* Felület: összecsukható oldalsávok (asztali nézet). */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const width = (page: Page, sel: string) => page.evaluate(s => document.querySelector(s)!.getBoundingClientRect().width, sel);

test('oldalsávok: gombbal és [ ] billentyűvel összecsukhatók, ikonsávról nyithatók, az állapot megmarad', async ({ page }) => {
  await page.click('#colL');
  expect(await width(page, '.left')).toBeLessThan(60);
  await expect(page.locator('#railL')).toBeVisible();
  await expect(page.locator('#tools')).toBeHidden();
  await page.keyboard.press(']');
  expect(await width(page, '.right')).toBeLessThan(60);
  await expect(page.locator('#railR')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => !!(window as any).pcb);
  expect(await page.evaluate(() => (window as any).pcb.sides())).toEqual({ l: true, r: true });
  // ikonsáv: a fülre kattintva kinyílik, és arra a fülre vált
  await page.click('[data-rail-ltab="lib"]');
  expect(await width(page, '.left')).toBeGreaterThan(150);
  await expect(page.locator('#lpLib')).toBeVisible();
  await page.click('[data-rail-rtab="check"]');
  await expect(page.locator('#rpCheck')).toBeVisible();
  // [ újra összecsukja; beviteli mezőben gépelve nem
  await page.keyboard.press('[');
  expect(await width(page, '.left')).toBeLessThan(60);
  await page.click('[data-expand="l"]');
  expect(await width(page, '.left')).toBeGreaterThan(150);
});
