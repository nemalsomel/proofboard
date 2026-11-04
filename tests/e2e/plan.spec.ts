import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Terv: mentés/megnyitás fájlból a saját alkatrészekkel, jegyzetek, rövidített vezetékrajz. */

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
const part = (name: string, fill = '#1b4f8a') => ({ name, fp: '2 láb', prefix: 'X', pins: [{ id: '1', lr: 0, lc: 0, role: 'sig' }, { id: '2', lr: 0, lc: 1, role: 'gnd' }],
  graphics: [{ shape: 'rect', layer: 'body', r: [-0.6, 0.6], c: [-0.6, 1.6], fill, stroke: '#000' }] });

test('terv fájlba és vissza: a használt saját alkatrészek a tervvel utaznak, a fogadó könyvtára nem változik', async ({ page }, info) => {
  const t = await pcb<string>(page, `pcb.load({ board: { rows: 30, cols: 20, sec: 3 }, parts: [], bridges: [], wires: [], links: [], settings: {}, seq: 1 });
    const t = pcb.addPart(${JSON.stringify(part('Barát modulja'))}).type; pcb.addPart(${JSON.stringify(part('Nem használt'))});
    const d = pcb.get(); d.parts.push({ id: 'p1', type: t, label: 'X1', r: 5, c: 5, rot: 0, mir: false, props: {} }); pcb.load(d); return t;`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bFile').then(() => page.click('#bSaveFile'))]);
  expect(dl.suggestedFilename()).toMatch(/^proofboard-terv-\d{8}\.json$/);
  const file = info.outputPath('terv.json');
  await dl.saveAs(file);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  expect(Object.keys(saved.customParts)).toEqual([t]); // csak a tervben használt alkatrész kerül a fájlba
  // "a haverom gépe": tiszta böngésző, saját könyvtárral, benne azonos kulcsú, de eltérő alkatrésszel
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  const r = await pcb<any>(page, `pcb.load({ board: { rows: 30, cols: 20, sec: 3 }, parts: [], bridges: [], wires: [], links: [], settings: {}, seq: 1 });
    pcb.addPart(${JSON.stringify(part('Saját szenzorom'))}); pcb.addPart(${JSON.stringify(part('Barát modulja', '#2f9e44'))});
    const before = pcb.library();
    const msg = pcb.importPlan(${JSON.stringify(saved)});
    return { msg, lib: Object.keys(pcb.library()).sort(), same: JSON.stringify(before) === JSON.stringify(pcb.library()), proj: Object.keys(pcb.projectParts()), type: pcb.get().parts[0].type, placed: pcb.pins('X1').length };`);
  expect(r.placed).toBe(2);
  expect(r.same).toBe(true);
  expect(r.lib).toEqual([t, 'c_sajat_szenzorom'].sort());
  expect(r.proj).toEqual([t + '_2']);
  expect(r.type).toBe(t + '_2');
  expect(r.msg).toContain('a tervvel 1 saját alkatrész jött');
  expect(r.msg).toContain(`Barát modulja → ${t}_2`);
  // a terv alkatrésze a Projekt csoportban, ＋ gombbal a könyvtárba tehető
  await page.click('[data-ltab="lib"]');
  await expect(page.locator(`details[data-grp="proj"] [data-lib="${t}_2"]`)).toBeVisible();
  await page.click(`[data-tolib="${t}_2"]`);
  expect(Object.keys(await pcb<any>(page, 'return pcb.library();')).sort()).toEqual([t, t + '_2', 'c_sajat_szenzorom'].sort());
  await expect(page.locator('details[data-grp="proj"]')).toHaveCount(0);
});

test('jegyzet: lerakás a Jegyzet eszközzel, szöveg, méret, mutató egy alkatrészre; mozgatás, visszavonás', async ({ page }) => {
  await pcb(page, 'pcb.preset();');
  await page.keyboard.press('j');
  const at = await pcb<any>(page, 'return pcb.reveal(50, 2);');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#nText')).toBeFocused();
  await page.fill('#nText', '# Macropad\nKilenc gomb és egy Fn.');
  await page.fill('#nW', '14'); await page.locator('#nW').blur();
  await page.selectOption('#nTarget', { label: 'K5 · Nyomógomb 12 mm' });
  let n = (await pcb<any[]>(page, 'return pcb.notes();'))[0];
  expect(n).toMatchObject({ r: 50, c: 2, w: 14, text: '# Macropad\nKilenc gomb és egy Fn.' });
  expect(n.target).toBeTruthy();
  // húzás a Kijelölés eszközzel
  await page.keyboard.press('v');
  const a = await pcb<any>(page, 'return pcb.reveal(51, 4);'), b = await pcb<any>(page, 'return pcb.reveal(51, 4);');
  await page.mouse.move(b.x, b.y); await page.mouse.down();
  const c = await pcb<any>(page, 'return pcb.reveal(54, 7);'); await page.mouse.move(c.x, c.y, { steps: 4 }); await page.mouse.up();
  n = (await pcb<any[]>(page, 'return pcb.notes();'))[0];
  expect([n.r, n.c]).toEqual([53, 5]);
  void a;
  expect(await pcb(page, 'return pcb.issues().length;')).toBe(0); // nem villamos elem
  await pcb(page, 'pcb.undo();');
  expect((await pcb<any[]>(page, 'return pcb.notes();'))[0].r).toBe(50);
});

test('rövidített vezetékrajz: kapcsolható, megmarad', async ({ page }) => {
  await expect(page.locator('#vStub')).not.toHaveClass(/on/);
  await page.click('#vStub');
  await expect(page.locator('#vStub')).toHaveClass(/on/);
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await expect(page.locator('#vStub')).toHaveClass(/on/);
});
