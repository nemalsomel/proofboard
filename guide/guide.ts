// Kézikönyv: keresés (kliensoldali index: search-<nyelv>.json), képnagyító, az oldal címei közül az aktuális kiemelése.
interface Hit { t: string; h: string; u: string; x: string }
const body = document.body, root = body.dataset.root || '', lang = body.dataset.lang || 'en';
const hu = lang === 'hu';

/* ---------- fejezetlista: keskeny képernyőn összecsukva indul ---------- */
if (matchMedia('(max-width: 820px)').matches) document.querySelector('.side details')?.removeAttribute('open');

/* ---------- keresés ---------- */
/** ékezet nélkül, kisbetűvel; UTF-16 egységenként, így a hossz (és a pozíciók) megegyeznek az eredetivel */
const fold = (s: string) => s.split('').map(ch => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().charAt(0) || ch).join('');
const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const q = document.querySelector<HTMLInputElement>('#q'), hits = document.querySelector<HTMLOListElement>('#hits');
let data: Hit[] | null = null, sel = -1;
async function load(): Promise<Hit[]> {
  if (data) return data;
  try { data = (await (await fetch(`${root}search-${lang}.json`)).json()) as Hit[]; } catch { data = []; }
  return data;
}
/** a találat szövegrészlete a szavak első előfordulása körül, kiemelve (ékezetfüggetlenül: a hajtogatott szöveg hossza azonos) */
function snippet(x: string, words: string[]): string {
  const f = fold(x); let i = -1;
  for (const w of words) { const k = f.indexOf(w); if (k >= 0 && (i < 0 || k < i)) i = k; }
  const a = Math.max(0, i - 50), b = Math.min(x.length, a + 150), on = new Array<boolean>(b - a).fill(false);
  for (const w of words) for (let k = f.indexOf(w, a); k >= 0 && k < b; k = f.indexOf(w, k + 1)) for (let j = k; j < Math.min(b, k + w.length); j++) on[j - a] = true;
  let out = a ? '…' : '';
  for (let j = 0; j < on.length;) { let e = j; while (e < on.length && on[e] === on[j]) e++; const t = escH(x.slice(a + j, a + e)); out += on[j] ? `<mark>${t}</mark>` : t; j = e; }
  return out + (b < x.length ? '…' : '');
}
async function search() {
  if (!q || !hits) return;
  const words = fold(q.value).split(/\s+/).filter(w => w.length > 1);
  if (!words.length) { hits.hidden = true; return; }
  const list = (await load()).map(d => {
    const t = fold(d.t), h = fold(d.h), x = fold(d.x);
    let sc = 0;
    for (const w of words) { const s = (t.includes(w) ? 3 : 0) + (h.includes(w) ? 5 : 0) + (x.includes(w) ? 1 : 0); if (!s) return null; sc += s; }
    return { d, sc };
  }).filter((r): r is { d: Hit; sc: number } => !!r).sort((a, b) => b.sc - a.sc).slice(0, 12);
  sel = -1;
  hits.innerHTML = list.length ? list.map(({ d }) => `<li><a href="${root}${d.u}"><b>${escH(d.h || d.t)}</b><small>${d.h ? escH(d.t) + ' · ' : ''}${snippet(d.x, words)}</small></a></li>`).join('') : `<li class="none">${escH(q.dataset.nohit || '')}</li>`;
  hits.hidden = false;
}
if (q && hits) {
  q.addEventListener('input', search);
  q.addEventListener('focus', () => { void load(); if (q.value) void search(); });
  q.addEventListener('keydown', e => {
    const as = [...hits.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!as.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + as.length) % as.length;
      as.forEach((a, i) => a.setAttribute('aria-selected', String(i === sel)));
      as[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { const a = as[Math.max(0, sel)]; if (a) location.href = a.href; }
    else if (e.key === 'Escape') { q.value = ''; hits.hidden = true; q.blur(); }
  });
  document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.search')) hits.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== q && !(e.target as HTMLElement).closest('input, textarea')) { e.preventDefault(); q.focus(); }
  });
}

/* ---------- képnagyító ---------- */
const box = document.createElement('dialog');
box.className = 'zoom';
box.innerHTML = `<button class="zoom-x" aria-label="${hu ? 'Bezárás' : 'Close'}">×</button><img alt="">`;
document.body.append(box);
const big = box.querySelector('img')!;
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('.shot a');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  big.src = a.href; big.alt = a.querySelector('img')?.alt || '';
  box.showModal();
});
box.addEventListener('click', () => box.close());

/* ---------- az aktuális cím a jobb oldali listában ---------- */
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>('.toc a')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const heads = tocLinks.map(a => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter((h): h is HTMLElement => !!h);
  const mark = () => {
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < 120) cur = h;
    tocLinks.forEach(a => a.classList.toggle('on', a.hash === '#' + cur.id));
  };
  addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
  mark();
}
