import { expect, test, type Page } from '@playwright/test';

/* Mérőműszerek: Műszerek fül, multiméter (csúcsok letétele a panelen, módok), szondák, lebegő ablak (a bal szélhez húzva vissza), elrejtés. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const ready = (p: Page) => p.waitForFunction(() => !!(window as any).pcb);
const pcb = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> => page.evaluate(([f, a]) => (window as any).pcb[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
/** az alkatrész lábainak lyukai */
const pinHoles = (page: Page, label: string) => pcb<Array<{ r: number; c: number }>>(page, 'pins', label);

async function clickHole(page: Page, r: number, c: number) {
  const { x, y } = await pcb<{ x: number; y: number }>(page, 'holeXY', r, c);
  await page.mouse.click(x, y);
}

test('multiméter: csúcsok letétele kattintással, feszültség / áram / ellenállás / szakadás; szonda; mentés a tervbe', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await pcb(page, 'example', 'strip');
  await page.click('[data-ltab="meters"]');
  const tab = page.locator('#lpMeters');
  await tab.locator('[data-act="add-meter"]').click();
  await expect(tab.locator('.mtr-card')).toHaveCount(1);
  await expect(tab.locator('.mtr-name')).toHaveText('M1');
  // az R1 két lába (a terv szerint)
  const [p1, p2] = await pinHoles(page, 'R1'), holes = p1;
  // a piros csúcs az R1 első lábára
  await tab.locator('[data-act="pick-red"]').click();
  await clickHole(page, holes.r, holes.c);
  await expect.poll(() => pcb<any[]>(page, 'meters').then(m => m[0].red)).toEqual([holes.r, holes.c]);
  await expect(tab.locator('.mtr-hint')).toContainText('Indítsd el a szimulációt');
  // szimulációban feszültséget mér
  await page.evaluate(() => (window as any).pcb.sim(true));
  await expect.poll(() => pcb<any[]>(page, 'meters').then(m => m[0].status)).toBe('ok');
  const v = (await pcb<any[]>(page, 'meters'))[0].value as number;
  expect(Math.abs(v)).toBeGreaterThan(1);
  await expect(page.locator('#lpMeters .mtr-val, .mtr-win .mtr-val').first()).toContainText(' V');
  // áram: a láb árama mA nagyságrendben
  await page.locator('#lpMeters [data-act="mode"][data-v="A"], .mtr-win [data-act="mode"][data-v="A"]').first().click();
  await expect.poll(() => pcb<any[]>(page, 'meters').then(m => Math.abs(m[0].value || 0))).toBeGreaterThan(1e-4);
  await page.evaluate(() => (window as any).pcb.sim(false));
  // ellenállás: piros az R1 egyik, fekete a másik lábán → 330 Ω
  await page.locator('#lpMeters [data-act="mode"][data-v="R"]').click();
  await page.locator('#lpMeters [data-act="pick-black"]').click();
  await clickHole(page, p2.r, p2.c);
  await expect.poll(() => pcb<any[]>(page, 'meters').then(m => m[0].text)).toBe('330Ω');
  await page.locator('#lpMeters [data-act="mode"][data-v="C"]').click();
  await expect.poll(() => pcb<any[]>(page, 'meters').then(m => m[0].cont)).toBe(false);
  await page.locator('#lpMeters [data-act="gnd"]').click();
  // szonda: az R1 lábán, a szimulációban értéket mutat
  await tab.locator('[data-act="add-probe"]').click();
  await clickHole(page, p1.r, p1.c);
  await expect(tab.locator('.mtr-probes li')).toHaveCount(1);
  await page.evaluate(() => (window as any).pcb.sim(true));
  await expect.poll(() => pcb<any[]>(page, 'probes').then(p => p[0].v)).not.toBeNull();
  await expect(tab.locator('.mtr-pv')).toContainText('V');
  await page.evaluate(() => (window as any).pcb.sim(false));
  // a terv része: újratöltés után is megvan
  await page.reload(); await ready(page);
  expect((await pcb<any[]>(page, 'meters')).length).toBe(1);
  expect((await pcb<any[]>(page, 'probes')).length).toBe(1);
});

test('lebegő ablak: leválasztás, húzás, a bal szélhez húzva vissza a fülre; elrejtés, a csúcsok megmaradnak', async ({ page }) => {
  await page.goto('./'); await ready(page);
  await pcb(page, 'example', 'strip');
  await page.click('[data-ltab="meters"]');
  const tab = page.locator('#lpMeters');
  await tab.locator('[data-act="add-meter"]').click();
  await tab.locator('[data-act="add-meter"]').click();
  await expect(tab.locator('.mtr-card')).toHaveCount(2);
  await tab.locator('.mtr-card').first().locator('[data-act="float"]').click();
  await expect(page.locator('.mtr-win')).toHaveCount(1);
  await expect(tab.locator('.mtr-card')).toHaveCount(1);
  await expect(tab.locator('.mtr-away li')).toContainText('lebegő ablakban');
  const head = (await page.locator('.mtr-win .mtr-head').boundingBox())!;
  await page.mouse.move(head.x + 40, head.y + 10); await page.mouse.down();
  await page.mouse.move(head.x + 160, head.y + 90, { steps: 4 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).pcb.get().meters[0].win.x)).toBeGreaterThan(100);
  const area = (await page.locator('#carea').boundingBox())!, h2 = (await page.locator('.mtr-win .mtr-head').boundingBox())!;
  await page.mouse.move(h2.x + 40, h2.y + 10); await page.mouse.down();
  await page.mouse.move(area.x + 8, h2.y + 10, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('.mtr-win')).toHaveCount(0);
  await expect(tab.locator('.mtr-card')).toHaveCount(2);
  // elrejtés: a műszer eltűnik, a csúcsa megmarad, megjeleníthető
  await page.evaluate(() => { const p = (window as any).pcb, d = p.get(); d.meters[0].red = [3, 3]; p.load(d); });
  await page.click('[data-ltab="meters"]');
  await tab.locator('.mtr-card').first().locator('[data-act="hide"]').click();
  await expect(tab.locator('.mtr-card')).toHaveCount(1);
  const m = await pcb<any[]>(page, 'meters');
  expect(m[0]).toMatchObject({ hidden: true, red: [3, 3] });
  await tab.locator('[data-act="show"]').click();
  await expect(tab.locator('.mtr-card')).toHaveCount(2);
});
