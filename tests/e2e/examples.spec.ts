import { expect, test, type Page } from '@playwright/test';

/* Példatár: minden példa betölthető, bekötött, hibamentes; néhány működés-ellenőrzés. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const pcb = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(async () => { const pcb = window.pcb; ${body} })()`) as Promise<T>;

test('minden példa betöltődik: a kapcsolatok rendben, nincs hiba, van magyarázó jegyzet', async ({ page }) => {
  const r = await pcb<any[]>(page, `return pcb.examples().map(e => { pcb.example(e.id); const ls = pcb.links(), d = pcb.get(); pcb.sim(true);
    const out = { id: e.id, bad: ls.filter(l => !l.ok).map(l => l.text), errs: pcb.issues().filter(i => i.sev === 'err').map(i => i.msg),
      warns: pcb.issues().filter(i => i.sev !== 'err').map(i => i.msg), notes: d.notes.length, parts: d.parts.length }; pcb.sim(false); return out; });`);
  expect(r.length).toBeGreaterThanOrEqual(16);
  for (const x of r) {
    expect(x.bad, x.id).toEqual([]);
    expect(x.errs, x.id).toEqual([]);
    expect(x.notes, x.id).toBeGreaterThan(0);
    // figyelmeztetés legfeljebb egy-egy vezetékes bekötésről lehet (a jegyzet meg is magyarázza)
    for (const w of x.warns) expect(w, x.id).toMatch(/csak vezetékkel köthető be/);
  }
});

test('kézi és útvonalkeresős LED-példa: ugyanaz a kör, egyik hidakkal, másik kapcsolatokkal', async ({ page }) => {
  const r = await pcb<any>(page, `const f = id => { pcb.example(id); const d = pcb.get(); pcb.sim(true); const s = { br: d.bridges.length, auto: d.auto.bridges.length, links: d.links.length, I: pcb.simInfo().leds[0].I }; pcb.sim(false); return s; };
    return { m: f('led-manual'), a: f('led-auto') };`);
  expect(r.m.links).toBe(0);
  expect(r.m.br).toBeGreaterThan(0);
  expect(r.m.auto).toBe(0);
  expect(r.a.links).toBe(3);
  expect(r.a.br).toBe(0);
  expect(r.a.auto).toBeGreaterThan(0);
  expect(r.m.I).toBeGreaterThan(0.003);
  expect(r.a.I).toBeCloseTo(r.m.I, 4);
});

test('logikai példák: D tároló gombnyomásra vált, a dekóder végigléptet a LED-eken', async ({ page }) => {
  const r = await pcb<any>(page, `const L = () => pcb.simInfo().leds.map(l => l.I > 2e-4 ? 1 : 0).join('');
    pcb.example('toggle'); pcb.sim(true); const t = [L()];
    for (let i = 0; i < 2; i++) { pcb.press('SW1', true); t.push(L()); pcb.press('SW1', false); t.push(L()); }
    pcb.sim(false); pcb.example('decoder'); pcb.sim(true); const d = [L()]; for (let i = 0; i < 4; i++) { pcb.sigStep(1); d.push(L()); }
    return { t: t.join(' '), d: d.join(' ') };`);
  expect(r.t).toBe('0 1 1 0 0');
  expect(r.d).toBe('1000 0100 0010 0001 1000');
});

test('léptetőmotor: a Jelsorozat félléptetésben lépteti, visszafelé is; a lejátszás a gombbal indul', async ({ page }) => {
  await pcb(page, `pcb.example('stepper'); pcb.sim(true);`);
  const fwd = await pcb<any>(page, `for (let i = 0; i < 10; i++) pcb.sigStep(1); return pcb.simInfo().steppers[0];`);
  expect(fwd).toMatchObject({ pos: 10, coils: 'B' });
  expect(fwd.angle).toBeCloseTo(10 * 360 / 4096, 6);
  expect((await pcb<any>(page, `pcb.sigStep(-3); return pcb.simInfo().steppers[0];`)).pos).toBe(7);
  await page.click('#sigPlay');
  await expect(page.locator('#sigPlay')).toHaveText(/Állj/);
  await page.waitForTimeout(700);
  await page.click('#sigPlay');
  expect((await pcb<any>(page, `return pcb.simInfo().steppers[0];`)).pos).toBeGreaterThan(8);
  // a szimuláció leállítása a lejátszást is megállítja
  await pcb(page, `pcb.sim(false);`);
  expect(await pcb(page, `return pcb.signal().playing;`)).toBe(false);
});

test('példatár a Terv fülön: kategória, betöltés, visszavonás', async ({ page }) => {
  await pcb(page, `pcb.example('rc');`);
  await page.click('#accPlan summary');
  await page.click('.ex-cat[data-excat="Motor"]');
  await expect(page.locator('.ex-item')).toHaveCount(3);
  await page.click('.ex-item[data-ex="servo"]');
  await expect(page.locator('#exMsg')).toContainText('Betöltve: Szervó');
  expect(await pcb(page, `return pcb.get().parts.map(p => p.type).sort();`)).toEqual(['pico', 'servo']);
  await pcb(page, `pcb.undo();`);
  expect(await pcb(page, `return pcb.get().parts.map(p => p.type).sort();`)).toEqual(['elko', 'pico', 'res']);
});
