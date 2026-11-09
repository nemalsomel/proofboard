import { expect, test, type Page, type Route } from '@playwright/test';
import { SPREAD } from './fixtures';

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

test('beszélgetések: újratöltés után visszajön, listából megnyitható, törölhető; az új beszélgetés elmenti az előzőt', async ({ page }) => {
  await setKey(page);
  await fakeApi(page, [say('Első válasz.'), say('Második válasz.')]);
  await ask(page, 'Első kérdés');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Első válasz');
  const pid = await page.evaluate(() => (window as any).pcb.get().id);
  expect(pid).toMatch(/^p\w+/);
  await page.click('#agNew');
  await expect(page.locator('.ag-msg')).toHaveCount(0);
  await ask(page, 'Második kérdés');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Második válasz');
  // újratöltés: a legutóbbi beszélgetés nyílik meg, a terv azonosítója megmarad
  await page.reload();
  await page.waitForFunction(() => !!(window as any).pcb);
  await page.click('.right [data-rtab="agent"]');
  expect(await page.evaluate(() => (window as any).pcb.get().id)).toBe(pid);
  await expect(page.locator('.ag-msg.u')).toHaveText(['Második kérdés']);
  await expect(page.locator('.ag-msg.a').last()).toContainText('Második válasz');
  // lista: két beszélgetés, a régebbi megnyitható
  await page.click('#agHist');
  await expect(page.locator('.ag-hrow')).toHaveCount(2);
  await expect(page.locator('.ag-hrow.on')).toContainText('Második kérdés');
  await page.locator('.ag-hopen', { hasText: 'Első kérdés' }).click();
  await expect(page.locator('#agHistList')).toBeHidden();
  await expect(page.locator('.ag-msg.u')).toHaveText(['Első kérdés']);
  // a folytatásban az előzmények mennek
  const reqs = await fakeApi(page, [say('Folytatás.')]);
  await ask(page, 'Még valami');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Folytatás');
  expect(JSON.stringify(reqs[0].body.messages)).toContain('Első kérdés');
  // törlés
  await page.click('#agHist');
  await page.locator('.ag-hrow', { hasText: 'Második kérdés' }).locator('[data-chatdel]').click();
  await expect(page.locator('.ag-hrow')).toHaveCount(1);
  // másik terv (új): üres beszélgetés, saját lista
  await page.evaluate(() => { const d = (window as any).pcb.get(); delete d.id; (window as any).pcb.load(d); });
  await expect(page.locator('.ag-msg')).toHaveCount(0);
  await page.click('#agHist');
  await expect(page.locator('#agHistList')).toContainText('még nincs mentett beszélgetés');
  expect(await page.evaluate(() => (window as any).pcb.get().id)).not.toBe(pid);
});

test('projektjegyzet: a felhasználó szerkeszti, az agent megkapja és frissíti; visszavonható', async ({ page }) => {
  await setKey(page);
  await page.click('#agBriefBox summary');
  await page.fill('#agBrief', 'Cél: villogó LED a GP15-ön.');
  await page.locator('#agBrief').blur();
  expect(await page.evaluate(() => (window as any).pcb.get().brief)).toBe('Cél: villogó LED a GP15-ön.');
  const reqs = await fakeApi(page, [toolUse('t1', 'set_project_notes', { text: 'Cél: villogó LED a GP15-ön.\n- Előtét: 330 Ω' }, 'Feljegyzem.'), say('Feljegyeztem.')]);
  await ask(page, 'Jegyezd fel, hogy 330 Ω-os előtét lesz.');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Feljegyeztem');
  expect(JSON.stringify((reqs[0].body.messages as unknown[])[0])).toContain('Project notes (kept by you and the user');
  expect(JSON.stringify((reqs[0].body.messages as unknown[])[0])).toContain('villogó LED a GP15');
  await expect(page.locator('#agBrief')).toHaveValue('Cél: villogó LED a GP15-ön.\n- Előtét: 330 Ω');
  await expect(page.locator('.ag-tool.ok')).toContainText('Projektjegyzet');
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await page.evaluate(() => (window as any).pcb.get().brief)).toBe('Cél: villogó LED a GP15-ön.');
});

test('hosszú beszélgetés: a korábbi rész összefoglalóra cserélődik, az agent az összefoglalót kapja', async ({ page }) => {
  await setKey(page);
  // egy nagyon hosszú, mentett beszélgetés
  await page.evaluate(() => {
    const pid = (window as any).pcb.get().id || (() => { const d = (window as any).pcb.get(); d.id = 'proj-hosszu'; (window as any).pcb.load(d); return 'proj-hosszu'; })();
    const big = 'x'.repeat(320000), now = Date.now();
    const chat = { id: 'c1', title: 'Hosszú', created: now, updated: now, usage: { in: 0, out: 0 },
      messages: [{ role: 'user', content: [{ type: 'text', text: big }] }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }],
      entries: [{ k: 'user', text: 'Hosszú' }, { k: 'text', text: 'ok' }] };
    localStorage.setItem('proofboard.agent.chats.' + pid, JSON.stringify([chat]));
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).pcb);
  await page.click('.right [data-rtab="agent"]');
  await expect(page.locator('.ag-msg.u')).toHaveText(['Hosszú']);
  const reqs = await fakeApi(page, [say('Cél: teszt. Döntés: nincs.'), say('Rendben.')]);
  await ask(page, 'Folytassuk');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Rendben');
  await expect(page.locator('.ag-msg.info')).toContainText('összefoglalva');
  expect(reqs.length).toBe(2);
  expect(reqs[0].body.tools).toBeUndefined(); // az összefoglaló kérés
  const m = reqs[1].body.messages as Array<{ content: unknown }>;
  expect(m.length).toBe(1);
  expect(JSON.stringify(m[0])).toContain('Summary of the earlier part of this conversation:\\nCél: teszt.');
  expect(JSON.stringify(m[0])).not.toContain('xxxxxxxxxx');
});

test('tömörítés az agenttel: előnézet, majd alkalmazás; egy lépésben visszavonható, a rögzített marad', async ({ page }) => {
  await page.evaluate(d => { const x = JSON.parse(JSON.stringify(d)); x.parts.find((p: { label: string }) => p.label === 'R2').fixed = true; (window as any).pcb.load(x); }, SPREAD);
  const pos = () => page.evaluate(() => JSON.stringify((window as any).pcb.get().parts.map((p: { label: string; r: number; c: number; rot: number }) => [p.label, p.r, p.c, p.rot])));
  const before = await pos();
  await setKey(page);
  const reqs = await fakeApi(page, [
    toolUse('t1', 'plan_compaction', { strength: 0.7 }, 'Megnézem, mennyit nyerünk.'),
    toolUse('t2', 'compact_layout', { strength: 0.7 }),
    say('Tömörítettem: kisebb terület, kevesebb híd.'),
  ]);
  await ask(page, 'Túl szellős, tömörítsd.');
  await expect(page.locator('.ag-msg.a').last()).toContainText('Tömörítettem');
  await expect(page.locator('.ag-tool.ok').first()).toContainText('Tömörítés előnézete');
  const res1 = JSON.stringify(reqs[1].body.messages);
  expect(res1).toContain('Compaction preview (not applied)');
  expect(res1).toContain('R2 (fixed)');
  expect(JSON.stringify(reqs[0].body.messages)).toContain('FIXED by the user');
  const after = await pos();
  expect(after).not.toBe(before);
  expect(JSON.parse(after).find((x: unknown[]) => x[0] === 'R2')).toEqual(JSON.parse(before).find((x: unknown[]) => x[0] === 'R2'));
  expect(await page.evaluate(() => (window as any).pcb.links().filter((l: { ok: boolean }) => l.ok).length)).toBe(6);
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await pos()).toBe(before);
});
