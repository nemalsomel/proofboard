/**
 * Gyártási csomag nyomtatáshoz: önálló HTML-dokumentum A4-es lapokkal (1:1-es alkatrész- és rézoldal,
 * anyaglista, beültetési lépések pipálható négyzetekkel). DOM-mentes, szöveget ad; a gazda új ablakban
 * nyitja meg és nyomtatja.
 */
import type { Tr } from '../i18n/i18n';
import { assembly, bom, boardKindName, marks } from '../engine/manufacture';
import { sheetSvg } from '../engine/mfgsheet';
import { dimSvg } from '../engine/dimension';
import type { Design } from '../engine/types';

export interface PrintOpts {
  comp: boolean; cu: boolean; bom: boolean; steps: boolean; title: string; lang: string;
  /** méretrajz (1:1), a méretezett elemekkel (hiányzóként az alapértelmezés) */ dims?: boolean; dimShow?: string[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
/** A4 nyomtatható terület (mm), 10 mm-es margóval. */
const PW = 190, PH = 277;

export function printHtml(D: Design, o: PrintOpts, tr: Tr): string {
  const mk = marks(D), pages: string[] = [];
  const sheet = (side: 'comp' | 'cu' | 'dims') => {
    const s = side === 'dims' ? dimSvg(D, { show: o.dimShow ? new Set(o.dimShow) : null, tr, title: o.title }) : sheetSvg(D, { side, tr, mk, title: o.title });
    const land = s.w > PW && s.w <= PH && s.h <= PW;
    const fits = land ? true : s.w <= PW && s.h <= PH;
    // ha nem fér el 1:1-ben, kicsinyítve (és ezt ki is írja)
    const k = fits ? 1 : Math.min(PW / s.w, PH / s.h);
    const svg = s.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${(s.w * k).toFixed(2)}mm" height="${(s.h * k).toFixed(2)}mm"`);
    pages.push(`<section class="page${land ? ' land' : ''}">${fits ? '' : `<p class="warn">${esc(tr('A panel nem fér el egy A4-es lapon 1:1-ben; ez a lap {p} %-ra kicsinyítve.', { p: Math.round(k * 100) }))}</p>`}${svg}</section>`);
  };
  if (o.comp) sheet('comp');
  if (o.cu) sheet('cu');
  if (o.dims) sheet('dims');
  if (o.bom) {
    const b = bom(D, tr), x = b.extra;
    const rows = b.rows.map(r => `<tr><td class="n">${r.qty}</td><td>${esc(r.labels.join(', '))}</td><td>${esc(r.name)}</td><td>${esc(r.value)}</td><td>${esc(r.note)}</td><td class="ck">☐</td></tr>`).join('');
    const extra = [
      `<tr><td class="n">1</td><td></td><td>${esc(tr('Próbapanel, {k}', { k: boardKindName(D, tr) }))}</td><td>${x.board.cols}×${x.board.rows} ${esc(tr('lyuk'))} (${x.board.w}×${x.board.h} mm)</td><td></td><td class="ck">☐</td></tr>`,
      ...x.wires.map(w => `<tr><td class="n">${w.count}</td><td></td><td>${esc(tr('Szigetelt vezeték'))} <span class="sw" style="background:${esc(w.color || '#1c7ed6')}"></span></td><td>${esc(tr('összesen {mm} mm', { mm: w.mm }))}</td><td>${esc(tr('+ 2×5 mm a lábaknak darabonként'))}</td><td class="ck">☐</td></tr>`),
    ].join('');
    const totals = [x.cuts ? tr('{n} csíkvágás', { n: x.cuts }) : '', x.bridges ? tr('{n} forrasztóhíd ({c} lánc)', { n: x.bridges, c: x.chains }) : ''].filter(Boolean).join(' · ');
    pages.push(`<section class="page text"><h2>${esc(tr('Anyaglista'))}</h2><table><thead><tr><th>${esc(tr('Db'))}</th><th>${esc(tr('Jelölés'))}</th><th>${esc(tr('Alkatrész'))}</th><th>${esc(tr('Érték'))}</th><th>${esc(tr('Megjegyzés'))}</th><th></th></tr></thead><tbody>${rows}${extra}</tbody></table>${totals ? `<p class="muted">${esc(totals)}</p>` : ''}</section>`);
  }
  if (o.steps) {
    const st = assembly(D, tr);
    const body = st.map((s, i) => `<div class="step"><h3>${i + 1}. ${esc(s.title)}${s.side ? ` <span class="side">${esc(s.side === 'cu' ? tr('rézoldal') : tr('alkatrészoldal'))}</span>` : ''}</h3><p class="tip">${esc(s.tip)}</p><ul>${s.items.map(it => `<li><span class="ck">☐</span>${it.mark ? `<b>${esc(it.mark)}</b> ` : ''}${esc(it.text)}</li>`).join('')}</ul></div>`).join('');
    pages.push(`<section class="page text"><h2>${esc(tr('Beültetési sorrend'))}</h2>${body}</section>`);
  }
  return `<!doctype html><html lang="${esc(o.lang)}"><head><meta charset="utf-8"><title>${esc(o.title)} – ${esc(tr('Gyártási lapok'))}</title>
<style>
@page{size:A4 portrait;margin:10mm}
@page land{size:A4 landscape;margin:10mm}
*{box-sizing:border-box}
body{margin:0;font:11pt/1.45 system-ui,"Segoe UI",Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.page.land{page:land}
.page svg{display:block}
.warn{color:#b00;font-weight:600}
h2{font-size:15pt;margin:0 0 4mm}
h3{font-size:11.5pt;margin:5mm 0 1mm}
.side{font-weight:400;color:#666;font-size:9.5pt}
.tip{margin:0 0 1.5mm;color:#555;font-size:9.5pt}
table{border-collapse:collapse;width:100%;font-size:10pt}
th,td{border-bottom:0.3mm solid #ccc;padding:1.6mm 2mm;text-align:left;vertical-align:top}
th{font-size:8.5pt;color:#555;font-weight:600}
td.n{text-align:right;width:10mm}
.ck{font-size:12pt;width:7mm}
ul{list-style:none;margin:0;padding:0}
li{padding:0.9mm 0;border-bottom:0.2mm solid #eee;display:flex;gap:2mm}
li b{font-family:"IBM Plex Mono",monospace;min-width:11mm}
.sw{display:inline-block;width:3mm;height:3mm;border-radius:50%;vertical-align:middle;border:0.2mm solid #333}
.muted{color:#555}
@media screen{body{background:#e9ece6;padding:8mm}.page{background:#fff;width:210mm;min-height:297mm;padding:10mm;margin:0 auto 8mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}.page.land{width:297mm;min-height:210mm}}
</style></head><body>${pages.join('')}</body></html>`;
}
