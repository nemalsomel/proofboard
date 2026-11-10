import { expect, test, type Page } from '@playwright/test';

/* Megosztás linkkel: a terv a link # része mögött; megnyitáskor üres tervnél rögtön betöltődik, különben rákérdez. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const ready = (p: Page) => p.waitForFunction(() => !!(window as any).pcb);

test('Fájl › Megosztás linkkel: a link egy új böngészőben ugyanazt a tervet nyitja meg (programmal), a # rész eltűnik', async ({ page, browser }) => {
  await page.goto('./'); await ready(page);
  expect(await page.evaluate(() => (window as any).pcb.example('prog-toggle'))).toBe(true);
  const want = await page.evaluate(() => { const d = (window as any).pcb.get(); return { parts: d.parts.map((p: any) => p.label + '@' + p.r + ',' + p.c).sort(), links: d.links.length, nodes: d.program ? d.program.nodes.length : 0 }; });
  expect(want.nodes).toBeGreaterThan(0);
  await page.click('#bFile'); await page.click('#bShare');
  const dlg = page.locator('#dlgShare');
  await expect(dlg).toBeVisible();
  const url = await page.locator('#shareUrl').inputValue();
  expect(url).toMatch(/#d=1\.[A-Za-z0-9_-]+$/);
  await expect(page.locator('#shareInfo')).toContainText('karakter');
  expect(await page.evaluate(() => (window as any).pcb.shareLink())).toBe(url);

  const ctx = await browser.newContext(); const p2 = await ctx.newPage();
  const err2: string[] = []; p2.on('pageerror', e => err2.push(e.message));
  await p2.goto(url); await ready(p2);
  await p2.waitForFunction(() => (window as any).pcb.get().parts.length > 0);
  const got = await p2.evaluate(() => { const d = (window as any).pcb.get(); return { parts: d.parts.map((p: any) => p.label + '@' + p.r + ',' + p.c).sort(), links: d.links.length, nodes: d.program ? d.program.nodes.length : 0 }; });
  expect(got).toEqual(want);
  expect(new URL(p2.url()).hash).toBe('');
  expect(err2).toEqual([]);
  await ctx.close();
});

test('nem üres tervnél rákérdez: Mégse – marad a régi; Megnyitás – betölt, visszavonható', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await page.evaluate(() => (window as any).pcb.preset());
  const mine = await page.evaluate(() => (window as any).pcb.get().parts.length);
  await page.evaluate(() => (window as any).pcb.example((window as any).pcb.examples()[0].id));
  const link = await page.evaluate(() => (window as any).pcb.shareLink());
  const theirs = await page.evaluate(() => (window as any).pcb.get().parts.length);
  await page.evaluate(() => (window as any).pcb.preset());

  await page.evaluate(h => { location.hash = h; }, new URL(link).hash);
  const dlg = page.locator('#dlgShared');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#sharedInfo')).toContainText(`${theirs} alkatrész`);
  await dlg.locator('[data-close]').last().click();
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(mine);

  await page.evaluate(h => { location.hash = h; }, new URL(link).hash);
  await expect(dlg).toBeVisible();
  await page.click('#bSharedOpen');
  await expect(dlg).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Megosztott terv megnyitva');
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(theirs);
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(mine);
});

test('sérült link: hibaüzenet, a terv nem változik', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await page.evaluate(() => (window as any).pcb.preset());
  const n = await page.evaluate(() => (window as any).pcb.get().parts.length);
  await page.evaluate(() => { location.hash = 'd=1.AAAA'; });
  await expect(page.locator('#toast')).toContainText('A link nem nyitható meg');
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(n);
});
