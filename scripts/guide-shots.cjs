/**
 * A kézikönyv képernyőképei a valódi appból (magyarul és angolul), és a gyorsbillentyűk táblázata.
 * Használat: npm run build && npx vite preview --port 4173 & ; node scripts/guide-shots.cjs [név…]
 * Kimenet: public/guide/img/<név>-<nyelv>.jpg és guide/data/commands-<nyelv>.json.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, '..', 'public', 'guide', 'img');
const DATA = path.join(__dirname, '..', 'guide', 'data');
const URL = process.env.APP_URL || 'http://localhost:4173/proofboard/';
const ex = (p, id, ...js) => p.evaluate(([id, js]) => { const pcb = window.pcb; pcb.example(id); for (const s of js) new Function('pcb', s)(pcb); }, [id, js]);
const noNotes = 'const d = pcb.get(); d.notes = []; pcb.load(d);';

const SHOTS = {
  // a felület részei: tervezés elrendezés, egy kijelölt alkatrész
  ui: async p => { await ex(p, 'esp32', noNotes, "pcb.layout('design'); pcb.work('board'); pcb.select(['LED1'])"); },
  // példák ablak
  examples: async p => { await ex(p, 'led-auto', "pcb.layout('design')"); await p.click('#fileBtn, [aria-controls="fileMenu"]').catch(() => {}); await p.click('#bExamples'); await p.waitForTimeout(300); },
  // panel beállításai
  boardset: async p => { await ex(p, 'led-auto', "pcb.layout('design')"); await p.click('#fileBtn, [aria-controls="fileMenu"]').catch(() => {}); await p.click('#bBoard'); await p.waitForTimeout(300); },
  // tulajdonságpanel: alkatrész kijelölve, lábak és bekötés
  props: async p => { await ex(p, 'button', noNotes, "pcb.layout('design'); pcb.work('board'); pcb.select(['SW1'])"); },
  // csíkos panel rézoldalról
  copper: async p => { await ex(p, 'strip', noNotes, "pcb.layout('design'); pcb.work('board')"); await p.click('#vCu'); await p.click('#zFit').catch(() => {}); },
  // kapcsolatok: a vonalak és a Kapcsolatok fül
  links: async p => { await ex(p, 'mosfet-pwm', noNotes, "pcb.layout('design'); pcb.work('board'); pcb.selectLink(1)"); },
  // problémák az alsó panelen
  problems: async p => {
    await ex(p, 'button', noNotes, "pcb.layout('design'); pcb.work('board')");
    await p.evaluate(() => {
      const pcb = window.pcb, g = pcb.links().find(l => l.text.startsWith('SW1.A')).gpio;
      pcb.gpio(g, 'float');
      const d = pcb.get(); d.parts.find(x => x.label === 'R1').props.ohm = 22; pcb.load(d);
      pcb.bottom(true, 'problems'); pcb.select(['R1']);
    });
  },
  // tömörítés előnézete
  compact: async p => { await ex(p, 'esp32', noNotes, "pcb.layout('design'); pcb.work('board')"); await p.evaluate(() => window.pcb.run('compact')); await p.waitForTimeout(1500); },
  // program: blokkok és panel
  program: async p => { await ex(p, 'prog-dimmer', noNotes, "pcb.layout('prog'); pcb.work('split'); pcb.sides('r', true); pcb.split(0.42)"); },
  // generált kód
  code: async p => { await ex(p, 'prog-chase', noNotes, "pcb.layout('prog'); pcb.work('prog'); pcb.pvTab('code')"); },
  // szimuláció: a szervó és a potméter
  sim: async p => { await ex(p, 'nokia', "pcb.layout('sim'); pcb.sim(true)"); await p.waitForTimeout(900); },
  // műszerek: multiméter és szkóp a Műszerek fülön
  meters: async p => {
    await ex(p, 'prog-blink', noNotes, "pcb.layout('design'); pcb.work('board')");
    await p.evaluate(() => {
      const pcb = window.pcb, d = pcb.get(), q = pcb.pins('LED1');
      d.meters = [{ id: 'm1', name: 'M1', mode: 'V', red: [q[0].r, q[0].c], black: null }, { id: 's1', name: 'S1', kind: 'scope', mode: 'V', red: null, black: null, ch: [[q[0].r, q[0].c]], span: 2000 }];
      pcb.load(d);
    });
    await p.click('[data-ltab="meters"]');
    await p.evaluate(() => window.pcb.sim(true));
    await p.waitForTimeout(2600);
  },
  // alkatrész-szerkesztő
  editor: async p => { await ex(p, 'custom-xor', "pcb.openEditor(Object.keys(pcb.get().customParts)[0]); pcb.sides('l', true); pcb.sides('r', true)"); await p.click('[data-tab="func"]').catch(() => {}); },
  // gyártás: beültetés és méretrajz
  assembly: async p => { await ex(p, 'esp32', noNotes, "pcb.run('layoutMfg') || null"); await p.evaluate(() => { const pcb = window.pcb; if (pcb.mfgTab() == null) return; }); await p.keyboard.press('Alt+4'); await p.waitForTimeout(300); await p.evaluate(() => window.pcb.mfgTab('asm')); },
  dims: async p => { await ex(p, 'esp32', noNotes); await p.keyboard.press('Alt+4'); await p.waitForTimeout(300); await p.evaluate(() => window.pcb.mfgTab('dims')); },
  // agent fül
  agent: async p => { await ex(p, 'button', noNotes, "pcb.layout('design')"); await p.click('[data-rtab="agent"]').catch(() => {}); },
  // megosztás
  share: async p => { await ex(p, 'prog-toggle', "pcb.layout('design')"); await p.click('#fileBtn, [aria-controls="fileMenu"]').catch(() => {}); await p.click('#bShare'); await p.waitForTimeout(300); },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
  const only = process.argv.slice(2);
  const b = await chromium.launch();
  for (const lang of ['hu', 'en']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: lang === 'hu' ? 'hu-HU' : 'en-GB', colorScheme: 'light', serviceWorkers: 'block' });
    // gyorsbillentyűk
    {
      const p = await ctx.newPage();
      await p.goto(URL); await p.waitForFunction(() => !!window.pcb);
      await p.evaluate(l => window.pcb.lang(l), lang);
      const cmds = await p.evaluate(() => window.pcb.commands().filter(c => c.keys.length && !c.hidden).map(c => ({ group: c.group, name: c.label, keys: c.keys })));
      fs.writeFileSync(path.join(DATA, `commands-${lang}.json`), JSON.stringify(cmds, null, 1) + '\n');
      await p.close();
    }
    for (const [name, prep] of Object.entries(SHOTS)) {
      if (only.length && !only.includes(name)) continue;
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(URL); await p.waitForFunction(() => !!window.pcb);
      await p.evaluate(l => window.pcb.lang(l), lang);
      await prep(p);
      await p.waitForTimeout(500);
      await p.mouse.move(1430, 890);
      await p.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
      await p.screenshot({ path: path.join(OUT, `${name}-${lang}.jpg`), type: 'jpeg', quality: 74 });
      if (errs.length) console.log(name, lang, errs);
      await p.close();
    }
    await ctx.close();
  }
  await b.close();
  for (const f of fs.readdirSync(OUT).filter(f => !only.length || only.some(n => f.startsWith(n + '-')))) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' kB');
})();
