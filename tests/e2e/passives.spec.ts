import { expect, test, type Page } from '@playwright/test';

/* Kondenzátor (kerámia, elektrolit) és NPN tranzisztor a szimulációban és az ellenőrzésben. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

type Run = { bad: string[]; iss: string[]; caps: any[]; bjts: any[]; leds: Array<[string, number]> };
const run = (page: Page, parts: object[], links: Array<[string, string]>, gpio: Record<string, string> = {}): Promise<Run> =>
  page.evaluate(([parts, links, gpio]) => {
    const pcb = (window as any).pcb;
    pcb.load({ board: { rows: 78, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio, seq: 100, auto: { bridges: [], wires: [] },
      parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, mir: false, props: { span: 6 } }, ...(parts as object[])],
      links: (links as Array<[string, string]>).map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
      settings: { usb: true, btnMode: 'hold', autoRoute: true } });
    pcb.route();
    const s = pcb.simInfo();
    return { bad: pcb.links().filter((l: any) => !l.ok).map((l: any) => l.text), iss: pcb.issues().map((i: any) => i.msg), caps: s.caps, bjts: s.bjts, leds: s.leds.map((l: any) => [l.label, l.I]) };
  }, [parts, links, gpio] as const) as Promise<Run>;

const part = (id: string, type: string, label: string, r: number, c: number, props: object = {}) => ({ id, type, label, r, c, rot: 0, mir: false, props });
const R = (id: string, label: string, r: number, c: number, ohm: number) => part(id, 'res', label, r, c, { ohm, dr: 0, dc: 4 });

test('RC-tag: a kondenzátor feltöltődik, az időállandó R·C', async ({ page }) => {
  const r = await run(page, [R('p2', 'R1', 30, 5, 10000), part('p3', 'cap', 'C1', 30, 15, { f: 100e-9 })], [['p2.1', 'p1.36'], ['p2.2', 'p3.1'], ['p3.2', 'GND']]);
  expect(r.bad).toEqual([]);
  expect(r.iss).toEqual([]);
  expect(r.caps[0].U).toBeCloseTo(3.3, 2);
  expect(r.caps[0].tau).toBeCloseTo(1e-3, 5); // 10 kΩ · 100 nF
});

test('kondenzátor: fordított elektrolit és túl nagy feszültség hiba', async ({ page }) => {
  const rev = await run(page, [part('p3', 'elko', 'C2', 30, 15, { f: 10e-6, volt: 16 })], [['p3.-', 'p1.36'], ['p3.+', 'GND']]);
  expect(rev.iss).toEqual(['C2: fordítva van bekötve (-3.30 V). Az elektrolit kondenzátor + lába kerüljön a magasabb feszültségre.']);
  const over = await run(page, [part('p3', 'cap', 'C3', 30, 15, { f: 1e-6, volt: 3 })], [['p3.1', 'p1.40'], ['p3.2', 'GND']]);
  expect(over.iss).toEqual(['C3: 5.00 V, több a névleges 3 V-nál']);
});

const npnSwitch = (rb: number) => [
  [R('p2', 'R1', 30, 5, rb), part('p3', 'npn', 'Q1', 40, 10, { kind: 'BC547' }), part('p4', 'led', 'LED1', 36, 20, { color: 'red', dr: 0, dc: 1 }), R('p5', 'R2', 30, 22, 220)],
  [['p2.1', 'p1.21'], ['p2.2', 'p3.B'], ['p3.E', 'GND'], ['p3.C', 'p4.K'], ['p4.A', 'p5.1'], ['p5.2', 'p1.36']],
] as const;

test('NPN kapcsoló: GPIO-ról telítve kapcsolja a LED-et, nagy bázisellenállásnál figyelmeztet, lebegő bázisnál is', async ({ page }) => {
  const [parts, links] = npnSwitch(1000);
  const on = await run(page, [...parts], [...links] as Array<[string, string]>, { 'p1.21': 'out_high' });
  expect(on.bad).toEqual([]);
  expect(on.iss).toEqual([]);
  expect(on.bjts[0]).toMatchObject({ label: 'Q1', st: 'sat' });
  expect(on.bjts[0].vce).toBeLessThan(0.2);
  expect(on.leds[0][1]).toBeGreaterThan(0.004);
  const off = await run(page, [...parts], [...links] as Array<[string, string]>, { 'p1.21': 'out_low' });
  expect(off.bjts[0].st).toBe('off');
  expect(off.leds[0][1]).toBeLessThan(1e-6);
  const [p2, l2] = npnSwitch(470000);
  const weak = await run(page, [...p2], [...l2] as Array<[string, string]>, { 'p1.21': 'out_high' });
  expect(weak.bjts[0].st).toBe('act');
  expect(weak.bjts[0].ic).toBeCloseTo(200 * weak.bjts[0].ib, 6); // Ic = β·Ib
  expect(weak.iss).toContainEqual(expect.stringMatching(/^Q1: nem telítődik/));
  const fl = await run(page, [...parts], [...links] as Array<[string, string]>, { 'p1.21': 'float' });
  expect(fl.iss).toContainEqual(expect.stringMatching(/^Q1: a bázis lebeg/));
});

test('NPN emitterkövető: aktív tartományban konvergál (Ue ≈ Ub − 0,65 V)', async ({ page }) => {
  // bázis: 3V3-ról 10k/10k osztó; emitter: 1 kΩ a GND felé; kollektor: VBUS
  const r = await run(page, [R('p2', 'R1', 30, 2, 10000), R('p3', 'R2', 34, 2, 10000), part('p4', 'npn', 'Q1', 40, 12, { kind: '2N3904' }), R('p5', 'R3', 46, 12, 1000)],
    [['p2.1', 'p1.36'], ['p2.2', 'p3.1'], ['p3.2', 'GND'], ['p4.B', 'p2.2'], ['p4.C', 'p1.40'], ['p4.E', 'p5.1'], ['p5.2', 'GND']]);
  expect(r.bad).toEqual([]);
  expect(r.bjts[0].st).toBe('act');
  expect(r.bjts[0].vbe).toBeCloseTo(0.65, 1);
  expect(r.bjts[0].ic).toBeCloseTo(150 * r.bjts[0].ib, 5);
});
