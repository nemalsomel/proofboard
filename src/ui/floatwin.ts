/**
 * Lebegő ablak (5.2): a kijelölés tulajdonságai a vászon fölött. Húzható a címsoránál (húzás közben
 * áttetsző), címsorra csökkenthető, a jobb sávba rögzíthető; a helye, a mérete és az állapota megmarad.
 * A hely a vászonterület jobb felső sarkától mért távolság, így átméretezéskor a sarokhoz tapad.
 */
export interface WinState {
  /** a jobb széltől */ x: number;
  /** a felső széltől */ y: number;
  w: number;
  /** a tartalom magassága (null: a tartalomhoz igazodik) */ h: number | null;
  collapsed: boolean;
  docked: boolean;
}
export const WIN_DEFAULT: WinState = { x: 12, y: 12, w: 300, h: null, collapsed: false, docked: false };
export const WIN_MIN_W = 220;
const HEAD = 34;

/** Beolvasás a tárolt értékből, hibás mezők helyett alapértékkel. */
export function parseWin(raw: unknown): WinState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, n = (v: unknown, d: number) => typeof v === 'number' && isFinite(v) ? v : d;
  return {
    x: n(r.x, WIN_DEFAULT.x), y: n(r.y, WIN_DEFAULT.y), w: Math.max(WIN_MIN_W, n(r.w, WIN_DEFAULT.w)),
    h: typeof r.h === 'number' && isFinite(r.h) && r.h > 40 ? r.h : null,
    collapsed: r.collapsed === true, docked: r.docked === true,
  };
}

/** Az ablak a területen belül marad: legalább a címsora és egy darab belőle látszik. */
export function clampWin(s: WinState, area: { w: number; h: number }): WinState {
  const w = Math.max(WIN_MIN_W, Math.min(s.w, Math.max(WIN_MIN_W, area.w - 16)));
  const x = Math.max(-w + 80, Math.min(s.x, area.w - 80));
  const y = Math.max(0, Math.min(s.y, Math.max(0, area.h - HEAD)));
  return { ...s, w, x, y };
}

export interface FloatWinOpts {
  win: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  /** a terület, amelyben lebeg (pozícionált elem) */
  area: HTMLElement;
  load(): WinState;
  save(s: WinState): void;
  /** rögzítés / leválasztás után (a gazda áthelyezi a tartalmat) */
  onDock(docked: boolean): void;
  /** kisképernyős mód: nem húzható, a területhez igazodik */
  compact(): boolean;
}
export interface FloatWin {
  state(): WinState;
  /** látszik-e (lebegő módban csak kijelöléskor) */
  show(v: boolean): void;
  collapse(on?: boolean): void;
  dock(on?: boolean): void;
  /** újraigazítás (pl. a terület méretének változásakor) */
  place(): void;
}

export function mountFloatWin(o: FloatWinOpts): FloatWin {
  let st = o.load(), shown = false;
  const area = () => ({ w: o.area.clientWidth, h: o.area.clientHeight });
  function place() {
    const c = o.compact();
    o.win.classList.toggle('compact', c);
    o.win.classList.toggle('collapsed', st.collapsed);
    o.win.hidden = st.docked || !shown;
    if (c) { o.win.style.cssText = ''; o.body.style.height = ''; o.body.style.width = ''; return; }
    st = clampWin(st, area());
    o.win.style.right = st.x + 'px'; o.win.style.top = st.y + 'px'; o.body.style.width = st.w + 'px';
    o.body.style.height = st.h && !st.collapsed ? st.h + 'px' : '';
  }
  const store = () => o.save(st);
  // húzás a címsornál (a gombok kivételével)
  o.head.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button') || o.compact() || e.button !== 0) return;
    e.preventDefault(); o.head.setPointerCapture(e.pointerId); o.win.classList.add('dragging');
    const x0 = e.clientX, y0 = e.clientY, s0 = { ...st };
    const mv = (ev: PointerEvent) => { st = clampWin({ ...s0, x: s0.x - (ev.clientX - x0), y: s0.y + (ev.clientY - y0) }, area()); place(); };
    const up = () => { o.win.classList.remove('dragging'); o.head.removeEventListener('pointermove', mv); o.head.removeEventListener('pointerup', up); o.head.removeEventListener('pointercancel', up); store(); };
    o.head.addEventListener('pointermove', mv); o.head.addEventListener('pointerup', up); o.head.addEventListener('pointercancel', up);
  });
  o.head.addEventListener('dblclick', e => { if (!(e.target as HTMLElement).closest('button')) api.collapse(); });
  // méretezés: a tartalom alsó-jobb sarkánál (CSS resize), a végén elmentve
  if (typeof ResizeObserver !== 'undefined') {
    let t: ReturnType<typeof setTimeout> | undefined;
    new ResizeObserver(() => {
      if (o.win.hidden || st.collapsed || o.compact() || !o.win.classList.contains('resized')) return;
      clearTimeout(t); t = setTimeout(() => { st = { ...st, w: Math.round(o.body.offsetWidth), h: Math.round(o.body.offsetHeight) }; store(); }, 150);
    }).observe(o.body);
    o.body.addEventListener('pointerdown', e => { const r = o.body.getBoundingClientRect(); if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) o.win.classList.add('resized'); });
  }
  const api: FloatWin = {
    state: () => ({ ...st }),
    show(v) { shown = v; place(); },
    collapse(on) { st = { ...st, collapsed: on == null ? !st.collapsed : on }; place(); store(); },
    dock(on) { const d = on == null ? !st.docked : on; if (d === st.docked) return; st = { ...st, docked: d, collapsed: false }; place(); store(); o.onDock(d); },
    place,
  };
  place();
  return api;
}
