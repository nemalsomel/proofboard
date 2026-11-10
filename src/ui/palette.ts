/**
 * Parancspaletta (Ctrl+K): keresés minden parancs, alkatrész és példa között; Enter végrehajtja.
 * Üres keresésnél a teljes gyorsbillentyű-táblázat csoportonként (súgóként is). A tartalmat a gazda adja
 * (már lefordított szövegekkel), a rangsor a `commands.ts`-ben.
 */
import { fmtKey, rank } from './commands';
import { esc } from './links';

export type PalKind = 'cmd' | 'part' | 'example';
export interface PalItem {
  id: string; kind: PalKind; label: string; group: string;
  keys?: string[]; words?: string; sub?: string;
  enabled: boolean; checked?: boolean;
  run(): void;
}
export interface PaletteHost {
  /** a parancsok (üres keresésnél csak ezek látszanak) */ commands(): PalItem[];
  /** alkatrészek és példák (csak kereséskor) */ extra(): PalItem[];
  tr(s: string, p?: Record<string, unknown>): string;
  /** a megnyitás/bezárás előtt-után (pl. billentyűzár) */ onOpen?(open: boolean): void;
}
export interface Palette { open(q?: string): void; close(): void; isOpen(): boolean; render(): void }

const MAX = 60;

export function mountPalette(dlg: HTMLDialogElement, host: PaletteHost): Palette {
  const tr = host.tr;
  dlg.innerHTML = `<div class="pal-head"><span class="pal-ic" aria-hidden="true">⌕</span><input class="pal-q" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list"><kbd class="pal-esc">Esc</kbd></div>
    <div class="pal-list" id="palList" role="listbox"></div>
    <div class="pal-foot small muted"></div>`;
  const q = dlg.querySelector<HTMLInputElement>('.pal-q')!, list = dlg.querySelector<HTMLElement>('.pal-list')!, foot = dlg.querySelector<HTMLElement>('.pal-foot')!;
  let shown: PalItem[] = [], act = 0;

  const kbd = (ks?: string[]) => (ks || []).slice(0, 2).map(k => `<kbd>${esc(fmtKey(k))}</kbd>`).join('');
  const row = (it: PalItem, i: number, tag: boolean) =>
    `<div class="pal-row${it.enabled ? '' : ' off'}${i === act ? ' on' : ''}" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === act}" aria-disabled="${!it.enabled}">`
    + `<span class="pal-l">${it.checked != null ? `<span class="pal-chk${it.checked ? ' y' : ''}" aria-hidden="true">${it.checked ? '✓' : ''}</span>` : ''}${esc(it.label)}${it.sub ? ` <span class="pal-sub">${esc(it.sub)}</span>` : ''}</span>`
    + (tag ? `<span class="pal-tag">${esc(it.group)}</span>` : '') + `<span class="pal-k">${kbd(it.keys)}</span></div>`;

  function render() {
    q.placeholder = tr('Parancs, alkatrész vagy példa keresése…');
    q.setAttribute('aria-label', tr('Parancspaletta'));
    foot.textContent = tr('↑↓ választás · Enter: végrehajtás · Esc: bezárás · a Ctrl nyomva tartásakor a látható gombokon is megjelenik a billentyűjük');
    const s = q.value.trim();
    let html = '';
    if (!s) {
      shown = host.commands();
      let g = '';
      shown.forEach((it, i) => { if (it.group !== g) { g = it.group; html += `<div class="pal-g" role="presentation">${esc(g)}</div>`; } html += row(it, i, false); });
    } else {
      const all = [...host.commands(), ...host.extra()];
      shown = rank(all, s, x => [x.label, [x.words || '', x.sub || '', x.group].join(' ')]).slice(0, MAX);
      html = shown.map((it, i) => row(it, i, true)).join('') || `<p class="pal-none muted">${esc(tr('Nincs találat.'))}</p>`;
    }
    if (act >= shown.length) act = Math.max(0, shown.length - 1);
    list.innerHTML = html;
    q.setAttribute('aria-activedescendant', shown.length ? 'pal-' + act : '');
    scrollAct();
  }
  function scrollAct() { const el = list.querySelector<HTMLElement>(`[data-i="${act}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  function setAct(i: number) {
    if (!shown.length) return;
    act = (i + shown.length) % shown.length;
    for (const el of list.querySelectorAll<HTMLElement>('.pal-row')) { const on = +el.dataset.i! === act; el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); }
    q.setAttribute('aria-activedescendant', 'pal-' + act); scrollAct();
  }
  function exec(i: number) {
    const it = shown[i]; if (!it || !it.enabled) return;
    close(); it.run();
  }
  function open(text = '') {
    q.value = text; act = 0; render();
    if (!dlg.open) dlg.showModal();
    host.onOpen?.(true);
    q.focus(); q.select();
  }
  function close() { if (dlg.open) dlg.close(); }

  q.addEventListener('input', () => { act = 0; render(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAct(act + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(act - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); setAct(Math.min(shown.length - 1, act + 8)); }
    else if (e.key === 'PageUp') { e.preventDefault(); setAct(Math.max(0, act - 8)); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(act); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); } // a keresőmező az első Esc-re csak törölne
  });
  list.addEventListener('mousemove', e => { const r = (e.target as HTMLElement).closest<HTMLElement>('.pal-row'); if (r && +r.dataset.i! !== act) setAct(+r.dataset.i!); });
  list.addEventListener('click', e => { const r = (e.target as HTMLElement).closest<HTMLElement>('.pal-row'); if (r) exec(+r.dataset.i!); });
  dlg.addEventListener('close', () => host.onOpen?.(false));
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); }); // a háttérre kattintva bezárul

  return { open, close, isOpen: () => dlg.open, render };
}
