import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * Beépített agent: a modell válaszai rögzítettek (a Playwright fogja el az API-hívást), valódi hívás nincs.
 * Forgatókönyvek: kulcs megadása, feladat eszközhívásokkal az élő terven, egy lépésben visszavonható,
 * Megbeszélés módban nem módosít, Leállítás, hibakezelés.
 */
const API = 'https://api.anthropic.com/v1/messages';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
type Reply = object | { status: number; body: string } | { delay: number; reply: object };

/** Hamis API: a válaszokat sorban adja, a kéréseket megjegyzi. */
async function fakeApi(page: Page, replies: Reply[]) {
  const reqs: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  await page.route(API, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    reqs.push({ headers: req.headers(), body: JSON.parse(req.postData() || '{}') });
    let r = replies.shift();
    if (!r) return route.fulfill({ status: 500, headers: CORS, body: '{"error":{"message":"no reply scripted"}}' });
    if ('delay' in r) { await new Promise(res => setTimeout(res, (r as { delay: number }).delay)); r = (r as { reply: object }).reply; }
    try {
      if ('status' in r && typeof (r as { status: unknown }).status === 'number') await route.fulfill({ status: (r as { status: number }).status, headers: CORS, body: (r as { body: string }).body });
      else await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r) });
    } catch { /* a kérés közben megszakadt (Leállítás) */ }
  });
  return reqs;
}
const toolUse = (id: string, name: string, input: object, text?: string) => ({ content: [...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1200, output_tokens: 40 } });
const say = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1300, output_tokens: 30 } });

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = []; errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
  await page.evaluate(() => { const d = (window as any).pcb.get(); d.parts = []; d.links = []; d.bridges = []; d.wires = []; d.notes = []; d.auto = { bridges: [], wires: [] }; (window as any).pcb.load(d); });
  await page.click('.right [data-rtab="agent"]');
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'futásidejű hibák').toEqual([]));

async function setKey(page: Page) {
  await expect(page.locator('#agSetup')).toBeVisible();
  await expect(page.locator('#agSend')).toBeDisabled();
  await page.fill('#agKey', 'sk-ant-teszt');
  await page.click('#agSave');
  await expect(page.locator('#agSetup')).toBeHidden();
}
async function ask(page: Page, text: string) { await page.fill('#agText', text); await page.click('#agSend'); }

test('kulcs megadása, majd feladat: az agent lerak és beköt, a terv él; egy lépésben visszavonható', async ({ page }) => {
  await setKey(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('proofboard.agent') || '{}').key)).toBe('sk-ant-teszt');
  const reqs = await fakeApi(page, [
    toolUse('t1', 'place_part', { type: 'res', row: 10, col: 10, params: { ohm: 330 } }, 'Lerakom az ellenállást és a LED-et.'),
    toolUse('t2', 'place_part', { type: 'led', row: 10, col: 20 }),
    toolUse('t3', 'connect', { from: 'R1.2', to: 'LED1.A' }),
    say('Kész: **R1** (330 Ω) és **LED1** lerakva, összekötve.'),
  ]);
  await ask(page, 'Tegyél le egy ellenállást és egy LED-et, és kösd össze.');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Kész: R1 (330 Ω)');
  await expect(page.locator('.ag-msg.a b').first()).toHaveText('R1'); // markdown
  // a válasz másolható (markdownként)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.ag-msg.a').last().locator('.ag-copy').click();
  await expect(page.locator('.ag-msg.a').last().locator('.ag-copy')).toContainText('Másolva');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Kész: **R1** (330 Ω) és **LED1** lerakva, összekötve.');
  await expect(page.locator('.ag-tool.ok')).toHaveCount(3);
  await expect(page.locator('.ag-tool').first()).toContainText('Lerakás');
  expect(await page.evaluate(() => (window as any).pcb.get().parts.map((p: { label: string }) => p.label))).toEqual(['R1', 'LED1']);
  expect(await page.evaluate(() => (window as any).pcb.links().length)).toBe(1);
  // a kérés: saját kulcs, közvetlen böngészős hozzáférés, a terv összefoglalója az első üzenetben
  expect(reqs.length).toBe(4);
  expect(reqs[0].headers['x-api-key']).toBe('sk-ant-teszt');
  expect(reqs[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(JSON.stringify((reqs[0].body.messages as unknown[])[0])).toContain('Current design:');
  expect(String(((reqs[0].body.system as Array<{ text: string }>)[0]).text)).toContain('Mode: Build');
  await expect(page.locator('#agentBar')).toBeHidden();
  await expect(page.locator('#agUsage')).toContainText('token');
  // egy feladat = egy visszavonási lépés
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(0);
  await page.evaluate(() => (window as any).pcb.redo());
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(2);
});

test('Megbeszélés mód: módosító eszköz hívása hibát ad, a terv nem változik; a beszélgetés folytatódik', async ({ page }) => {
  await setKey(page);
  await page.click('[data-mode="discuss"]');
  await expect(page.locator('[data-mode="discuss"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#agText')).toHaveAttribute('placeholder', /beszéljünk meg/);
  const reqs = await fakeApi(page, [toolUse('t1', 'place_part', { type: 'res' }), say('Megbeszélés módban csak javaslok: tegyél egy 330 Ω-os ellenállást.')]);
  await ask(page, 'Mekkora előtét kell egy piros LED-hez 3,3 V-ról?');
  await expect(page.locator('.ag-msg.a').last()).toContainText('csak javaslok');
  await expect(page.locator('.ag-tool.err')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).pcb.get().parts.length)).toBe(0);
  expect(JSON.stringify(reqs[1].body.messages)).toContain('Discuss mode: changing the design is not allowed');
  expect(String(((reqs[0].body.system as Array<{ text: string }>)[0]).text)).toContain('Mode: Discuss');
  // a terv nem változott: nincs visszavonási lépés
  await expect(page.locator('#bUndo')).toBeDisabled();
  // második kérdés: a beszélgetés folytatódik (az előzmények mennek), a terv összefoglalója nem ismétlődik
  await fakeApi(page, [say('Kb. 6 mA lesz.')]).then(async r2 => {
    await ask(page, 'És mekkora lesz az áram?');
    await expect(page.locator('.ag-msg.a').last()).toContainText('6 mA');
    const msgs = r2[0].body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.length).toBe(5);
    expect(JSON.stringify(msgs[4])).not.toContain('Current design');
  });
});

test('futás közben: „Agent dolgozik” sáv, a kézi szerkesztés szünetel; Leállítás', async ({ page }) => {
  await setKey(page);
  await fakeApi(page, [{ delay: 4000, reply: say('túl késő') }]);
  await ask(page, 'Tervezz egy villogót.');
  await expect(page.locator('#agentBar')).toBeVisible();
  await expect(page.locator('.app')).toHaveClass(/agent-busy/);
  await expect(page.locator('#agStop')).toBeVisible();
  await expect(page.locator('[data-mode="discuss"]')).toBeDisabled();
  // a kézi gyorsbillentyű nem hat (pl. visszavonás), az Esc leállít
  await page.locator('#cv').focus().catch(() => {});
  await page.keyboard.press('Escape');
  await expect(page.locator('#agentBar')).toBeHidden();
  await expect(page.locator('.ag-msg.info').last()).toContainText('Leállítva');
  await expect(page.locator('.app')).not.toHaveClass(/agent-busy/);
  await expect(page.locator('#agSend')).toBeVisible();
});

test('hibák érthetően: érvénytelen kulcs, túlterhelés; a beszélgetés folytatható', async ({ page }) => {
  await setKey(page);
  await fakeApi(page, [{ status: 401, body: '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}' }, { status: 529, body: '{"error":{"message":"Overloaded"}}' }, say('Most már megy.')]);
  await ask(page, 'Szia');
  await expect(page.locator('.ag-msg.err').last()).toContainText('Az API-kulcs érvénytelen');
  await ask(page, 'Újra');
  await expect(page.locator('.ag-msg.err').last()).toContainText('túlterhelt');
  await ask(page, 'Még egyszer');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Most már megy');
  // új beszélgetés: az előzmények törlődnek
  await page.click('#agNew');
  await expect(page.locator('.ag-msg')).toHaveCount(0);
  // kulcs törlése: a beállítás újra látszik
  await page.click('#agCfg');
  await page.click('#agForget');
  await expect(page.locator('#agSetup')).toBeVisible();
  await expect(page.locator('#agSend')).toBeDisabled();
});

test('angol felületen angolul, és a rendszerprompt angol választ kér', async ({ page }) => {
  await page.evaluate(() => (window as any).pcb.lang('en'));
  await expect(page.locator('.right [data-rtab="agent"]')).toHaveText('Agent');
  await expect(page.locator('#agKeyL')).toHaveText('Anthropic API key');
  await setKey(page);
  await expect(page.locator('[data-mode="build"]')).toHaveText('Build');
  const reqs = await fakeApi(page, [say('Hello!')]);
  await ask(page, 'Hi');
  await expect(page.locator('.ag-msg.a')).toContainText('Hello!');
  expect(String(((reqs[0].body.system as Array<{ text: string }>)[0]).text)).toContain('Reply in English');
});
