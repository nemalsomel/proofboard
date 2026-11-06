/**
 * Alkatrészlista (bal sáv, Alkatrészek fül): kedvencek, legutóbb használtak, projekt, saját könyvtár és a beépített
 * kategóriák csoportjai; a felhasználói beállítások (kedvencek, legutóbbiak, becsukott csoportok) a böngészőben.
 * Tiszta: a lista HTML-je a bemenetekből, a beállítások tárolása a `Storage`-on át.
 */
import type { PartDef } from '../core/schema';
import { matchPart } from '../core/library';
import { N_, t as tr } from '../i18n/i18n';

export interface LibPref { fav?: string[]; recent?: string[]; closed?: string[] }
const KEY = 'proofboard.lib.ui';
const RECENT_MAX = 6;
export function libPref(st: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): LibPref {
  try { const v = st && JSON.parse(st.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function libPrefSet(o: LibPref, st: Pick<Storage, 'getItem' | 'setItem'> | null = globalThis.localStorage ?? null): void {
  try { st?.setItem(KEY, JSON.stringify({ ...libPref(st), ...o })); } catch { /* tárhely nélkül */ }
}
/** Kedvenc be / ki. */
export const favToggled = (p: LibPref, t: string): string[] => { const f = new Set(p.fav || []); if (f.has(t)) f.delete(t); else f.add(t); return [...f]; };
/** A legutóbb lerakott elöl, legfeljebb hat. */
export const recentWith = (p: LibPref, t: string): string[] => [t, ...(p.recent || []).filter(x => x !== t)].slice(0, RECENT_MAX);

export interface LibEntry { def: PartDef; name: string; fp: string; cat: string }
export interface LibInput {
  /** az összes elérhető alkatrész típuskulcs szerint */ defs: Record<string, LibEntry>;
  /** beépített típusok */ builtin: ReadonlySet<string>;
  /** a saját könyvtár típusai */ library: ReadonlySet<string>;
  /** a terv saját alkatrészei */ project: readonly string[];
  pref: LibPref; query: string; placing: string | null; sim: boolean;
  /** rejtett kategóriák (egyszerű mód) */ hideCats?: ReadonlySet<string>;
}
/** a keresés magyarul és angolul is talál, bármelyik a felület nyelve */
const EN = (s: string) => tr(s, undefined, 'en');
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

/** Az alkatrészlista HTML-je (üresen „Nincs találat.”). */
export function libraryHtml(I: LibInput): string {
  const q = I.query.trim(), fav = new Set(I.pref.fav || []), closed = new Set(I.pref.closed || []), dis = I.sim ? 'disabled' : '';
  const ok = (t: string) => !!I.defs[t] && matchPart(I.defs[t].def, q, EN);
  const item = (t: string) => {
    const d = I.defs[t], own = !I.builtin.has(t), projOnly = own && !I.library.has(t), f = fav.has(t);
    return `<div class="libitem" role="group">`
      + `<button class="btn libfav ${f ? 'on' : ''}" data-fav="${t}" title="${f ? tr('Kedvenc (kattintásra kiveszi)') : tr('Kedvencekhez')}" aria-label="${esc(tr('{x} kedvenc', { x: tr(d.name) }))}" aria-pressed="${f}">${f ? '★' : '☆'}</button>`
      + `<button class="btn ${I.placing === t ? 'on' : ''}" data-lib="${t}" ${dis}>${esc(tr(d.name))}<span>${esc(tr(d.fp))}</span></button>`
      + (projOnly ? `<button class="btn" data-tolib="${t}" title="${tr('Hozzáadás a saját könyvtárhoz (más tervekben is elérhető lesz)')}" aria-label="${esc(tr('{x} a könyvtárba', { x: tr(d.name) }))}" ${dis}>＋</button>` : '')
      + (own ? `<button class="btn" data-adv data-edit="${t}" title="${tr('Szerkesztés')}" aria-label="${esc(tr('{x} szerkesztése', { x: tr(d.name) }))}" ${dis}>✎</button>` : '') + `</div>`;
  };
  const group = (id: string, title: string, list: string[], hint = '') => {
    const ts = list.filter(ok); if (!ts.length) return '';
    const open = q || !closed.has(id);
    return `<details class="libgrp" data-grp="${esc(id)}" ${open ? 'open' : ''}><summary><span>${esc(tr(title))}</span><span class="muted small">${ts.length}</span></summary>${hint ? `<p class="help" style="margin:2px 0 4px">${esc(tr(hint))}</p>` : ''}${ts.map(item).join('')}</details>`;
  };
  const all = Object.keys(I.defs), cats = [...new Set(all.filter(t => I.builtin.has(t)).map(t => I.defs[t].cat))];
  let h = '';
  if (!q) { h += group('fav', N_('Kedvencek'), [...fav].filter(t => I.defs[t])); h += group('recent', N_('Legutóbb használt'), (I.pref.recent || []).filter(t => I.defs[t])); }
  h += group('proj', N_('Projekt'), I.project.filter(t => !I.library.has(t)), N_('A megnyitott terv saját alkatrészei, amelyek nincsenek a könyvtáradban. ＋: hozzáadás a saját könyvtárhoz.'));
  h += group('lib', N_('Saját könyvtár'), [...I.library]);
  for (const c of cats) if (!I.hideCats?.has(c)) h += group('cat:' + c, c, all.filter(t => I.builtin.has(t) && I.defs[t].cat === c));
  return h || `<p class="help">${tr('Nincs találat.')}</p>`;
}
