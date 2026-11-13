/**
 * Gyártás: anyaglista, beültetési sorrend és a lapok jelölései (vágás X, hídlánc H, vezeték V).
 * DOM-mentes; a szövegek a `tr` fordítóval készülnek (alapból magyarul). A lapok rajza: `mfgsheet.ts`.
 */
import { fmtSI, num } from '../core/expr';
import type { PartDef, PartInstance } from '../core/schema';
import { fmt, N_, type Tr } from '../i18n/i18n';
import { buildLayout, type Cut } from './board';
import { DEFS, isMcu, isOff, penv } from './defs';
import { placedPins } from './geometry';
import type { Bridge, Design, Hole, Wire } from './types';

/** Lyukosztás (mm). */
export const PITCH = 2.54;

export type BoardKind = 'dot' | 'strip' | 'section';
export const boardKind = (D: Design): BoardKind => (D.board.sec <= 1 ? 'dot' : D.board.sec >= D.board.rows ? 'strip' : 'section');
export const boardMm = (D: Design) => ({ w: +(D.board.cols * PITCH).toFixed(2), h: +(D.board.rows * PITCH).toFixed(2) });
export const holeName = (r: number, c: number) => `${r}:${c}`;

/* ---------- jelölések: a lapokon és a lépésekben ugyanazok ---------- */
export interface CutMark { n: string; cut: Cut }
/** Hídlánc: egymáshoz kapcsolódó forrasztóhidak (egy húzással forrasztható), az első lyuktól. */
export interface BridgeMark { n: string; bridges: Bridge[]; holes: Hole[]; from: Hole; to: Hole; long: number }
export interface WireMark { n: string; wire: Wire; mm: number }
export interface Marks { cuts: CutMark[]; chains: BridgeMark[]; wires: WireMark[] }

/** A ténylegesen elválasztó vágások (kézi + automatikus), oszloponként felülről. */
export function boardCuts(D: Design): Cut[] {
  return [...buildLayout(D.board, [...(D.cuts || []), ...(D.auto.cuts || [])]).cuts];
}

export function marks(D: Design): Marks {
  const cuts = boardCuts(D).map((cut, i) => ({ n: 'X' + (i + 1), cut }));
  // hidak láncokba: közös lyukon át összefüggők
  const all: Bridge[] = [...D.bridges, ...D.auto.bridges.map(b => [b[0], b[1], b[2], b[3]] as Bridge)];
  const k = (r: number, c: number) => r * 100000 + c, par = new Map<number, number>();
  const find = (x: number): number => { let y = x; while (par.get(y) !== y) y = par.get(y)!; par.set(x, y); return y; };
  const add = (x: number) => { if (!par.has(x)) par.set(x, x); };
  for (const b of all) { const a = k(b[0], b[1]), z = k(b[2], b[3]); add(a); add(z); par.set(find(a), find(z)); }
  const groups = new Map<number, Bridge[]>();
  for (const b of all) { const g = find(k(b[0], b[1])); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(b); }
  const chains = [...groups.values()].map(bs => {
    const hs = new Map<number, Hole>(); for (const b of bs) { hs.set(k(b[0], b[1]), [b[0], b[1]]); hs.set(k(b[2], b[3]), [b[2], b[3]]); }
    const holes = [...hs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const long = bs.filter(b => Math.abs(b[0] - b[2]) + Math.abs(b[1] - b[3]) > 1).length;
    return { bridges: bs, holes, from: holes[0], to: holes[holes.length - 1], long };
  }).sort((a, b) => a.from[0] - b.from[0] || a.from[1] - b.from[1]).map((x, i) => ({ n: 'H' + (i + 1), ...x }));
  const wires = [...D.wires, ...D.auto.wires].map(w => ({ wire: w, mm: +(Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]) * PITCH).toFixed(1) }))
    .sort((a, b) => a.wire.a[0] - b.wire.a[0] || a.wire.a[1] - b.wire.a[1]).map((x, i) => ({ n: 'V' + (i + 1), ...x }));
  return { cuts, chains, wires };
}

/* ---------- anyaglista ---------- */
export interface BomRow { qty: number; labels: string[]; type: string; name: string; value: string; note: string; off: boolean }
export interface BomExtra { board: { kind: BoardKind; rows: number; cols: number; sec: number; w: number; h: number }; cuts: number; bridges: number; chains: number; wires: Array<{ color: string; count: number; mm: number }>; wireMm: number }
export interface Bom { rows: BomRow[]; extra: BomExtra }

/** A példány megkülönböztető értéke (ellenállás értéke, LED színe, tüskesor lábszáma…), a hely- és csúszkaparaméterek nélkül. */
export function partValue(p: PartInstance, tr: Tr = fmt): string {
  const d: PartDef = DEFS[p.type].def, E = penv(p);
  const sliders = new Set((d.controls || []).filter(c => c.kind === 'slider').map(c => c.key));
  const out: string[] = [];
  for (const pr of d.params || []) {
    if (pr.type === 'span' || pr.type === 'names' || sliders.has(pr.key) || (pr.geo && pr.type !== 'int')) continue;
    const v = E[pr.key];
    if (pr.type === 'value') out.push(fmtSI(v) + (pr.unit || ''));
    else if (pr.type === 'select' || pr.type === 'color') { const o = (pr.options || []).find(x => String(x.v) === String(v)); out.push(o ? tr(o.label) : String(v)); }
    else if (pr.geo && pr.type === 'int' && pr.key !== 'span') out.push(`${tr(pr.label)}: ${v}`);
    else if (pr.type === 'number' || pr.type === 'int') { if (!pr.geo) out.push(`${+(+(v as number)).toPrecision(4)}${pr.unit || ''}`); }
  }
  return out.join(', ');
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function bom(D: Design, tr: Tr = fmt): Bom {
  const groups = new Map<string, BomRow>();
  for (const p of D.parts) {
    const c = DEFS[p.type]; if (!c) continue;
    const value = partValue(p, tr), off = isOff(p), key = p.type + '|' + value;
    let row = groups.get(key);
    if (!row) { row = { qty: 0, labels: [], type: p.type, name: tr(c.name), value, note: drillOf(p) ? tr('csavar, anya vagy távtartó') : '', off }; groups.set(key, row); }
    row.qty++; row.labels.push(p.label);
    if (off) {
      const sock = p.plug ? D.parts.find(q => q.id === p.plug) : null;
      row.note = sock ? tr('külső, kábellel ({x} csatlakozóba)', { x: sock.label }) : tr('külső, kábellel');
    }
  }
  const rows = [...groups.values()].map(r => ({ ...r, labels: r.labels.sort(natural) }))
    .sort((a, b) => Number(a.off) - Number(b.off) || natural(a.labels[0], b.labels[0]));
  const m = marks(D), byColor = new Map<string, { count: number; mm: number }>();
  for (const w of m.wires) { const x = byColor.get(w.wire.color || '') || { count: 0, mm: 0 }; x.count++; x.mm += w.mm; byColor.set(w.wire.color || '', x); }
  const { w, h } = boardMm(D);
  return {
    rows,
    extra: {
      board: { kind: boardKind(D), rows: D.board.rows, cols: D.board.cols, sec: D.board.sec, w, h },
      cuts: m.cuts.length, bridges: m.chains.reduce((a, c) => a + c.bridges.length, 0), chains: m.chains.length,
      wires: [...byColor].map(([color, x]) => ({ color, count: x.count, mm: Math.round(x.mm) })), wireMm: Math.round(m.wires.reduce((a, x) => a + x.mm, 0)),
    },
  };
}

/** A panel fajtájának neve. */
export function boardKindName(D: Design, tr: Tr = fmt): string {
  const k = boardKind(D);
  return k === 'dot' ? tr('pontraszteres') : k === 'strip' ? tr('csíkos') : tr('szekciós (1×{n})', { n: D.board.sec });
}

/** Anyaglista CSV-ként (pontosvesszővel, az Excel magyar beállításához is jó). */
export function bomCsv(D: Design, tr: Tr = fmt): string {
  const b = bom(D, tr), q = (s: string | number) => /[;"\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const lines = [[tr('Db'), tr('Jelölés'), tr('Alkatrész'), tr('Érték'), tr('Megjegyzés')].map(q).join(';')];
  for (const r of b.rows) lines.push([r.qty, r.labels.join(' '), r.name, r.value, r.note].map(q).join(';'));
  const x = b.extra;
  lines.push([1, '', tr('Próbapanel, {k}', { k: boardKindName(D, tr) }), `${x.board.cols}×${x.board.rows} ${tr('lyuk')} (${x.board.w}×${x.board.h} mm)`, ''].map(q).join(';'));
  if (x.wireMm) lines.push([x.wires.reduce((a, w) => a + w.count, 0), '', tr('Szigetelt vezeték'), `${tr('összesen {mm} mm', { mm: x.wireMm })}`, ''].map(q).join(';'));
  return lines.join('\n') + '\n';
}

/* ---------- beültetési sorrend ---------- */
export interface AsmItem {
  /** egyedi kulcs (a pipák mentéséhez) */ key: string;
  /** a lapon látható jelölés (X3, H2, V1, R1) */ mark: string;
  text: string;
  /** a kiemelendő alkatrész-azonosító vagy jelölés */ ref: string;
}
export interface AsmStep { id: string; title: string; side: 'comp' | 'cu' | null; tip: string; items: AsmItem[] }

/** Beültetési csoport: alacsonytól a magasig (a valós magasság a 3. lépésben, addig típus szerint). */
const GROUPS: Array<{ id: string; title: string; tip: string }> = [
  { id: 'low', title: N_('Fekvő alkatrészek: átkötők, ellenállások, diódák'), tip: N_('A lábakat hajlítsd a lyuktávolságra, a test feküdjön a panelon; forrasztás után vágd le a lábakat.') },
  { id: 'ic', title: N_('IC-k (foglalatba)'), tip: N_('Előbb a foglalatot forraszd be, a bevágás a rajz szerint; az IC-t a végén tedd bele.') },
  { id: 'small', title: N_('Kis alkatrészek: kondenzátorok, tranzisztorok, LED-ek'), tip: N_('Figyelj az irányra: a LED hosszabb lába az anód (+), a tranzisztor lapos oldala a rajz szerint.') },
  { id: 'ctrl', title: N_('Kezelőszervek: nyomógombok, potméterek'), tip: N_('Nyomd a panelhoz, hogy egyenesen álljon, és előbb két szemközti lábat forraszd.') },
  { id: 'conn', title: N_('Csatlakozók, tüskesorok'), tip: N_('A tüskesort egy lábnál forraszd, igazítsd merőlegesre, csak utána a többit.') },
  { id: 'tall', title: N_('Magas alkatrészek: elektrolit kondenzátorok'), tip: N_('Az elektrolit kondenzátor rövidebb lába, a csíkos oldal a negatív (−).') },
  { id: 'module', title: N_('Modulok és vezérlőlap'), tip: N_('Tüskesorral vagy foglalatba; a vezérlőlap USB-csatlakozója a rajz szerinti oldalra nézzen.') },
];
/** Rögzítőfurat (a leírás `meta.drill` mezője, kifejezés is lehet): a furat átmérője (mm), különben null. */
export function drillOf(p: PartInstance): number | null {
  const m = DEFS[p.type]?.def.meta as { drill?: unknown } | undefined;
  if (!m || m.drill == null) return null;
  const d = num(m.drill, penv(p));
  return isFinite(d) && d > 0 ? d : null;
}
/** A csavarfej (alátét) átmérője (mm), a furat körüli szabad terület. */
export function headOf(p: PartInstance): number | null {
  const m = DEFS[p.type]?.def.meta as { head?: unknown } | undefined;
  if (!m || m.head == null) return null;
  const d = num(m.head, penv(p));
  return isFinite(d) && d > 0 ? d : null;
}

function groupOf(p: PartInstance): string {
  const t = p.type, c = DEFS[t];
  if (drillOf(p)) return 'hole';
  if (isMcu(p)) return 'module';
  if (t === 'jumper' || t === 'res' || t === 'diode') return 'low';
  if (c.cat === 'Logika') return 'ic';
  if (t === 'elko') return 'tall';
  if (t === 'button' || t === 'pot') return 'ctrl';
  if (t === 'header' || t === 'bat' || c.def.socket) return 'conn';
  if (c.cat === 'Modul' || t === 'joystick') return 'module';
  return 'small';
}
/** Magasság (mm) a sorrendhez: a leírás `meta.h` mezőjéből, különben a csoport szerinti becslés. */
export function partHeight(p: PartInstance): number {
  const m = DEFS[p.type].def.meta as { h?: number } | undefined;
  if (m && typeof m.h === 'number') return m.h;
  return ({ low: 2.5, ic: 4, small: 5, ctrl: 7, conn: 8.5, tall: 12, module: 9 } as Record<string, number>)[groupOf(p)] ?? 5;
}

function pinText(p: PartInstance, tr: Tr): string {
  const ps = placedPins(p);
  if (!ps.length) return '';
  const pol = ps.find(q => q.role === 'an' || /\+/.test(q.name || ''));
  const span = ps.length <= 2 ? ps.map(q => holeName(q.r, q.c)).join(' – ') : tr('{n} láb, 1. láb: {h}', { n: ps.length, h: holeName(ps[0].r, ps[0].c) });
  return span + (pol && ps.length <= 3 ? ' · ' + tr('+ / anód: {h}', { h: holeName(pol.r, pol.c) }) : '');
}

export function assembly(D: Design, tr: Tr = fmt): AsmStep[] {
  const m = marks(D), steps: AsmStep[] = [], { w, h } = boardMm(D);
  steps.push({ id: 'board', title: tr('A panel előkészítése'), side: null, tip: tr('Vágd méretre a panelt, és csiszold le az élét; a lyukakat tisztítsd meg (zsírtalanítás, fényes réz).'),
    items: [{ key: 'board', mark: '', ref: '', text: tr('{k} panel, {c}×{r} lyuk ({w}×{h} mm)', { k: boardKindName(D, tr), c: D.board.cols, r: D.board.rows, w, h }) },
      ...D.parts.filter(p => DEFS[p.type] && !isOff(p) && drillOf(p)).sort((a, b) => natural(a.label, b.label))
        .map(p => ({ key: 'part:' + p.id, mark: p.label, ref: p.id, text: tr('⌀{d} mm rögzítőfurat a {h} lyuknál', { d: String(drillOf(p)), h: holeName(p.r, p.c) }) }))] });
  if (m.cuts.length) steps.push({ id: 'cuts', title: tr('Csíkvágások (rézoldal)'), side: 'cu', tip: tr('3–4 mm-es fúróval kézzel, vagy szikével két bevágással; utána nagyítóval nézd meg, hogy a réz tényleg megszakadt.'),
    items: m.cuts.map(x => ({ key: 'cut:' + x.cut.join(':'), mark: x.n, ref: x.n, text: x.cut[2] ? tr('kifúrt lyuk: {h}', { h: holeName(x.cut[0], x.cut[1]) }) : tr('a {c}. oszlop csíkja a {r1}. és {r2}. sor között', { c: x.cut[1], r1: x.cut[0], r2: x.cut[0] + 1 }) })) });
  if (m.wires.length) steps.push({ id: 'wires', title: tr('Átkötő vezetékek (alkatrészoldal)'), side: 'comp', tip: tr('A hossz a két lyuk távolsága; adj hozzá 2×5 mm-t a lábaknak. A vezeték feküdjön a panelon.'),
    items: m.wires.map(x => ({ key: 'wire:' + x.wire.a.join(':') + '-' + x.wire.b.join(':'), mark: x.n, ref: x.n, text: `${holeName(x.wire.a[0], x.wire.a[1])} → ${holeName(x.wire.b[0], x.wire.b[1])} · ${x.mm} mm` })) });
  const on = D.parts.filter(p => DEFS[p.type] && !isOff(p));
  for (const g of GROUPS) {
    const ps = on.filter(p => groupOf(p) === g.id).sort((a, b) => partHeight(a) - partHeight(b) || natural(a.label, b.label));
    if (!ps.length) continue;
    steps.push({ id: 'parts:' + g.id, title: tr(g.title), side: 'comp', tip: tr(g.tip),
      items: ps.map(p => { const v = partValue(p, tr); return { key: 'part:' + p.id, mark: p.label, ref: p.id, text: `${tr(DEFS[p.type].name)}${v ? ' ' + v : ''} · ${pinText(p, tr)}` }; }) });
  }
  if (m.chains.length) steps.push({ id: 'bridges', title: tr('Forrasztóhidak (rézoldal)'), side: 'cu', tip: tr('Ónnal kösd össze a szomszédos lyukakat; hosszabb láncnál egy csupasz huzal (vagy levágott láb) a lyukak fölött biztosabb.'),
    items: m.chains.map(x => ({ key: 'chain:' + holeName(x.from[0], x.from[1]), mark: x.n, ref: x.n, text: tr('{a} → {b} · {n} híd', { a: holeName(x.from[0], x.from[1]), b: holeName(x.to[0], x.to[1]), n: x.bridges.length }) + (x.long ? ' · ' + tr('{n} hosszabb, csupasz huzallal', { n: x.long }) : '') })) });
  const offs = D.parts.filter(p => DEFS[p.type] && isOff(p));
  if (offs.length) steps.push({ id: 'off', title: tr('Külső alkatrészek, kábelek'), side: null, tip: tr('A kábelt a jelölt csatlakozóba dugd; ügyelj a sorrendre (GND, táp, jel).'),
    items: offs.map(p => { const s = p.plug ? D.parts.find(q => q.id === p.plug) : null; return { key: 'part:' + p.id, mark: p.label, ref: p.id, text: tr(DEFS[p.type].name) + (s ? ' → ' + s.label : '') }; }) });
  steps.push({ id: 'check', title: tr('Ellenőrzés bekapcsolás előtt'), side: null, tip: tr('A tápot csak akkor kösd rá, ha minden pont rendben van.'),
    items: [
      { key: 'chk:look', mark: '', ref: '', text: tr('Nagyítóval: nincs-e ónhíd a szomszédos csíkok között, minden forrasztás fényes, kúpos') },
      { key: 'chk:short', mark: '', ref: '', text: tr('Multiméterrel: a GND és a táp (3V3, 5V) között nincs zárlat') },
      { key: 'chk:pol', mark: '', ref: '', text: tr('Irány: LED-ek, diódák, elektrolit kondenzátorok, IC-k és modulok a rajz szerint') },
      { key: 'chk:power', mark: '', ref: '', text: tr('Első bekapcsolás: figyeld a melegedést; a feszültségeket mérd meg a vezérlőlap lábain') },
    ] });
  return steps;
}
