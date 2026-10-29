import { expect, test, type Page } from '@playwright/test';

/* Digitális logika: a 74HC139 dekóder a szimulációban; a Logika fül nézetei (kifejezés, igazságtábla, kapuk). */

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

test('74HC139: az A1 A0 szerinti kimenet megy alacsonyra; E=1-re mind magas; lebegő bemenetre figyelmeztet', async ({ page }) => {
  const r = await pcb<any>(page, `
    const d = { board: { rows: 78, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: {}, pwm: {}, seq: 100, auto: { bridges: [], wires: [] },
      parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, mir: false, props: { span: 6 } }, { id: 'p2', type: 'hc139', label: 'U1', r: 30, c: 5, rot: 0, mir: false, props: {} }],
      links: [['p2.16', 'p1.36'], ['p2.8', 'GND'], ['p2.1', 'GPIO'], ['p2.2', 'GPIO'], ['p2.3', 'GPIO']].map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
      settings: { usb: true, btnMode: 'hold', autoRoute: true } };
    pcb.load(d); pcb.route();
    const set = (e, a1, a0) => { const g = pcb.get(), k = id => g.links.find(l => l.a === 'p2.' + id).gpio;
      g.gpio[k(1)] = e ? 'out_high' : 'out_low'; g.gpio[k(3)] = a1 ? 'out_high' : 'out_low'; g.gpio[k(2)] = a0 ? 'out_high' : 'out_low';
      pcb.load(g); const o = pcb.simInfo().logics[0].outs; return ['1Y0', '1Y1', '1Y2', '1Y3'].map(n => o[n]).join(''); };
    return { ok: pcb.links().every(l => l.ok), s00: set(0, 0, 0), s01: set(0, 0, 1), s10: set(0, 1, 0), s11: set(0, 1, 1), off: set(1, 1, 0),
      iss: pcb.issues().map(i => i.msg) };`);
  expect(r).toMatchObject({ ok: true, s00: '0111', s01: '1011', s10: '1101', s11: '1110', off: '1111' });
  expect(r.iss).toEqual(['U1: lebegő bemenet: 2E, 2A1, 2A0. CMOS-bemenetet ne hagyj szabadon: kösd jelre, vagy a nem használtat GND-re (vagy VCC-re).']);
});

test('74HC00 NAND: táp nélkül nem hajt; a kimenet egy LED-et kapcsol', async ({ page }) => {
  const r = await pcb<any>(page, `
    const d = { board: { rows: 78, cols: 39, sec: 3 }, customParts: {}, bridges: [], wires: [], gpio: { 'p1.21': 'out_high', 'p1.22': 'out_low' }, pwm: {}, seq: 100, auto: { bridges: [], wires: [] },
      parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, mir: false, props: { span: 6 } }, { id: 'p2', type: 'hc00', label: 'U1', r: 30, c: 5, rot: 0, mir: false, props: {} },
        { id: 'p3', type: 'res', label: 'R1', r: 40, c: 5, rot: 0, mir: false, props: { ohm: 330, dr: 0, dc: 4 } }, { id: 'p4', type: 'led', label: 'LED1', r: 40, c: 12, rot: 0, mir: false, props: { color: 'green', dr: 0, dc: 1 } }],
      links: [['p2.14', 'p1.36'], ['p2.7', 'GND'], ['p2.1', 'p1.21'], ['p2.2', 'p1.22'], ['p2.3', 'p3.1'], ['p3.2', 'p4.A'], ['p4.K', 'GND'],
              ['p2.4', 'GND'], ['p2.5', 'GND'], ['p2.9', 'GND'], ['p2.10', 'GND'], ['p2.12', 'GND'], ['p2.13', 'GND']].map(([a, b], i) => ({ id: 'l' + (10 + i), a, b, gpio: null })),
      settings: { usb: true, btnMode: 'hold', autoRoute: true } };
    pcb.load(d); pcb.route();
    const led = () => pcb.simInfo().leds[0].I, y = () => pcb.simInfo().logics[0].outs['1Y'];
    const a = { y: y(), I: led() };
    const g = pcb.get(); g.gpio['p1.22'] = 'out_high'; pcb.load(g);
    const b = { y: y(), I: led() };
    const h = pcb.get(); h.settings.usb = false; pcb.load(h);
    return { a, b, nopow: y(), iss: (h.settings.usb = true, pcb.load(h), pcb.issues().map(i => i.msg)), ok: pcb.links().every(l => l.ok) };`);
  expect(r.ok).toBe(true);
  expect(r.a.y).toBe(1);
  expect(r.a.I).toBeGreaterThan(0.002);
  expect(r.b).toEqual({ y: 0, I: expect.any(Number) });
  expect(r.b.I).toBeLessThan(1e-6);
  expect(r.nopow).toBe('z');
  expect(r.iss).toEqual([]); // a GND-re kötött, nem használt bemenetek nem hibák
});

test('Logika fül: kifejezés → igazságtábla → kapuk, kétirányú; a JSON-ban logic elem', async ({ page }) => {
  await page.click('[data-ltab="lib"]');
  await page.click('#bNewPart');
  await page.fill('#pe_name', 'Saját kapu');
  await page.fill('#pe_gnames', 'GND,VCC,A,B,Y');
  await page.click('[data-act="gen"]');
  await page.click('.pe [data-tab="logic"]');
  await page.click('[data-act="lgstart"]');
  await expect(page.locator('#pe_lvcc')).toHaveValue('2');
  await expect(page.locator('#pe_lgnd')).toHaveValue('1');
  await expect(page.locator('#pe_lp_0 option:checked')).toHaveText('Y (azon. 5)');
  await page.fill('#pe_lx_0', 'A &');
  await expect(page.locator('[data-lmsg="0"]')).toContainText('Hiányzó tag');
  await page.fill('#pe_lx_0', 'not (A and B)');
  await expect(page.locator('[data-lmsg="0"]')).toContainText('!(A & B)');
  // igazságtábla: NAND, az utolsó sor (A=1 B=1) 0; átbillentve mindenhol 1 → a kifejezés "1"
  await page.click('[data-act="lgview"][data-v="table"]');
  const cells = page.locator('.lg-cell');
  await expect(cells).toHaveText(['1', '1', '1', '0']);
  await cells.nth(0).click();
  await expect(cells).toHaveText(['0', '1', '1', '0']); // A ^ B
  await page.click('[data-act="lgview"][data-v="expr"]');
  await expect(page.locator('#pe_lx_0')).toHaveValue('A & !B | !A & B');
  // kapuk: a gyökér VAGY → KIZÁRÓ VAGY-ra cserélve
  await page.fill('#pe_lx_0', 'A | B');
  await page.click('[data-act="lgview"][data-v="gates"]');
  await expect(page.locator('.lgv')).toHaveCount(1);
  await page.selectOption('[data-gk="op"][data-gp=""]', 'nor');
  await page.click('[data-act="lgview"][data-v="expr"]');
  await expect(page.locator('#pe_lx_0')).toHaveValue('!(A | B)');
  await page.click('.pe [data-tab="json"]');
  const j = JSON.parse(await page.locator('#pe_json').inputValue());
  expect(j.model).toEqual([{ el: 'logic', vcc: '2', gnd: '1', outs: [{ pin: '5', expr: '!(A | B)' }] }]);
  // vissza: a logika megmarad
  await page.click('.pe [data-tab="logic"]');
  await expect(page.locator('#pe_lx_0')).toHaveValue('!(A | B)');
  // átnevezés az Űrlapon: a kifejezés követi
  await page.click('.pe [data-tab="form"]');
  await page.fill('.pe-pins input[data-pin="2"][data-k="name"]', 'IN1');
  await page.locator('.pe-pins input[data-pin="2"][data-k="name"]').blur();
  await page.click('.pe [data-tab="logic"]');
  await expect(page.locator('#pe_lx_0')).toHaveValue('!(IN1 | B)');
  await page.click('[data-act="save"]');
  expect(await pcb(page, `return Object.values(pcb.customParts())[0].model[0].outs[0].expr;`)).toBe('!(IN1 | B)');
});
