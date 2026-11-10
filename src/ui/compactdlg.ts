/**
 * Tömörítés panel (lebegő ablakban vagy a jobb sávba rögzítve – a helyét a gazda adja): szorosság (Laza ↔ Szoros), mi maradjon a helyén, élő előnézet a panelon (halványan az
 * eredeti helyekkel), előtte/utána számok. A tervet csak az Alkalmaz módosítja (a gazdán át, egy visszavonási lépésben).
 */
import { N_, type Tr } from '../i18n/i18n';
import type { PartInstance } from '../core/schema';
import { applyCompaction, planCompaction, type CompactMetrics, type CompactOpts, type CompactResult, type KeepReason } from '../engine/compact';
import { route } from '../engine/route';
import type { Design } from '../engine/types';
import { esc } from './links';

export interface CompactPrefs { strength: number; keepMcu: boolean; keepControls: boolean; rotate: boolean }
export const COMPACT_DEFAULTS: CompactPrefs = { strength: 0.5, keepMcu: true, keepControls: true, rotate: true };

export interface CompactHost {
  /** a valódi terv (az előnézet alatt is az eredeti) */ D(): Design;
  /** a kijelölt alkatrészek azonosítói */ selected(): string[];
  /** előnézet: a megjelenített terv és az eredeti helyükön halványan rajzolandó alkatrészek; null: vissza az eredetire */
  preview(d: Design | null, origins: PartInstance[]): void;
  /** a terv végrehajtása (visszavonható) */ apply(res: CompactResult): void;
  /** megnyitás / bezárás (a gazda megjeleníti vagy elrejti a helyét) */ shown(open: boolean): void;
  loadPrefs(): CompactPrefs; savePrefs(p: CompactPrefs): void;
  tr: Tr;
}
export interface CompactDialog {
  open(onlySelected?: boolean): void;
  /** bezárás: az előnézet eltűnik, a terv változatlan */ close(): void;
  isOpen(): boolean;
  /** a terv megváltozott, amíg nyitva volt: újraszámolás */ refresh(): void;
  result(): CompactResult | null; busy(): boolean;
}

const KEEP: Record<KeepReason, string> = { fixed: N_('rögzített'), mcu: N_('vezérlőlap'), control: N_('kezelőszerv'), manual: N_('kézzel bekötve'), off: N_('panelon kívül'), scope: N_('nincs kijelölve') };

export function mountCompactDialog(root: HTMLElement, H: CompactHost): CompactDialog {
  const q = <T extends HTMLElement = HTMLInputElement>(s: string) => root.querySelector<T>(s)!;
  const tr = H.tr;
  let res: CompactResult | null = null, timer = 0, computing = false, isOpen = false, selIds: string[] = [];

  const opts = (): CompactOpts => {
    const sel = selIds;
    return { strength: +q('#cpStrength').value / 100, keepMcu: q('#cpMcu').checked, keepControls: q('#cpCtl').checked, rotate: q('#cpRot').checked, only: q('#cpSel').checked && sel.length ? sel : null };
  };
  const row = (name: string, a: number | string, b: number | string, better: boolean | null) =>
    `<tr><td>${name}</td><td>${a}</td><td>→</td><td class="${better == null || a === b ? '' : better ? 'good' : 'bad'}">${b}</td></tr>`;
  function show() {
    const box = q<HTMLElement>('#cpRes');
    if (!res) { box.innerHTML = ''; return; }
    const a: CompactMetrics = res.before, b = res.after, sz = (m: CompactMetrics) => (m.stats.box ? `${m.stats.rows}×${m.stats.cols}` : '–');
    const kept = Object.entries(res.kept).filter(([, w]) => w !== 'off').map(([l, w]) => `${esc(l)} <span class="muted">(${esc(tr(KEEP[w]))})</span>`);
    box.innerHTML = `<table><thead><tr><th></th><th>${tr('Most')}</th><th></th><th>${tr('Utána')}</th></tr></thead><tbody>`
      + row(tr('Terület (lyuk)'), sz(a), sz(b), b.stats.area < a.stats.area ? true : b.stats.area > a.stats.area ? false : null)
      + row(tr('Hidak'), a.bridges, b.bridges, b.bridges < a.bridges ? true : b.bridges > a.bridges ? false : null)
      + row(tr('Vezetékek'), a.wires, b.wires, b.wires < a.wires ? true : b.wires > a.wires ? false : null)
      + row(tr('Bekötve'), `${a.linksOk}/${a.links}`, `${b.linksOk}/${b.links}`, b.linksOk > a.linksOk ? true : b.linksOk < a.linksOk ? false : null)
      + `</tbody></table>`
      + (res.moves.length ? `<p>${tr('Mozdul: {x}', { x: res.moves.map(m => esc(m.label)).join(', ') })}</p>` : `<p class="muted">${tr('Ezekkel a beállításokkal nincs jobb elrendezés.')}</p>`)
      + (kept.length ? `<p class="small">${tr('A helyén marad: {x}', { x: kept.join(', ') })}</p>` : '');
    q<HTMLButtonElement>('#cpApply').disabled = !res.moves.length;
  }
  function compute() {
    timer = 0; computing = true;
    const D = H.D(); res = planCompaction(D, opts());
    if (res.moves.length) {
      const P = JSON.parse(JSON.stringify(D)) as Design; applyCompaction(P, res);
      if (P.settings.autoRoute && P.links.length) route(P, { full: true });
      const ids = new Set(res.moves.map(m => m.id));
      H.preview(P, D.parts.filter(p => ids.has(p.id)));
    } else H.preview(null, []);
    computing = false; q('#cpRes').classList.remove('busy'); show();
  }
  const schedule = () => { q('#cpRes').classList.add('busy'); q<HTMLButtonElement>('#cpApply').disabled = true; if (timer) clearTimeout(timer); timer = window.setTimeout(compute, 120); };
  const save = () => H.savePrefs({ strength: +q('#cpStrength').value / 100, keepMcu: q('#cpMcu').checked, keepControls: q('#cpCtl').checked, rotate: q('#cpRot').checked });
  for (const id of ['#cpStrength', '#cpMcu', '#cpCtl', '#cpRot', '#cpSel']) q(id).addEventListener(id === '#cpStrength' ? 'input' : 'change', () => { save(); schedule(); });
  q('#cpApply').addEventListener('click', () => {
    if (timer) { clearTimeout(timer); compute(); }
    if (!res || !res.moves.length) return;
    const r = res; close(false); H.apply(r);
  });
  /** bezárás; `restore`: az előnézet helyett az eredeti terv látszik */
  function close(restore = true) {
    if (!isOpen) return; isOpen = false;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (restore) H.preview(null, []);
    res = null; H.shown(false);
  }
  root.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-cp-close]')) close(); });

  return {
    open(onlySelected) {
      const p = H.loadPrefs(), sel = (selIds = H.selected());
      q('#cpStrength').value = String(Math.round(p.strength * 100)); q('#cpMcu').checked = p.keepMcu; q('#cpCtl').checked = p.keepControls; q('#cpRot').checked = p.rotate;
      q('#cpSelL').hidden = !sel.length; q('#cpSel').checked = !!sel.length && onlySelected !== false;
      isOpen = true; res = null; show(); H.shown(true);
      q('#cpRes').classList.add('busy'); compute();
    },
    close: () => close(),
    isOpen: () => isOpen,
    refresh() { if (isOpen) schedule(); },
    result: () => res,
    busy: () => computing || !!timer,
  };
}
