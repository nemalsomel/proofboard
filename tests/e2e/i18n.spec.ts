import { expect, test, type Page } from '@playwright/test';

/* Nyelvváltás (előkészítés): a statikus felület angolra fordul, vissza magyarra pontosan; a választás megmarad. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

test('Fájl → Nyelv: English, majd vissza Magyar; újratöltés után is megmarad', async ({ page }) => {
  await page.click('#bFile');
  await expect(page.locator('[data-lang-set="hu"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-lang-set="en"]');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#bFile')).toContainText('File');
  await expect(page.locator('#bExamples')).toContainText('Examples…');
  await expect(page.locator('[data-lang-set="hu"]')).toHaveText('Magyar'); // a nyelvek neve nem fordul
  await expect(page.locator('#toast')).toContainText('in progress');
  await expect(page.locator('#bUndo')).toHaveAttribute('title', 'Undo (Ctrl+Z)');
  await expect(page.locator('#exSearch')).toHaveAttribute('placeholder', 'Search the examples');
  // a program által épített részek is (eszközsáv, állapotsor)
  await expect(page.locator('[data-tool="select"] .tl')).toHaveText('Select');
  await expect(page.locator('[data-tool="erase"]')).toHaveAttribute('aria-label', 'Delete');
  await expect(page.locator('#status')).toContainText('parts: 0');
  await expect(page.locator('#sbTool')).toContainText('Tool: Select');
  expect(await page.evaluate(() => (window as any).pcb.lang())).toBe('en');
  await page.reload(); await page.waitForFunction(() => !!(window as any).pcb);
  await expect(page.locator('#bFile')).toContainText('File');
  await page.evaluate(() => (window as any).pcb.lang('hu'));
  await expect(page.locator('#bFile')).toContainText('Fájl');
  await expect(page.locator('#bExamples')).toContainText('Példák…');
  await expect(page.locator('#exSearch')).toHaveAttribute('placeholder', 'Keresés a példák között');
  await expect(page.locator('[data-tool="select"] .tl')).toHaveText('Kijelölés');
  await expect(page.locator('#status')).toContainText('0 alkatrész');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
});

test('angolul a tulajdonságpanel, a kapcsolatok, a szimuláció és a blokkszerkesztő is; vissza magyarra élőben', async ({ page }) => {
  await page.evaluate(() => { const p = (window as any).pcb; p.lang('en'); p.example('button'); p.select('R1'); });
  await expect(page.locator('#pDup')).toContainText('Duplicate');
  await expect(page.locator('#pinsSec summary')).toContainText('Pins and wiring');
  await expect(page.locator('#links')).toContainText('bridges');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).pcb.sim(true));
  await expect(page.locator('#bSim')).toContainText('Stop simulation');
  await expect(page.locator('#simOut')).toContainText('powered');
  await expect(page.locator('#sbSim')).toContainText('Simulation running');
  await page.evaluate(() => { const p = (window as any).pcb; p.sim(false); p.example('prog-blink'); });
  await expect(page.locator('#progView .pg-head').first()).toContainText(/Clock|Digital output/);
  await expect(page.locator('#progView [data-pg="add"]')).toHaveText('+ Block');
  await page.evaluate(() => (window as any).pcb.lang('hu'));
  await expect(page.locator('#progView .pg-head').first()).toContainText(/Ütemadó|Digitális kimenet/);
  await expect(page.locator('#progView [data-pg="add"]')).toHaveText('+ Blokk');
  await expect(page.locator('#bSim')).toContainText('Szimuláció');
});

test('az Alkatrész-szerkesztő és a belső kapcsolás angolul, majd nyitva maradva vissza magyarra', async ({ page }) => {
  await page.evaluate(() => (window as any).pcb.lang('en'));
  await page.click('[data-ltab="lib"]');
  await page.click('#bNewPart');
  await expect(page.locator('.pe [data-tab="pins"]')).toHaveText('Pins');
  await expect(page.locator('.pe [data-vtab="basic"]')).toHaveText('Basics');
  await expect(page.locator('#pe_name')).toHaveValue('New module');
  await expect(page.locator('.pe-acts [data-act="save"]')).toHaveAttribute('aria-label', 'Save');
  await page.fill('#pe_gnames', 'GND,VCC,A,Y');
  await page.click('[data-act="gen"]');
  await expect(page.locator('.pe-pins thead')).toContainText('Role');
  await page.click('.pe [data-tab="func"]');
  await expect(page.locator('.cg [data-cg="add"]')).toHaveText('+ Element');
  await page.click('.cg [data-cg="add"]');
  await expect(page.locator('.cg .pg-menu')).toContainText('Electrical elements');
  await page.click('.cg [data-add="g:nand"]');
  await expect(page.locator('.cg [data-k="gate"] .pg-head')).toHaveText('NAND');
  await page.evaluate(() => (window as any).pcb.lang('hu'));
  await expect(page.locator('.pe [data-tab="func"]')).toHaveText('Működés');
  await expect(page.locator('.cg [data-cg="add"]')).toHaveText('+ Elem');
  await expect(page.locator('.cg [data-k="gate"] .pg-head')).toHaveText('NEM-ÉS');
  await expect(page.locator('.pe-acts [data-act="save"]')).toHaveAttribute('aria-label', 'Mentés');
});

test('angolul az alkatrészlista, a paraméterek, a Problémák és a példák szövege; a jegyzet a betöltéskori nyelven', async ({ page }) => {
  await page.evaluate(() => (window as any).pcb.lang('en'));
  await page.click('[data-ltab="lib"]');
  await expect(page.locator('#lib [data-lib="res"]')).toContainText('Resistor');
  await page.evaluate(() => { const p = (window as any).pcb; p.example('npn'); p.select('R1'); });
  await expect(page.locator('#props')).toContainText('Value');
  await page.click('#bFile'); await page.click('#bExamples');
  await page.click('.ex-cat[data-excat="Program"]');
  await expect(page.locator('.ex-item[data-ex="prog-delay"] b')).toHaveText('Staircase light – off delay');
  await page.fill('#exSearch', 'staircase');
  await expect(page.locator('.ex-item')).toHaveCount(1);
  await page.click('.ex-item[data-ex="prog-delay"]');
  const notes = await page.evaluate(() => (window as any).pcb.notes().map((n: { text: string }) => n.text).join('\n'));
  expect(notes).toContain('Try it');
  await page.evaluate(() => (window as any).pcb.lang('hu'));
  const huNotes = await page.evaluate(() => (window as any).pcb.notes().map((n: { text: string }) => n.text).join('\n'));
  expect(huNotes).not.toContain('Próbáld ki'); // a már betöltött jegyzet a terv része, nem fordul vissza
});
