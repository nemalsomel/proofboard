/** A terv: üres terv, beolvasás (normalizálás, régi formátumok), saját alkatrészek összefésülése megnyitáskor. */
import type { PartDef } from '../core/schema';
import { hasErrors, validatePartDef } from '../core/validate';
import { PARTS } from '../parts/builtin';
import type { Cut } from './board';
import { DEFS, libraryParts, syncDefs } from './defs';
import type { AutoBridge, Bridge, Design, Hole, Link, Note, Wire } from './types';

/** Jegyzetszínek: [szín, név]. */
export const NOTE_COL: ReadonlyArray<readonly [string, string]> = [['#fff3bf', 'sárga'], ['#d3f9d8', 'zöld'], ['#d0ebff', 'kék'], ['#ffe3e3', 'piros'], ['#f1f3f5', 'szürke']];

export const emptyDesign = (): Design => ({
  v: 1, board: { rows: 78, cols: 39, sec: 3 }, parts: [], bridges: [], wires: [], links: [], auto: { bridges: [], wires: [] },
  customParts: {}, notes: [], gpio: {}, pwm: {}, settings: { usb: true, btnMode: 'hold', autoRoute: true }, seq: 1,
});

/** Csíkvágás-lista beolvasása: [sor, oszlop, fajta] egész számokkal. */
export const normCutList = (x: unknown): Cut[] =>
  (Array.isArray(x) ? x : []).filter(c => Array.isArray(c) && c.length >= 2)
    .map(c => [Math.round(+c[0]), Math.round(+c[1]), +c[2] ? 1 : 0] as Cut).filter(c => c.every(Number.isFinite));

type Raw = Record<string, any>;
const hole = (x: unknown): Hole => { const a = x as number[]; return [Number(a[0]), Number(a[1])]; };

/** JSON-ból (mentett, régebbi vagy kézzel írt terv) érvényes terv; ismeretlen alkatrésztípusnál hibát dob. A saját alkatrészeket regisztrálja. */
export function normalize(d: unknown): Design {
  if (!d || typeof d !== 'object') throw new Error('nem objektum');
  const r = d as Raw, o = emptyDesign();
  if (r.board) Object.assign(o.board, r.board);
  for (const [k, def] of Object.entries((r.customParts || {}) as Record<string, PartDef>)) {
    if (!/^c_[a-z0-9_]+$/.test(k) || k in PARTS || hasErrors(validatePartDef(def))) continue;
    o.customParts[k] = def;
  }
  // a tervben használt, de a leírásában hiányzó saját alkatrész a könyvtárból kerül bele (így a terv önálló marad)
  const lib = libraryParts();
  for (const p of (r.parts || []) as Raw[]) if (p && typeof p.type === 'string' && !(p.type in PARTS) && !(p.type in o.customParts) && lib[p.type]) o.customParts[p.type] = lib[p.type];
  syncDefs(o.customParts);
  o.parts = ((r.parts || []) as Raw[]).map((p, i) => {
    if (!DEFS[p.type]) throw new Error('ismeretlen alkatrész: ' + p.type);
    return { id: p.id || 'p' + (1000 + i), type: p.type, label: p.label || DEFS[p.type].prefix + (i + 1), r: p.r | 0, c: p.c | 0, rot: (p.rot | 0) & 3, mir: !!p.mir,
      ...(p.xray ? { xray: true } : {}), ...(typeof p.plug === 'string' && p.plug ? { plug: p.plug } : {}), props: { ...DEFS[p.type].props, ...(p.props || {}) } };
  });
  for (const p of o.parts) if (p.plug && !o.parts.some(x => x.id === p.plug)) delete p.plug; // a csatlakozó már nincs meg
  o.bridges = ((r.bridges || []) as unknown[]).filter(b => Array.isArray(b) && b.length === 4).map(b => (b as unknown[]).map(Number) as Bridge);
  o.wires = ((r.wires || []) as Raw[]).filter(w => w && w.a && w.b).map(w => ({ a: hole(w.a), b: hole(w.b), color: w.color || '#1c7ed6' }));
  o.gpio = r.gpio || {};
  o.pwm = r.pwm && typeof r.pwm === 'object' ? r.pwm : {};
  o.settings = { ...o.settings, ...(r.settings || {}) };
  o.notes = (Array.isArray(r.notes) ? (r.notes as Raw[]) : []).filter(n => n && isFinite(+n.r) && isFinite(+n.c)).map((n, i): Note => ({
    id: String(n.id || 'n' + (i + 1)), r: +n.r, c: +n.c, w: Math.max(3, Math.min(60, +n.w || 10)), h: Math.max(2, Math.min(60, +n.h || 6)),
    text: String(n.text ?? ''), color: NOTE_COL.some(x => x[0] === n.color) ? n.color : NOTE_COL[0][0], target: n.target ? String(n.target) : null,
  }));
  o.links = ((r.links || []) as Raw[]).filter(l => l && l.a && l.b).map((l, i): Link => ({ id: l.id || 'l' + (5000 + i), a: String(l.a), b: String(l.b), gpio: l.gpio || null }));
  const au = (r.auto || {}) as Raw;
  o.auto = {
    bridges: ((au.bridges || []) as unknown[][]).filter(b => Array.isArray(b) && b.length >= 4)
      .map(b => [...b.slice(0, 4).map(Number), Array.isArray(b[4]) ? b[4] : b[4] ? [b[4]] : []] as AutoBridge),
    wires: ((au.wires || []) as Raw[]).filter(w => w && w.a && w.b).map((w): Wire => ({ a: w.a, b: w.b, color: w.color || '#7048e8', links: w.links || (w.link ? [w.link] : []) })),
    cuts: normCutList(au.cuts),
  };
  o.cuts = normCutList(r.cuts);
  if (r.signal && typeof r.signal === 'object') {
    const s = r.signal as Raw;
    o.signal = { preset: String(s.preset || 'half'), custom: String(s.custom || ''), pins: (Array.isArray(s.pins) ? s.pins : []).slice(0, 8).map((x: unknown) => (x ? String(x) : null)),
      step: +s.step || 0, rate: +s.rate || 4, dir: +s.dir < 0 ? -1 : 1 };
  }
  o.seq = Math.max(r.seq || 1, ...o.parts.map(p => +String(p.id).replace(/\D/g, '') + 1 || 1), ...o.links.map(l => +String(l.id).replace(/\D/g, '') + 1 || 1));
  return o;
}

/**
 * Megnyitott terv saját alkatrészei a saját könyvtárhoz képest: ha egy kulcs a könyvtárban más tartalommal már
 * foglalt, a terv változata új kulcsot kap (`_2`…), és a terv alkatrészei is erre mutatnak; a könyvtár változatlan.
 */
export function rekeyAgainstLibrary(raw: Raw, lib: Record<string, PartDef>): { raw: Raw; renamed: Array<{ name: string; from: string; to: string }> } {
  const inc = (raw && raw.customParts && typeof raw.customParts === 'object' ? raw.customParts : {}) as Record<string, PartDef>;
  const out: Record<string, PartDef> = {}, map = new Map<string, string>(), renamed: Array<{ name: string; from: string; to: string }> = [];
  const taken = (k: string) => k in lib || k in inc || k in out || k in PARTS;
  for (const [k, def] of Object.entries(inc)) {
    if (k in lib && JSON.stringify(lib[k]) !== JSON.stringify(def)) {
      let n = 2;
      while (taken(k + '_' + n)) n++;
      const nk = k + '_' + n;
      out[nk] = def; map.set(k, nk); renamed.push({ name: def.name, from: k, to: nk });
    } else out[k] = def;
  }
  const parts = Array.isArray(raw.parts) ? (raw.parts as Raw[]).map(p => (p && map.has(p.type) ? { ...p, type: map.get(p.type) } : p)) : raw.parts;
  return { raw: { ...raw, customParts: out, parts }, renamed };
}

/**
 * Megnyitott terv saját alkatrészei a meglévők mellé: az azonos kulcsú, de eltérő saját alkatrész `_2`, `_3`…
 * utótagot kap (megmarad), az azonos tartalmú egybeolvad. Visszaadja az összefésült könyvtárat és az átnevezett neveket.
 */
export function mergeCustomParts(mine0: Record<string, PartDef>, inc: Record<string, PartDef>): { parts: Record<string, PartDef>; renamed: string[] } {
  const mine = { ...mine0 }, renamed: string[] = [];
  for (const [k, def] of Object.entries(mine)) {
    if (!(k in inc)) continue;
    if (JSON.stringify(inc[k]) === JSON.stringify(def)) { delete mine[k]; continue; }
    let n = 2;
    while (k + '_' + n in mine || k + '_' + n in inc) n++;
    mine[k + '_' + n] = def;
    delete mine[k];
    renamed.push(def.name);
  }
  return { parts: { ...mine, ...inc }, renamed };
}
