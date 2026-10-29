import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';

/* Mobil felület: érintéses gesztusok (CDP-érintésekkel, több ujjal is), alsó lapok, lebegő műveletgombok. */

const { defaultBrowserType: _b, ...pixel } = devices['Pixel 5'];
test.use(pixel);

const errors = new WeakMap<Page, string[]>();
let cdp: CDPSession;
test.beforeEach(async ({ page, context }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
  cdp = await context.newCDPSession(page);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

type XY = [number, number];
const touch = (type: string, pts: XY[]) =>
  cdp.send('Input.dispatchTouchEvent', { type: type as any, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
async function gesture(page: Page, from: XY[], to: XY[], { steps = 8, hold = 0 } = {}) {
  await touch('touchStart', from);
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) await touch('touchMove', from.map(([x, y], k) => [x + (to[k][0] - x) * i / steps, y + (to[k][1] - y) * i / steps] as XY));
  await touch('touchEnd', []);
}
const pcb = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(() => { const pcb = window.pcb; ${body} })()`) as Promise<T>;
const scroll = (page: Page) => page.evaluate(() => { const s = document.querySelector('#scroll')!; return { x: s.scrollLeft, y: s.scrollTop, z: document.querySelector('#zLbl')!.textContent }; });
/** Egy lyuk képernyőhelye görgetés nélkül (a reveal görgetne). */
const holeXY = (page: Page, r: number, c: number, keep = true) => page.evaluate(([r, c, keep]) => {
  const s = document.querySelector('#scroll')!, x = s.scrollLeft, y = s.scrollTop, p = (window as any).pcb.reveal(r, c);
  if (!keep) return [p.x, p.y] as XY;
  const dx = s.scrollLeft - x, dy = s.scrollTop - y; s.scrollTo(x, y); return [p.x + dx, p.y + dy] as XY; }, [r, c, keep] as const);
const part = (page: Page, label: string) => pcb<[number, number]>(page, `const p = pcb.get().parts.find(x => x.label === '${label}'); return [p.r, p.c];`);

test('egy ujj üres helyen görget, alkatrészen mozgat; a koppintás kijelöl', async ({ page }) => {
  await pcb(page, 'pcb.preset();');
  const [ex, ey] = await holeXY(page, 30, 1); // üres terület a panel bal szélén
  const s0 = await scroll(page);
  await gesture(page, [[ex, ey]], [[ex - 80, ey - 80]]);
  const s1 = await scroll(page);
  expect(s1.x - s0.x).toBeGreaterThan(60);
  expect(s1.y - s0.y).toBeGreaterThan(60);
  const k0 = await part(page, 'K1');
  const [x, y] = await holeXY(page, k0[0] + 1, k0[1] + 2);
  await gesture(page, [[x, y]], [[x + 3 * 17, y]]);
  const k1 = await part(page, 'K1');
  expect(k1[0]).toBe(k0[0]);
  expect(k1[1] - k0[1]).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#fab [data-fab="dup"]')).toBeVisible(); // a húzott alkatrész ki van jelölve
  await page.locator('#fab [data-fab="del"]').tap();
  expect(await pcb(page, `return pcb.get().parts.some(p => p.label === 'K1');`)).toBe(false);
});

test('két ujj: csípéssel nagyít, a félbehagyott mozgatás visszaáll', async ({ page }) => {
  await pcb(page, 'pcb.preset();');
  const z0 = await scroll(page);
  await gesture(page, [[150, 450], [250, 450]], [[100, 450], [300, 450]], { steps: 10 });
  const z1 = await scroll(page);
  expect(parseInt(z1.z!)).toBeGreaterThanOrEqual(parseInt(z0.z!) * 1.8);
  const k0 = await part(page, 'K2');
  const [x, y] = await holeXY(page, k0[0] + 1, k0[1] + 2, false);
  await touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[x + i * 12, y]]);
  expect((await part(page, 'K2'))[1]).not.toBe(k0[1]); // mozog
  await touch('touchStart', [[x + 60, y], [x + 60, y + 120]]); // második ujj
  await touch('touchMove', [[x + 40, y], [x + 40, y + 160]]);
  await touch('touchEnd', []);
  expect(await part(page, 'K2')).toEqual(k0);
});

test('lerakás: az Eszközök lapról választva, forgatással, az ujj fölé tolt előnézettel', async ({ page }) => {
  await pcb(page, `pcb.load({ board: { rows: 78, cols: 39, sec: 3 }, parts: [], bridges: [], wires: [], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 1 });`);
  await page.locator('#tabbar [data-sheet="left"]').tap();
  await expect(page.locator('.app')).toHaveClass(/sheet-left/);
  await page.locator('[data-ltab="lib"]').tap();
  await page.locator('[data-lib="res"]').tap();
  await expect(page.locator('.app')).not.toHaveClass(/sheet-left/);
  await page.locator('#fab [data-fab="rot"]').tap();
  const [x, y] = await holeXY(page, 20, 10);
  await touch('touchStart', [[x, y + 56]]); // az előnézet 56 px-lel az ujj fölött
  await touch('touchMove', [[x + 2, y + 57]]);
  await touch('touchEnd', []);
  const p = await pcb<any>(page, `return pcb.get().parts[0];`);
  expect(p).toMatchObject({ type: 'res', r: 20, c: 10, rot: 1 });
  await expect(page.locator('#fab [data-fab="dup"]')).toBeVisible();
});

test('hosszan nyomva kijelölő keret, a szimulációban a gomb nyomva tartható', async ({ page }) => {
  await pcb(page, 'pcb.preset();');
  const k = await part(page, 'K1');
  const [x0, y0] = await holeXY(page, k[0] - 3, k[1] - 2);
  const [x1, y1] = await holeXY(page, k[0] + 4, k[1] + 7);
  await gesture(page, [[x0, y0]], [[x1, y1]], { hold: 650 });
  await expect(page.locator('#fab [data-fab="rot"]')).toBeVisible(); // a keretben lévő alkatrész (és hidak) kijelölve
  await page.locator('#bSim').tap();
  const [bx, by] = await holeXY(page, k[0] + 1, k[1] + 2);
  const lvl = () => pcb<string>(page, `return pcb.read().find(x => x.pin === 'GP19').level;`);
  expect(await lvl()).toBe('1');
  await touch('touchStart', [[bx, by]]);
  expect(await lvl()).toBe('0');
  await touch('touchEnd', []);
  expect(await lvl()).toBe('1');
});
