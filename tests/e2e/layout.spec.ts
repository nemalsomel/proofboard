import { expect, test, type Page } from '@playwright/test';

/* Felület: összecsukható oldalsávok, elrendezések, alsó panel (asztali nézet). */

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
  await expect(page.locator('#lib')).toBeHidden();
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
  await page.click('[data-rail-rtab="sim"]');
  await expect(page.locator('#rpSim')).toBeVisible();
  // [ újra összecsukja; beviteli mezőben gépelve nem
  await page.keyboard.press('[');
  expect(await width(page, '.left')).toBeLessThan(60);
  await page.click('[data-expand="l"]');
  expect(await width(page, '.left')).toBeGreaterThan(150);
});

test('elrendezések: Tervezés / Program / Szimuláció; a kézi módosítás elrendezésenként megmarad, visszaállítható', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).pcb.layout())).toBe('design');
  await expect(page.locator('#layReset')).toBeHidden();
  await page.click('[data-layout="prog"]');
  expect(await page.evaluate(() => [(window as any).pcb.work(), (window as any).pcb.sides()])).toEqual(['split', { l: true, r: false }]);
  await expect(page.locator('#progView')).toBeVisible();
  await expect(page.locator('.right .rtab.on')).toHaveText('Kód'); // a Program elrendezésben jobbra a kód
  // kézi módosítás a Program elrendezésben: jobb sáv csukva, alsó panel nyitva
  await page.click('#colR');
  await page.keyboard.press('p');
  await expect(page.locator('#layReset')).toBeVisible();
  await page.keyboard.press('Alt+1');
  expect(await page.evaluate(() => [(window as any).pcb.layout(), (window as any).pcb.work(), (window as any).pcb.sides(), (window as any).pcb.bottom().open])).toEqual(['design', 'board', { l: false, r: false }, false]);
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await page.keyboard.press('Alt+2');
  expect(await page.evaluate(() => [(window as any).pcb.sides(), (window as any).pcb.bottom().open])).toEqual([{ l: true, r: true }, true]);
  // vissza az alapállapotra
  await page.click('#layReset');
  expect(await page.evaluate(() => [(window as any).pcb.sides(), (window as any).pcb.bottom().open])).toEqual([{ l: true, r: false }, false]);
  await expect(page.locator('#layReset')).toBeHidden();
});

test('alsó panel: Problémák (több oszlopban, a hibák elöl) és Napló olvasatlan-számlálóval; P nyitja, a magasság állítható', async ({ page }) => {
  await expect(page.locator('#bpBody')).toBeHidden(); // alapból összecsukva
  await page.evaluate(() => { const pcb = (window as any).pcb; pcb.example('rc'); const d = pcb.get(), r = d.parts.find((p: any) => p.label === 'R1'); d.parts.push({ ...r, id: 'px', label: 'R9' }); pcb.load(d); });
  await expect(page.locator('#bpIssN')).toHaveText(/\d+/);
  await expect(page.locator('#bpLogN')).toHaveText('1'); // a példa betöltése a naplóba került
  await page.keyboard.press('p');
  await expect(page.locator('#issues li').first()).toHaveClass(/c-err/);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#issues')!).columnWidth)).toBe('320px');
  await page.click('[data-btab="log"]');
  await expect(page.locator('#log')).toContainText('Betöltve');
  await page.click('#bpRead');
  await expect(page.locator('#bpLogN')).toHaveText('');
  // magasság: a fogantyú húzásával
  const h0 = await page.evaluate(() => document.querySelector('#bpBody')!.getBoundingClientRect().height);
  const g = (await page.locator('#bpGrip').boundingBox())!;
  await page.mouse.move(g.x + 100, g.y + 2); await page.mouse.down(); await page.mouse.move(g.x + 100, g.y - 80, { steps: 4 }); await page.mouse.up();
  const h1 = await page.evaluate(() => document.querySelector('#bpBody')!.getBoundingClientRect().height);
  expect(h1 - h0).toBeGreaterThan(60);
  // a fülre kattintva csukódik
  await page.click('[data-btab="log"]');
  await expect(page.locator('#bpBody')).toBeHidden();
});
