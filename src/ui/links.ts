/**
 * Kapcsolatok panel: a kapcsolatok listája (állapot, cél választása, törlés, kiemelés), összesítő (hidak, vezetékek,
 * vágások), a kiemelt kapcsolat állapotsori szövege, és a célválasztó lista (a tulajdonságpanel lábainál is).
 * A HTML-t építő függvények tiszták (unit tesztelt), a `createLinksPanel` a gazda (`app.ts`) műveleteivel köt be.
 * Kiemelve az app.ts-ből, a viselkedés változatlan.
 */
import { N_, type Tr } from '../i18n/i18n';
import { findPin, groupLabel, linkGeom, linkTargets, linkText, setLinkTarget, type LinkGeom, type LinkState } from '../engine/links';
import { pinLabel, type Netlist } from '../engine/netlist';
import type { Design, Link } from '../engine/types';

export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

/**
 * Célválasztó lista (`<select>`): GND, szabad GPIO, majd a lábak alkatrészenként csoportosítva; a jelenlegi cél akkor
 * is szerepel, ha már nem választható. `attr` az azonosító attribútum neve (pl. `data-linkto`), `except` a saját alkatrész.
 */
export function targetSelectHtml(D: Design, A: Netlist, attr: string, id: string, cur: string, except: string | undefined, tr: Tr): string {
  const ts = linkTargets(D, A, except, tr), groups = new Map<string, typeof ts>();
  if (cur && !ts.some(t => t.value === cur)) { const q = findPin(D, cur); ts.push({ value: cur, label: q ? groupLabel(q) : cur, group: N_('Jelenlegi') }); }
  for (const t of ts) { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group)!.push(t); }
  return `<select ${attr}="${esc(id)}"><option value="">– ${tr('nincs kapcsolat')} –</option>${[...groups].map(([g, xs]) => `<optgroup label="${esc(tr(g))}">${xs.map(t => `<option value="${esc(t.value)}" ${t.value === cur ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}

export interface LinksView {
  /** „3/4 bekötve” címke */ sum: string;
  /** a lista elemei */ list: string;
  /** összesítő sor: hidak, vezetékek, vágások (auto + kézi) */ total: string;
}

/** A Kapcsolatok panel tartalma a terv és a kapcsolatok állapota alapján. */
export function linksViewHtml(D: Design, A: Netlist, state: Map<string, LinkState>, selLink: string | null, tr: Tr): LinksView {
  const n = D.links.length, ok = [...state.values()].filter(s => s.ok).length;
  const sum = n ? `<span class="chip ${ok === n ? 'c-ok' : 'c-warn'}">${tr('{ok}/{n} bekötve', { ok, n })}</span>` : '';
  const list = n ? D.links.map(l => {
    const s: Partial<LinkState> = state.get(l.id) || {};
    const st = !s.ok ? `<span class="c-err">${tr('nincs')}</span>` : s.cable ? `<span class="c-ok">${tr('kábel')}</span>` : s.wire ? `<span class="c-warn">${tr('vezeték')}</span>` : s.nb ? `<span class="c-ok">${tr('{n} híd', { n: s.nb })}</span>` : `<span class="muted">${tr('kézi')}</span>`;
    return `<li class="lk${selLink === l.id ? ' on' : ''}" data-li="${l.id}" title="${tr('Kattints: kezdő- és végpont, útvonal kiemelése')}"><span class="t">${esc(linkText(D, l))}${s.gpio && l.b === 'GPIO' ? ` <b>${s.gpio}</b>` : ''}</span>${st}<button data-dl="${l.id}" aria-label="${tr('Kapcsolat törlése')}" title="${tr('Törlés')}">×</button></li>`
      + (selLink === l.id ? `<li class="lk-edit"><label class="small muted" for="lkTo">${tr('Cél')}</label>${targetSelectHtml(D, A, 'data-linkto', l.id, l.b, l.a.split('.')[0], tr).replace('<select ', '<select id="lkTo" ').replace(`<option value="">– ${tr('nincs kapcsolat')} –</option>`, '')}</li>` : '');
  }).join('')
    : `<li class="muted small" style="padding:4px 6px">${tr('Még nincs kapcsolat.')}</li>`;
  const ab = D.auto.bridges.length, aw = D.auto.wires.length, mb = D.bridges.length, mw = D.wires.length;
  const rows = [...state.values()].reduce((t, s) => t + (s.nb || 0), 0);
  /** „12 híd (10 auto + 2 kézi)”: a darabszám és hogy honnan van */
  const cnt = (key: string, a: number, m: number, always: boolean) => tr(key, { n: `<b>${a + m}</b>` }) + (a && m ? ` <span class="muted">(${tr('{a} auto + {m} kézi', { a, m })})</span>` : a ? ' <span class="muted">(auto)</span>' : (m || always) ? ` <span class="muted">(${tr('kézi')})</span>` : '');
  const parts = [cnt(N_('{n} híd'), ab, mb, false)];
  if (aw + mw) parts.push(cnt(N_('{n} vezeték'), aw, mw, true));
  { const ac = (D.auto.cuts || []).length, mc = (D.cuts || []).length; if (ac + mc) parts.push(cnt(N_('{n} vágás'), ac, mc, true)); }
  const total = (n || ab + mb + aw + mw || (D.cuts || []).length)
    ? `<span>${tr('Összesen: {x}', { x: parts.join(' · ') })}</span>` + (ab && rows > ab ? `<span class="muted" title="${tr('A soronkénti számok összege {n}; a közös szakaszok (pl. GND-törzs) több kapcsolatnál is szerepelnek, de csak egyszer kell beforrasztani.', { n: rows })}">ⓘ ${tr('sorok összege: {n} (közös szakaszok)', { n: rows })}</span>` : '')
    : '';
  return { sum, list, total };
}

/** A kiemelt kapcsolat az állapotsorban: honnan hová, a hidak száma. */
export function linkStatusLine(D: Design, l: Link, g: LinkGeom, tr: Tr): string {
  const e = g.endPin ? ` (${pinLabel(g.endPin)})` : '';
  return `${linkText(D, l)} · ${tr('kezdet')} ${g.start.join(':')}${g.end ? ` → ${tr('cél')} ${g.end.join(':')}${e}` : ''}${g.bridges.length ? ` · ${tr('{n} híd', { n: g.bridges.length })}` : ''} · ${tr('Esc: kiemelés vége')}`;
}

/** A panel állapotának az a része, amelyet a Kapcsolatok panel olvas és ír. */
export interface LinksState { selLink?: string | null; linkState: Map<string, LinkState> }

export interface LinksHost {
  readonly ui: LinksState;
  D(): Design;
  /** a nyugalmi netlista (nem a szimulációs) */ A(): Netlist;
  readonly root: { sum: HTMLElement; list: HTMLElement; total: HTMLElement; autoRoute: HTMLInputElement; autoCut: HTMLInputElement };
  autoCutOn(): boolean;
  tr: Tr;
  pushUndo(): void; dropUndo(): void; commit(): void; draw(): void; status(): void;
  /** a kiemelt kapcsolat kezdő- és végpontja a nézet közepére */ center(pts: Array<[number, number]>): void;
}

export interface LinksPanel {
  render(): void;
  /** a kiemelt kapcsolat geometriája (ha van) */ geom(l: Link | null | undefined): LinkGeom | null;
  /** a kiemelt kapcsolat állapotsori szövege, ha van kiemelés */ statusText(): string | null;
  select(id: string | null): void;
}

export function createLinksPanel(H: LinksHost): LinksPanel {
  const { ui, root } = H;
  const geom = (l: Link | null | undefined) => (l ? linkGeom(H.D(), H.A(), l, ui.linkState.get(l.id)) : null);
  function render() {
    const D = H.D();
    root.autoRoute.checked = !!D.settings.autoRoute; root.autoCut.checked = H.autoCutOn();
    const v = linksViewHtml(D, H.A(), ui.linkState, ui.selLink || null, H.tr);
    root.sum.innerHTML = v.sum; root.list.innerHTML = v.list; root.total.innerHTML = v.total;
  }
  function select(id: string | null) {
    ui.selLink = id; render(); H.draw(); H.status();
    if (!id) return;
    const g = geom(H.D().links.find(x => x.id === id));
    if (g) H.center([g.start, g.end].filter((x): x is [number, number] => !!x));
  }
  root.list.addEventListener('change', e => {
    const s = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-linkto]'); if (!s) return;
    H.pushUndo(); if (!setLinkTarget(H.D(), s.dataset.linkto!, s.value)) { H.dropUndo(); render(); return; } H.commit();
  });
  root.list.addEventListener('click', e => {
    const t = e.target as HTMLElement, b = t.closest<HTMLElement>('[data-dl]');
    if (b) { const D = H.D(); H.pushUndo(); D.links = D.links.filter(l => l.id !== b.dataset.dl); H.commit(); return; }
    const li = t.closest<HTMLElement>('[data-li]'); if (li) { const id = li.dataset.li!; select(ui.selLink === id ? null : id); }
  });
  return {
    render, geom, select,
    statusText() {
      const D = H.D(), l = D.links.find(x => x.id === ui.selLink); if (!l) return null;
      const g = geom(l); return g ? linkStatusLine(D, l, g, H.tr) : null;
    },
  };
}
