import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Saját alkatrészkönyvtár: a tervtől független (böngészőben marad), export/import, keresés, kedvencek, legutóbb használt. */

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
const part = (name: string, extra: Record<string, unknown> = {}) => ({ name, fp: '2 láb', prefix: 'X', cat: 'Saját', pins: [{ id: '1', lr: 0, lc: 0, role: 'sig', fn: 'i2c.sda' }, { id: '2', lr: 0, lc: 1, role: 'gnd' }],
  graphics: [{ shape: 'rect', layer: 'body', r: [-0.6, 0.6], c: [-0.6, 1.6], fill: '#1b4f8a', stroke: '#000' }], ...extra });

test('a könyvtár terv váltásakor és újratöltéskor is megmarad; a terv csak a használtakat hordozza', async ({ page }) => {
  const t = await pcb<string>(page, `return pcb.addPart(${JSON.stringify(part('Hőmérő modul'))}).type;`);
  await pcb(page, 'pcb.preset();');                            // másik terv
  expect(Object.keys(await pcb<any>(page, 'return pcb.library();'))).toContain(t);
  expect(await pcb<any>(page, 'return pcb.projectParts();')).toEqual({});
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  expect(Object.keys(await pcb<any>(page, 'return pcb.library();'))).toContain(t);
  // lerakás a listából: a terv része lesz, és a "Legutóbb használt" csoportba kerül
  await page.click('[data-ltab="lib"]');
  await page.click(`details[data-grp="lib"] [data-lib="${t}"]`);
  const at = await pcb<any>(page, 'return pcb.reveal(60, 30);');
  await page.mouse.click(at.x, at.y);
  expect(Object.keys(await pcb<any>(page, 'return pcb.projectParts();'))).toEqual([t]);
  await page.keyboard.press('Escape');
  await page.click('[data-ltab="lib"]');
  await expect(page.locator(`details[data-grp="recent"] [data-lib="${t}"]`)).toBeVisible();
  // könyvtárból törlés: a lerakott példány marad (a terv leírásával), a könyvtárból eltűnik
  const n = await pcb<number>(page, 'return pcb.get().parts.length;');
  await page.click(`details[data-grp="lib"] [data-edit="${t}"]`);
  await page.click('[data-act="delete"]');
  expect(Object.keys(await pcb<any>(page, 'return pcb.library();'))).not.toContain(t);
  expect(await pcb<number>(page, 'return pcb.get().parts.length;')).toBe(n);
  await expect(page.locator(`details[data-grp="proj"] [data-lib="${t}"]`)).toBeVisible();
  // visszavonás a könyvtárat is visszahozza
  await page.keyboard.press('Control+z');
  expect(Object.keys(await pcb<any>(page, 'return pcb.library();'))).toContain(t);
});

test('könyvtár export és import a tervtől függetlenül; keresés és kedvencek', async ({ page }, info) => {
  await pcb(page, `pcb.addPart(${JSON.stringify(part('Fényérzékelő'))}); pcb.addPart(${JSON.stringify(part('Kijelző modul'))});`);
  await page.click('[data-ltab="lib"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bFile').then(() => page.click('#bLibExp'))]);
  const file = info.outputPath('lib.json'); await dl.saveAs(file);
  const lib = JSON.parse(readFileSync(file, 'utf8'));
  expect(Object.keys(lib.parts).sort()).toEqual(['c_fenyerzekelo', 'c_kijelzo_modul']);
  // tiszta böngésző, másik terv: import után ott vannak, a terv nem változik
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  expect(await pcb<any>(page, 'return pcb.library();')).toEqual({});
  const before = await pcb<string>(page, 'return JSON.stringify(pcb.get().parts);');
  await page.click('[data-ltab="lib"]');
  await page.setInputFiles('#libFile', { name: 'lib.json', mimeType: 'application/json', buffer: readFileSync(file) });
  await expect(page.locator('#libMsg')).toContainText('2 alkatrész betöltve a saját könyvtárba');
  expect(Object.keys(await pcb<any>(page, 'return pcb.library();')).sort()).toEqual(['c_fenyerzekelo', 'c_kijelzo_modul']);
  expect(await pcb<any>(page, 'return pcb.projectParts();')).toEqual({});
  expect(await pcb<string>(page, 'return JSON.stringify(pcb.get().parts);')).toBe(before);
  // keresés: ékezet nélkül, lábfunkcióra is
  await page.fill('#libSearch', 'fenyer');
  await expect(page.locator('#lib [data-lib]')).toHaveCount(1);
  expect(await pcb<string[]>(page, 'return pcb.libSearch("i2c sda");')).toEqual(expect.arrayContaining(['c_fenyerzekelo', 'c_kijelzo_modul']));
  expect(await pcb<string[]>(page, 'return pcb.libSearch("pico");')).toContain('pico');
  expect(await pcb<string[]>(page, 'return pcb.libSearch("nincsilyen");')).toEqual([]);
  await expect(page.locator('#lib')).toContainText('Nincs találat');
  // kedvenc
  await page.fill('#libSearch', ''); await pcb(page, 'pcb.libSearch("");');
  await page.click('details[data-grp="lib"] [data-fav="c_kijelzo_modul"]');
  await expect(page.locator('details[data-grp="fav"] [data-lib="c_kijelzo_modul"]')).toBeVisible();
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await page.click('[data-ltab="lib"]');
  await expect(page.locator('details[data-grp="fav"] [data-lib="c_kijelzo_modul"]')).toBeVisible();
});
