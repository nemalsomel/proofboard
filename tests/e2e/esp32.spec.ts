import { expect, test, type Page } from '@playwright/test';

/* ESP32 vezérlőlapok: DOIT DevKit V1 (30 láb) és ESP32-C3 SuperMini; képességek, ellenőrzések, vezérlőcsere. */

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
const load = (mcu: string, parts: object[], links: Array<[string, string]>, usb = true) => `
  pcb.load({ board: { rows: 48, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: {}, pwm: {}, seq: 100, auto: { bridges: [], wires: [] },
    parts: [${JSON.stringify(part('p1', mcu, 'ESP1', 12, 30, {}, 2))}, ...${JSON.stringify(parts)}],
    links: ${JSON.stringify(links)}.map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
    settings: { usb: ${usb}, btnMode: 'hold', autoRoute: true } }); pcb.route();`;

const BTN = part('p2', 'button', 'SW1', 20, 8), R1 = part('p3', 'res', 'R1', 20, 26, { ohm: 330, dr: 0, dc: 4 }), LED = part('p4', 'led', 'LED1', 26, 30, { color: 'red', dr: 0, dc: 1 }), JS = part('p5', 'joystick', 'JS1', 30, 14);
const LINKS: Array<[string, string]> = [['p2.A1', 'GPIO'], ['p2.B1', 'GND'], ['p3.1', 'GPIO'], ['p3.2', 'p4.A'], ['p4.K', 'GND'],
  ['p5.GND', 'GND'], ['p5.5V', 'p1.3V3'], ['p5.VRX', 'GPIO'], ['p5.VRY', 'GPIO'], ['p5.SW', 'GPIO']];

const AVOID = { esp32: ['GPIO1', 'GPIO2', 'GPIO3', 'GPIO5', 'GPIO12', 'GPIO15', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39'], esp32c3: ['GPIO2', 'GPIO8', 'GPIO9', 'GPIO20', 'GPIO21'] };
for (const [type, adc] of [['esp32', ['GPIO32', 'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39']], ['esp32c3', ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4']]] as const) {
  test(`${type}: az útvonalkereső bekötése hibátlan; analóg jel ADC1-re, a többi nem indítási/soros lábra`, async ({ page }) => {
    const r = await pcb<any>(page, load(type, [BTN, R1, LED, JS], LINKS) + `
      const ls = pcb.links(), g = a => ls.find(l => l.a === a).gpio; pcb.gpio(g('p3.1'), 'out_high'); pcb.sim(true);
      return { bad: ls.filter(l => !l.ok).map(l => l.text), g: ['p2.A1', 'p3.1', 'p5.VRX', 'p5.VRY', 'p5.SW'].map(g), iss: pcb.issues().map(i => i.msg),
        led: pcb.simInfo().leds[0].I, powered: pcb.simInfo().picos[0].powered, adc: pcb.read().filter(x => x.level === 'A').map(x => x.pin) };`);
    expect(r.bad).toEqual([]);
    expect(r.iss).toEqual([]);
    expect(r.powered).toBe(true);
    expect(r.led).toBeGreaterThan(0.003);
    expect(adc).toContain(r.g[2]);
    expect(adc).toContain(r.g[3]);
    for (const x of [r.g[0], r.g[1], r.g[4]]) expect(AVOID[type]).not.toContain(x);
    expect(r.adc.sort()).toEqual([r.g[2], r.g[3]].sort());
  });
}

test('ESP32 csapdák: csak bemeneti láb gombbal lebeg, kimenetnek nem állítható; indítási láb, ADC2, kevés VIN-feszültség', async ({ page }) => {
  const r = await pcb<any>(page, load('esp32', [BTN], [['p2.A1', 'p1.GPIO34'], ['p2.B1', 'GND']]) + `
    pcb.sim(true); const o = { btn: pcb.issues().map(i => i.msg), out: pcb.gpio('GPIO34', 'out_high'), pwm: pcb.pwm('GPIO34', 50, 1000) }; pcb.sim(false);
    ${load('esp32', [R1, LED], [['p3.1', 'p1.GPIO12'], ['p3.2', 'p4.A'], ['p4.K', 'GND']])} o.strap = pcb.issues().map(i => i.msg);
    ${load('esp32', [JS], [['p5.GND', 'GND'], ['p5.5V', 'p1.3V3'], ['p5.VRX', 'p1.GPIO25'], ['p5.VRY', 'GPIO'], ['p5.SW', 'GPIO']])} o.adc2 = pcb.issues().map(i => i.msg);
    ${load('esp32', [part('p6', 'bat', 'BT1', 30, 4, { volt: 3.7 })], [['p6.+', 'p1.VIN'], ['p6.-', 'GND']], false)} pcb.sim(true); o.vin = [pcb.issues().map(i => i.msg), pcb.simInfo().picos[0].powered];
    return o;`);
  expect(r.btn).toEqual(['GPIO34: lebeg, amíg a gomb nincs lenyomva (ezen a lábon nincs belső felhúzó ellenállás). Tegyél külső felhúzó ellenállást (pl. 10 kΩ a 3V3-ra), vagy válassz másik GPIO-t.']);
  expect(r.out).toBe(false);
  expect(r.pwm).toBe(false);
  expect(r.strap).toEqual([expect.stringMatching(/^ESP1\.GPIO12: indítási \(strapping\) láb \(MTDI\)/)]);
  expect(r.adc2).toEqual([expect.stringMatching(/^GPIO25: ADC2-csatorna, bekapcsolt WiFi mellett nem mér/)]);
  expect(r.vin[0]).toEqual(['ESP1: a tápbemeneten (VIN) csak 3.70 V van, a stabilizátornak legalább 4.2 V kell, így nincs 3,3 V']);
  expect(r.vin[1]).toBe(false);
});

test('ESP32-C3: az 5V láb közvetlenül az USB-n van, akku mellette hiba; USB nélkül az akku táplál', async ({ page }) => {
  const BAT = part('p6', 'bat', 'BT1', 30, 4, { volt: 3.7 });
  const r = await pcb<any>(page, load('esp32c3', [BAT], [['p6.+', 'p1.5V'], ['p6.-', 'GND']]) + `pcb.sim(true); const usb = pcb.issues().map(i => i.msg); pcb.sim(false);
    ${load('esp32c3', [BAT], [['p6.+', 'p1.5V'], ['p6.-', 'GND']], false)} pcb.sim(true); return { usb, bat: [pcb.issues().length, pcb.simInfo().picos[0].powered] };`);
  expect(r.usb).toContainEqual(expect.stringMatching(/^BT1: a ESP1 USB-je a tápbemeneten \(5V\) át közvetlenül tölti az akkut/));
  expect(r.bat).toEqual([0, true]);
});

test('vezérlőcsere: a példák ESP32-re cserélve is működnek (PWM-beállítás, Jelsorozat átkerül), visszavonható', async ({ page }) => {
  const r = await pcb<any>(page, `
    pcb.example('servo'); pcb.swapMcu('PICO', 'esp32'); pcb.sim(true); const servo = pcb.simInfo().servos[0].angle; const sw = pcb.get().parts[0].type; pcb.sim(false);
    pcb.example('stepper'); const res = pcb.swapMcu('PICO', 'esp32c3'); const pins = pcb.signal().pins; pcb.sim(true); for (let i = 0; i < 5; i++) pcb.sigStep(1);
    const st = pcb.simInfo().steppers[0].pos, ok = pcb.links().every(l => l.ok); pcb.sim(false);
    pcb.undo(); return { servo, sw, pins, st, ok, dropped: res.dropped, back: pcb.get().parts.map(p => p.type), label: pcb.get().parts[0].label };`);
  expect(r.sw).toBe('esp32');
  expect(r.servo).toBe(90);
  expect(r.pins).toHaveLength(4);
  for (const k of r.pins) expect(k).toMatch(/^p1\.GPIO\d+$/);
  expect(r.st).toBe(5);
  expect(r.ok).toBe(true);
  expect(r.dropped).toEqual([]);
  expect(r.back).toEqual(['pico', 'uln2003', 'stepper']);
  expect(r.label).toBe('PICO');
});

test('vezérlőcsere a tulajdonságpanelen', async ({ page }) => {
  await pcb(page, `pcb.example('button'); pcb.select(['PICO']);`);
  await page.selectOption('#pSwap', 'esp32');
  await page.click('#pSwapGo');
  const r = await pcb<any>(page, `pcb.sim(true); return { t: pcb.get().parts[0].type, led: pcb.simInfo().leds[0].I, iss: pcb.issues().length };`);
  expect(r).toMatchObject({ t: 'esp32', iss: 0 });
  expect(r.led).toBeGreaterThan(0.003);
});

test('útvonalkereső: konkrét GPIO-lábra mutató kapcsolat célját más szabad GPIO-kapcsolat nem foglalja el', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.load({ board: { rows: 48, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: {}, pwm: {}, seq: 100, auto: { bridges: [], wires: [] },
      parts: [${JSON.stringify(part('p1', 'pico', 'PICO', 12, 30, { span: 6 }, 2))}, ${JSON.stringify(JS)}],
      links: [['p5.GND', 'GND'], ['p5.5V', 'p1.36'], ['p5.VRX', 'p1.31'], ['p5.VRY', 'GPIO'], ['p5.SW', 'GPIO']].map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
      settings: { usb: true, btnMode: 'hold', autoRoute: true } }); pcb.route();
    return { iss: pcb.issues().map(i => i.msg), g: pcb.links().filter(l => l.b === 'GPIO').map(l => l.gpio) };`);
  expect(r.iss).toEqual([]);
  expect(r.g).not.toContain('GP26');
});

test('buszfunkciók: az I²C-kijelző egy buszra és megfelelő lábakra kerül; rossz lábon és PWM-szelet ütközésnél figyelmeztet', async ({ page }) => {
  const OLED = part('p2', 'ssd1306', 'OLED1', 24, 12);
  const base = (gpio: object, pwm: object, parts: object[], links: Array<[string, string]>) => `pcb.load({ board: { rows: 48, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: ${JSON.stringify(gpio)}, pwm: ${JSON.stringify(pwm)}, seq: 100, auto: { bridges: [], wires: [] },
      parts: [${JSON.stringify(part('p1', 'pico', 'PICO', 12, 30, { span: 6 }, 2))}, ...${JSON.stringify(parts)}],
      links: ${JSON.stringify(links)}.map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })), settings: { usb: true, btnMode: 'hold', autoRoute: true } }); pcb.route();`;
  const r = await pcb<any>(page, base({}, {}, [OLED], [['p2.GND', 'GND'], ['p2.VCC', 'p1.36'], ['p2.SCL', 'GPIO'], ['p2.SDA', 'GPIO']]) + `
    const ls = pcb.links(), o = { ok: ls.every(l => l.ok), scl: ls.find(l => l.a === 'p2.SCL').gpio, sda: ls.find(l => l.a === 'p2.SDA').gpio, iss: pcb.issues().map(i => i.msg) };
    ${base({}, {}, [OLED], [['p2.GND', 'GND'], ['p2.VCC', 'p1.36'], ['p2.SCL', 'p1.4'], ['p2.SDA', 'p1.9']])} o.bad = pcb.issues().map(i => i.msg);
    ${base({ 'p1.1': 'pwm', 'p1.2': 'pwm' }, { 'p1.1': { duty: 50, freq: 1000 }, 'p1.2': { duty: 50, freq: 50 } }, [part('p3', 'res', 'R1', 24, 4, { ohm: 1000, dr: 0, dc: 4 }), part('p4', 'res', 'R2', 30, 4, { ohm: 1000, dr: 0, dc: 4 })], [['p3.1', 'p1.1'], ['p3.2', 'GND'], ['p4.1', 'p1.2'], ['p4.2', 'GND']])} o.pwm = pcb.issues().map(i => i.msg);
    return o;`);
  expect(r.ok).toBe(true);
  expect(r.iss).toEqual([]);
  const n = (g: string) => +g.replace(/\D/g, '');
  expect(n(r.scl) & 1).toBe(1); // SCL páratlan GP
  expect(n(r.sda) & 1).toBe(0);
  expect((n(r.scl) >> 1) & 1).toBe((n(r.sda) >> 1) & 1); // azonos I2C-busz
  expect(r.bad).toEqual([expect.stringMatching(/^OLED1\.SCL \(I2C SCL\) → GP2: ez a láb nem I2C SCL/)]);
  expect(r.pwm).toEqual(['GP0 és GP1 ugyanazon a PWM-szeleten (PWM0) van, csak azonos frekvenciával működhetnek (most: 1000 Hz, 50 Hz).']);
});

test('kábel a modul csatlakozójába: a léptetőmotor kábelei a ULN2003 kimeneti lábain végződnek', async ({ page }) => {
  const r = await pcb<any>(page, `pcb.example('stepper'); const d = pcb.get(), u = pcb.pins('U1'), at = id => { const q = u.find(x => x.id === id); return q.r + ':' + q.c; };
    const ends = d.auto.wires.map(w => w.b.join(':')); return { ends, want: ['A', 'B', 'C', 'D', 'COM'].map(at) };`);
  for (const w of r.want) expect(r.ends).toContain(w);
});
