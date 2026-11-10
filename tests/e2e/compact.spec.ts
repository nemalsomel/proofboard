import { expect, test, type Page } from '@playwright/test';
import { SPREAD } from './fixtures';

/* Tömörség: rögzített hely (lakat) alkatrészenként és csoportra, a foglalt terület az állapotsorban és az API-ban. */
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

test('rögzített hely: a tulajdonságoknál kapcsolható, visszavonható, mentődik; csoportra is', async ({ page }) => {
  await pcb(page, `pcb.preset(); pcb.select(['K1']);`);
  const fx = page.locator('#pFixed:visible');
  await expect(fx).not.toBeChecked();
  await fx.check();
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'K1').fixed;`)).toBe(true);
  expect(await pcb(page, `return pcb.layoutStats().fixed;`)).toBe(1);
  await page.click('#bUndo');
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'K1').fixed;`)).toBeUndefined();
  await page.click('#bRedo');
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  expect(await pcb(page, `return pcb.get().parts.find(p => p.label === 'K1').fixed;`)).toBe(true);
  // csoport: mind rögzítve, majd mind feloldva
  await pcb(page, `pcb.select(['K1', 'K2']);`);
  await page.locator('#gFixed:visible').click();
  expect(await pcb(page, `return pcb.get().parts.filter(p => p.fixed).map(p => p.label).sort();`)).toEqual(['K1', 'K2']);
  await page.locator('#gFixed:visible').click();
  expect(await pcb(page, `return pcb.get().parts.filter(p => p.fixed).length;`)).toBe(0);
});

test('foglalt terület: az állapotsorban és az API-ban; üres tervnél nincs', async ({ page }) => {
  await pcb(page, `pcb.preset();`);
  const s = await pcb<{ rows: number; cols: number; fill: number; area: number }>(page, `return pcb.layoutStats();`);
  expect(s.rows).toBeGreaterThan(0);
  await expect(page.locator('#sbFoot')).toHaveText(`Terület: ${s.rows}×${s.cols} · ${Math.round(s.fill * 100)}%`);
  await expect(page.locator('#sbFoot')).toHaveAttribute('title', new RegExp(`${s.rows}×${s.cols} lyuk`));
  await pcb(page, `pcb.load({ ...pcb.get(), parts: [], links: [], bridges: [], wires: [], auto: { bridges: [], wires: [] } });`);
  expect(await pcb(page, `return pcb.layoutStats().box;`)).toBeNull();
  await expect(page.locator('#sbFoot')).toBeHidden();
});


test('tömörítés az API-n: előbb csak terv, alkalmazva egy visszavonási lépés; a bekötés megmarad', async ({ page }) => {
  await page.evaluate(d => (window as any).pcb.load(d), SPREAD);
  const before = await pcb<string>(page, `return JSON.stringify(pcb.get().parts.map(p => [p.label, p.r, p.c, p.rot]));`);
  const plan = await pcb<{ moves: Array<{ label: string }>; after: { linksOk: number; wires: number; bridges: number } }>(page, `return pcb.compact({ strength: 0.5, keepControls: false });`);
  expect(await pcb<string>(page, `return JSON.stringify(pcb.get().parts.map(p => [p.label, p.r, p.c, p.rot]));`)).toBe(before);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect([plan.after.linksOk, plan.after.wires]).toEqual([6, 0]);
  await pcb(page, `pcb.compact({ strength: 0.5, keepControls: false, apply: true });`);
  expect(await pcb<string>(page, `return JSON.stringify(pcb.get().parts.map(p => [p.label, p.r, p.c, p.rot]));`)).not.toBe(before);
  expect(await pcb<number>(page, `return pcb.links().filter(l => l.ok).length;`)).toBe(6);
  expect(await pcb<number>(page, `return pcb.layoutStats().area;`)).toBeLessThan(SPREAD.board.rows * SPREAD.board.cols / 2);
  // a régi helyek hídjai nem maradnak meg: ugyanannyi, mint a tervben
  expect(await pcb<number>(page, `return pcb.get().auto.bridges.length;`)).toBe(plan.after.bridges);
  await page.click('#bUndo');
  expect(await pcb<string>(page, `return JSON.stringify(pcb.get().parts.map(p => [p.label, p.r, p.c, p.rot]));`)).toBe(before);
});

test('Tömörítés ablak: a Problémák jelzi; élő előnézet, Mégse visszaáll; a szorosság számít; Alkalmaz egy lépésben visszavonható', async ({ page }) => {
  await page.evaluate(d => (window as any).pcb.load(d), SPREAD);
  const pos = () => pcb<string>(page, `return JSON.stringify(pcb.get().parts.map(p => [p.label, p.r, p.c, p.rot]));`);
  const before = await pos();
  await pcb(page, `pcb.bottom(true, 'issues');`);
  const hint = page.locator('#issues li', { hasText: 'A terv szellős' });
  await expect(hint).toBeVisible();
  await hint.locator('[data-act="compact"]').click();
  const dlg = page.locator('#cpWin');
  await expect(dlg).toBeVisible();
  await expect(page.locator('.app')).toHaveClass(/cp-preview/);
  // alapból a gomb (kezelőszerv) és a Pico a helyén
  await expect(page.locator('#cpRes')).toContainText('A helyén marad: PICO1 (vezérlőlap), S1 (kezelőszerv)');
  await expect(page.locator('#cpRes')).toContainText('Mozdul:');
  expect(await pos()).toBe(before); // csak előnézet: a terv nem változik
  // Mégse: vissza az eredetire, nincs visszavonási lépés
  await dlg.locator('[data-cp-close]').last().click();
  await expect(dlg).toBeHidden();
  expect(await pos()).toBe(before);
  await expect(page.locator('#bUndo')).toBeDisabled();
  // újra, a gomb is mozdulhat; szoros vs laza
  await page.click('#bCompact');
  await page.locator('#cpCtl').uncheck();
  const area = async () => { await expect(page.locator('#cpRes')).not.toHaveClass(/busy/); return page.locator('#cpRes tbody tr').first().locator('td').last().textContent(); };
  await page.locator('#cpStrength').fill('0');
  const loose = await area();
  await page.locator('#cpStrength').fill('100');
  const tight = await area();
  const rows = (s: string | null) => +String(s).split('×')[0];
  expect(rows(tight)).toBeLessThanOrEqual(rows(loose));
  await expect(page.locator('#cpRes')).toContainText('S1');
  await page.click('#cpApply');
  await expect(dlg).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Tömörítve');
  const after = await pos();
  expect(after).not.toBe(before);
  expect(await pcb<number>(page, `return pcb.links().filter(l => l.ok).length;`)).toBe(6);
  await expect(page.locator('#issues li', { hasText: 'A terv szellős' })).toHaveCount(0);
  await page.click('#bUndo');
  expect(await pos()).toBe(before);
  // a beállítás megmarad
  await page.click('#bCompact');
  await expect(page.locator('#cpStrength')).toHaveValue('100');
  await expect(page.locator('#cpCtl')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  expect(await pos()).toBe(before);
});

test('Tömörítés ablak: csak a kijelöltek', async ({ page }) => {
  await page.evaluate(d => (window as any).pcb.load(d), SPREAD);
  await pcb(page, `pcb.select(['R1', 'LED1']);`);
  await page.click('#bCompact');
  await expect(page.locator('#cpSel')).toBeChecked();
  await expect(page.locator('#cpRes')).not.toHaveClass(/busy/);
  await expect(page.locator('#cpRes')).toContainText('R2 (nincs kijelölve)');
  await page.locator('#cpSel').uncheck();
  await expect(page.locator('#cpRes')).not.toContainText('nincs kijelölve');
});

test('Tömörítés ablak: húzható, a Kapcsolatok fül tetejére rögzíthető (és vissza); a helye megmarad', async ({ page }) => {
  await page.evaluate(d => (window as any).pcb.load(d), SPREAD);
  await page.click('#bCompact');
  const win = page.locator('#cpWin');
  await expect(win).toBeVisible();
  const b0 = (await win.boundingBox())!;
  const h = (await page.locator('#cpHead').boundingBox())!;
  await page.mouse.move(h.x + 40, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x - 160, h.y + 120, { steps: 6 }); await page.mouse.up();
  const b1 = (await win.boundingBox())!;
  expect(b1.x).toBeLessThan(b0.x - 100); expect(b1.y).toBeGreaterThan(b0.y + 80);
  // rögzítés: a jobb sáv Kapcsolatok fülén, a tetején
  await page.click('#cpDockBtn');
  await expect(win).toBeHidden();
  await expect(page.locator('#cpDock')).toBeVisible();
  await expect(page.locator('#cpDock #cpStrength')).toBeVisible();
  await expect(page.locator('.right [data-rtab="design"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cpRes')).toContainText('Mozdul:');
  // bezárás és újranyitás: rögzítve marad
  await page.click('#cpDockClose');
  await expect(page.locator('#cpDock')).toBeHidden();
  await expect(page.locator('.app')).not.toHaveClass(/cp-preview/);
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await page.click('#bCompact');
  await expect(page.locator('#cpDock')).toBeVisible();
  // vissza lebegőbe, a korábbi helyére
  await page.click('#cpUndock');
  await expect(win).toBeVisible();
  const b2 = (await win.boundingBox())!;
  expect(Math.abs(b2.x - b1.x)).toBeLessThan(4); expect(Math.abs(b2.y - b1.y)).toBeLessThan(4);
  await page.keyboard.press('Escape');
  await expect(win).toBeHidden();
});
