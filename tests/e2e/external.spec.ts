import { expect, test, type Page } from '@playwright/test';

/* Külső alkatrészek (DC motor, szervó) kábellel, PWM a szimulációban. */

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
const part = (id: string, type: string, label: string, r: number, c: number, props: object = {}, rot = 0) => ({ id, type, label, r, c, rot, mir: false, props });
const design = (parts: object[], links: Array<[string, string]>, extra = '') => `
  const d = { board: { rows: 78, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: {}, pwm: {}, seq: 100, auto: { bridges: [], wires: [] },
    parts: [${JSON.stringify(part('p1', 'pico', 'PICO', 12, 32, { span: 6 }, 2))}, ...${JSON.stringify(parts)}],
    links: ${JSON.stringify(links)}.map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
    settings: { usb: true, btnMode: 'hold', autoRoute: true } }; ${extra}
  pcb.load(d); pcb.route();`;

const M1 = part('p2', 'motor', 'M1', 40, -5), Q1 = part('p3', 'nmos', 'Q1', 40, 6), D1 = part('p4', 'diode', 'D1', 36, 4, { kind: '1N5817', dr: 0, dc: 4 });
const motorLinks: Array<[string, string]> = [['p2.+', 'p1.36'], ['p2.-', 'p3.D'], ['p3.S', 'GND'], ['p3.G', 'GPIO'], ['p4.K', 'p2.+'], ['p4.A', 'p2.-']];

test('DC motor kábellel, MOSFET-tel és PWM-mel: a fordulat a kitöltéssel arányos', async ({ page }) => {
  const r = await pcb<any>(page, design([M1, Q1, D1], motorLinks) + `
    const ls = pcb.links(), g = ls.find(l => l.a === 'p3.G').gpio;
    const at = duty => { pcb.pwm(g, duty, 1000); return pcb.simInfo().motors[0].speed; };
    return { ok: ls.every(l => l.ok), cables: ls.filter(l => l.cable).length, s100: at(100), s50: at(50), s0: at(0),
      iss: pcb.issues().map(i => i.msg), mode: pcb.read().find(x => x.pin === g).level };`);
  expect(r.ok).toBe(true);
  expect(r.cables).toBe(4); // M1 két kivezetése: táp, MOSFET, és a dióda két vége
  expect(r.s100).toBeGreaterThan(0.8);
  expect(r.s50).toBeCloseTo(r.s100 / 2, 3);
  expect(Math.abs(r.s0)).toBeLessThan(1e-3);
  expect(r.iss).toEqual([]);
  expect(r.mode).toBe('P');
});

test('motor: visszacsapó dióda nélkül figyelmeztet, GPIO-ról közvetlenül hiba', async ({ page }) => {
  const noDiode = await pcb<string[]>(page, design([M1, Q1], motorLinks.slice(0, 4)) + `return pcb.issues().map(i => i.msg);`);
  expect(noDiode).toContainEqual(expect.stringMatching(/^M1: nincs visszacsapó dióda a motoron/));
  const direct = await pcb<string[]>(page, design([M1], [['p2.+', 'GPIO'], ['p2.-', 'GND']]) + `return pcb.issues().map(i => i.msg);`);
  expect(direct).toContain('M1: a motor közvetlenül GPIO-ra van kötve. Tranzisztor vagy MOSFET kell a meghajtásához.');
});

const SV = part('p5', 'servo', 'SV1', 66, -6);
const servoLinks: Array<[string, string]> = [['p5.GND', 'GND'], ['p5.V+', 'p1.40'], ['p5.SIG', 'GPIO']];

test('szervó: a szög a PWM impulzusszélességéből (50 Hz), érvénytelen jelre figyelmeztet', async ({ page }) => {
  const r = await pcb<any>(page, design([SV], servoLinks) + `
    const g = pcb.links().find(l => l.a === 'p5.SIG').gpio, none = pcb.issues().map(i => i.msg);
    const at = (duty, f) => { pcb.pwm(g, duty, f); const s = pcb.simInfo().servos[0]; return [s.angle, pcb.issues().length]; };
    return { none, mid: at(7.5, 50), q: at(5, 50), max: at(12.5, 50), fast: at(50, 1000) };`);
  expect(r.none).toContainEqual(expect.stringMatching(/^SV1: nincs érvényes szervójel/));
  expect(r.mid).toEqual([90, 0]);
  expect(r.q).toEqual([45, 0]);
  expect(r.max).toEqual([180, 0]);
  expect(r.fast[0]).toBeNull();
  expect(r.fast[1]).toBe(1);
});

test('kézi kábel a kivezetéshez, és a külső alkatrész nem tehető a panelra', async ({ page }) => {
  const r = await pcb<any>(page, `
    const d = { board: { rows: 78, cols: 39, sec: 3 }, customParts: {}, bridges: [], links: [], gpio: {}, pwm: {}, seq: 100, auto: { bridges: [], wires: [] },
      parts: [${JSON.stringify(part('p1', 'pico', 'PICO', 12, 32, { span: 6 }, 2))}, ${JSON.stringify(M1)}],
      wires: [], settings: { usb: true, btnMode: 'hold', autoRoute: false } };
    const v33 = pcb.load(d) && pcb.pins('PICO').find(q => q.name === '3V3'), gnd = pcb.pins('PICO').find(q => q.name === 'GND');
    const m = pcb.pins('M1');
    d.wires = [{ a: [m[0].r, m[0].c], b: [v33.r + 1, v33.c], color: '#c92a2a' }, { a: [m[1].r, m[1].c], b: [gnd.r + 1, gnd.c], color: '#212529' }];
    pcb.load(d); const p2 = pcb.pins('M1'), p1 = pcb.pins('PICO');
    return { plus: p2[0].net === p1.find(q => q.name === '3V3').net, minus: p2[1].net === p1.find(q => q.name === 'GND').net,
      speed: pcb.simInfo().motors[0].speed, iss: pcb.issues().map(i => i.msg), onBoard: pcb.move('M1', 0, 12), nearBoard: pcb.move('M1', 2, 0) };`);
  expect(r).toMatchObject({ plus: true, minus: true, onBoard: false, nearBoard: true });
  expect(r.speed).toBeCloseTo(1.1, 1); // 3,3 V a 3 V-os motoron
  expect(r.iss).toContainEqual(expect.stringMatching(/^M1: nincs visszacsapó dióda/));
});

test('PWM-mel hajtott LED: az átlagáram a kitöltéssel arányos', async ({ page }) => {
  const r = await pcb<any>(page, design([part('p2', 'res', 'R1', 30, 5, { ohm: 220, dr: 0, dc: 4 }), part('p3', 'led', 'LED1', 30, 12, { color: 'red', dr: 0, dc: 1 })],
    [['p2.1', 'p1.21'], ['p2.2', 'p3.A'], ['p3.K', 'GND']]) + `
    const I = duty => { pcb.pwm('GP16', duty, 1000); return pcb.simInfo().leds[0].I; };
    return { full: I(100), quarter: I(25) };`);
  expect(r.full).toBeGreaterThan(0.004);
  expect(r.quarter).toBeCloseTo(r.full / 4, 6);
});

test('felület: a motor csak a panel mellé rakható, vezeték köthető a kivezetéséhez', async ({ page }) => {
  await pcb(page, `pcb.load({ board: { rows: 78, cols: 39, sec: 3 }, parts: [], bridges: [], wires: [], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 10 });`);
  const at = async (r: number, c: number) => { const p = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(${r}, ${c});`); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); };
  await page.click('[data-lib="motor"]');
  await at(50, 10); // a panelon: nem rakható le
  await at(56, -6); // mellette: igen
  expect(await pcb(page, `return pcb.get().parts.map(p => p.label + '@' + p.r + ':' + p.c);`)).toEqual(['M1@56:-6']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await at(56, -6);
  await at(56, 3);
  expect(await pcb(page, `return pcb.get().wires.map(w => w.a.join(':') + '-' + w.b.join(':'));`)).toEqual(['56:-6-56:3']);
});
