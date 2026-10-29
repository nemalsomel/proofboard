import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

const nokia = {
  name: 'Nokia 5110 kijelző', fp: '8 láb egy sorban', prefix: 'LCD', cat: 'Kijelző',
  pins: ['RST', 'CE', 'DC', 'DIN', 'CLK', 'VCC', 'BL', 'GND'].map((n, i) => ({ id: String(i + 1), name: n, lr: 0, lc: i, role: n === 'GND' ? 'gnd' : n === 'VCC' ? 'vin' : 'sig' })),
  graphics: [{ shape: 'rect', layer: 'body', r: [-0.6, 0.6], c: [-0.6, 7.6], fill: '#1b4f8a', stroke: '#0d2f55' }],
};

test('saját modul: lábsor-generátorral felvéve, mentve, lerakva, visszavonható', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  await page.click('#bNewPart');
  await expect(page.locator('.pe')).toBeVisible();
  await page.fill('#pe_name', 'Nokia 5110 kijelző');
  await page.fill('#pe_prefix', 'LCD');
  await page.fill('#pe_cat', 'Kijelző');
  await page.fill('#pe_gnames', 'RST,CE,DC,DIN,CLK,VCC,BL,GND');
  await page.click('[data-act="gen"]');
  await expect(page.locator('.pe-pins tbody tr')).toHaveCount(8);
  await expect(page.locator('.pe-pins select[data-k="role"]').nth(5)).toHaveValue('vin');
  await expect(page.locator('.pe-pins select[data-k="role"]').nth(7)).toHaveValue('gnd');
  await page.fill('#pe_ext_t', '4');
  await page.fill('#pe_btext', 'NOKIA 5110');
  await expect(page.locator('.pe [data-ref="probs"]')).toContainText('rendben');
  await page.click('[data-act="saveplace"]');
  await expect(page.locator('.pe')).toHaveCount(0);
  await expect(page.locator('#lib')).toContainText('Nokia 5110 kijelző');
  const pt = await pcb<{ x: number; y: number }>(page, `return pcb.reveal(60, 6);`);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
  const r = await pcb<any>(page, `const ps = pcb.pins('LCD1'); const def = Object.values(pcb.customParts())[0];
    return { n: ps.length, first: ps[0].name + '@' + ps[0].r + ':' + ps[0].c, iss: pcb.issues().map(i => i.msg), body: def.bounds };`);
  expect(r).toMatchObject({ n: 8, first: 'RST@60:6', iss: ['LCD1.VCC: nincs tápfeszültség'] }); // még nincs bekötve
  expect(r.body.r[0]).toBeLessThan(-4); // a 4 lyukas kiterjesztés benne van
  await pcb(page, `pcb.undo();`);
  expect(await pcb(page, `return pcb.pins('LCD1');`)).toBeNull();
  await pcb(page, `pcb.undo();`);
  expect(await pcb(page, `return Object.keys(pcb.customParts()).length;`)).toBe(0);
});

test('hibás leírás nem menthető, a hibát érthetően jelzi', async ({ page }) => {
  await page.click('#bNewPart');
  await page.click('.pe [data-tab="json"]');
  await page.fill('#pe_json', JSON.stringify({ ...nokia, prefix: '', pins: [...nokia.pins, { id: '1', lr: 3, lc: 0 }] }));
  await page.click('[data-act="applyjson"]');
  const probs = page.locator('.pe [data-ref="probs"]');
  await expect(probs).toContainText('előtag');
  await expect(probs).toContainText('Kétszer szerepel a láb: 1');
  await expect(page.locator('[data-act="save"]')).toBeDisabled();
  await page.fill('#pe_json', '{ nem json');
  await page.click('[data-act="applyjson"]');
  await expect(probs).toContainText('Hibás JSON');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pe')).toHaveCount(0);
});

test('alkatrészkönyvtár: export fájlba, import vissza, ütköző kulcs átnevezésével', async ({ page }, info) => {
  expect(await pcb<any>(page, `return pcb.addPart(${JSON.stringify(nokia)}).type;`)).toBe('c_nokia_5110_kijelzo');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bLibExp')]);
  expect(dl.suggestedFilename()).toBe('proofboard-alkatreszek.json');
  const file = info.outputPath('lib.json');
  await dl.saveAs(file);
  await page.setInputFiles('#libFile', { name: 'lib.json', mimeType: 'application/json', buffer: readFileSync(file) });
  await expect(page.locator('#libMsg')).toContainText('1 alkatrész betöltve');
  expect(await pcb(page, `return Object.keys(pcb.customParts()).sort();`)).toEqual(['c_nokia_5110_kijelzo', 'c_nokia_5110_kijelzo_2']);
});

test('beépített alkatrész másolata saját, szerkeszthető alkatrészként', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.select(['PICO']);`);
  await page.click('#pCopyDef');
  await expect(page.locator('.pe [data-tab="json"]')).toHaveClass(/on/);
  await expect(page.locator('#pe_json')).toHaveValue(/Raspberry Pi Pico W \(másolat\)/);
  await page.click('[data-act="save"]');
  const r = await pcb<any>(page, `const [k, d] = Object.entries(pcb.customParts())[0]; return { k, name: d.name, pins: d.pins.length };`);
  expect(r).toEqual({ k: 'c_raspberry_pi_pico_w_maso', name: 'Raspberry Pi Pico W (másolat)', pins: 2 });
});

test('saját alkatrész nyomógomb-vezérlővel a szimulációban', async ({ page }) => {
  const sw = { name: 'Mikrokapcsoló', fp: '2 láb', prefix: 'SW', pins: [{ id: '1', lr: 0, lc: 0, role: 'sig' }, { id: '2', lr: 0, lc: 3, role: 'gnd' }],
    graphics: [{ shape: 'rect', layer: 'body', r: [-0.8, 0.8], c: [-0.4, 3.4], fill: '#2a2a2a', stroke: '#111' }], controls: [{ kind: 'press', closes: [['1', '2']] }] };
  const r = await pcb<any>(page, `const t = pcb.addPart(${JSON.stringify(sw)}).type;
    const d = { board: { rows: 78, cols: 39, sec: 3 }, parts: [{ id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, mir: false, props: { span: 6 } },
      { id: 'p2', type: t, label: 'SW1', r: 40, c: 5, rot: 0, mir: false, props: {} }], bridges: [], customParts: pcb.customParts(),
      wires: [{ a: [41, 5], b: [14, 13], color: '#1c7ed6' }, { a: [41, 8], b: [14, 30], color: '#000' }], links: [], gpio: {}, settings: { usb: true, btnMode: 'hold', autoRoute: false }, seq: 10 };
    pcb.load(d); const lvl = () => pcb.read().find(x => x.pin === 'GP16').level;
    const up = lvl(); pcb.press('SW1', true); const down = lvl(); pcb.press('SW1', false);
    return { up, down, iss: pcb.issues().map(i => i.msg) };`);
  expect(r).toEqual({ up: '1', down: '0', iss: [] });
});

test('Esc nem dobja el a szerkesztést; az Elvetés visszaállítja a kiinduló állapotot', async ({ page }) => {
  await page.click('#bNewPart');
  await page.fill('#pe_name', 'Piszkozat modul');
  await page.fill('#pe_gnames', 'A,B,C');
  await page.click('[data-act="gen"]');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pe')).toHaveCount(0);
  await page.click('#bNewPart');
  await expect(page.locator('#pe_name')).toHaveValue('Piszkozat modul');
  await expect(page.locator('.pe-pins tbody tr')).toHaveCount(3);
  await expect(page.locator('.pe [data-ref="sub"]')).toContainText('nem mentett módosítások');
  await page.click('[data-act="discard"]');
  await expect(page.locator('[data-act="discard"]')).toHaveText('Biztos? Kattints újra');
  await page.click('[data-act="discard"]');
  await expect(page.locator('#pe_name')).toHaveValue('Új modul');
  await expect(page.locator('.pe-pins tbody tr')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.click('#bNewPart');
  await expect(page.locator('#pe_name')).toHaveValue('Új modul');
});

test('Űrlap ↔ JSON: a beállítások mindkét irányban átkerülnek; amit az űrlap nem tud, arra figyelmeztet', async ({ page }) => {
  await page.click('#bNewPart');
  await page.fill('#pe_name', 'Oda-vissza');
  await page.fill('#pe_gnames', 'VCC,GND,OUT');
  await page.click('[data-act="gen"]');
  await page.click('.pe [data-tab="json"]');
  const j = JSON.parse(await page.locator('#pe_json').inputValue());
  expect(j.name).toBe('Oda-vissza');
  expect(j.pins.map((p: any) => p.name)).toEqual(['VCC', 'GND', 'OUT']);
  j.name = 'JSON-ból'; j.pins[2].role = 'adc'; j.pins.push({ id: '4', name: 'EN', lr: 0, lc: 3, role: 'sig' });
  j.model = [{ el: 'resistor', a: '1', b: '2', ohm: 4700 }];
  await page.fill('#pe_json', JSON.stringify(j, null, 2));
  await page.click('.pe [data-tab="form"]');
  await expect(page.locator('#pe_name')).toHaveValue('JSON-ból');
  await expect(page.locator('.pe-pins tbody tr')).toHaveCount(4);
  await expect(page.locator('.pe-pins select[data-k="role"]').nth(2)).toHaveValue('adc');
  await expect(page.locator('[data-model="0"][data-k="val0"]')).toHaveValue('4.7k');
  await expect(page.locator('[data-model="0"][data-k="pin0"] option:checked')).toHaveText('VCC (azon. 1)');
  // haladó elem: paraméter → figyelmeztetés, maradhat JSON-ban
  await page.click('.pe [data-tab="json"]');
  const k = JSON.parse(await page.locator('#pe_json').inputValue());
  k.params = [{ key: 'x', label: 'X', type: 'number', default: 1 }];
  await page.fill('#pe_json', JSON.stringify(k));
  await page.click('.pe [data-tab="form"]');
  await expect(page.locator('.pe-warn')).toContainText('paraméterek');
  await page.click('[data-act="stayjson"]');
  await expect(page.locator('.pe [data-tab="json"]')).toHaveClass(/on/);
  await page.click('.pe [data-tab="form"]');
  await page.click('[data-act="toform"]');
  await expect(page.locator('#pe_name')).toHaveValue('JSON-ból');
});
