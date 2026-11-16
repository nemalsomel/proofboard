import { expect, test, type Page } from '@playwright/test';

/* Rézoldali alkatrész: a tulajdonságpanel kapcsolója, az útvonalkereső kikerüli a test alatti lyukakat, „alatta is mehet”, visszavonás, beültetési lépés. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const ready = (p: Page) => p.waitForFunction(() => !!(window as any).pcb);
const pcb = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> => page.evaluate(([f, a]) => (window as any).pcb[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
const sw1 = (page: Page) => page.evaluate(() => (window as any).pcb.get().parts.find((p: any) => p.label === 'SW1')) as Promise<{ side?: string; under?: boolean }>;
const cuIssues = (page: Page) => page.evaluate(() => (window as any).pcb.issues(true).map((i: any) => i.msg).filter((m: string) => /rézoldal|copper side/i.test(m))) as Promise<string[]>;

test('rézoldalra tétel: kapcsoló, útvonal a test alatt nélkül, alatta vezetés, visszavonás, beültetés', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await pcb(page, 'example', 'esp32');
  expect(await pcb(page, 'select', ['SW1'])).toBe(1);
  await expect(page.locator('#pUnder')).toHaveCount(0);
  await page.locator('#pSide').check();
  await expect.poll(() => sw1(page)).toMatchObject({ side: 'cu' });
  // az újratervezett útvonal nem visz hidat a test alá: nincs figyelmeztetés, minden bekötve
  expect(await cuIssues(page)).toEqual([]);
  const links = await pcb<Array<{ ok?: boolean }>>(page, 'links');
  expect(links.every(l => l.ok !== false)).toBe(true);
  const steps = (await pcb<{ steps: Array<{ id: string }> }>(page, 'mfg')).steps.map(s => s.id);
  expect(steps).toContain('parts:cu');
  // alatta is mehet
  await expect(page.locator('#pUnder')).toHaveCount(1);
  await page.locator('#pUnder').check();
  await expect.poll(() => sw1(page)).toMatchObject({ side: 'cu', under: true });
  // visszavonás: előbb az „alatta”, aztán az oldal
  await pcb(page, 'undo');
  expect((await sw1(page)).under).toBeUndefined();
  await pcb(page, 'undo');
  expect((await sw1(page)).side).toBeUndefined();
  expect((await pcb<{ steps: Array<{ id: string }> }>(page, 'mfg')).steps.map(s => s.id)).not.toContain('parts:cu');
});
