import { expect, test, type Page } from '@playwright/test';
import { createProofboardServer } from '../../mcp/src/server';

/* Claude-kapcsolat (MCP-híd): valódi helyi szerver (a teszt folyamatában), a böngészős app kapcsolódik hozzá. */
type Srv = ReturnType<typeof createProofboardServer>;
let S: Srv, port: number;
test.beforeEach(async ({ page }) => {
  S = createProofboardServer({ version: 'teszt', port: 0 });
  port = (await S.listen())!;
  await page.addInitScript(p => localStorage.setItem('proofboard.mcp', JSON.stringify({ port: p, auto: false, readOnly: false })), port);
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).pcb);
  await page.evaluate(() => { const d = (window as any).pcb.get(); d.parts = []; d.links = []; d.bridges = []; d.wires = []; d.auto = { bridges: [], wires: [] }; (window as any).pcb.load(d); });
});
test.afterEach(async () => { await S.close(); });

async function connect(page: Page) {
  await page.click('#bFile'); await page.click('#bMcp');
  await expect(page.locator('#dlgMcp')).toBeVisible();
  await expect(page.locator('#mcpCfgDesktop')).toContainText('"proofboard-mcp"');
  await expect(page.locator('#mcpCfgDesktop')).toContainText(`"--port"`);
  // a Claude Desktop-bővítmény letölthető az app mellől (zip: PK…)
  await expect(page.locator('#mcpDl')).toHaveAttribute('href', 'proofboard.mcpb');
  const dl = await page.request.get('./proofboard.mcpb');
  expect(dl.status()).toBe(200);
  expect((await dl.body()).subarray(0, 2).toString()).toBe('PK');
  await page.click('#mcpConnect');
  await expect(page.locator('#mcpState')).toContainText('Kapcsolódva');
  await expect(page.locator('#mcpChip')).toBeVisible();
  await expect(page.locator('#mcpChip')).toHaveClass(/on/);
  await page.locator('#dlgMcp [data-close]').click();
}
const parts = (page: Page) => page.evaluate(() => (window as any).pcb.get().parts.map((p: { label: string }) => p.label));

test('a Claude az élő terven dolgozik: „dolgozik” sáv, a kézi szerkesztés szünetel; egy munkamenet = egy visszavonási lépés', async ({ page }) => {
  await connect(page);
  expect((await S.call('bridge_status', {})).text).toMatch(/Connected to the Proofboard app/);
  let r = await S.call('place_part', { type: 'res', row: 10, col: 10 });
  expect(r.text).toMatch(/^Placed R1/);
  await expect(page.locator('#agentBar')).toBeVisible();
  await expect(page.locator('#agentBarText')).toContainText('A Claude dolgozik');
  await expect(page.locator('.app')).toHaveClass(/agent-busy/);
  await expect(page.locator('#mcpChip')).toContainText('Claude dolgozik');
  r = await S.call('place_part', { type: 'led', row: 10, col: 20 });
  r = await S.call('connect', { from: 'R1.2', to: 'LED1.A' });
  expect(r.isError, r.text).toBeFalsy();
  expect(await parts(page)).toEqual(['R1', 'LED1']);
  // a szünet után a munkamenet lezárul
  await expect(page.locator('#agentBar')).toBeHidden({ timeout: 6000 });
  await expect(page.locator('#toast')).toContainText('A Claude módosította a tervet');
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await parts(page)).toEqual([]);
  // panelkép az appból
  r = await S.call('get_board_image', {});
  expect(r.image && r.image.length).toBeGreaterThan(100);
  // a terv mentése fájlba az app tervéből
  await page.evaluate(() => (window as any).pcb.redo());
  const { mkdtempSync, readFileSync } = await import('node:fs'), { join } = await import('node:path'), { tmpdir } = await import('node:os');
  const f = join(mkdtempSync(join(tmpdir(), 'pb-')), 'x.json');
  await S.call('save_design_file', { path: f });
  expect(JSON.parse(readFileSync(f, 'utf8')).parts.map((p: { label: string }) => p.label)).toEqual(['R1', 'LED1']);
});

test('csak olvasás: a módosító hívást az app elutasítja; leválasztás után a szerver felület nélkül dolgozik', async ({ page }) => {
  await connect(page);
  await page.click('#mcpChip');
  await page.locator('#mcpRead').check();
  await expect(page.locator('#mcpChip')).toContainText('csak olvasás');
  const r = await S.call('place_part', { type: 'res' });
  expect(r.isError).toBe(true); expect(r.text).toMatch(/read-only mode/);
  expect((await S.call('get_design', {})).isError).toBeFalsy();
  expect(await parts(page)).toEqual([]);
  await expect(page.locator('#bUndo')).toBeDisabled({ timeout: 6000 });
  await page.click('#mcpConnect'); // Leválasztás
  await expect(page.locator('#mcpState')).toContainText('Nincs kapcsolat');
  await expect(page.locator('#mcpChip')).toBeHidden();
  await expect.poll(() => S.connected()).toBe(false);
  expect((await S.call('place_part', { type: 'res', row: 5, col: 5 })).text).toMatch(/^Placed R1/);
  expect(await parts(page)).toEqual([]);
});

test('a „dolgozik” sáv Leválasztás gombja bontja a kapcsolatot', async ({ page }) => {
  await connect(page);
  await S.call('place_part', { type: 'res', row: 10, col: 10 });
  await expect(page.locator('#agentBar')).toBeVisible();
  await page.click('#agentBarStop');
  await expect(page.locator('#agentBar')).toBeHidden();
  await expect(page.locator('#mcpChip')).toBeHidden();
  await expect.poll(() => S.connected()).toBe(false);
  expect(await parts(page)).toEqual(['R1']); // a már megtett lépés marad (visszavonható)
});

test('saját alkatrész a Claude-tól: a könyvtárba és a tervbe kerül, lerakható', async ({ page }) => {
  await connect(page);
  const d = await S.call('get_part_definition', { type: 'res' });
  const def = JSON.parse(d.text.slice(d.text.indexOf('\n') + 1));
  def.name = 'Álló ellenállás';
  const r = await S.call('save_custom_part', { definition: def });
  expect(r.isError, r.text).toBeFalsy();
  const key = /custom part "([^"]+)"/.exec(r.text)![1];
  expect(await page.evaluate(k => Object.keys((window as any).pcb.library()).includes(k), key)).toBe(true);
  expect(await page.evaluate(k => k in (window as any).pcb.get().customParts, key)).toBe(true);
  await expect(page.locator('#lib')).toContainText('Álló ellenállás');
  expect((await S.call('place_part', { type: key, row: 10, col: 10 })).isError).toBeFalsy();
  expect(await parts(page)).toEqual(['R1']);
});

test('program a blokkos felületen: a Claude blokkokat rak le és köt össze; a Program nézet megnyílik; egy lépésben visszavonható', async ({ page }) => {
  await page.evaluate(() => (window as any).pcb.example('led-auto'));
  await connect(page);
  const labels = await page.evaluate(() => (window as any).pcb.get().parts.map((p: { label: string }) => p.label));
  expect(labels).toContain('R1');
  let r = await S.call('add_block', { type: 'blink', params: { period: 500 } });
  expect(r.text).toMatch(/^Added n1/);
  await expect(page.locator('#progView')).toBeVisible(); // Mindkettő nézetre vált
  r = await S.call('add_block', { type: 'out', params: { pin: 'R1.1' } });
  r = await S.call('connect_blocks', { from: 'n1.v', to: 'n2.a' });
  r = await S.call('arrange_program', {});
  const prog = await page.evaluate(() => (window as any).pcb.program());
  expect(prog.nodes.map((n: { type: string }) => n.type)).toEqual(['blink', 'out']);
  expect(prog.edges.length).toBe(1);
  await expect(page.locator('#progView .pg-node')).toHaveCount(2);
  r = await S.call('run_program', { ms: 1000, sample_ms: 250 });
  expect(r.text.split('\n')[0]).toContain('LED1(lit)');
  await expect(page.locator('#agentBar')).toBeHidden({ timeout: 6000 });
  await page.evaluate(() => (window as any).pcb.undo());
  expect(await page.evaluate(() => { const p = (window as any).pcb.program(); return p ? p.nodes.length : 0; })).toBe(0);
  expect(await parts(page)).toContain('LED1'); // a példa megmaradt
});

test('potméter a Claude-tól űrlapként: az Alkatrész-szerkesztő űrlapként nyitja, a Működés fülön a paraméterek és a csúszka', async ({ page }) => {
  await connect(page);
  const f = await S.call('get_part_form', { type: 'pot' });
  const form = JSON.parse(f.text.slice(f.text.indexOf('\n') + 1));
  form.name = 'Potméter 47k'; form.params[0].def = '47k';
  const r = await S.call('save_custom_part', { form });
  expect(r.text).toMatch(/Editable in the part editor/);
  const key = /custom part "([^"]+)"/.exec(r.text)![1];
  await expect(page.locator('#agentBar')).toBeHidden({ timeout: 6000 });
  await page.evaluate(k => (window as any).pcb.openEditor(k), key);
  await expect(page.locator('#pe_name')).toHaveValue('Potméter 47k'); // űrlap, nem JSON
  await page.locator('[data-tab="func"]').first().click();
  await expect(page.locator('#pe_s_params')).toBeVisible();
  await expect(page.locator('#pe_s_params input[data-k="key"]')).toHaveCount(2);
  await expect(page.locator('#pe_s_params input[data-k="slider"]').nth(1)).toBeChecked();
});
