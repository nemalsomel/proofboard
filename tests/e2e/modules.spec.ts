import { expect, test, type Page } from '@playwright/test';

/* Modulok (joystick, Nokia 5110, TP4056) és a szerep alapú ellenőrzések: tápbemenet (vin), analóg jel (adc). */

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

/** Pico + a megadott alkatrészek + kapcsolatok, automatikus útvonaltervezéssel. */
const design = (parts: object[], links: Array<[string, string]>, usb = true) => `
  const d = { board: { rows: 78, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: {}, seq: 100, auto: { bridges: [], wires: [] },
    parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, mir: false, props: { span: 6 } }, ...${JSON.stringify(parts)}],
    links: ${JSON.stringify(links)}.map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
    settings: { usb: ${usb}, btnMode: 'hold', autoRoute: true } };
  pcb.load(d); pcb.route();`;

const JS = { id: 'p2', type: 'joystick', label: 'JS1', r: 30, c: 8, rot: 0, mir: false, props: { x: 0, y: 0 } };
const jsLinks: Array<[string, string]> = [['p2.VRX', 'GPIO'], ['p2.VRY', 'GPIO'], ['p2.SW', 'GPIO'], ['p2.GND', 'GND'], ['p2.5V', 'p1.36']];

test('joystick: a tengelyek ADC-képes GPIO-ra kerülnek, a csúszka és a gomb a szimulációban', async ({ page }) => {
  const r = await pcb<any>(page, design([JS], jsLinks) + `
    const ls = pcb.links(); pcb.sim(true);
    const adc = () => Object.fromEntries(pcb.read().filter(x => x.mode === 'adc').map(x => [x.pin, x.V]));
    const mid = adc(); pcb.slider('JS1', 'x', 100); const right = adc(); pcb.slider('JS1', 'x', -100); const left = adc();
    const sw = () => pcb.read().find(x => x.pin === ls.find(l => l.a === 'p2.SW').gpio).level;
    const up = sw(); pcb.press('JS1', true); const down = sw();
    return { ok: ls.every(l => l.ok), gx: ls.find(l => l.a === 'p2.VRX').gpio, gy: ls.find(l => l.a === 'p2.VRY').gpio, mid, right, left, up, down,
      iss: pcb.issues().map(i => i.msg), sliders: document.querySelectorAll('#simCtl input[type=range]').length };`);
  expect(r.ok).toBe(true);
  expect(['GP26', 'GP27', 'GP28']).toContain(r.gx);
  expect(['GP26', 'GP27', 'GP28']).toContain(r.gy);
  expect(r.mid[r.gx]).toBeCloseTo(1.65, 2);
  expect(r.right[r.gx]).toBeGreaterThan(3.25);
  expect(r.left[r.gx]).toBeLessThan(0.05);
  expect(r.right[r.gy]).toBeCloseTo(1.65, 2); // a másik tengely nem mozdul
  expect([r.up, r.down]).toEqual(['1', '0']);
  expect(r.iss).toEqual([]);
  expect(r.sliders).toBe(2);
});

test('analóg jel ADC nélküli GPIO-n: figyelmeztet és megnevezi az alkalmas lábakat', async ({ page }) => {
  const r = await pcb<string[]>(page, design([JS], [['p2.VRX', 'p1.21'], ['p2.GND', 'GND'], ['p2.5V', 'p1.36']]) + `return pcb.issues().map(i => i.msg);`);
  expect(r).toContainEqual(expect.stringMatching(/JS1\.VRX: analóg jel a GP16-n, de azon nincs ADC\. Erre alkalmas: GP26, GP27, GP28|GP28, GP27, GP26/));
});

test('az útvonalkereső az ADC-lábakat az analóg jeleknek tartogatja (a kézi minta gombjai mellett is)', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.presetRouted(); const d = pcb.get();
    d.parts.push(${JSON.stringify({ ...JS, id: 'p90', r: 56, c: 4 })});
    d.links.push({ id: 'l900', a: 'p90.VRX', b: 'GPIO', gpio: null }, { id: 'l901', a: 'p90.VRY', b: 'GPIO', gpio: null });
    pcb.load(d); pcb.route(); const ls = pcb.links();
    return { all: ls.length, ok: ls.filter(l => l.ok).length, adc: ls.filter(l => l.a.startsWith('p90.')).map(l => l.gpio) };`);
  expect(r.ok).toBe(r.all);
  for (const g of r.adc) expect(['GP26', 'GP27', 'GP28']).toContain(g);
});

const LCD = { id: 'p3', type: 'nokia5110', label: 'LCD1', r: 50, c: 20, rot: 0, mir: false, props: {} };

test('Nokia 5110: 3,3 V rendben, 5 V-ra kötve hiba, a háttérfény GPIO-ról világít', async ({ page }) => {
  const ok = await pcb<any>(page, design([LCD], [['p3.VCC', 'p1.36'], ['p3.GND', 'GND'], ['p3.BL', 'GPIO']]) + `
    const g = pcb.links().find(l => l.a === 'p3.BL').gpio;
    return { iss: pcb.issues().map(i => i.msg), g };`);
  expect(ok.iss).toEqual([]);
  const lit = await pcb<any>(page, `const d = pcb.get(); const pin = pcb.pins('PICO').find(q => q.name === '${ok.g}');
    d.gpio['p1.' + pin.id] = 'out_high'; pcb.load(d); pcb.sim(true);
    return { I: pcb.simInfo().leds.find(l => l.label === 'LCD1').I, iss: pcb.issues().map(i => i.msg) };`);
  expect(lit.I).toBeGreaterThan(0.005);
  expect(lit.iss).toEqual([]);
  const hi = await pcb<string[]>(page, design([LCD], [['p3.VCC', 'p1.40'], ['p3.GND', 'GND']]) + `return pcb.issues().map(i => i.msg);`);
  expect(hi).toContainEqual(expect.stringMatching(/^LCD1\.VCC: 5\.\d\d V, több a megengedett 3\.6 V-nál$/));
  const none = await pcb<string[]>(page, design([LCD], [['p3.GND', 'GND']]) + `return pcb.issues().map(i => i.msg);`);
  expect(none).toContain('LCD1.VCC: nincs tápfeszültség');
});

const TP = { id: 'p4', type: 'tp4056', label: 'U1', r: 40, c: 10, rot: 0, mir: false, props: { usb: 'on' } };
const BAT = { id: 'p5', type: 'bat', label: 'BAT1', r: 42, c: 25, rot: 0, mir: false, props: { volt: 3.7 } };
const tpLinks: Array<[string, string]> = [['p5.+', 'p4.B+'], ['p5.-', 'p4.B-'], ['p4.OUT-', 'GND'], ['p4.OUT+', 'p1.39']];

test('TP4056: a saját USB-ről tölti az akkut és táplálja a Picót; a Pico USB-je mellett Schottky kell', async ({ page }) => {
  const chg = await pcb<any>(page, design([TP, BAT], tpLinks, false) + `const s = pcb.simInfo();
    return { iss: pcb.issues().map(i => i.msg), bat: s.bats.find(b => b.label === 'BAT1').I, pico: s.picos[0].powered, ok: pcb.links().every(l => l.ok) };`);
  expect(chg).toMatchObject({ iss: [], pico: true, ok: true });
  expect(chg.bat).toBeGreaterThan(0.1); // töltődik
  const batOnly = await pcb<any>(page, design([{ ...TP, props: { usb: 'off' } }, BAT], tpLinks, false) + `const s = pcb.simInfo();
    return { iss: pcb.issues().map(i => i.msg), pico: s.picos[0].powered };`);
  expect(batOnly).toEqual({ iss: [], pico: true }); // akkuról megy, a bedugatlan USB-bemenet nem hiba
  const both = await pcb<string[]>(page, design([TP, BAT], tpLinks, true) + `return pcb.issues().map(i => i.msg);`);
  expect(both).toContainEqual(expect.stringContaining('BAT1: a Pico USB-je a VSYS-en át közvetlenül tölti az akkut'));
});

test('Pico sortáv szabadon állítható (pl. 8), a lábak és a GPIO-k követik', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.preset(); pcb.select(['PICO']); const el = document.querySelector('#pp_span');
    el.value = '8'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    const ps = pcb.pins('PICO'), rows = [...new Set(ps.map(q => q.r))].sort((a, b) => a - b);
    return { type: el.type, span: pcb.get().parts.find(p => p.label === 'PICO').props.span, rows };`);
  expect(r).toMatchObject({ type: 'number', span: 8 });
  expect(r.rows[1] - r.rows[0]).toBe(8);
});
