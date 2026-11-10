// Nyitókép: a panel-háttér görgetéskor lassabban halad (parallax), közben elhomályosodik és sötétedik.
// Csökkentett mozgásnál nincs effekt.
const hero = document.querySelector<HTMLElement>('.hero');
if (hero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let raf = 0;
  const update = () => {
    raf = 0;
    const r = hero.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
    hero.style.setProperty('--p', p.toFixed(3));
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  update();
}

// Képnagyító: a képernyőképre kattintva nagyban, a lapon belül (Esc, kattintás vagy a gomb bezárja).
// JavaScript nélkül a link magára a képre visz.
const box = document.createElement('dialog');
box.className = 'zoom';
const hu = document.documentElement.lang === 'hu';
box.innerHTML = `<button class="zoom-x" aria-label="${hu ? 'Bezárás' : 'Close'}">×</button><img alt="">`;
document.body.append(box);
const big = box.querySelector('img')!;
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href$=".jpg"]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  big.src = a.href; big.alt = a.querySelector('img')?.alt || '';
  box.showModal();
});
box.addEventListener('click', () => box.close());
