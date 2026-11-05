/**
 * A Vezérlés nézet „Kód” füle: a programból generált MicroPython vagy Arduino kód (engine/codegen.ts),
 * sorszámokkal, a kijelölt csomópont sorainak kiemelésével; másolás, letöltés, PlatformIO-projekt (zip).
 * Önálló komponens, mint a csomópontszerkesztő: a gazdától kapja a kódot és a kijelölést.
 */
import type { CodeLang, CodeOut } from '../engine/codegen';
import { platformioFiles } from '../engine/codegen';
import { makeZip } from '../core/zip';
import { t } from '../i18n/i18n';

export interface CodeHost {
  code(lang: CodeLang): CodeOut | null;
  selected(): string | null;
  select(id: string | null): void;
  /** Fájl letöltése (a böngészőben). */
  download(name: string, data: Blob): void;
  lang(): CodeLang;
  setLang(l: CodeLang): void;
}
export interface CodeView { refresh(): void }

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
/** Egyszerű kiemelés: megjegyzés, szöveg, szám, kulcsszó (a sorok szerkezete marad). */
function hl(line: string, lang: CodeLang): string {
  const cm = lang === 'micropython' ? '#' : '//', i = line.indexOf(cm);
  const code = i >= 0 ? line.slice(0, i) : line, com = i >= 0 ? line.slice(i) : '';
  const KW = lang === 'micropython' ? /\b(from|import|while|if|else|not|and|or|True|False|None|int|max|min)\b/g : /\b(void|bool|int|float|unsigned|long|if|else|return|true|false|const)\b/g;
  // szövegek először (kimarad belőlük a kulcsszó- és számkiemelés), a számok nem eshetnek HTML-entitásba (&#39;)
  const parts = esc(code).split(/(&quot;.*?&quot;|&#39;.*?&#39;)/g);
  const c = parts.map((x, i) => i % 2 ? `<span class="tk-s">${x}</span>` : x.replace(KW, '<span class="tk-k">$1</span>').replace(/(?<![&#\w])(\d+(?:\.\d+)?f?)\b/g, '<span class="tk-n">$1</span>')).join('');
  return c + (com ? `<span class="tk-c">${esc(com)}</span>` : '');
}

export function mountCodeView(root: HTMLElement, host: CodeHost): CodeView {
  root.classList.add('pc');
  root.innerHTML = `
    <div class="pg-bar" role="toolbar" aria-label="${t('Kód')}">
      <div class="grp seg" role="group" aria-label="${t('Programnyelv')}"><button class="btn" data-lang="micropython">MicroPython</button><button class="btn" data-lang="arduino">Arduino</button></div>
      <span class="pg-sp"></span>
      <button class="btn" data-pc="copy">${t('Másolás')}</button>
      <button class="btn" data-pc="dl"></button>
      <button class="btn" data-adv data-pc="pio" title="${t('platformio.ini és src/main.cpp egy zip-ben (VS Code + PlatformIO)')}">${t('PlatformIO-projekt')}</button>
    </div>
    <div class="pc-info"></div>
    <div class="pc-scroll"><pre class="pc-code" tabindex="0" aria-label="${t('Generált kód')}"></pre></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  let cur: CodeOut | null = null;

  function render() {
    // a sáv feliratai (nyelvváltáskor is)
    root.querySelector('.pg-bar')!.setAttribute('aria-label', t('Kód'));
    root.querySelector('.pg-bar .grp')!.setAttribute('aria-label', t('Programnyelv'));
    $<HTMLButtonElement>('[data-pc="copy"]').textContent = t('Másolás');
    const pio = $<HTMLButtonElement>('[data-pc="pio"]'); pio.textContent = t('PlatformIO-projekt'); pio.title = t('platformio.ini és src/main.cpp egy zip-ben (VS Code + PlatformIO)');
    $<HTMLElement>('.pc-code').setAttribute('aria-label', t('Generált kód'));
    const lang = host.lang();
    cur = host.code(lang);
    root.querySelectorAll<HTMLElement>('[data-lang]').forEach(b => { const on = b.dataset.lang === lang; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $<HTMLButtonElement>('[data-pc="dl"]').textContent = t('Letöltés ({x})', { x: lang === 'micropython' ? 'main.py' : '.ino' });
    $<HTMLButtonElement>('[data-pc="pio"]').hidden = lang !== 'arduino';
    const pre = $<HTMLPreElement>('.pc-code'), info = $<HTMLDivElement>('.pc-info');
    if (!cur) { pre.innerHTML = ''; info.innerHTML = `<p class="help">${t('Még nincs program. A Blokkok fülön rakd össze, és itt megjelenik a kódja.')}</p>`; return; }
    const sel = host.selected(), mark = new Set<number>(), owner = new Map<number, string>();
    for (const [id, rs] of Object.entries(cur.lines)) for (const [a, b] of rs) for (let i = a; i <= b; i++) { owner.set(i, id); if (id === sel) mark.add(i); }
    const tg = cur.target;
    const how = lang === 'micropython'
      ? t('Feltöltés: Thonny-val nyisd meg, és mentsd a lapra {x} néven (vagy {y}). A lapon MicroPython-firmware kell.', { x: '<code>main.py</code>', y: '<code>mpremote cp main.py :main.py</code>' })
      : `Arduino IDE 2: ${tg ? `${t('lap')} <code>${esc(tg.fqbn)}</code>${tg.boardUrl ? ` (${t('az alaplapkezelőhöz add hozzá: {x}', { x: `<code>${esc(tg.boardUrl)}</code>` })})` : ''}` : t('válaszd ki a lapot')}. ${t('Haladóknak: PlatformIO-projekt zip-ben.')}`;
    info.innerHTML = `<p class="help">${how}</p>${cur.warnings.length ? `<ul class="pc-warn">${cur.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
    pre.innerHTML = cur.code.replace(/\n$/, '').split('\n').map((l, i) => {
      const n = i + 1, o = owner.get(n);
      return `<span class="pc-ln${mark.has(n) ? ' on' : ''}${o ? ' own' : ''}"${o ? ` data-node="${esc(o)}"` : ''}><i>${n}</i>${hl(l, lang) || ' '}</span>`;
    }).join(''); // a sorok blokkelemek: sortörés nélkül fűzve
    const first = pre.querySelector('.pc-ln.on') as HTMLElement | null;
    if (first) { const sc = $<HTMLDivElement>('.pc-scroll'), top = first.offsetTop - sc.clientHeight / 3; if (first.offsetTop < sc.scrollTop || first.offsetTop > sc.scrollTop + sc.clientHeight - 20) sc.scrollTop = Math.max(0, top); }
  }

  root.addEventListener('click', async e => {
    const el = e.target as HTMLElement, lb = el.closest('[data-lang]') as HTMLElement | null, b = el.closest('[data-pc]') as HTMLElement | null, ln = el.closest('.pc-ln[data-node]') as HTMLElement | null;
    if (lb) { host.setLang(lb.dataset.lang as CodeLang); render(); return; }
    if (ln) { host.select(ln.dataset.node === host.selected() ? null : ln.dataset.node!); render(); return; }
    if (!b || !cur) return;
    if (b.dataset.pc === 'copy') {
      try { await navigator.clipboard.writeText(cur.code); b.textContent = t('Másolva') + ' ✓'; } catch { b.textContent = t('Nem sikerült'); }
      setTimeout(() => { b.textContent = t('Másolás'); }, 1500);
    } else if (b.dataset.pc === 'dl') host.download(cur.file, new Blob([cur.code], { type: 'text/plain' }));
    else if (b.dataset.pc === 'pio') { const z = makeZip(platformioFiles(cur).map(f => ({ name: 'proofboard/' + f.name, text: f.text }))); host.download('proofboard-platformio.zip', new Blob([z as BlobPart], { type: 'application/zip' })); }
  });
  return { refresh: render };
}
