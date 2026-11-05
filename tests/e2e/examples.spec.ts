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
    pcb.sim(false); pcb.example('decoder'); pcb.progAuto(false); pcb.sim(true); const d = [L()]; for (let i = 0; i < 4; i++) { pcb.progStep(250); pcb.progStep(250); d.push(L()); }
    return { t: t.join(' '), d: d.join(' ') };`);
  expect(r.t).toBe('0 1 1 0 0');
  expect(r.d).toBe('1000 0100 0010 0001 1000');
});

test('léptetőmotor: a program Sorozat blokkja félléptetésben lépteti, visszafelé is', async ({ page }) => {
  // Ütemadó (125 ms) → Sorozat → 4 kimenet; a program kézzel léptetve (fél periódusonként egy kiértékelés)
  const st = (n: number) => pcb<any>(page, `for (let i = 0; i < ${n}; i++) pcb.progStep(62.5); return pcb.simInfo().steppers[0];`);
  await pcb(page, `pcb.example('stepper'); pcb.progAuto(false); pcb.sim(true);`);
  const p0 = (await st(0)).pos, fwd = await st(20);
  expect(fwd.pos - p0).toBe(10);
  expect(fwd.angle).toBeCloseTo(fwd.pos * 360 / 4096, 6);
  // irány: vissza
  await pcb(page, `const pr = pcb.program(); pr.nodes.find(n => n.type === 'seq').props.dir = 'back'; pcb.program(pr);`);
  const b0 = (await st(1)).pos, back = await st(6); // az első kiértékelés az új (nullázott) sorozat kezdősora
  expect(back.pos - b0).toBe(-3);
  expect(await pcb(page, `return pcb.issues().filter(i => i.sev === 'err').length;`)).toBe(0);
});

test('példatár a Fájl menüből: kategória, betöltés, visszavonás', async ({ page }) => {
  await pcb(page, `pcb.example('rc');`);
  await page.click('#bFile');
  await page.click('#bExamples');
  await expect(page.locator('#dlgEx')).toBeVisible();
  await page.click('.ex-cat[data-excat="Motor"]');
  await expect(page.locator('.ex-item')).toHaveCount(3);
  await page.click('.ex-item[data-ex="servo"]');
  await expect(page.locator('#toast')).toContainText('Betöltve: Szervó');
  await expect(page.locator('#dlgEx')).toBeHidden();
  expect(await pcb(page, `return pcb.get().parts.map(p => p.type).sort();`)).toEqual(['header', 'pico', 'servo']); // a szervó kábele tüskesorba dugva
  await pcb(page, `pcb.undo();`);
  expect(await pcb(page, `return pcb.get().parts.map(p => p.type).sort();`)).toEqual(['elko', 'pico', 'res']);
});

test('példák ablaka: balra a kategóriák darabszámmal, jobbra kártyák (szint, mit tanulsz); keresés minden kategóriában', async ({ page }) => {
  await page.click('#bFile');
  await page.click('#bExamples');
  const cats = page.locator('#examples .ex-cats .ex-cat');
  const c0 = (await cats.nth(0).boundingBox())!, c1 = (await cats.nth(1).boundingBox())!;
  expect(c1.y).toBeGreaterThan(c0.y); // egymás alatt, egy oszlopban
  await expect(page.locator('.ex-cat[data-excat="Program"] .ex-n')).toHaveText('7');
  await page.click('.ex-cat[data-excat="Program"]');
  const card = page.locator('.ex-item[data-ex="prog-chase"]');
  await expect(card.locator('.ex-tag')).toContainText(['kezdő', 'program']); // a kategória csak keresésnél
  await expect(card.locator('.ex-learn li')).toHaveCount(3);
  await page.fill('#exSearch', 'késleltetés');
  await expect(page.locator('.ex-item')).toHaveCount(1);
  await expect(page.locator('.ex-item')).toHaveAttribute('data-ex', 'prog-delay');
});

test('új tanító példák: futófény, ÉS gombokkal, saját XOR modul belső kapcsolással', async ({ page }) => {
  const led = (l: string) => `return ((pcb.simInfo().leds.find(x => x.label === '${l}') || {}).I || 0) > 2e-4;`; // világít
  await pcb(page, `pcb.example('prog-and'); pcb.sim(true);`);
  await expect.poll(() => pcb(page, led('LED1'))).toBe(false);
  await pcb(page, `pcb.press('SW1', true); pcb.press('SW2', true);`);
  await expect.poll(() => pcb(page, led('LED1'))).toBe(true);
  await pcb(page, `pcb.press('SW2', false);`);
  await expect.poll(() => pcb(page, led('LED1'))).toBe(false);
  await pcb(page, `pcb.sim(false); pcb.example('custom-xor'); pcb.sim(true);`);
  await expect.poll(() => pcb(page, led('LED1'))).toBe(false);
  await pcb(page, `pcb.press('SW1', true);`);
  await expect.poll(() => pcb(page, led('LED1'))).toBe(true);
  await pcb(page, `pcb.press('SW2', true);`);
  await expect.poll(() => pcb(page, led('LED1'))).toBe(false);
  // a saját alkatrész a szerkesztőben a belső kapcsolás diagramjával nyílik
  await pcb(page, `pcb.sim(false); pcb.select(['U1']);`);
  await page.click('#pEditDef');
  await page.click('.pe [data-tab="func"]');
  await expect(page.locator('.cg [data-k="gate"]')).toHaveText([/KIZÁRÓ VAGY/]);
});
