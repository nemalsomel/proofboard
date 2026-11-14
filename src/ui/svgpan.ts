/**
 * Nagyítható, mozgatható SVG-nézet (a Gyártás nézet rajzaihoz), a panel nézetéhez hasonlóan:
 * Ctrl/⌘ + görgő (és érintőpados csípés) nagyít a mutató körül, a görgő mozgat (Shift-tel vízszintesen),
 * húzás mozgat, két ujjal csípve nagyít, dupla kattintás: az egész rajz. Sarokban − / % / + / teljes gombok.
 * A nagyítás a `viewBox`-ot állítja, így a vonalak élesek maradnak. Az állapot kulcsonként megmarad
 * (a rajz újraépítésekor – pl. kiemeléskor – a nézet nem ugrik vissza).
 */
import type { Tr } from '../i18n/i18n';
import { icon } from './icons';

/** k: nagyítás (1 = az egész rajz látszik), cx/cy: a látott terület közepe a rajz egységeiben */
interface View { k: number; cx: number; cy: number }
const KMIN = 1, KMAX = 24;

export interface SvgPan {
  /** A tárolóban lévő `<svg>` bekötése a kulcs szerinti nézettel; a tárolóba kerülnek a gombok is. */
  attach(box: HTMLElement, key: string): void;
  /** A kulcs nézetének visszaállítása (az egész rajz). */
  reset(key?: string): void;
  /** A kulcs nagyítása (tesztekhez, API-hoz). */
  zoom(key: string): number;
}

export function createSvgPan(tr: Tr): SvgPan {
  const views = new Map<string, View>();
  const get = (key: string) => { let v = views.get(key); if (!v) { v = { k: 1, cx: NaN, cy: NaN }; views.set(key, v); } return v; };

  function attach(box: HTMLElement, key: string) {
    const svg = box.querySelector<SVGSVGElement>(':scope > svg'); if (!svg) return;
    const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height;
    if (!W || !H) return;
    svg.removeAttribute('style'); svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    box.classList.add('pan');
    const v = get(key);
    if (!isFinite(v.cx)) { v.cx = W / 2; v.cy = H / 2; }
    let ctl = box.querySelector<HTMLElement>(':scope > .pan-ctl');
    if (!ctl) {
      ctl = document.createElement('div');
      ctl.className = 'grp seg pan-ctl';
      ctl.setAttribute('role', 'group');
      box.appendChild(ctl);
    }
    ctl.setAttribute('aria-label', tr('Nagyítás'));
    ctl.innerHTML = `<button class="btn icon" data-z="out" aria-label="${tr('Kicsinyítés')}" title="${tr('Kicsinyítés (Ctrl+görgő)')}">${icon('zoomOut')}</button><button class="btn mono small zlbl" data-z="fit" title="${tr('Az egész rajz (dupla kattintás)')}"></button><button class="btn icon" data-z="in" aria-label="${tr('Nagyítás')}" title="${tr('Nagyítás (Ctrl+görgő)')}">${icon('zoomIn')}</button>`;
    const lbl = ctl.querySelector<HTMLElement>('.zlbl')!;

    /** a látott terület (rajzegység), a meet szerint a tároló arányára bővítve */
    const scale = () => { const r = svg.getBoundingClientRect(); return { r, u: Math.max(W / v.k / Math.max(1, r.width), H / v.k / Math.max(1, r.height)) }; };
    function apply() {
      v.k = Math.min(KMAX, Math.max(KMIN, v.k));
      const vw = W / v.k, vh = H / v.k;
      // a rajz ne tűnjön el: a közép a rajzon belül marad
      if (v.k <= 1) { v.cx = W / 2; v.cy = H / 2; }
      v.cx = Math.min(W - vw / 2 + vw * 0.4, Math.max(vw / 2 - vw * 0.4, v.cx));
      v.cy = Math.min(H - vh / 2 + vh * 0.4, Math.max(vh / 2 - vh * 0.4, v.cy));
      if (vw >= W) v.cx = W / 2; if (vh >= H) v.cy = H / 2;
      svg!.setAttribute('viewBox', `${(v.cx - vw / 2).toFixed(3)} ${(v.cy - vh / 2).toFixed(3)} ${vw.toFixed(3)} ${vh.toFixed(3)}`);
      lbl.textContent = Math.round(v.k * 100) + '%';
      box.classList.toggle('zoomed', v.k > 1.001);
    }
    /** nagyítás a képernyőpont körül (ott marad ugyanaz a rajzpont) */
    function zoomAt(f: number, px?: number, py?: number) {
      const { r, u } = scale();
      const sx = px ?? r.left + r.width / 2, sy = py ?? r.top + r.height / 2;
      const ux = v.cx + (sx - r.left - r.width / 2) * u, uy = v.cy + (sy - r.top - r.height / 2) * u;
      const k0 = v.k; v.k = Math.min(KMAX, Math.max(KMIN, v.k * f));
      const q = k0 / v.k;
      v.cx = ux - (ux - v.cx) * q; v.cy = uy - (uy - v.cy) * q;
      apply();
    }
    const panBy = (dx: number, dy: number) => { const { u } = scale(); v.cx -= dx * u; v.cy -= dy * u; apply(); };

    ctl.onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-z]'); if (!b) return;
      e.stopPropagation();
      if (b.dataset.z === 'in') zoomAt(1.4); else if (b.dataset.z === 'out') zoomAt(1 / 1.4); else { v.k = 1; apply(); }
    };
    svg.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(Math.pow(1.0025, -Math.max(-120, Math.min(120, e.deltaY))), e.clientX, e.clientY); return; }
      if (v.k <= 1.001) return; // nincs mit mozgatni: a lap görgessen
      e.preventDefault();
      const px = e.deltaMode === 1 ? 16 : 1;
      panBy(-(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * px, -(e.shiftKey && !e.deltaX ? 0 : e.deltaY) * px);
    }, { passive: false });
    svg.addEventListener('dblclick', e => { e.preventDefault(); if (v.k > 1.001) v.k = 1; else { zoomAt(2.5, e.clientX, e.clientY); return; } apply(); });
    // húzás és csípés (egér, toll, érintés)
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0, moved = false;
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true; box.classList.add('grabbing');
        p.x = e.clientX; p.y = e.clientY;
        if (v.k > 1.001) panBy(dx, dy);
      } else if (pts.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d; moved = true;
      }
    });
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) box.classList.remove('grabbing'); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    // húzás után ne kattintson (pl. ne nyisson lépést)
    svg.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    apply();
  }

  return {
    attach,
    reset(key) { if (key) views.delete(key); else views.clear(); },
    zoom(key) { return views.get(key)?.k ?? 1; },
  };
}
