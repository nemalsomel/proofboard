import { expect, test, type Page } from '@playwright/test';

/* Csíkos panel: kézi és automatikus csíkvágás (rés két sor között, kifúrt lyuk). */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const pcb = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(() => { const pcb = window.pcb; ${body} })()`) as Promise<T>;
/** 10×20-as csíkos panel: R1 és LED1 lába ugyanazon a csíkon (a 2. oszlopban). */
const small = `pcb.load({ board: { rows: 20, cols: 10, sec: 20 }, bridges: [], wires: [], links: [], gpio: {}, seq: 10,
  settings: { usb: true, btnMode: 'hold', autoRoute: false },
  parts: [{ id: 'p1', type: 'res', label: 'R1', r: 4, c: 2, rot: 1, mir: false, props: { ohm: 330, dr: 0, dc: 4 } },
          { id: 'p2', type: 'led', label: 'LED1', r: 12, c: 2, rot: 1, mir: false, props: { color: 'red', dr: 0, dc: 1 } }] });`;
const nets = `const r = pcb.pins('R1'), l = pcb.pins('LED1'); return { same: r.find(q => q.r === 8).net === l.find(q => q.r === 12).net, iss: pcb.issues().map(i => i.msg) };`;

test('kézi vágás: a rés kettévágja a csíkot, újra kattintva visszaáll; kifúrt lyukban a láb hiba', async ({ page }) => {
  expect(await pcb<any>(page, small + nets)).toMatchObject({ same: true });
  const c1 = await pcb<any>(page, `pcb.cut(10, 2, 0); ${nets}`);
  expect(c1.same).toBe(false);
  expect(await pcb(page, `return pcb.cuts().manual;`)).toEqual([[10, 2, 0]]);
  expect((await pcb<any>(page, `pcb.cut(10, 2, 0); ${nets}`)).same).toBe(true);
  const d = await pcb<any>(page, `pcb.cut(12, 2, 1); ${nets}`);
  expect(d.same).toBe(false);
  expect(d.iss).toContain('LED1.A kifúrt lyukban van (12:2), nincs alatta réz: a láb sehová sem csatlakozik');
  await pcb(page, 'pcb.undo();');
  expect(await pcb(page, `return pcb.cuts().manual;`)).toEqual([]);
});

test('Csíkvágás eszköz: lyuk közepén kifúrás, két sor között rés', async ({ page }) => {
  await pcb(page, small);
  await page.keyboard.press('k');
  const at = async (r: number, c: number) => { const p = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(${r}, ${c});`); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); };
  await at(10.5, 2);
  await at(16, 5);
  expect(await pcb(page, `return pcb.cuts().manual;`)).toEqual([[10, 2, 0], [16, 5, 1]]);
  await page.keyboard.press('e');
  await at(10.5, 2);
  expect(await pcb(page, `return pcb.cuts().manual;`)).toEqual([[16, 5, 1]]);
});

test('automatikus csíkvágás: a minta csíkos panelen is mind bekötve, zárlat nélkül; kikapcsolva zárlat', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const d = pcb.get(); d.board.sec = 78; d.auto = { bridges: [], wires: [] }; pcb.load(d); pcb.route();
    const ls = pcb.links(); return { n: ls.length, ok: ls.filter(l => l.ok).length, cuts: pcb.cuts().auto.length, errs: pcb.issues().filter(i => i.sev === 'err').map(i => i.msg),
      box: document.querySelector('#autoCut').checked };`);
  expect(r.ok).toBe(r.n);
  expect(r.cuts).toBeGreaterThan(20);
  expect(r.errs).toEqual([]);
  expect(r.box).toBe(true);
  await page.uncheck('#autoCut');
  const off = await pcb<any>(page, `return { cuts: pcb.cuts().auto.length, errs: pcb.issues().filter(i => i.sev === 'err').length };`);
  expect(off.cuts).toBe(0);
  expect(off.errs).toBeGreaterThan(0);
  await page.check('#autoCut');
  await page.click('#bFreeze');
  const fz = await pcb<any>(page, `return { ...pcb.cuts(), box: document.querySelector('#autoCut').checked };`);
  expect(fz.auto).toEqual([]);
  expect(fz.manual.length).toBe(r.cuts);
  expect(fz.box).toBe(false);
});

test('szekciós panelen alapból nincs automatikus vágás (a regressziós minta változatlan)', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const ls = pcb.links(); return { ok: ls.filter(l => l.ok).length, wires: ls.filter(l => l.wire).length, cuts: pcb.cuts().auto.length };`);
  expect(r).toEqual({ ok: 29, wires: 0, cuts: 0 });
});

test('csíkvágás kijelölése és törlése: Kijelölés eszközzel rákattintva, Delete; kézi vágások törlése gombbal', async ({ page }) => {
  await pcb(page, small + 'pcb.cut(10, 2, 0); pcb.cut(16, 5, 1); pcb.cut(3, 4, 0);');
  const at = async (r: number, c: number) => { const p = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(${r}, ${c});`); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); };
  await page.keyboard.press('v');
  await at(10.5, 2);
  await expect(page.locator('#props')).toContainText('Csíkvágás: rés');
  await expect(page.locator('#props')).toContainText('kézi');
  await page.keyboard.press('Delete');
  expect((await pcb<any>(page, `return pcb.cuts().manual;`)).some((c: number[]) => c[0] === 10)).toBe(false);
  await pcb(page, 'pcb.undo();');
  expect((await pcb<any>(page, `return pcb.cuts().manual;`)).length).toBe(3);
  // a gomb a Csíkvágás eszköz sávjában: minden kézi vágás
  await page.keyboard.press('k');
  await expect(page.locator('#cutClear')).toHaveText('Kézi vágások törlése (3)');
  await page.click('#cutClear');
  expect(await pcb(page, `return pcb.cuts().manual;`)).toEqual([]);
  await expect(page.locator('#cutClear')).toBeDisabled();
  await pcb(page, 'pcb.undo();');
  expect((await pcb<any>(page, `return pcb.cuts().manual;`)).length).toBe(3);
});

test('automatikus vágás törlése: kijelölve, Csíkvágás eszközzel vagy törléssel; ide nem kerül újra, visszavonható', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const d = pcb.get(); d.board.sec = 78; d.auto = { bridges: [], wires: [] }; pcb.load(d); pcb.route(); return pcb.cuts();`);
  expect(r.auto.length).toBeGreaterThan(20);
  const [a, b, c] = r.auto as number[][];
  // kijelölve: a tulajdonságoknál automatikus, magyarázattal; Delete
  expect(await pcb(page, `return pcb.selectCut(${a[0]}, ${a[1]}, ${a[2]});`)).toBe('auto');
  await expect(page.locator('#props')).toContainText('automatikus');
  await expect(page.locator('#props')).toContainText('Törlés után ide nem kerül újra');
  await page.locator('#props #pDel').click();
  let s = await pcb<any>(page, `return pcb.cuts();`);
  expect(s.ban).toEqual([a]);
  expect(s.auto.some((x: number[]) => x.join() === a.join())).toBe(false);
  // API (a felület Csíkvágás és Törlés eszköze ugyanezt hívja)
  await pcb(page, `pcb.uncut(${b[0]}, ${b[1]}, ${b[2]});`);
  s = await pcb<any>(page, `return pcb.cuts();`);
  expect(s.ban).toEqual([a, b]);
  // Csíkvágás eszközzel rákattintva
  await page.keyboard.press('k');
  await pcb(page, `pcb.cutKind('gap');`);
  const p = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(${c[0] + 0.5}, ${c[1]});`);
  await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  s = await pcb<any>(page, `return pcb.cuts();`);
  expect(s.ban).toEqual([a, b, c]);
  expect(s.manual).toEqual([]);
  // visszavonás: a vágás visszajön, a tiltás eltűnik
  await pcb(page, 'pcb.undo();');
  s = await pcb<any>(page, `return pcb.cuts();`);
  expect(s.ban).toEqual([a, b]);
  expect(s.auto.some((x: number[]) => x.join() === c.join())).toBe(true);
  // kézi vágás ugyanoda feloldja a tiltást
  await pcb(page, `pcb.cut(${a[0]}, ${a[1]}, ${a[2]});`);
  expect((await pcb<any>(page, `return pcb.cuts();`)).ban).toEqual([b]);
});
