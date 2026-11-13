/**
 * Agent-eszközök: a Proofboard műveletei nyelvi modell számára (Anthropic tool use / MCP formátum).
 * Átvitelfüggetlen és DOM-mentes: a beépített agent (böngésző) és a későbbi MCP-szerver (Node) ugyanezt a
 * listát használja. Az eszköz a tervet a környezeten (`ToolCtx`) át kapja, a tervműveletek az `engine/ops.ts`-re épülnek.
 *
 * Az eszközök leírása és kimenete angol: a modellnek szól, nem a felületnek (a Problémák üzenetei a `ctx.tr` nyelvén).
 * Hivatkozások: alkatrész a címkéjével („R1”), láb „címke.láb” alakban („R1.2”, „LED1.A”, „PICO1.GP15”),
 * lyuk (sor, oszlop), 0-tól. A csíkok függőlegesek: egy oszlop egy csík, `sec` soronként szakaszolva.
 */
import type { PartInstance } from '../core/schema';
import { matchPart, typeKeyFor } from '../core/library';
import type { PartDef } from '../core/schema';
import { hasErrors, validatePartDef } from '../core/validate';
import { defToForm, formToDef, type Form } from '../core/partform';
import { EL_KINDS } from '../core/circuit';
import { decodeShare, shareCode, shareUrl } from '../core/share';
import { applyImport, importCode } from '../engine/codeimport';
import { assembly, bom, boardMm } from '../engine/manufacture';
import { BOARD_T, dimDxf, dimItems, LEGS, maxHeight } from '../engine/dimension';
import { PARTS } from '../parts/builtin';
import { fmt, t as translate, type Tr } from '../i18n/i18n';
import { checkAll, type Issue } from '../engine/check';
import { generateCode, type CodeLang } from '../engine/codegen';
import { applyCompaction, layoutStats, planCompaction, type CompactMetrics, type CompactResult, type KeepReason } from '../engine/compact';
import { makeProgTools } from './progtools';
import { BRIEF_MAX, emptyDesign, normalize } from '../engine/design';
import { DEFS, hasPress, isMcu, isOff, penv, syncDefs } from '../engine/defs';
import { placedPins, xf } from '../engine/geometry';
import { simulateFor } from '../engine/headless';
import { linkStates, linkText } from '../engine/links';
import { GPIO_MODES } from '../engine/mcu';
import { analyze, layoutOf, type Netlist } from '../engine/netlist';
import * as OPS from '../engine/ops';
import { route } from '../engine/route';
import { gpioLevel } from '../engine/simulate';
import type { Design, Link, PlacedPin } from '../engine/types';

/* ---------- Típusok ---------- */

/** JSON-séma (a tool use bemenetéhez). */
export interface JsonSchema { type: string; description?: string; properties?: Record<string, JsonSchema>; items?: JsonSchema; required?: string[]; enum?: Array<string | number>; additionalProperties?: boolean }

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** a terv megváltozott (a gazda újrarajzol, ment) */ changed?: boolean;
  /** kép a panelről (base64 PNG) */ image?: string;
}

/** A környezet: a terv és a gazda műveletei. */
export interface ToolCtx {
  D(): Design;
  /** új terv betöltése (példa, üres terv) */ setD(d: Design): void;
  /** módosítás után: újraszámolás, útvonal (ha automatikus), mentés; a felületen a `commit` */ commit(): void;
  /** fordító a Problémák üzeneteihez */ tr?: Tr;
  /** panelkép (base64 PNG), ha a gazda tud rajzolni */ snapshot?(): Promise<string | null> | string | null;
  /** példák: azonosító, cím, leírás, és a betöltésük */ examples?(): Array<{ id: string; title: string; desc: string }>;
  loadExample?(id: string): boolean;
  /** saját alkatrész mentése (a felületen a saját könyvtárba és a tervbe); a típuskulcs. Alapból csak a tervbe. */
  saveCustomPart?(type: string, def: PartDef): void;
  /** a saját könyvtár alkatrészei (a terven kívüliek is) */ library?(): Record<string, PartDef>;
  /** a program megváltozott: a felület mutassa a Program nézetet (ha nem látszik) */ showProgram?(fit?: boolean): void;
  /** a megosztott link alapja (az app címe); alapból a nyilvános cím */ shareBase?(): string;
}

/** A nyilvános app címe: a megosztott link ide mutat, ha a gazda nem ad mást. */
export const PUBLIC_URL = 'https://nemalsomel.github.io/proofboard/';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
  /** módosítja-e a tervet (Megbeszélés módban a módosító eszközök nem érhetők el) */ mutates: boolean;
  run(ctx: ToolCtx, input: Record<string, unknown>): ToolResult | Promise<ToolResult>;
}

/* ---------- Segédek ---------- */

const ok = (text: string, changed = false): ToolResult => ({ text, changed });
const err = (text: string): ToolResult => ({ text, isError: true });
const en: Tr = (s, p) => translate(s, p, 'en');
const num = (x: unknown): number | null => (typeof x === 'number' && isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && isFinite(+x) ? +x : null);
const str = (x: unknown): string => (x == null ? '' : String(x));

/** Alkatrész a címkéje szerint (kis- és nagybetű nem számít). */
export function partOf(D: Design, label: string): PartInstance | null {
  const l = label.trim().toLowerCase();
  return D.parts.find(p => p.label.toLowerCase() === l) || null;
}

/** Láb „címke.láb” hivatkozásból: a láb azonosítója vagy neve szerint; vissza a belső hivatkozás is (pl. 'p3.A'). */
export function pinOf(D: Design, ref: string): { p: PartInstance; q: PlacedPin; ref: string } | null {
  const i = ref.indexOf('.'); if (i < 0) return null;
  const p = partOf(D, ref.slice(0, i)); if (!p) return null;
  const n = ref.slice(i + 1).trim().toLowerCase(), ps = placedPins(p);
  const q = ps.find(x => x.id.toLowerCase() === n) || ps.find(x => x.name.toLowerCase() === n) || ps.find(x => en(x.name).toLowerCase() === n);
  return q ? { p, q, ref: p.id + '.' + q.id } : null;
}

/** Belső lábhivatkozás (p3.A) → olvasható („LED1.A”). */
export function pinLabelOf(D: Design, ref: string): string {
  const i = ref.indexOf('.'), p = D.parts.find(x => x.id === ref.slice(0, i));
  if (!p) return ref;
  const q = placedPins(p).find(x => x.id === ref.slice(i + 1));
  return p.label + '.' + (q ? (q.name !== q.id && !isMcu(p) ? q.id : q.name) : ref.slice(i + 1));
}

/** Az alkatrész által elfoglalt lyukak (a test téglalapja a panelon), ütközésvizsgálathoz. */
function footprint(p: PartInstance): Set<string> {
  const b = DEFS[p.type].bounds(p), cs = [[b.r0, b.c0], [b.r1, b.c1], [b.r0, b.c1], [b.r1, b.c0]].map(([r, c]) => xf(p, r, c));
  const r0 = Math.ceil(Math.min(...cs.map(x => x[0]))), r1 = Math.floor(Math.max(...cs.map(x => x[0])));
  const c0 = Math.ceil(Math.min(...cs.map(x => x[1]))), c1 = Math.floor(Math.max(...cs.map(x => x[1])));
  const out = new Set<string>();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.add(r + ':' + c);
  for (const q of placedPins(p)) out.add(q.r + ':' + q.c);
  return out;
}

/** Mely (panelra szerelt) alkatrészekkel ütközne. */
export function overlaps(D: Design, cand: PartInstance): string[] {
  if (isOff(cand)) return [];
  const f = footprint(cand), out: string[] = [];
  for (const p of D.parts) { if (p.id === cand.id || isOff(p)) continue; for (const h of footprint(p)) if (f.has(h)) { out.push(p.label); break; } }
  return out;
}

/**
 * Véletlen összeköttetések a csíkokon: a saját lábak közül azok, amelyek egy csíkszakaszba esnek, de gyárilag nincsenek
 * összekötve (pl. a nyomógomb két oldala), és a más alkatrész lábával közös szakaszba eső lábak.
 */
export function stripClashes(D: Design, cand: PartInstance): string[] {
  if (isOff(cand)) return [];
  const L = layoutOf(D), cellOf = (r: number, c: number) => (OPS.onBoard(D, r, c) && !L.drilled(r, c) ? L.cell(r, c) : null);
  const same = new Map<string, string>(); // belső összeköttetés: láb → csoport
  for (const [a, b] of DEFS[cand.type].internal(cand)) { const g = same.get(a) || a; same.set(a, g); same.set(b, g); }
  const grp = (id: string) => same.get(id) || id, mine = placedPins(cand), out: string[] = [];
  const byCell = new Map<number, typeof mine>();
  for (const q of mine) { const k = cellOf(q.r, q.c); if (k == null) continue; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k)!.push(q); }
  for (const qs of byCell.values()) for (let i = 1; i < qs.length; i++) if (grp(qs[i].id) !== grp(qs[0].id)) out.push(`${cand.label}.${pinRef(cand, qs[0])} and ${cand.label}.${pinRef(cand, qs[i])} share a strip section (shorted)`);
  for (const p of D.parts) {
    if (p.id === cand.id || isOff(p)) continue;
    for (const q of placedPins(p)) { const k = cellOf(q.r, q.c); if (k == null || !byCell.has(k)) continue; out.push(`${cand.label}.${pinRef(cand, byCell.get(k)![0])} shares a strip section with ${p.label}.${pinRef(p, q)}`); }
  }
  return out;
}

/** Szabad hely: a megadott ponthoz (vagy a panel bal felső sarkához) legközelebbi, ahol elfér és nem ütközik. */
export function freeSpot(D: Design, g: PartInstance, near?: { r: number; c: number }): { r: number; c: number } | null {
  const { rows, cols } = D.board, o = near || { r: 0, c: 0 }, cand: Array<[number, number, number]> = [];
  const lo = isOff(g) ? -OPS.EXT : 0, hiR = isOff(g) ? rows + OPS.EXT : rows, hiC = isOff(g) ? cols + OPS.EXT : cols;
  for (let r = lo; r < hiR; r++) for (let c = lo; c < hiC; c++) cand.push([Math.abs(r - o.r) + Math.abs(c - o.c), r, c]);
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, r, c] of cand) { const t = { ...g, r, c }; if (OPS.partFits(D, t) && !overlaps(D, t).length && !stripClashes(D, t).length) return { r, c }; }
  return null;
}

const typeName = (type: string) => en(DEFS[type].name);
/** a láb hivatkozható neve: vezérlőlapon a GPIO-név (GP15), máshol az azonosító (A, 1, B1) */
const pinRef = (p: PartInstance, q: { id: string; name: string }) => (isMcu(p) ? q.name : q.id);
const rotDeg = (p: PartInstance) => p.rot * 90 + '°' + (p.mir ? ' mirrored' : '');
const fmtV = (v: unknown) => (typeof v === 'number' ? +v.toPrecision(4) : v);
function paramsText(p: PartInstance): string {
  const E = penv(p), ps = DEFS[p.type].def.params || [];
  return ps.filter(x => x.type !== 'span' && x.type !== 'names').map(x => `${x.key}=${fmtV(E[x.key])}${x.unit ? x.unit : ''}`).join(', ');
}

/** Az alkatrész-űrlap tömör leírása a modellnek (get_part_schema). */
const PART_SCHEMA_TEXT = () => [
  'Part editor model ("form") – save with save_custom_part {form}; the part is then editable in the app (Pins and Function tabs).',
  'Fields: name, prefix (label prefix, e.g. "RV"), cat (category), bodyText (text on the body), fill (body colour #rrggbb), pad (body margin around pins, holes, default 0.6), ext {t,b,l,r} (extra body size, holes), showLabel (bool), names ("below"|"above"|"in"|"out"|"none": pin name labels), off (true = off-board part on a cable).',
  'pins: [{ id, name, lr, lc, role, group, volt?, caps?, fn? }] – lr/lc = row/column in holes (first pin is the origin 0:0); group: pins with the same non-empty group are connected internally; volt for vin pins "2.7-5.5".',
  'Pin roles: sig (signal), out, vin (power in), gnd, adc (analog signal), an (anode/+), ka (cathode/−), nc, h (general), r (resistor lead), gpio, p33, pwr, misc.',
  'model: electrical elements [{ el, pins: [pin ids in order], vals: [values as text] }]:',
  ...Object.entries(EL_KINDS).map(([k, d]) => `  ${k}: pins (${d.pins.map(p => p[0]).join(', ')}), vals (${d.vals.map(v => `${v[0]}${v[2] ? ' ' + v[2] : ''}, default ${v[3]}`).join('; ') || '-'})`),
  '  Values accept SI prefixes ("4.7k", "100n") or an expression of parameters in braces, e.g. "{ohm*pos/100+0.5}".',
  'press: [pinA, pinB] – a push button that connects the two pins while pressed (clickable in simulation).',
  'logic (digital behaviour): { vcc: pin, gnd: pin, outs: [{ pin, expr, oe?, type: "pp"|"od" }], regs?: [{ name, clk, d, edge: "rise"|"fall", reset?, set? }] } – expr uses pin names and register names with & | ^ ! ( ), e.g. "!(A & B)".',
  'params: [{ key, label, unit, def, min, max, step, slider, value? }] – adjustable per placed part; slider: true = a slider in simulation; value: true = the value takes SI prefixes (e.g. ohms). Use {key} in model values.',
  'Example – potentiometer: {"name":"Potentiometer 10k","prefix":"RV","cat":"Passive","pins":[{"id":"1","name":"1","lr":0,"lc":0,"role":"r","group":""},{"id":"W","name":"W","lr":0,"lc":1,"role":"adc","group":""},{"id":"3","name":"3","lr":0,"lc":2,"role":"r","group":""}],"model":[{"el":"resistor","pins":["1","W"],"vals":["{ohm*pos/100+0.5}"]},{"el":"resistor","pins":["W","3"],"vals":["{ohm*(100-pos)/100+0.5}"]}],"params":[{"key":"ohm","label":"Value","unit":"Ω","def":"10k","min":"100","max":"10M","step":"","slider":false,"value":true},{"key":"pos","label":"Position","unit":"%","def":"50","min":"0","max":"100","step":"5","slider":true}],"press":null}',
  'There is also a built-in "pot" (potentiometer) – prefer built-ins when they fit. After saving, place the part and check it with simulate.',
].join('\n');

/** a saját alkatrészek: a könyvtár és a terv (a terv felülírja) */
const customDefs = (ctx: ToolCtx): Record<string, PartDef> => ({ ...(ctx.library ? ctx.library() : {}), ...(ctx.D().customParts || {}) });

/* ---------- Tömörítés ---------- */

const KEEP_EN: Record<KeepReason, string> = { fixed: 'fixed', mcu: 'controller', control: 'control', manual: 'hand-wired', off: 'off-board', scope: 'not in "only"' };
function compactPlan(D: Design, i: Record<string, unknown>): CompactResult | { error: string } {
  const s = num(i.strength); if (s != null && (s < 0 || s > 1)) return { error: 'strength must be between 0 and 1.' };
  let only: string[] | null = null;
  if (Array.isArray(i.only)) { const ls = i.only.map(str), ps = ls.map(l => partOf(D, l)), miss = ls.filter((_, k) => !ps[k]); if (miss.length) return { error: `Unknown label(s): ${miss.join(', ')}` }; only = ps.map(p => p!.id); }
  return planCompaction(D, { strength: s ?? 0.5, only, keepMcu: i.keep_mcu !== false, keepControls: i.keep_controls !== false });
}
function compactText(r: CompactResult, applied: boolean): string {
  const m = (x: CompactMetrics) => `${x.stats.box ? x.stats.rows + '×' + x.stats.cols : '-'} holes, ${x.bridges} bridges, ${x.wires} wires, ${x.linksOk}/${x.links} connected`;
  const kept = Object.entries(r.kept).filter(([, w]) => w !== 'off').map(([l, w]) => `${l} (${KEEP_EN[w]})`);
  const L = [r.moves.length ? (applied ? 'Compacted.' : 'Compaction preview (not applied).') : 'No better layout found with these settings; nothing changed.',
    `Before: ${m(r.before)}`, `After:  ${m(r.after)}`];
  if (r.moves.length) L.push('Moves: ' + r.moves.map(x => `${x.label} ${x.from.r},${x.from.c} → ${x.to.r},${x.to.c}${x.to.rot !== x.from.rot ? ` rot ${x.to.rot * 90}°` : ''}`).join('; '));
  if (kept.length) L.push('Stays in place: ' + kept.join(', '));
  return L.join('\n');
}

/* ---------- Tervösszefoglaló ---------- */

export interface Analysis { A: Netlist; issues: Issue[]; states: ReturnType<typeof linkStates> }
export function analyzeDesign(D: Design, tr: Tr = fmt): Analysis {
  const A = analyze(D), states = linkStates(D, A);
  const issues = checkAll(D, { A0: A, AS: A, SIM: null, linkState: states, tr });
  return { A, issues, states };
}

/** Tömör szöveges összefoglaló a tervről (a modell ebből „lát”). */
export function summarize(D: Design, tr: Tr = fmt): string {
  const { issues, states } = analyzeDesign(D, tr), b = D.board, L: string[] = [];
  const kind = b.sec >= b.rows ? 'full-length vertical strips (stripboard)' : b.sec <= 1 ? 'isolated pads (dot grid, no strips)' : `vertical strips cut into sections of ${b.sec} rows`;
  L.push(D.brief ? `Project notes (kept by you and the user; update with set_project_notes):\n${D.brief}` : 'Project notes: none yet (record the goal and key decisions with set_project_notes once agreed).');
  L.push(`Board: ${b.rows} rows × ${b.cols} columns, ${kind}. Holes are (row, col), 0-based; a strip is one column.`);
  L.push(`Settings: auto-routing ${D.settings.autoRoute ? 'on' : 'off'}, automatic strip cuts ${D.settings.autoCut === false ? 'off' : 'on'}.`);
  if (!D.parts.length) L.push('Parts: none.');
  else {
    L.push(`Parts (${D.parts.length}):`);
    for (const p of D.parts) {
      const ps = placedPins(p), pins = ps.length <= 8 ? ' pins ' + ps.map(q => `${q.name !== q.id && !isMcu(p) ? q.id + '/' + en(q.name) : q.name}@${q.r},${q.c}`).join(' ') : ` ${ps.length} pins`;
      const prm = paramsText(p);
      L.push(`- ${p.label}: ${typeName(p.type)} [${p.type}] at ${p.r},${p.c} rot ${rotDeg(p)}${p.fixed ? ', FIXED by the user (do not move)' : ''}${isOff(p) ? ', off-board' + (p.plug ? ' (plugged into ' + (D.parts.find(h => h.id === p.plug) || { label: '?' }).label + ')' : '') : ''}${prm ? '; ' + prm : ''};${pins}`);
    }
  }
  if (D.links.length) {
    L.push(`Connections (${D.links.length}, routed automatically when auto-routing is on):`);
    for (const l of D.links) {
      const s = states.get(l.id), via = !s ? '' : !s.ok ? 'NOT connected' : s.cable ? 'via cable' : s.wire ? 'via wire' : s.nb ? `via ${s.nb} bridge(s)` : 'connected';
      L.push(`- ${pinLabelOf(D, l.a)} → ${l.b === 'GND' || l.b === 'GPIO' ? l.b : pinLabelOf(D, l.b)}${s && s.gpio && l.b === 'GPIO' ? ' (' + s.gpio + ')' : ''}: ${via}`);
    }
  } else L.push('Connections: none.');
  { const st = layoutStats(D); if (st.box) L.push(`Footprint: rows ${st.box.r0}–${st.box.r1}, columns ${st.box.c0}–${st.box.c1} (${st.rows}×${st.cols} holes, ${Math.round(st.area / st.boardArea * 100)}% of the board); part bodies fill ${Math.round(st.fill * 100)}% of it. Keep layouts compact: place parts close to what they connect to.`); }
  L.push(`Wiring: ${D.auto.bridges.length} auto bridges, ${D.auto.wires.length} auto wires, ${D.bridges.length} manual bridges, ${D.wires.length} manual wires, ${(D.cuts || []).length + (D.auto.cuts || []).length} strip cuts.`);
  const gp = Object.entries(D.gpio || {}).filter(([, m]) => m);
  if (gp.length) L.push('GPIO modes: ' + gp.map(([k, m]) => `${pinLabelOf(D, k)}=${m}`).join(', '));
  if (D.program && D.program.nodes.length) L.push(`Program: ${D.program.nodes.length} blocks (${[...new Set(D.program.nodes.map(n => n.type))].join(', ')}).`);
  const shown = issues.filter(i => i.sev !== 'info');
  L.push(shown.length ? `Problems (${shown.length}):\n` + shown.slice(0, 20).map(i => `- [${i.sev}] ${i.msg}`).join('\n') + (shown.length > 20 ? `\n… ${shown.length - 20} more` : '') : 'Problems: none.');
  if (D.notes && D.notes.length) L.push(`Notes: ${D.notes.length}.`);
  return L.join('\n');
}

/* ---------- Eszközök ---------- */

const S = {
  str: (description: string): JsonSchema => ({ type: 'string', description }),
  int: (description: string): JsonSchema => ({ type: 'integer', description }),
  num: (description: string): JsonSchema => ({ type: 'number', description }),
  bool: (description: string): JsonSchema => ({ type: 'boolean', description }),
  arr: (items: JsonSchema, description: string): JsonSchema => ({ type: 'array', items, description }),
  obj: (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false }),
};

/** A paraméterérték ellenőrzése és átalakítása a leírás szerint; hiba esetén szöveg. */
function coerceParam(type: string, key: string, v: unknown): { v: unknown } | { error: string } {
  const pd = (DEFS[type].def.params || []).find(x => x.key === key);
  if (!pd) return { error: `${typeName(type)} has no parameter "${key}" (valid: ${(DEFS[type].def.params || []).map(x => x.key).join(', ') || 'none'})` };
  if (pd.type === 'select' || pd.type === 'color') {
    const o = (pd.options || []).find(x => String(x.v) === String(v) || en(x.label).toLowerCase() === String(v).toLowerCase());
    return o ? { v: o.v } : { error: `"${key}" must be one of: ${(pd.options || []).map(x => `${x.v} (${en(x.label)})`).join(', ')}` };
  }
  if (pd.type === 'names') return { v: str(v) };
  if (pd.type === 'span') return { error: `"${key}" is a pin-spacing parameter; set "dr" and "dc" (row/column offset of the second pin)` };
  const n = num(v); if (n == null) return { error: `"${key}" must be a number${pd.unit ? ' in ' + pd.unit : ''}` };
  if ((pd.min != null && n < pd.min) || (pd.max != null && n > pd.max)) return { error: `"${key}" must be between ${pd.min ?? '-∞'} and ${pd.max ?? '∞'}` };
  return { v: pd.type === 'int' ? Math.round(n) : n };
}
function applyParams(type: string, params: unknown, base: Record<string, unknown> = {}): { props: Record<string, unknown> } | { error: string } {
  const props = { ...base };
  if (params == null) return { props };
  if (typeof params !== 'object') return { error: 'params must be an object' };
  const span = (DEFS[type].def.params || []).find(x => x.type === 'span');
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (span && (k === 'dr' || k === 'dc')) { const n = num(v); if (n == null) return { error: `"${k}" must be an integer` }; props[k] = Math.round(n); continue; }
    const r = coerceParam(type, k, v); if ('error' in r) return r; props[k] = r.v;
  }
  return { props };
}

function partBrief(D: Design, p: PartInstance): string {
  return `${p.label} (${typeName(p.type)}) at ${p.r},${p.c} rot ${rotDeg(p)}; pins ` + placedPins(p).map(q => `${q.id === q.name ? q.id : q.id + '/' + en(q.name)}@${q.r},${q.c}${OPS.onBoard(D, q.r, q.c) ? '' : '(off-board)'}`).join(' ');
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_design', mutates: false,
    description: 'Get a compact text summary of the current design: board, parts (label, type, position, rotation, parameters, pin positions), connections with routing status, wiring counts, GPIO modes, program, and problems. Call this first, and again after changes when you need fresh state.',
    input_schema: S.obj({}),
    run: (ctx) => ok(summarize(ctx.D(), ctx.tr)),
  },
  {
    name: 'list_part_types', mutates: false,
    description: 'Search the part catalog (built-in and the user\'s own parts). Returns type keys, names, categories and footprints. Use the type key with place_part. Query matches name, category, footprint or pin names, in English or Hungarian; empty query lists everything.',
    input_schema: S.obj({ query: S.str('search words, e.g. "led", "resistor", "button", "esp32"') }),
    run(_ctx, i) {
      const q = str(i.query), xs = Object.values(DEFS).filter(d => !q || matchPart(d.def, q, en));
      if (!xs.length) return ok(`No part type matches "${q}". Try a broader word, or an empty query.`);
      return ok(xs.map(d => `${d.type}: ${en(d.name)} — ${en(d.cat)}; ${en(d.fp)}${d.def.mount === 'off' ? '; off-board (cable)' : ''}`).join('\n'));
    },
  },
  {
    name: 'describe_part_type', mutates: false,
    description: 'Details of one part type: pins (id, name, role, capabilities), parameters (key, type, default, unit, options), help text. Use before placing an unfamiliar part or setting its parameters.',
    input_schema: S.obj({ type: S.str('part type key from list_part_types') }, ['type']),
    run(_ctx, i) {
      const d = DEFS[str(i.type)]; if (!d) return err(`Unknown part type "${str(i.type)}". Use list_part_types.`);
      const g = { id: 'x', type: d.type, label: d.prefix, r: 0, c: 0, rot: 0, mir: false, props: { ...d.props } } as PartInstance;
      const pins = d.pins(g).map(q => `${q.id}${q.name !== q.id ? '/' + en(q.name) : ''} (${q.role}${q.caps && q.caps.length ? '; ' + q.caps.join(',') : ''}) @${q.lr},${q.lc}`);
      const prm = (d.def.params || []).map(x => `${x.key}: ${x.type}${x.unit ? ' [' + x.unit + ']' : ''}, default ${JSON.stringify(x.default)}${x.options ? ', options ' + x.options.map(o => `${o.v}=${en(o.label)}`).join('|') : ''}${x.min != null || x.max != null ? `, range ${x.min ?? ''}..${x.max ?? ''}` : ''} — ${en(x.label)}`);
      const help = d.def.meta && typeof d.def.meta.help === 'string' ? en(d.def.meta.help) : '';
      return ok([`${d.type}: ${en(d.name)} (${en(d.cat)}; ${en(d.fp)}); label prefix ${d.prefix}${d.def.mount === 'off' ? '; off-board part: placed beside the board, connected by cable via a header (attach_plug)' : ''}`,
        `Pins (local offsets at rotation 0): ${pins.join('; ')}`, prm.length ? 'Parameters:\n' + prm.map(x => '- ' + x).join('\n') : 'Parameters: none', help ? 'Help: ' + help : ''].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'get_part', mutates: false,
    description: 'Details of one placed part: position, rotation, parameters, every pin with its hole, net and connection status.',
    input_schema: S.obj({ label: S.str('part label, e.g. "R1"') }, ['label']),
    run(ctx, i) {
      const D = ctx.D(), p = partOf(D, str(i.label)); if (!p) return err(`No part labelled "${str(i.label)}". Labels: ${D.parts.map(x => x.label).join(', ') || 'none'}`);
      const A = analyze(D), m = A.byPart.get(p.id)!.map;
      const lines = placedPins(p).map(q => {
        const net = m[q.id], mates = net && net.on ? (A.netPins.get(net.net) || []).filter(x => x.part !== p).map(x => x.part.label + '.' + (isMcu(x.part) ? x.name : x.id)).slice(0, 6) : [];
        const ls = D.links.filter(l => l.a === p.id + '.' + q.id || l.b === p.id + '.' + q.id).map(l => linkText(D, l));
        return `- ${q.id}${q.name !== q.id ? '/' + en(q.name) : ''} (${q.role}) @${q.r},${q.c}${OPS.onBoard(D, q.r, q.c) ? '' : ' off-board'}: ${mates.length ? 'net with ' + mates.join(', ') : 'no other pins on its net'}${ls.length ? '; links: ' + ls.join('; ') : ''}`;
      });
      return ok(`${p.label}: ${typeName(p.type)} [${p.type}] at ${p.r},${p.c} rot ${rotDeg(p)}${paramsText(p) ? '; ' + paramsText(p) : ''}\n${lines.join('\n')}`);
    },
  },
  {
    name: 'place_part', mutates: true,
    description: 'Place a new part on the board. Give row/col for the part origin (its pin 1 / first pin at rotation 0), or omit them to place it at the nearest free spot – preferably with "near" set to the pin it will connect to, so the layout stays compact (or near_row/near_col). Rotation is in 90° steps clockwise. Off-board parts (motors, servos) are placed beside the board and get a header plugged in automatically. Fails if the part does not fit or would overlap another part.',
    input_schema: S.obj({
      type: S.str('part type key'), row: S.int('origin row'), col: S.int('origin column'),
      near_row: S.int('preferred area when row/col omitted'), near_col: S.int('preferred area when row/col omitted'),
      near: S.str('when row/col omitted: place next to this pin or part (e.g. "PICO1.GP15" or "R1") – use the pin it will connect to'),
      rotation: S.int('0, 90, 180 or 270'), mirror: S.bool('mirror the part'), params: { type: 'object', description: 'parameter values by key (see describe_part_type), e.g. {"ohm": 330}' }, label: S.str('custom label (default: next free, e.g. R2)'),
    }, ['type']),
    run(ctx, i) {
      const D = ctx.D(), type = str(i.type), d = DEFS[type]; if (!d) return err(`Unknown part type "${type}". Use list_part_types.`);
      const rot = Math.round((num(i.rotation) || 0) / 90) & 3, mir = !!i.mirror;
      const pr = applyParams(type, i.params, d.props); if ('error' in pr) return err(pr.error);
      if (i.label && partOf(D, str(i.label))) return err(`Label "${str(i.label)}" is already used.`);
      let r = num(i.row), c = num(i.col);
      const g = OPS.partAt(D, type, r ?? 0, c ?? 0, { rot, mir, props: pr.props });
      if (r == null || c == null) {
        let nr = num(i.near_row) ?? r ?? 0, nc = num(i.near_col) ?? c ?? 0;
        if (i.near) { const ref = str(i.near), pq = pinOf(D, ref), pp = pq ? null : partOf(D, ref); if (!pq && !pp) return err(`Unknown pin or part "${ref}" in "near".`); [nr, nc] = pq ? [pq.q.r, pq.q.c] : [pp!.r, pp!.c]; }
        const s = freeSpot(D, g, { r: nr, c: nc });
        if (!s) return err('No free spot where this part fits. Make room or use a bigger board.');
        r = s.r; c = s.c;
      }
      const t = { ...g, r, c };
      if (!OPS.partFits(D, t)) return err(isOff(t) ? 'An off-board part must have all its leads outside the board, within 8 holes of the edge.' : `Does not fit at ${r},${c}: at least one pin must be on the board and none more than 8 holes outside.`);
      const ov = overlaps(D, t); if (ov.length) return err(`Would overlap ${ov.join(', ')} at ${r},${c}. Choose another position, or omit row/col to auto-place.`);
      const p = OPS.placePart(D, type, r, c, { rot, mir, props: pr.props, label: i.label ? str(i.label) : undefined })!;
      const cl = stripClashes(D, p);
      let extra = cl.length ? '\nWarning: ' + cl.join('; ') + '. Move or rotate it unless this is intended.' : '';
      if (isOff(p)) { const h = OPS.attachPlug(D, p); extra = h ? `; cable plugged into header ${h.label}` : '; no room for a header: connect its leads with wires'; }
      ctx.commit();
      return ok('Placed ' + partBrief(D, p) + extra, true);
    },
  },
  {
    name: 'move_part', mutates: true,
    description: 'Move a part to a new origin (row/col) and/or rotation. Fails if it would not fit or would overlap another part.',
    input_schema: S.obj({ label: S.str('part label'), row: S.int('new origin row'), col: S.int('new origin column'), rotation: S.int('0, 90, 180 or 270'), mirror: S.bool('mirrored') }, ['label']),
    run(ctx, i) {
      const D = ctx.D(), p = partOf(D, str(i.label)); if (!p) return err(`No part labelled "${str(i.label)}".`);
      if (p.fixed) return err(`${p.label} is fixed in place by the user. Do not move it; if moving it seems necessary, explain why and ask the user to unlock it (“Fixed position” in its properties).`);
      const t = { ...p, r: num(i.row) ?? p.r, c: num(i.col) ?? p.c, rot: i.rotation != null ? Math.round((num(i.rotation) || 0) / 90) & 3 : p.rot, mir: i.mirror != null ? !!i.mirror : p.mir };
      if (!OPS.partFits(D, t)) return err(`${p.label} does not fit at ${t.r},${t.c}.`);
      const ov = overlaps(D, t); if (ov.length) return err(`Would overlap ${ov.join(', ')}.`);
      Object.assign(p, { r: t.r, c: t.c, rot: t.rot, mir: t.mir }); ctx.commit();
      const cl = stripClashes(D, p);
      return ok('Moved ' + partBrief(D, p) + (cl.length ? '\nWarning: ' + cl.join('; ') + '.' : ''), true);
    },
  },
  {
    name: 'set_params', mutates: true,
    description: 'Change parameters of a placed part (e.g. resistance, LED colour, transistor kind). Keys and allowed values: describe_part_type.',
    input_schema: S.obj({ label: S.str('part label'), params: { type: 'object', description: 'parameter values by key' } }, ['label', 'params']),
    run(ctx, i) {
      const D = ctx.D(), p = partOf(D, str(i.label)); if (!p) return err(`No part labelled "${str(i.label)}".`);
      const pr = applyParams(p.type, i.params, p.props); if ('error' in pr) return err(pr.error);
      const t = { ...p, props: pr.props }; if (!OPS.partFits(D, t)) return err('With these parameters the part would not fit (pin spacing).');
      p.props = pr.props; ctx.commit();
      return ok(`${p.label}: ${paramsText(p) || 'updated'}`, true);
    },
  },
  {
    name: 'remove_parts', mutates: true,
    description: 'Delete parts (with their connections; an off-board part takes its header with it).',
    input_schema: S.obj({ labels: S.arr(S.str('label'), 'part labels') }, ['labels']),
    run(ctx, i) {
      const D = ctx.D(), ls = Array.isArray(i.labels) ? i.labels.map(str) : [], ps = ls.map(l => partOf(D, l));
      const miss = ls.filter((_, k) => !ps[k]); if (miss.length) return err(`Unknown label(s): ${miss.join(', ')}`);
      OPS.removeParts(D, ps.map(p => p!.id)); ctx.commit();
      return ok(`Removed ${ls.join(', ')}.`, true);
    },
  },
  {
    name: 'connect', mutates: true,
    description: 'Add a connection from a pin to another pin, to ground ("GND"), or to a free GPIO of the microcontroller ("GPIO"; the router picks a suitable pin). Pins: "LABEL.PIN" by pin id or name, e.g. "R1.2", "LED1.A", "PICO1.GP15", "PICO1.3V3". With auto-routing on, bridges/wires/strip cuts are created automatically.',
    input_schema: S.obj({ from: S.str('pin, e.g. "R1.2"'), to: S.str('pin, "GND" or "GPIO"') }, ['from', 'to']),
    run(ctx, i) {
      const D = ctx.D(), a = pinOf(D, str(i.from)); if (!a) return err(`Unknown pin "${str(i.from)}". Use get_part to see pin names.`);
      const to = str(i.to).trim(), up = to.toUpperCase();
      let b: string;
      if (up === 'GND' || up === 'GPIO') b = up;
      else { const x = pinOf(D, to); if (!x) return err(`Unknown pin "${to}".`); if (x.ref === a.ref) return err('A pin cannot connect to itself.'); b = x.ref; }
      const l = OPS.addLink(D, a.ref, b); if (!l) return err('This connection already exists.');
      ctx.commit();
      const st = linkStates(D, analyze(D)).get(l.id);
      return ok(`Connected ${linkText(D, l)}${st ? (st.ok ? ` (routed${st.gpio ? ', ' + st.gpio : ''})` : D.settings.autoRoute ? ' (could not be routed yet — see problems)' : ' (auto-routing is off: run route)') : ''}.`, true);
    },
  },
  {
    name: 'disconnect', mutates: true,
    description: 'Remove connection(s) between two pins (or from a pin to GND/GPIO). With only "from", removes every connection of that pin.',
    input_schema: S.obj({ from: S.str('pin'), to: S.str('pin, "GND" or "GPIO" (optional)') }, ['from']),
    run(ctx, i) {
      const D = ctx.D(), a = pinOf(D, str(i.from)); if (!a) return err(`Unknown pin "${str(i.from)}".`);
      const to = i.to ? str(i.to).trim() : '', up = to.toUpperCase(), b = !to ? null : up === 'GND' || up === 'GPIO' ? up : (pinOf(D, to) || { ref: '?' }).ref;
      const hit = (l: Link) => (l.a === a.ref && (!b || l.b === b)) || (l.b === a.ref && (!b || l.a === b));
      const gone = D.links.filter(hit); if (!gone.length) return err('No such connection.');
      D.links = D.links.filter(l => !hit(l)); ctx.commit();
      return ok(`Removed ${gone.length} connection(s).`, true);
    },
  },
  {
    name: 'route', mutates: true,
    description: 'Recompute the automatic wiring (solder bridges, wires, strip cuts) for all connections. Normally automatic; use after turning auto-routing on or if connections show as not routed.',
    input_schema: S.obj({}),
    run(ctx) {
      const D = ctx.D(); route(D, { full: true }); ctx.commit();
      const st = [...linkStates(D, analyze(D)).values()], bad = st.filter(s => !s.ok).length;
      return ok(`Routed: ${st.length - bad}/${st.length} connections, ${D.auto.bridges.length} bridges, ${D.auto.wires.length} wires, ${(D.auto.cuts || []).length} strip cuts.${bad ? ` ${bad} not routed — check get_problems.` : ''}`, true);
    },
  },
  {
    name: 'get_problems', mutates: false,
    description: 'Design-rule check: shorts, unconnected or floating pins, wrong GPIO use, over-current, missing resistors, etc. Run after changes.',
    input_schema: S.obj({ include_info: S.bool('also list hints (severity info)') }),
    run(ctx, i) {
      const xs = analyzeDesign(ctx.D(), ctx.tr).issues.filter(x => i.include_info || x.sev !== 'info');
      return ok(xs.length ? xs.map(x => `- [${x.sev}] ${x.msg}${x.holes.length ? ' @' + x.holes.slice(0, 3).map(h => h.join(',')).join(' ') : ''}`).join('\n') : 'No problems.');
    },
  },
  {
    name: 'simulate', mutates: false,
    description: 'Run the circuit simulation (DC operating point). Optionally press buttons and run the block program for some milliseconds. Returns microcontroller power, GPIO levels, LED currents, motor/servo/stepper state and transistor states.',
    input_schema: S.obj({ pressed: S.arr(S.str('button label'), 'buttons held down'), time_ms: S.int('program run time in ms (default 0)') }),
    run(ctx, i) {
      const D = ctx.D(), labels = Array.isArray(i.pressed) ? i.pressed.map(str) : [], pressed = new Set<string>();
      for (const l of labels) { const p = partOf(D, l); if (!p || !hasPress(p)) return err(`"${l}" is not a button.`); pressed.add(p.id); }
      const { SIM, prog, t } = simulateFor(D, { pressed, ms: num(i.time_ms) || 0 }), L: string[] = [];
      for (const m of SIM.picos) L.push(`${m.p.label}: ${m.powered ? `powered (${m.vsysName} ${fmtV(m.Usys)} V)` : 'NOT powered'}`);
      const g = SIM.gpios.filter(x => x.mode !== 'float' || !x.float);
      if (g.length) L.push('GPIO: ' + g.map(x => `${x.q.name}=${x.mode}:${gpioLevel(x)}(${fmtV(x.V)}V)`).join(', '));
      for (const l of SIM.leds) L.push(`${l.p.label}: ${(l.I * 1000).toFixed(2)} mA${l.light ? (l.on && l.I > 1e-4 ? ', lit' : ', dark') : (l.on ? ', conducting' : ', off')}${l.imax && l.I > l.imax ? ' — OVER-CURRENT' : ''}`);
      for (const f of SIM.fets) L.push(`${f.p.label}: ${f.on ? 'on' : 'off'}, Vgs ${fmtV(f.vgs)} V${f.floatGate ? ', FLOATING GATE' : ''}`);
      for (const b of SIM.bjts) L.push(`${b.p.label}: ${b.st}, Ic ${(b.ic * 1000).toFixed(2)} mA`);
      for (const m of SIM.motors) L.push(`${m.p.label}: ${fmtV(m.U)} V, ${(m.I * 1000).toFixed(0)} mA, speed ${Math.round(m.speed * 100)}%`);
      for (const s of SIM.servos) L.push(`${s.p.label}: ${s.angle != null ? Math.round(s.angle) + '°' : 'no signal'}`);
      for (const s of SIM.steppers) L.push(`${s.p.label}: step ${s.pos}, coils ${s.coils || '–'}`);
      if (prog) L.push(`Program after ${t} ms: ` + (prog.errors.size ? 'errors: ' + [...prog.errors.values()].join('; ') : 'ok'));
      return ok(L.join('\n') || 'Nothing to simulate (no powered parts).');
    },
  },
  {
    name: 'set_gpio_mode', mutates: true,
    description: `Set the mode of a microcontroller GPIO by pin name (e.g. "GP15"): ${GPIO_MODES.map(m => m[0]).join(', ')}. For "pwm" also give duty (%) and frequency (Hz).`,
    input_schema: S.obj({ pin: S.str('GPIO name, e.g. "GP15" or "IO4"'), mode: { type: 'string', enum: GPIO_MODES.map(m => m[0]), description: 'mode' }, duty: S.num('PWM duty cycle %'), freq: S.num('PWM frequency Hz') }, ['pin', 'mode']),
    run(ctx, i) {
      const D = ctx.D(), pin = str(i.pin), mode = str(i.mode);
      if (!OPS.gpioPin(D, pin)) return err(`No GPIO named "${pin}" on the board's microcontroller.`);
      const okk = mode === 'pwm' ? OPS.setPwm(D, pin, num(i.duty), num(i.freq)) : OPS.setGpioMode(D, pin, mode);
      if (!okk) return err(`${pin} does not support mode "${mode}".`);
      ctx.commit();
      const q = OPS.gpioPin(D, pin)!, cfg = (D.pwm || {})[q.part.id + '.' + q.id];
      return ok(`${pin} → ${mode}${mode === 'pwm' && cfg ? ` (duty ${cfg.duty}%, ${cfg.freq} Hz)` : ''}`, true);
    },
  },
  {
    name: 'add_note', mutates: true,
    description: 'Add a text note on the canvas (documentation only, not electrical). Lines starting with "# " are headings. Optionally point at a part.',
    input_schema: S.obj({ text: S.str('note text'), row: S.int('top row'), col: S.int('left column'), width: S.int('width in holes (default 12)'), height: S.int('height in holes (default 6)'), target: S.str('part label to point at') }, ['text', 'row', 'col']),
    run(ctx, i) {
      const D = ctx.D(), tg = i.target ? partOf(D, str(i.target)) : null; if (i.target && !tg) return err(`No part labelled "${str(i.target)}".`);
      OPS.addNote(D, num(i.row) || 0, num(i.col) || 0, str(i.text), '#fff3bf', { w: num(i.width) || 12, h: num(i.height) || 6, target: tg ? tg.id : null });
      ctx.commit(); return ok('Note added.', true);
    },
  },
  {
    name: 'generate_code', mutates: false,
    description: 'Generate firmware source code from the block program for the board\'s microcontroller: MicroPython or Arduino (C++). Requires a program.',
    input_schema: S.obj({ lang: { type: 'string', enum: ['micropython', 'arduino'], description: 'language' } }),
    run(ctx, i) {
      const D = ctx.D(); if (!D.program || !D.program.nodes.length) return err('The design has no block program yet.');
      const c = generateCode(D, analyze(D), D.program, (str(i.lang) || 'micropython') as CodeLang, ctx.tr || fmt);
      return ok(`File ${c.file}${c.warnings.length ? '\nWarnings: ' + c.warnings.join('; ') : ''}\n\n${c.code}`);
    },
  },
  {
    name: 'get_board_image', mutates: false,
    description: 'Get a picture of the board as the user sees it (parts, bridges, wires, strip cuts, problem markers). Use to check placement and wiring visually.',
    input_schema: S.obj({}),
    async run(ctx) {
      if (!ctx.snapshot) return err('Board images are not available here; use get_design.');
      const img = await ctx.snapshot(); return img ? { text: 'Board image attached.', image: img } : err('Could not render the board.');
    },
  },
  {
    name: 'set_project_notes', mutates: false,
    description: 'Replace the project notes: a short, durable description of what is being built and the key decisions (supply voltage, controller, chosen parts and values, pin assignments, open questions). It is saved with the design and given to you at the start of every conversation. Keep it under ~20 lines, plain text or simple markdown; rewrite it fully each time (it is not appended). Update it when the user agrees on something important. Allowed in both modes.',
    input_schema: S.obj({ text: S.str('the complete new notes') }, ['text']),
    run(ctx, i) {
      const D = ctx.D(), t = str(i.text).trim().slice(0, BRIEF_MAX);
      if (t) D.brief = t; else delete D.brief;
      ctx.commit(); return ok(t ? `Project notes saved (${t.split('\n').length} lines).` : 'Project notes cleared.', true);
    },
  },
  {
    name: 'get_part_definition', mutates: false,
    description: 'The full JSON definition (PartDef) of a part type – built-in or custom – to study or to use as the starting point of a new custom part (save_custom_part). Fields: name, cat, fp, prefix, pins [{id, name, role, lr, lc, caps}], params, model (electrical elements: resistor, diode, source, …), controls (press, slider), draw/body, meta.help.',
    input_schema: S.obj({ type: S.str('part type key') }, ['type']),
    run(ctx, i) {
      const k = str(i.type), d = customDefs(ctx)[k] || PARTS[k]; if (!d) return err(`Unknown part type "${k}". Use list_part_types.`);
      return ok(`${k} (${k in PARTS ? 'built-in – save changes as a new custom part' : 'custom part'}):\n${JSON.stringify(d, null, 1)}`);
    },
  },
  {
    name: 'save_custom_part', mutates: true,
    description: 'Create or update a custom part type (the user\'s own parts). Prefer giving "form" (the part editor model, see get_part_schema and get_part_form): the result is then editable in the app\'s part editor (Pins and Function tabs). A raw "definition" (PartDef) is also accepted for things the form cannot express (custom graphics, pin expressions) – then the user can edit it only as JSON. Give "type" to update an existing custom part; omit it to create a new one. Built-in types cannot be overwritten – save a copy under a new name. The result is validated; errors are returned and nothing is saved. Placed parts of an updated type change with it.',
    input_schema: S.obj({ form: { type: 'object', description: 'the part editor model (get_part_form / get_part_schema)' }, definition: { type: 'object', description: 'a complete PartDef (alternative to form)' }, type: S.str('existing custom part key to update (omit for a new part)') }),
    run(ctx, i) {
      const k0 = i.type == null ? null : str(i.type);
      if (k0 && k0 in PARTS) return err(`"${k0}" is a built-in part and cannot be changed. Save the edited copy as a new part (omit "type", give it a new name).`);
      const cur = customDefs(ctx);
      if (k0 && !cur[k0]) return err(`No custom part "${k0}". Omit "type" to create a new one.`);
      let def: PartDef, lost: string[] = [];
      if (i.form && typeof i.form === 'object') {
        const f = i.form as Form;
        if (!Array.isArray(f.pins) || !f.pins.length) return err('form.pins must be a non-empty array of {id, name, lr, lc, role, group}.');
        const base: Partial<Form> = { name: '', prefix: 'U', cat: 'Saját', bodyText: '', pad: 0.6, ext: { t: 0, b: 0, l: 0, r: 0 }, fill: '#1b4f8a', showLabel: true, names: 'below', model: [], press: null };
        try { def = formToDef({ ...base, ...f,
          pins: f.pins.map(p => ({ ...p, group: p.group ?? '', role: p.role ?? 'sig', name: p.name ?? String(p.id) })), model: (f.model || []).map(m => ({ ...m, pins: m.pins || [], vals: (m.vals || []).map(String) })) } as Form); }
        catch (e) { return err('Invalid form: ' + String(e)); }
      } else if (i.definition && typeof i.definition === 'object') {
        def = JSON.parse(JSON.stringify(i.definition)) as PartDef;
        const conv = defToForm(def, undefined, en);
        if (conv.form && !conv.lost.length) def.meta = { ...(def.meta || {}), editor: 1, form: conv.form }; else lost = conv.lost.length ? conv.lost : ['pins'];
      } else return err('Give "form" (preferred) or "definition".');
      const probs = validatePartDef(def, en);
      if (hasErrors(probs)) return err('The part has errors; nothing was saved:\n' + probs.map(p => `- ${p.level}: ${p.path ? p.path + ': ' : ''}${p.msg}`).join('\n'));
      const k = k0 || typeKeyFor(def.name, x => x in DEFS || x in cur);
      if (ctx.saveCustomPart) ctx.saveCustomPart(k, def);
      else { const D = ctx.D(); D.customParts = { ...D.customParts, [k]: def }; }
      syncDefs(ctx.D().customParts); ctx.commit();
      const warns = probs.filter(p => p.level === 'warn');
      return ok(`${k0 ? 'Updated' : 'Saved new'} custom part "${k}" (${def.name}). Place it with place_part type "${k}". ${lost.length ? `Editable only as JSON in the part editor (the form cannot show: ${lost.join(', ')}).` : 'Editable in the part editor (Pins and Function tabs).'}${warns.length ? '\nWarnings: ' + warns.map(p => (p.path ? p.path + ': ' : '') + p.msg).join('; ') : ''}`, true);
    },
  },
  {
    name: 'get_part_form', mutates: false,
    description: 'A part type as the part editor model ("form") – the easiest way to make an editable custom part: take a similar part\'s form, change it, and save it with save_custom_part {form}. Also says what the form cannot express for this type (that would be lost, e.g. custom graphics of built-in parts: the copy gets a plain body).',
    input_schema: S.obj({ type: S.str('part type key') }, ['type']),
    run(ctx, i) {
      const k = str(i.type), d = customDefs(ctx)[k] || PARTS[k]; if (!d) return err(`Unknown part type "${k}". Use list_part_types.`);
      const c = defToForm(d, undefined, en); if (!c.form) return err(`"${k}" cannot be shown as a form (${c.lost.join(', ')}). Use get_part_definition.`);
      const f = JSON.parse(JSON.stringify(c.form)) as Form; delete f.graph; if (f.logic) delete f.logic.graph;
      return ok(`${k} as form${c.lost.length ? ` (not representable, would be lost: ${c.lost.join(', ')})` : ''}:\n${JSON.stringify(f)}`);
    },
  },
  {
    name: 'get_part_schema', mutates: false,
    description: 'Reference for making custom parts with the part editor model ("form"): fields, pin roles, electrical elements, digital logic, button, parameters with sliders and value expressions, with a complete potentiometer example.',
    input_schema: S.obj({}),
    run() { return ok(PART_SCHEMA_TEXT()); },
  },
  {
    name: 'plan_compaction', mutates: false,
    description: 'Preview compacting the layout (does not change the design): parts move closer to what they connect to, onto a smaller area, and the wiring is re-routed and checked. Returns before/after area, bridges, wires and connected links, which parts would move and which stay (fixed, controller, controls, hand-wired). strength 0 = loose (2-hole gaps, small moves, easy soldering) … 1 = tight (smallest board). Use it to suggest compaction, then compact_layout to apply.',
    input_schema: S.obj({ strength: S.num('0 (loose) … 1 (tight), default 0.5'), only: S.arr(S.str('label'), 'only these parts may move (default: all movable)'), keep_mcu: S.bool('keep the controller board in place (default true)'), keep_controls: S.bool('keep buttons, sliders and connectors in place (default true)') }),
    run(ctx, i) { const r = compactPlan(ctx.D(), i); return 'error' in r ? err(r.error) : ok(compactText(r, false)); },
  },
  {
    name: 'compact_layout', mutates: true,
    description: 'Compact the layout (same options as plan_compaction) and apply it: parts move closer together and the wiring is re-routed. Never makes the wiring worse; fixed parts stay. Ask before compacting a layout the user arranged by hand.',
    input_schema: S.obj({ strength: S.num('0 (loose) … 1 (tight), default 0.5'), only: S.arr(S.str('label'), 'only these parts may move (default: all movable)'), keep_mcu: S.bool('keep the controller board in place (default true)'), keep_controls: S.bool('keep buttons, sliders and connectors in place (default true)') }),
    run(ctx, i) {
      const D = ctx.D(), r = compactPlan(D, i); if ('error' in r) return err(r.error);
      if (!r.moves.length) return ok(compactText(r, true));
      applyCompaction(D, r); if (D.settings.autoRoute && D.links.length) route(D, { full: true }); ctx.commit();
      return ok(compactText(r, true), true);
    },
  },
  {
    name: 'set_fixed', mutates: true,
    description: 'Fix parts in place (or release them). Fixed parts are not moved by compaction or by move_part; the user can still move them by hand. Fix parts whose position matters (buttons on a front panel, connectors at the edge) when the user says so.',
    input_schema: S.obj({ labels: S.arr(S.str('label'), 'part labels'), fixed: S.bool('true = fix in place, false = release') }, ['labels', 'fixed']),
    run(ctx, i) {
      const D = ctx.D(), ls = Array.isArray(i.labels) ? i.labels.map(str) : [], ps = ls.map(l => partOf(D, l));
      const miss = ls.filter((_, k) => !ps[k]); if (miss.length) return err(`Unknown label(s): ${miss.join(', ')}`);
      for (const p of ps) { if (i.fixed) p!.fixed = true; else delete p!.fixed; }
      ctx.commit(); return ok(`${i.fixed ? 'Fixed in place' : 'Released'}: ${ls.join(', ')}.`, true);
    },
  },
  {
    name: 'list_examples', mutates: false,
    description: 'List the built-in example designs (id, title, description).',
    input_schema: S.obj({}),
    run(ctx) { const xs = ctx.examples ? ctx.examples() : []; return ok(xs.length ? xs.map(x => `${x.id}: ${x.title} — ${x.desc}`).join('\n') : 'No examples available.'); },
  },
  {
    name: 'load_example', mutates: true,
    description: 'Replace the current design with a built-in example. This discards the current design (the user can undo). Ask the user first unless they asked for it.',
    input_schema: S.obj({ id: S.str('example id') }, ['id']),
    run(ctx, i) { if (!ctx.loadExample) return err('Examples are not available here.'); return ctx.loadExample(str(i.id)) ? ok(`Loaded example "${str(i.id)}".\n\n` + summarize(ctx.D(), ctx.tr), true) : err(`Unknown example "${str(i.id)}".`); },
  },
  {
    name: 'new_design', mutates: true,
    description: 'Start an empty design on a new board. Discards the current design (the user can undo). Ask the user first unless they asked for it.',
    input_schema: S.obj({ rows: S.int('rows (default 78)'), cols: S.int('columns (default 39)'), section: S.int('strip section length in rows: 1 = dot grid, 3 = tripad, rows = full strips (default 3)') }),
    run(ctx, i) {
      const rows = Math.max(5, Math.min(200, num(i.rows) || 78)), cols = Math.max(5, Math.min(120, num(i.cols) || 39)), sec = Math.max(1, Math.min(rows, num(i.section) || 3));
      const d = emptyDesign(); d.board = { rows, cols, sec }; ctx.setD(normalize(d)); ctx.commit();
      return ok(`New empty design: ${rows}×${cols}, section ${sec}.`, true);
    },
  },
  {
    name: 'get_manufacturing', mutates: false,
    description: 'Manufacturing package of the current design: bill of materials (quantities, labels, values, off-board parts), board and consumables (wire lengths by colour, solder bridges, track cuts), and the assembly order (low parts first; cuts X1…, bridge chains H1…, wires V1… as numbered on the printable sheets). Use it when the user asks what to buy, how to build/solder the board, or for a parts list. The user can print 1:1 component- and copper-side sheets in the Manufacturing layout (Alt+4).',
    input_schema: S.obj({ part: { type: 'string', enum: ['bom', 'assembly', 'both'], description: 'which part to return (default both)' } }),
    async run(ctx, i) {
      const D = ctx.D(), what = String(i.part || 'both'), out: string[] = [];
      if (what !== 'assembly') {
        const b = bom(D, en), x = b.extra;
        out.push(`Board: ${x.board.kind}, ${x.board.cols}×${x.board.rows} holes (${x.board.w}×${x.board.h} mm)`);
        out.push('Bill of materials (qty | labels | part | value | note):');
        for (const r of b.rows) out.push(`- ${r.qty} | ${r.labels.join(', ')} | ${r.name} | ${r.value || '-'}${r.note ? ' | ' + r.note : ''}`);
        for (const w of x.wires) out.push(`- wire ${w.color || 'default'}: ${w.count} pcs, ${w.mm} mm total`);
        out.push(`Track cuts: ${x.cuts}; solder bridges: ${x.bridges} in ${x.chains} chain(s)`);
      }
      if (what !== 'bom') {
        out.push('Assembly order:');
        assembly(D, en).forEach((s, k) => {
          out.push(`${k + 1}. ${s.title}${s.side ? ` [${s.side === 'cu' ? 'copper side' : 'component side'}]` : ''} – ${s.tip}`);
          for (const it of s.items) out.push(`   - ${it.mark ? it.mark + ' ' : ''}${it.text}`);
        });
      }
      return ok(out.join('\n'));
    },
  },
  {
    name: 'get_dimensions', mutates: false,
    description: 'Dimension data of the board for enclosure / front panel design: board outline and the centre position and body size of every on-board part (mm; origin = bottom-left corner of the board, x right, y up, top view), plus feature points such as the controller board USB connector, mounting holes (part type "mhole", M2/M2.5/M3; place them with place_part) and the estimated height of each part above the board. "front" marks items that usually matter from outside (controls, connectors, LEDs, displays, USB, mounting holes). format "dxf" returns an AutoCAD R12 DXF of the drawing (top, front and side view) instead; the user can also download SVG/DXF in the Manufacturing layout, Drawing tab.',
    input_schema: S.obj({ format: { type: 'string', enum: ['table', 'dxf'], description: 'table (default) or dxf' } }),
    async run(ctx, i) {
      const D = ctx.D();
      if (i.format === 'dxf') return ok(dimDxf(D, { tr: en }));
      const b = boardMm(D), mm = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
      const rows = dimItems(D).map(it => `- ${it.label} | ${it.feature ? it.feature + ' (feature point)' : en(DEFS[D.parts.find(p => p.id === it.id)!.type].name)} | x ${mm(it.x)} | y ${mm(it.y)}${it.feature ? '' : it.drill ? ` | hole ⌀${mm(it.drill)}, keep ⌀${mm(it.head || 0)} clear` : ` | ${mm(it.w)}×${mm(it.h)} | z ${mm(it.z)}`}${it.def ? ' | front' : ''}`);
      const mx = maxHeight(D);
      return ok([`Board outline: ${mm(b.w)} × ${mm(b.h)} mm (${D.board.cols}×${D.board.rows} holes, 2.54 mm pitch; hole centres 1.27 mm from the edge; board ${BOARD_T} mm thick, legs ~${LEGS} mm below).`,
        mx.z ? `Tallest: ${mx.label}, ${mm(mx.z)} mm above the board (heights are estimates from the part data).` : 'No part heights.',
        'label | part | x | y | w×h (mm) | z height (mm) | front', ...rows].join('\n'));
    },
  },
  {
    name: 'get_share_link', mutates: false,
    description: 'Create a share link for the current design. The whole design (parts, connections, custom parts, program, notes) is compressed into the link after "#", nothing is uploaded; whoever opens it gets a copy in their own browser. Give it to the user when they want to share, send or bookmark the design.',
    input_schema: S.obj({}),
    async run(ctx) {
      const u = await shareUrl(ctx.shareBase ? ctx.shareBase() : PUBLIC_URL, ctx.D());
      return ok(`${u}\n(${u.length} characters${u.length > 8000 ? '; long: some chat apps and mail clients may cut it, a file is safer' : ''})`);
    },
  },
  {
    name: 'open_share_link', mutates: true,
    description: 'Open a design from a Proofboard share link (a URL with "#d=…", or just the part after "#"). Replaces the current design (the user can undo). Ask the user first unless they asked for it.',
    input_schema: S.obj({ url: S.str('the share link') }, ['url']),
    async run(ctx, i) {
      const code = shareCode(str(i.url)); if (code == null) return err('Not a Proofboard share link (no "#d=…" part).');
      let raw: unknown; try { raw = await decodeShare(code); } catch (e) { return err(`The link cannot be opened (incomplete or damaged): ${(e as Error).message}`); }
      ctx.setD(normalize(raw)); ctx.commit();
      const d = ctx.D();
      return ok(`Opened the shared design: ${d.parts.length} parts, ${d.links.length} connections, ${Object.keys(d.customParts || {}).length} custom parts, ${d.program ? d.program.nodes.length : 0} blocks.`, true);
    },
  },
  {
    name: 'import_code', mutates: true,
    description: 'Turn an Arduino (C++) or MicroPython sketch into the block program (the user can see and edit blocks; prefer building blocks directly with add_block when you design from scratch). The code is run symbolically: GPIO numbers map to the board\'s pins; digitalRead/digitalWrite, analogRead/analogWrite, PWM, delay-based timing (→ Clock / Sequence), conditions (→ logic blocks, Compare), and state variables (x = !x with edge detection → Toggle, counter → Counter, millis() timers → Clock or Timer) are recognised. Returns what was created and line-numbered notes about parts that could not be translated. mode: "replace" (default) or "append" to the existing program; dry_run: only report.',
    input_schema: S.obj({ code: S.str('the sketch source'), language: { type: 'string', enum: ['arduino', 'micropython'], description: 'default: detected' }, mode: { type: 'string', enum: ['replace', 'append'], description: 'default: replace' }, dry_run: S.bool('only report, do not change the design') }, ['code']),
    run(ctx, i) {
      const lang = i.language === 'arduino' || i.language === 'micropython' ? i.language : undefined;
      const r = importCode(ctx.D(), str(i.code), { lang, tr: en });
      const rep = [`Language: ${r.lang}.`, ...r.summary, ...(r.notes.length ? ['Notes:', ...r.notes.map(n => '- ' + n.msg)] : ['Everything was translated.'])];
      if (i.dry_run || !r.program.nodes.length) return ok((i.dry_run ? 'Dry run, nothing changed. ' : 'No blocks were created. ') + rep.join('\n'));
      const ids = applyImport(ctx.D(), r, i.mode === 'append' ? 'append' : 'replace');
      ctx.commit(); if (ctx.showProgram) ctx.showProgram(true);
      return ok(`Program ${i.mode === 'append' ? 'extended' : 'replaced'}: blocks ${ids.join(', ')}.\n` + rep.join('\n'), true);
    },
  },
  ...makeProgTools({ ok, err, en, num, str, partOf, pinOf, pinLabelOf, S }),
];

/** Eszköz futtatása név szerint, hibakezeléssel (a modell hibaüzenetet kap, nem kivételt). */
export async function runTool(ctx: ToolCtx, name: string, input: unknown): Promise<ToolResult> {
  const t = TOOLS.find(x => x.name === name); if (!t) return err(`Unknown tool "${name}".`);
  const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const k of t.input_schema.required || []) if (inp[k] == null) return err(`Missing required input "${k}".`);
  try { return await t.run(ctx, inp); } catch (e) { return err(`Tool failed: ${(e as Error).message}`); }
}

/** Az eszközök leírása a modellnek (Anthropic `tools` formátum); Megbeszélés módban csak a nem módosítók. */
export function toolSpecs(mode: 'discuss' | 'build' = 'build'): Array<{ name: string; description: string; input_schema: JsonSchema }> {
  return TOOLS.filter(t => mode === 'build' || !t.mutates).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

/** Motoroldali környezet (felület nélkül, pl. tesztben vagy MCP-szerverben): commit = útvonal, ha automatikus. */
export function engineCtx(d: Design, extra: Partial<ToolCtx> = {}): ToolCtx & { design: Design } {
  const box = { design: d };
  return {
    get design() { return box.design; },
    D: () => box.design, setD: x => { box.design = x; },
    commit() { const D = box.design; if (D.settings.autoRoute && D.links.length) route(D); },
    ...extra,
  };
}
