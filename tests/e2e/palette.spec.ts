import { expect, test, type Page } from '@playwright/test';

/* Parancspaletta (Ctrl+K), a parancsok gyorsbillentyűi és a Ctrl nyomva tartásakor látható címkék. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  await page.goto('./'); await page.waitForFunction(() => !!(window as any).pcb);
  await page.evaluate(() => (window as any).pcb.preset());
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

test('Ctrl+K: üresen a gyorsbillentyű-táblázat csoportonként; kereséssel (ékezet nélkül is) Enter végrehajtja', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const dlg = page.locator('#dlgPal');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.pal-q')).toBeFocused();
  for (const g of ['Fájl', 'Szerkesztés', 'Eszközök', 'Nézet', 'Panelek és fülek', 'Bekötés', 'Beállítások']) await expect(dlg.locator('.pal-g', { hasText: g })).toHaveCount(1);
  await expect(dlg.locator('.pal-row', { hasText: 'Mentés fájlba' }).locator('kbd')).toHaveText('Ctrl+S');
  await dlg.locator('.pal-q').fill('megoszt');
  await expect(dlg.locator('.pal-row').first()).toContainText('Megosztás linkkel');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(page.locator('#dlgShare')).toBeVisible();
  await page.keyboard.press('Escape');
  // ékezet nélkül, nyilakkal
  await page.keyboard.press('Control+k');
  await dlg.locator('.pal-q').fill('rontgen');
  await expect(dlg.locator('.pal-row.on')).toContainText('Röntgen');
  await page.keyboard.press('Enter');
  await expect(page.locator('#vXray')).toHaveClass(/\bon\b/);
});

test('a palettáról alkatrész lerakása és példa megnyitása; szimulációban a szerkesztés halvány', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const dlg = page.locator('#dlgPal');
  await dlg.locator('.pal-q').fill('ellenallas');
  const row = dlg.locator('.pal-row', { hasText: 'Alkatrész lerakása' }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#lib [data-lib].on')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lib [data-lib].on')).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await dlg.locator('.pal-q').fill('futofeny');
  await expect(dlg.locator('.pal-row').first()).toContainText('Példa megnyitása');
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toContainText('Betöltve');

  await page.keyboard.press('s');
  await page.keyboard.press('Control+k');
  await dlg.locator('.pal-q').fill('forgatas');
  await expect(dlg.locator('.pal-row', { hasText: /^Forgatás/ }).first()).toHaveClass(/\boff\b/);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('új gyorsbillentyűk: nagyítás, jobb sáv fülei, alkatrészkeresés, megosztás, palettából a ?', async ({ page }) => {
  const z0 = await page.locator('#zLbl').textContent();
  await page.keyboard.press('+');
  await expect(page.locator('#zLbl')).not.toHaveText(z0!);
  await page.keyboard.press('-');
  await expect(page.locator('#zLbl')).toHaveText(z0!);
  await page.keyboard.press('Shift+4');
  await expect(page.locator('[data-rtab="code"]')).toHaveClass(/\bon\b/);
  await page.keyboard.press('Shift+2');
  await expect(page.locator('[data-rtab="design"]')).toHaveClass(/\bon\b/);
  await page.keyboard.press('/');
  await expect(page.locator('#libSearch')).toBeFocused();
  await page.keyboard.type('led');
  await expect(page.locator('#libSearch')).toHaveValue('led'); // a mezőben a betűk nem parancsok
  await page.locator('#libSearch').blur();
  await page.keyboard.press('Alt+l');
  await expect(page.locator('#dlgShare')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('#dlgPal')).toBeVisible();
});

test('parancslista: minden billentyű egyedi, a Fájl menüben a billentyűk a listából', async ({ page }) => {
  const cmds = await page.evaluate(() => (window as any).pcb.commands()) as Array<{ id: string; label: string; keys: string[] }>;
  expect(cmds.length).toBeGreaterThan(50);
  const seen = new Map<string, string>();
  for (const c of cmds) {
    expect(c.label.length, c.id).toBeGreaterThan(1);
    for (const k of c.keys) { expect(seen.get(k.toLowerCase()), k).toBeUndefined(); seen.set(k.toLowerCase(), c.id); }
  }
  await page.click('#bFile');
  await expect(page.locator('#bShare kbd')).toHaveText('Alt+L');
  await expect(page.locator('#bSaveFile kbd')).toHaveText('Ctrl+S');
  expect(await page.evaluate(() => (window as any).pcb.run('bottom'))).toBe(true);
  await expect(page.locator('#bpanel')).toHaveClass(/\bopen\b/);
});

test('Ctrl nyomva: a látható gombokon a billentyű (a parancslistából), fölül utalás a palettára', async ({ page }) => {
  const after = (sel: string) => page.evaluate(s => getComputedStyle(document.querySelector(s)!, '::after').content, sel);
  await expect(page.locator('.keys-hint')).toBeHidden();
  await page.keyboard.down('Control');
  await expect(page.locator('.keys-hint')).toBeVisible();
  expect(await after('#zIn')).toBe('"+"');
  expect(await after('#colL')).toBe('"["');
  expect(await after('[data-rtab="design"]')).toBe('"⇧2"');
  expect(await after('[data-layout="sim"]')).toBe('"Alt+3"');
  await page.keyboard.up('Control');
  await expect(page.locator('.keys-hint')).toBeHidden();
});
