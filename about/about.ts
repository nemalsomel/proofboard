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
