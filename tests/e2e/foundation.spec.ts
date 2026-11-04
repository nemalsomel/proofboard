import { expect, test, type Page } from '@playwright/test';

/* 5.1 alapozó kör: kezdőkép, Fájl menü, téma, állapotsor, szabad vászon. */
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), 'futásidejű hibák').toEqual([]);
});
const pcb = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(() => { const pcb = window.pcb; ${body} })()`) as Promise<T>;

test('kezdőkép: üres panel bevezetővel; Tiszta sablon a választott mérettel', async ({ page }) => {
  await expect(page.locator('#intro')).toBeVisible();
  expect(await pcb(page, `return pcb.get().parts.length;`)).toBe(0);
  await page.selectOption('#introBoard', { label: '5×7 cm pontraszter (18×24)' });
  await page.click('#introBlank');
  await expect(page.locator('#intro')).toBeHidden();
  expect(await pcb(page, `return pcb.get().board;`)).toEqual({ cols: 18, rows: 24, sec: 1 });
  await expect(page.locator('.left .rtab.on')).toHaveText('Alkatrészek'); // innen jönnek az alkatrészek
  // a választás visszavonható
  await pcb(page, `pcb.undo();`);
  expect(await pcb(page, `return pcb.get().board.cols;`)).toBe(39);
});

test('kezdőkép: Példa betöltése a példatárat nyitja, betöltés után eltűnik', async ({ page }) => {
  await page.click('#introEx');
  await expect(page.locator('#dlgEx')).toBeVisible();
  await page.locator('.ex-item').first().click();
  await expect(page.locator('#dlgEx')).toBeHidden();
  await expect(page.locator('#intro')).toBeHidden();
  expect(await pcb<number>(page, `return pcb.get().parts.length;`)).toBeGreaterThan(0);
  // Új terv (Alt+N) üres tervet ad, a régi visszavonható
  await page.keyboard.press('Alt+n');
  await expect(page.locator('#dlgNew')).toBeVisible();
  await page.click('#bNewOk');
  expect(await pcb(page, `return pcb.get().parts.length;`)).toBe(0);
  await expect(page.locator('#toast')).toContainText('visszavonással');
  await expect(page.locator('#intro')).toBeHidden(); // sablont választott: nem kell a bevezető
  await pcb(page, `pcb.undo();`);
  expect(await pcb<number>(page, `return pcb.get().parts.length;`)).toBeGreaterThan(0);
});

test('Fájl menü: billentyűvel kezelhető, Escape zárja; Ctrl+S ment', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.click('#bFile');
  await expect(page.locator('#fileMenu')).toBeVisible();
  await expect(page.locator('#bNew')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#bOpenFile')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fileMenu')).toBeHidden();
  await expect(page.locator('#bFile')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#cv').hover();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(dl.suggestedFilename()).toMatch(/^proofboard-terv-\d{8}\.json$/);
});

test('téma: Világos/Sötét/Auto a Fájl menüben, a választás megmarad', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.click('#bFile');
  await page.click('[data-theme-set="dark"]');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
  await page.click('#bFile');
  await expect(page.locator('[data-theme-set="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-theme-set="auto"]');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
});

test('állapotsor: eszköz, kijelölés, problémák (kattintásra az alsó panel Problémák füle), szimuláció', async ({ page }) => {
  await pcb(page, `pcb.example('rc'); pcb.select(['R1']);`);
  await expect(page.locator('#sbTool')).toContainText('Kijelölés');
  await expect(page.locator('#sbSel')).toHaveText('Kijelölve: R1');
  await expect(page.locator('#sbIss')).toHaveText('Nincs probléma');
  // hibát okozunk: egy alkatrész másolata ugyanazokba a lyukakba
  await pcb(page, `const d = pcb.get(), r = d.parts.find(p => p.label === 'R1'); d.parts.push({ ...r, id: 'px', label: 'R9' }); pcb.load(d);`);
  await expect(page.locator('#sbIss')).toContainText(/\d+ hiba/);
  await page.click('#sbIss');
  expect(await pcb(page, `return pcb.bottom();`)).toEqual({ open: true, tab: 'issues' });
  await expect(page.locator('#issues')).toContainText('Ütközés');
  await expect(page.locator('#bpIssN')).not.toHaveText('');
  await expect(page.locator('#sbSim')).toHaveText('Szimuláció áll');
  await pcb(page, `pcb.sim(true);`);
  await expect(page.locator('#sbSim')).toHaveText('Szimuláció fut');
  await expect(page.locator('#bSim')).toHaveText('Szimuláció leállítása');
});

test('szabad vászon: nagyítás a kurzorhoz, pásztázás az üres téren és szóközzel, 0 = egész panel', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  const sc = () => page.evaluate(() => { const s = document.querySelector('#scroll')!; return { x: s.scrollLeft, y: s.scrollTop }; });
  const p = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(30, 20);`);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  expect(await page.locator('#zLbl').textContent()).not.toBe('100%');
  // a kurzor alatti lyuk a helyén marad (legfeljebb egy lyuknyi eltéréssel)
  const q = await pcb<{ x: number; y: number }>(page, `return pcb.at(30, 20);`);
  expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(14);
  // a panel mellett, az üres téren húzva pásztáz (a panel bárhová vihető, a széle is középre)
  const box = (await page.locator('#scroll').boundingBox())!;
  await page.evaluate(() => { const s = document.querySelector('#scroll')!; s.scrollLeft = 0; s.scrollTop = 0; });
  const s0 = await sc();
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 10, box.y + 10, { steps: 3 }); await page.mouse.up();
  const s1 = await sc();
  expect(Math.abs(s1.x - s0.x - 20)).toBeLessThanOrEqual(2); expect(Math.abs(s1.y - s0.y - 20)).toBeLessThanOrEqual(2);
  // szóköz + húzás a panelon is pásztáz, nem jelöl ki
  const c = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(40, 20);`);
  const s2 = await sc();
  await page.mouse.move(c.x, c.y); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(c.x - 40, c.y - 30, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space');
  const s3 = await sc();
  expect(Math.abs(s3.x - s2.x - 40)).toBeLessThanOrEqual(2); expect(Math.abs(s3.y - s2.y - 30)).toBeLessThanOrEqual(2);
  expect(await pcb(page, `return pcb.get().parts.length;`)).toBeGreaterThan(0);
  // 0: az egész panel a látómezőben
  await page.locator('#cv').hover({ position: { x: 5, y: 5 } });
  await page.keyboard.press('0');
  const fit = await pcb<boolean>(page, `const s = document.querySelector('#scroll').getBoundingClientRect(), b = pcb.get().board, a = pcb.at(0, 0), z = pcb.at(b.rows - 1, b.cols - 1);
    return [a, z].every(p => p.x >= s.left && p.x <= s.right && p.y >= s.top && p.y <= s.bottom);`);
  expect(fit).toBe(true);
});
