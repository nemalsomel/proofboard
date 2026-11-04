/**
 * A Vezérlés nézet „Kód” füle: a programból generált MicroPython vagy Arduino kód (engine/codegen.ts),
 * sorszámokkal, a kijelölt csomópont sorainak kiemelésével; másolás, letöltés, PlatformIO-projekt (zip).
 * Önálló komponens, mint a csomópontszerkesztő: a gazdától kapja a kódot és a kijelölést.
 */
import type { CodeLang, CodeOut } from '../engine/codegen';
import { platformioFiles } from '../engine/codegen';
import { makeZip } from '../core/zip';

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
  const c = esc(code).replace(/(&quot;[^&]*&quot;|'[^']*')/g, '<span class="tk-s">$1</span>').replace(KW, '<span class="tk-k">$1</span>').replace(/\b(\d+(?:\.\d+)?f?)\b/g, '<span class="tk-n">$1</span>');
  return c + (com ? `<span class="tk-c">${esc(com)}</span>` : '');
}

export function mountCodeView(root: HTMLElement, host: CodeHost): CodeView {
  root.classList.add('pc');
  root.innerHTML = `
    <div class="pg-bar" role="toolbar" aria-label="Kód">
      <div class="grp seg" role="group" aria-label="Nyelv"><button class="btn" data-lang="micropython">MicroPython</button><button class="btn" data-lang="arduino">Arduino</button></div>
      <span class="pg-sp"></span>
      <button class="btn" data-pc="copy">Másolás</button>
      <button class="btn" data-pc="dl"></button>
      <button class="btn" data-pc="pio" title="platformio.ini és src/main.cpp egy zip-ben (VS Code + PlatformIO)">PlatformIO-projekt</button>
    </div>
    <div class="pc-info"></div>
    <div class="pc-scroll"><pre class="pc-code" tabindex="0" aria-label="Generált kód"></pre></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  let cur: CodeOut | null = null;

  function render() {
    const lang = host.lang();
    cur = host.code(lang);
    root.querySelectorAll<HTMLElement>('[data-lang]').forEach(b => { const on = b.dataset.lang === lang; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $<HTMLButtonElement>('[data-pc="dl"]').textContent = lang === 'micropython' ? 'Letöltés (main.py)' : 'Letöltés (.ino)';
    $<HTMLButtonElement>('[data-pc="pio"]').hidden = lang !== 'arduino';
    const pre = $<HTMLPreElement>('.pc-code'), info = $<HTMLDivElement>('.pc-info');
    if (!cur) { pre.innerHTML = ''; info.innerHTML = '<p class="help">Még nincs program. A Blokkok fülön rakd össze, és itt megjelenik a kódja.</p>'; return; }
    const sel = host.selected(), mark = new Set<number>(), owner = new Map<number, string>();
    for (const [id, rs] of Object.entries(cur.lines)) for (const [a, b] of rs) for (let i = a; i <= b; i++) { owner.set(i, id); if (id === sel) mark.add(i); }
    const t = cur.target;
    const how = lang === 'micropython'
      ? 'Feltöltés: Thonny-val nyisd meg, és mentsd a lapra <code>main.py</code> néven (vagy <code>mpremote cp main.py :main.py</code>). A lapon MicroPython-firmware kell.'
      : `Arduino IDE 2: ${t ? `lap <code>${esc(t.fqbn)}</code>${t.boardUrl ? ` (az alaplapkezelőhöz add hozzá: <code>${esc(t.boardUrl)}</code>)` : ''}` : 'válaszd ki a lapot'}. Haladóknak: PlatformIO-projekt zip-ben.`;
    info.innerHTML = `<p class="help">${how}</p>${cur.warnings.length ? `<ul class="pc-warn">${cur.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
    pre.innerHTML = cur.code.replace(/\n$/, '').split('\n').map((l, i) => {
      const n = i + 1, o = owner.get(n);
      return `<span class="pc-ln${mark.has(n) ? ' on' : ''}${o ? ' own' : ''}"${o ? ` data-node="${esc(o)}"` : ''}><i>${n}</i>${hl(l, lang) || ' '}</span>`;
    }).join(''); // a sorok blokkelemek: sortörés nélkül fűzve
    const first = pre.querySelector('.pc-ln.on') as HTMLElement | null;
    if (first) { const sc = $<HTMLDivElement>('.pc-scroll'), top = first.offsetTop - sc.clientHeight / 3; if (first.offsetTop < sc.scrollTop || first.offsetTop > sc.scrollTop + sc.clientHeight - 20) sc.scrollTop = Math.max(0, top); }
  }

  root.addEventListener('click', async e => {
    const t = e.target as HTMLElement, lb = t.closest('[data-lang]') as HTMLElement | null, b = t.closest('[data-pc]') as HTMLElement | null, ln = t.closest('.pc-ln[data-node]') as HTMLElement | null;
    if (lb) { host.setLang(lb.dataset.lang as CodeLang); render(); return; }
    if (ln) { host.select(ln.dataset.node === host.selected() ? null : ln.dataset.node!); render(); return; }
    if (!b || !cur) return;
    if (b.dataset.pc === 'copy') {
      try { await navigator.clipboard.writeText(cur.code); b.textContent = 'Másolva ✓'; } catch { b.textContent = 'Nem sikerült'; }
      setTimeout(() => { b.textContent = 'Másolás'; }, 1500);
    } else if (b.dataset.pc === 'dl') host.download(cur.file, new Blob([cur.code], { type: 'text/plain' }));
    else if (b.dataset.pc === 'pio') { const z = makeZip(platformioFiles(cur).map(f => ({ name: 'proofboard/' + f.name, text: f.text }))); host.download('proofboard-platformio.zip', new Blob([z as BlobPart], { type: 'application/zip' })); }
  });
  return { refresh: render };
}
