/**
 * Kód importálása (Kód fül › Importálás…): Arduino vagy MicroPython vázlat beillesztve vagy fájlból, élő
 * előnézettel – mi lesz belőle (blokkok) és mi nem fordítható (sorszámmal, kattintásra a sorra ugrik).
 * Az átalakítás az `engine/codeimport.ts`-ben; a tervbe a gazda teszi (egy visszavonási lépés).
 */
import { importCode, type ImportLang, type ImportResult } from '../engine/codeimport';
import type { Design } from '../engine/types';
import { esc } from './links';
import { icon } from './icons';

export interface ImportHost {
  design(): Design;
  tr(s: string, p?: Readonly<Record<string, string | number>>): string;
  /** az eredmény a tervbe (csere vagy hozzáadás) */ apply(res: ImportResult, mode: 'replace' | 'append'): void;
}
export interface ImportDialog { open(code?: string): void; close(): void }

export function mountImportDialog(dlg: HTMLDialogElement, host: ImportHost): ImportDialog {
  const tr = host.tr;
  dlg.innerHTML = `<header class="dlg-head"><h2 id="dlgImpT"></h2><button class="btn icon ghost" data-close aria-label="" data-x>${icon('close')}</button></header>
    <div class="dlg-body imp">
      <p class="help imp-intro"></p>
      <div class="imp-bar">
        <div class="grp seg imp-lang" role="group"><button class="btn" data-il="auto"></button><button class="btn" data-il="arduino">Arduino</button><button class="btn" data-il="micropython">MicroPython</button></div>
        <span class="pg-sp"></span>
        <button class="btn" data-imp="file"></button><input type="file" accept=".ino,.cpp,.c,.h,.py,.txt" hidden>
      </div>
      <textarea class="imp-code" spellcheck="false" wrap="off"></textarea>
      <div class="imp-out" aria-live="polite"></div>
    </div>
    <footer class="dlg-foot"><button class="btn ghost" data-close data-c></button><button class="btn" data-imp="append"></button><button class="btn primary" data-imp="replace"></button></footer>`;
  dlg.setAttribute('aria-labelledby', 'dlgImpT');
  const $ = <T extends HTMLElement>(s: string) => dlg.querySelector(s) as T;
  const ta = $<HTMLTextAreaElement>('.imp-code'), out = $<HTMLDivElement>('.imp-out'), file = $<HTMLInputElement>('input[type=file]');
  let lang: 'auto' | ImportLang = 'auto', res: ImportResult | null = null, timer: ReturnType<typeof setTimeout> | undefined;

  function labels() {
    $('#dlgImpT').textContent = tr('Kód importálása');
    $('[data-x]').setAttribute('aria-label', tr('Bezárás'));
    $('.imp-intro').textContent = tr('Illessz be egy Arduino- vagy MicroPython-vázlatot: a lábakat, a feltételeket, az időzítést és az állapotváltozókat (váltás, számláló, millis-időzítő) blokkokká alakítja. Ami nem fordítható, azt sorszámmal jelzi.');
    $('[data-il="auto"]').textContent = tr('Automatikus');
    $('.imp-lang').setAttribute('aria-label', tr('Programnyelv'));
    $('[data-imp="file"]').textContent = tr('Fájl betöltése…');
    ta.placeholder = 'void setup() { pinMode(15, OUTPUT); }\nvoid loop() { digitalWrite(15, HIGH); delay(500); digitalWrite(15, LOW); delay(500); }';
    ta.setAttribute('aria-label', tr('Kód'));
    $('[data-c]').textContent = tr('Mégse');
    const has = !!host.design().program?.nodes.length;
    const rep = $<HTMLButtonElement>('[data-imp="replace"]'), app = $<HTMLButtonElement>('[data-imp="append"]');
    rep.textContent = has ? tr('A program cseréje') : tr('Blokkok létrehozása');
    app.textContent = tr('Hozzáadás a programhoz');
    app.hidden = !has;
    for (const b of dlg.querySelectorAll<HTMLElement>('[data-il]')) { const on = b.dataset.il === lang; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  function preview() {
    const code = ta.value;
    const rep = $<HTMLButtonElement>('[data-imp="replace"]'), app = $<HTMLButtonElement>('[data-imp="append"]');
    if (!code.trim()) { res = null; out.innerHTML = ''; rep.disabled = app.disabled = true; return; }
    res = importCode(host.design(), code, { lang: lang === 'auto' ? undefined : lang, tr: (s, p) => tr(s, p) });
    const ok = res.program.nodes.length > 0;
    rep.disabled = app.disabled = !ok;
    const ln = (n: number) => (n > 0 ? `<button class="imp-ln" data-line="${n}">${n}</button>` : '');
    out.innerHTML = `<p class="imp-sum"><b>${esc(lang === 'auto' ? tr('Felismert nyelv: {x}', { x: res.lang === 'arduino' ? 'Arduino' : 'MicroPython' }) : '')}</b>${lang === 'auto' ? ' · ' : ''}${res.summary.map(esc).join(' · ') || esc(tr('Nem keletkezik blokk.'))}</p>`
      + (res.notes.length ? `<ul class="imp-notes">${res.notes.map(n => `<li>${ln(n.line)}${esc(n.msg.replace(/^\d+\. sor: /, '').replace(/^Line \d+: /, ''))}</li>`).join('')}</ul>` : `<p class="help">${esc(tr('Minden rész lefordult.'))}</p>`);
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(preview, 250); };
  ta.addEventListener('input', later);
  ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); later(); } });
  dlg.addEventListener('click', e => {
    const el = e.target as HTMLElement, il = el.closest<HTMLElement>('[data-il]'), b = el.closest<HTMLElement>('[data-imp]'), l = el.closest<HTMLElement>('[data-line]');
    if (il) { lang = il.dataset.il as typeof lang; labels(); preview(); return; }
    if (l) { const n = +l.dataset.line!, lines = ta.value.split('\n'); const a = lines.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0); ta.focus(); ta.setSelectionRange(a, a + (lines[n - 1] || '').length); ta.scrollTop = Math.max(0, (n - 4) * 18); return; }
    if (!b) return;
    if (b.dataset.imp === 'file') { file.click(); return; }
    clearTimeout(timer); preview();
    if (!res || !res.program.nodes.length) return;
    const r = res; dlg.close(); host.apply(r, b.dataset.imp === 'append' ? 'append' : 'replace');
  });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; file.value = ''; if (!f) return;
    ta.value = await f.text();
    if (/\.py$/i.test(f.name)) lang = 'micropython'; else if (/\.(ino|cpp|c|h)$/i.test(f.name)) lang = 'arduino';
    labels(); preview();
  });
  return {
    open(code?: string) { if (code != null) ta.value = code; labels(); preview(); if (!dlg.open) dlg.showModal(); ta.focus(); },
    close() { if (dlg.open) dlg.close(); },
  };
}
