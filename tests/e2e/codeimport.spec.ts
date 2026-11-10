import { expect, test, type Page } from '@playwright/test';

/* Kód importálása: Kód fül › Importálás… – előnézet, megjegyzések sorszámmal, létrehozás egy visszavonási lépésben. */

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  await page.goto('./'); await page.waitForFunction(() => !!(window as any).pcb);
  await page.evaluate(() => (window as any).pcb.preset()); // vezérlőlappal, program nélkül
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

const BLINK = `#define LED 22
void setup() { pinMode(LED, OUTPUT); }
void loop() {
  digitalWrite(LED, HIGH); delay(250);
  digitalWrite(LED, LOW); delay(750);
  tone(9, 440);
}`;

test('Kód fül › Importálás: előnézet (nyelv, blokkok, megjegyzés sorszámmal), létrehozás, visszavonás', async ({ page }) => {
  await page.keyboard.press('Shift+4');
  await expect(page.locator('#codeView [data-pc="imp"]')).toBeVisible();
  await page.click('#codeView [data-pc="imp"]');
  const dlg = page.locator('#dlgImp');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-imp="replace"]')).toBeDisabled();
  await dlg.locator('.imp-code').fill(BLINK);
  await expect(dlg.locator('.imp-sum')).toContainText('Felismert nyelv: Arduino');
  await expect(dlg.locator('.imp-sum')).toContainText('Ütemadó: 1000 ms, 25 %');
  await expect(dlg.locator('.imp-notes li')).toHaveCount(1);
  await expect(dlg.locator('.imp-notes li')).toContainText('tone');
  // a sorszámra kattintva a kódban kijelölődik a sor
  await dlg.locator('.imp-ln', { hasText: '6' }).click();
  expect(await dlg.locator('.imp-code').evaluate((t: HTMLTextAreaElement) => t.value.slice(t.selectionStart, t.selectionEnd))).toBe('  tone(9, 440);');
  await dlg.locator('[data-imp="replace"]').click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Kódból: 2 blokk');
  const prog = await page.evaluate(() => (window as any).pcb.get().program);
  expect(prog.nodes.map((n: any) => n.type).sort()).toEqual(['blink', 'out']);
  expect(prog.nodes.find((n: any) => n.type === 'blink').props).toMatchObject({ period: 1000, duty: 25 });
  expect(prog.edges).toHaveLength(1);
  await expect(page.locator('#codeView .pc-code')).toContainText('t % 1000 < 250');
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await page.evaluate(() => ((window as any).pcb.get().program?.nodes || []).length)).toBe(0);
});

test('hozzáadás a meglévő programhoz; MicroPython fájlból (nyelv a kiterjesztésből); a palettáról és Alt+I-vel', async ({ page }) => {
  const r = await page.evaluate(c => (window as any).pcb.importCode(c), BLINK);
  expect(r).toMatchObject({ lang: 'arduino', blocks: 2 });
  await page.keyboard.press('Alt+i');
  const dlg = page.locator('#dlgImp');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-imp="append"]')).toBeVisible();
  await expect(dlg.locator('[data-imp="replace"]')).toHaveText('A program cseréje');
  await dlg.locator('input[type=file]').setInputFiles({ name: 'main.py', mimeType: 'text/plain', buffer: Buffer.from('from machine import Pin\nbtn = Pin(2, Pin.IN, Pin.PULL_UP)\nled = Pin(15, Pin.OUT)\nwhile True:\n    led.value(not btn.value())\n') });
  await expect(dlg.locator('[data-il="micropython"]')).toHaveClass(/\bon\b/);
  await expect(dlg.locator('.imp-sum')).toContainText('Digitális bemenet');
  await expect(dlg.locator('.imp-out')).toContainText('Minden rész lefordult');
  await dlg.locator('[data-imp="append"]').click();
  const prog = await page.evaluate(() => (window as any).pcb.get().program);
  expect(prog.nodes.map((n: any) => n.type).sort()).toEqual(['blink', 'in', 'out', 'out']);
  const inp = prog.nodes.find((n: any) => n.type === 'in');
  expect(inp.props).toMatchObject({ pull: 'pullup', active: 'low' });
  await page.keyboard.press('Control+k');
  await page.locator('#dlgPal .pal-q').fill('kod import');
  await expect(page.locator('#dlgPal .pal-row').first()).toContainText('Kód importálása');
});
