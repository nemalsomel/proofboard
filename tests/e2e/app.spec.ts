import { expect, test, type Page } from '@playwright/test';

// A tesztek a `window.pcb` API-n és a DOM-on keresztül dolgoznak.
const W = 'window.pcb';
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

const pcb = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const pcb = ${W}; ${fn} })()`) as Promise<T>;

const MAPPING = { Fn: 'GP16', K1: 'GP19', K2: 'GP20', K3: 'GP28', K4: 'GP18', K5: 'GP21', K6: 'GP27', K7: 'GP17', K8: 'GP22', K9: 'GP26' };
const pressAll = `const r = {}; for (const k of ${JSON.stringify(Object.keys(MAPPING))}) { pcb.press(k, true);
  r[k] = pcb.read().filter(x => x.mode === 'pullup' && x.level === '0').map(x => x.pin).join(','); pcb.press(k, false); }
  pcb.sim(false); return r;`;

test('a kézi macropad minta hibátlan, 157 hídból áll', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.preset(); const d = pcb.get(); return { iss: pcb.issues(), br: d.bridges.length, w: d.wires.length };`);
  expect(r).toEqual({ iss: [], br: 157, w: 0 });
});

test('minden gomb pontosan a saját GPIO-ját húzza le', async ({ page }) => {
  expect(await pcb(page, `pcb.preset(); ${pressAll}`)).toEqual(MAPPING);
});

test('kézi → automatikus: ugyanazok a hidak, mozgatás után csak az érintettek változnak', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.preset(); const n = pcb.toAuto();
    const k5 = new Set(pcb.links().filter(l => l.text.startsWith('K5')).map(l => l.id));
    const others = pcb.get().auto.bridges.filter(b => !b[4].some(id => k5.has(id))).map(b => b.slice(0, 4).join(','));
    const before = { n, auto: pcb.get().auto.bridges.length };
    const moved = pcb.move('K5', 3, -1);
    const after = new Set(pcb.get().auto.bridges.map(b => b.slice(0, 4).join(',')));
    const ls = pcb.links();
    return { ...before, moved, ok: ls.filter(l => l.ok).length, total: ls.length, wires: pcb.get().auto.wires.length,
      kept: others.filter(x => after.has(x)).length / others.length, k5: ls.find(l => l.text === 'K5.A → GPIO').gpio, iss: pcb.issues().length };`);
  expect(r).toMatchObject({ n: 29, auto: 157, moved: true, ok: 29, total: 29, wires: 0, iss: 0 });
  expect(r.kept).toBeGreaterThan(0.9);
  expect(r.k5).toBe('GP21');
  expect(await pcb(page, pressAll)).toEqual(MAPPING);
});

test('útvonalkeresős minta: minden kapcsolat vezeték nélkül bekötődik', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const ls = pcb.links();
    return { ok: ls.filter(l => l.ok).length, total: ls.length, wires: pcb.get().auto.wires.length, iss: pcb.issues().length };`);
  expect(r).toEqual({ ok: 29, total: 29, wires: 0, iss: 0 });
});

const base = `({ board: { rows: 78, cols: 39, sec: 3 }, parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, mir: false, props: { span: 6 } }],
  bridges: [], wires: [], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 50 })`;
const W_ = `const W = (d, a, b) => d.wires.push({ a, b, color: '#1c7ed6' });`;

test('Schottky-dióda: az USB nem tölti az akkut, USB nélkül az akku táplál', async ({ page }) => {
  const r = await pcb<any>(page, `${W_} let d = ${base};
    d.parts.push({ id: 'p2', type: 'bat', label: 'BAT', r: 30, c: 2, rot: 0, props: { volt: 3.7 } }, { id: 'p3', type: 'diode', label: 'D1', r: 33, c: 2, rot: 0, props: { kind: '1N5817' } });
    W(d, [31, 2], [34, 2]); W(d, [34, 6], [13, 31]); W(d, [31, 3], [13, 30]);
    pcb.load(d); const withDiode = { iss: pcb.issues().map(i => i.msg), batI: pcb.simInfo().bats[0].I };
    d.settings.usb = false; pcb.load(d); const batOnly = { powered: pcb.simInfo().picos[0].powered, vsys: pcb.netV('PICO', '39') };
    d.settings.usb = true; d.parts = d.parts.filter(x => x.id !== 'p3'); d.wires.push({ a: [35, 2], b: [35, 6], color: '#000' }); pcb.load(d);
    return { withDiode, batOnly, noDiode: pcb.issues().map(i => i.msg) };`);
  expect(r.withDiode.iss).toEqual([]);
  expect(Math.abs(r.withDiode.batI)).toBeLessThan(1e-4);
  expect(r.batOnly.powered).toBe(true);
  expect(r.batOnly.vsys).toBeCloseTo(3.4, 1);
  expect(r.noDiode).toContainEqual(expect.stringContaining('BAT: a Pico USB-je a VSYS-en át közvetlenül tölti az akkut'));
});

test('N-MOSFET kapcsolja a LED-et, lebegő gate-re figyelmeztet', async ({ page }) => {
  const r = await pcb<any>(page, `${W_} const d = ${base};
    d.parts.push({ id: 'p4', type: 'nmos', label: 'Q1', r: 40, c: 10, rot: 0, props: {} }, { id: 'p5', type: 'res', label: 'R1', r: 46, c: 20, rot: 0, props: { ohm: 220 } }, { id: 'p6', type: 'led', label: 'LED1', r: 45, c: 24, rot: 0, props: { color: 'green' } });
    W(d, [13, 28], [47, 20]); W(d, [47, 25], [41, 12]); W(d, [41, 10], [14, 30]); W(d, [41, 11], [14, 13]);
    const run = m => { d.gpio = { 'p1.21': m }; pcb.load(d); const s = pcb.simInfo(); return { on: s.fets[0].on, led: s.leds[0].I, iss: pcb.issues().map(i => i.msg) }; };
    return { high: run('out_high'), low: run('out_low'), float: run('float') };`);
  expect(r.high.on).toBe(true);
  expect(r.high.led * 1000).toBeGreaterThan(3);
  expect(r.high.iss).toEqual([]);
  expect(r.low.on).toBe(false);
  expect(r.low.led).toBeLessThan(1e-6);
  expect(r.float.iss.join(' ')).toContain('a gate lebeg');
});

test('átkötő huzal: a két vége egy hálózat', async ({ page }) => {
  const r = await pcb<any>(page, `const d = ${base}; d.parts.push({ id: 'p7', type: 'jumper', label: 'JP1', r: 50, c: 2, rot: 0, props: { dr: 0, dc: 3 } });
    pcb.load(d); const p = pcb.pins('JP1'); return p[0].net === p[1].net;`);
  expect(r).toBe(true);
});

test('tulajdonságpanel: SI-érték, E12-léptetés, a fókusz a mezőben marad', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.select(['R1']);`);
  const f = page.locator('#pp_ohm');
  await f.fill('4k7'); await f.press('Enter');
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'R1').props.ohm;`)).toBe(4700);
  await expect(page.locator('#pp_ohm')).toBeFocused();
  await page.locator('#pp_ohm').press('ArrowUp');
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'R1').props.ohm;`)).toBe(5600);
  await expect(page.locator('#pp_ohm')).toBeFocused();
  await page.locator('#pp_ohm').fill('xyz'); await page.locator('#pp_ohm').press('Enter');
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'R1').props.ohm;`)).toBe(5600);
});

test('LED színe a színkorongokkal állítható', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.select(['LED2']);`);
  await page.locator('[data-pk="color"][data-pv="blue"]').click();
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'LED2').props.color;`)).toBe('blue');
});

test('a Pico tükrözése és forgatása a közepe körül történik', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const span = () => { const ps = pcb.pins('PICO'); const c = ps.map(q => q.c), rr = ps.map(q => q.r);
      return [Math.min(...rr), Math.max(...rr), Math.min(...c), Math.max(...c)].join(','); };
    const a = span(); pcb.select(['PICO']); pcb.mirror(); const b = span(); pcb.mirror(); const c = span();
    return { a, b, c, iss: pcb.issues().length };`);
  expect(r.b).toBe(r.a);
  expect(r.c).toBe(r.a);
  expect(r.iss).toBe(0);
});

test('panelméret váltása és visszavonása', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.click('#accBoard summary'); // a Panel harmonika alapból csukva
  await page.locator('#bdPreset').selectOption({ label: '5×7 cm pontraszter (18×24)' });
  await page.locator('#bdApply').click();
  expect(await pcb(page, `return pcb.get().board;`)).toEqual({ cols: 18, rows: 24, sec: 1 });
  await expect(page.locator('#boardInfo')).toContainText('18×24');
  await pcb(page, `pcb.undo();`);
  expect(await pcb(page, `return pcb.get().board;`)).toMatchObject({ cols: 39, rows: 78, sec: 3 });
});

test('kapcsolat kiválasztása: kezdet, cél és útvonal', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const info = pcb.linkInfo(); const i = info.findIndex(x => x.text === 'Fn.A → GPIO');
    return { info: info[i], status: pcb.selectLink(i) };`);
  expect(r.info.endPin).toMatch(/^PICO\.GP\d+$/);
  expect(r.info.bridges).toBeGreaterThan(0);
  expect(r.status).toContain('kezdet');
  expect(r.status).toContain('cél');
});

test('jobb oldali sáv: fülek, a szimuláció indításakor a Szimuláció fül, leállításkor vissza; a harmonika állapota megmarad', async ({ page }) => {
  await expect(page.locator('.rtab.on')).toHaveText('Terv');
  await expect(page.locator('#accLinks')).toHaveAttribute('open', '');
  await expect(page.locator('#accBoard')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-rtab="check"] #issueSum')).toContainText('Rendben'); // az összegzés a fülön látszik
  await page.click('[data-rtab="check"]');
  await expect(page.locator('#issues')).toBeVisible();
  await page.click('#bSim');
  await expect(page.locator('.rtab.on')).toHaveText('Szimuláció');
  await expect(page.locator('#simOut')).toBeVisible();
  await page.click('[data-rtab="design"]'); // el lehet kapcsolni
  await expect(page.locator('#simOut')).toBeHidden();
  await page.click('[data-rtab="sim"]');
  await page.click('#bSim');
  await expect(page.locator('.rtab.on')).toHaveAttribute('data-rtab', 'check'); // vissza oda, ahonnan indult
  await page.click('[data-rtab="design"]');
  await page.click('#accBoard summary');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('proofboard.ui.right') || '{}').acc || {}).accBoard === true);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).pcb);
  await expect(page.locator('#accBoard')).toHaveAttribute('open', '');
  await expect(page.locator('.rtab.on')).toHaveText('Terv');
});
