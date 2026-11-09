/**
 * A panel interakciója: egér (lenyomás, húzás, felengedés eszközönként), érintés (koppintás, húzás, hosszú nyomás,
 * két ujjas nagyítás) és pásztázás. A gazda (`app.ts`) adja az állapotot (`ui`), a tervet és a műveleteket
 * (`InteractHost`); a modul maga csak a gesztusokat értelmezi és a tervet a megadott műveletekkel módosítja.
 * Kiemelve az app.ts-ből, a viselkedés változatlan; új: a csíkvágás (kézi és automatikus is) kijelölhető és törölhető.
 */
import type { Design, Hole, Note, PlacedPin } from '../engine/types';
import type { PartInstance } from '../core/schema';
import { cutAt, cutCheck, hitCut, removeCut, sameCut, toggleCut, type CutHit, type CutKind, type HolePoint } from '../engine/cuts';
import { placedPins } from '../engine/geometry';
import { t as tr } from '../i18n/i18n';
import { grp, gSize, groupApply, groupOk, groupSnap, hitBridge, hitNote, hitPart, noteCorner, type BoundsOf, type Group, type GroupSnap } from './hit';

/** Kijelölés a panelon. */
export type Selection = Group | { kind: 'wire'; i: number } | { kind: 'bridge'; i: number } | { kind: 'note'; id: string } | { kind: 'cut'; hit: CutHit };

/** Folyamatban lévő húzás. */
export type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'box'; h0: HolePoint; h1: HolePoint; add: boolean }
  | { kind: 'nmove' | 'nsize'; n: Note; h0: HolePoint; r0: number; c0: number; w0: number; h0n: number; pushed: boolean }
  | { kind: 'gmove'; h0: HolePoint; sn: GroupSnap; dr: number; dc: number; pushed: boolean; warned?: boolean }
  | { kind: 'move'; p: PartInstance; h0: HolePoint; r0: number; c0: number; pushed: boolean; warned?: boolean }
  | { kind: 'bridge'; last: [number, number]; n: number }
  | { kind: 'erase'; any: boolean };

/** Lerakás alatt álló alkatrész beállításai. */
export interface Ghost { rot: number; mir: boolean; props?: Record<string, unknown>; xray?: boolean; from?: string }

/** A felület állapotának az a része, amelyet az interakció olvas és ír. */
export interface InteractState {
  tool: string; /** 'comp' | 'cu' (rézoldal) */ view: string; sim: boolean; coarse?: boolean; space?: boolean;
  hover: HolePoint | null; sel: Selection | null; drag: Drag | null;
  placing: string | null; ghost: Ghost;
  wireStart: Hole | null; wireColor: string; linkStart: string | null;
  pressed: Record<string, boolean>; holdPtr: Map<number, string>;
  /** útvonal-újratervezés közben rejtett automatikus elemek: a kapcsolatok, vagy mind ('all') */ hideAuto: Set<string> | 'all' | null; moved?: Set<string> | null;
  zoom: number;
}

/** Pont a képernyőn (egér- vagy érintésesemény). */
export interface ScreenPt { clientX: number; clientY: number; pointerId?: number; shiftKey?: boolean }

export interface InteractHost {
  readonly ui: InteractState;
  /** a pillanatnyi terv (visszavonáskor lecserélődik, ezért függvény) */ D(): Design;
  readonly cv: HTMLCanvasElement;
  readonly scroll: HTMLElement;
  toHole(ev: ScreenPt): HolePoint;
  boundsOf: BoundsOf;
  inb(r: number, c: number): boolean;
  partFits(p: PartInstance): boolean;
  ghostPart(h: HolePoint): PartInstance;
  offPinAt(r: number, c: number): PlacedPin | null;
  hitPin(rf: number, cf: number): PlacedPin | null;
  hitWire(rf: number, cf: number): number;
  addBridge(r1: number, c1: number, r2: number, c2: number): boolean;
  hasPress(p: PartInstance): boolean;
  isOff(p: PartInstance): boolean;
  attachPlug(p: PartInstance): unknown;
  /** lerakáskor: a saját könyvtár alkatrésze a tervbe kerül, és a „legutóbbiak” közé */ placed(type: string): void;
  nextLabel(type: string): string;
  cutKind(): CutKind;
  pushUndo(): void;
  /** a visszavonási lépés eldobása (üres gesztus); a mentett pillanatkép */ dropUndo(): string | null;
  restoreSnap(s: string | null): void;
  commit(noRoute?: boolean): void;
  recompute(): void;
  save(): void;
  renderLeft(): void;
  draw(): void;
  status(): void;
  setTool(t: string): void;
  addNote(h: HolePoint): void;
  addLink(a: string, b: string): void;
  removeParts(ids: Iterable<string>): void;
  movedLinks(p: PartInstance): Set<string>;
  flashMsg(m: string): void;
  flashHint(m: string): void;
  /** nagyítás: a lyuktávolság pixelben, és az új nagyítás alkalmazása */ P(): number; resize(): void;
  toScreen(x: number, y: number): [number, number];
  hx(c: number): number; hy(r: number): number;
  sheetOpen(): boolean; closeSheet(): void;
  /** a jegyzet a panel körül ennyi lyuknyira mehet ki */ readonly NEXT: number;
}

export interface Interaction {
  onDown(ev: ScreenPt, hAt?: HolePoint): void;
  onMove(ev: ScreenPt, hAt?: HolePoint): void;
  endDrag(ev: ScreenPt): void;
  /** csíkvágás eszköznél a kurzor alatti (leendő) vágás */ cutAt(h: HolePoint): readonly [number, number, number];
  /** a kurzor alatti vágás (kézi vagy automatikus) */ hitCut(rf: number, cf: number): CutHit | null;
  /** vágás törlése (automatikusnál a hely tiltólistára kerül) */ deleteCut(hit: CutHit): void;
  /** a kijelölt vágás (a kijelölés kiemeléséhez) */ isSelCut(cut: readonly [number, number, number]): boolean;
  /** vászon- és görgetési figyelők felrakása */ attach(): void;
}

const PLACE_LIFT = 56; // px: lerakáskor ennyivel az ujj fölött az előnézet

export function createInteraction(H: InteractHost): Interaction {
  const ui = H.ui, cv = H.cv;
  const isGroup = (): boolean => !!ui.sel && ui.sel.kind === 'group';
  const G = () => ui.sel as Group;
  const cap = (ev: ScreenPt) => { if (ev.pointerId != null) cv.setPointerCapture(ev.pointerId); };
  const cutHere = (h: HolePoint) => cutAt(H.D().board, h, H.cutKind());
  const hitCutAt = (rf: number, cf: number, tol?: number) => hitCut(H.D(), rf, cf, tol ?? (ui.coarse ? 0.6 : 0.4));

  function deleteCut(hit: CutHit) {
    H.pushUndo(); removeCut(H.D(), hit);
    if (ui.sel && ui.sel.kind === 'cut') ui.sel = null;
    H.commit();
    if (hit.src === 'auto') H.flashHint(tr('Automatikus vágás törölve: ide nem kerül újra; ha kell, a program máshol vágja el a csíkot.'));
  }

  function eraseAt(h: HolePoint, click: boolean) {
    const D = H.D(), d = ui.drag as Extract<Drag, { kind: 'erase' }>;
    const order = ui_cu() ? ['bridge', 'wire', 'part'] : ['wire', 'part', 'bridge'];
    if (click) { const n = hitNote(D, h.rf, h.cf); if (n) { D.notes = D.notes.filter(x => x !== n); d.any = true; ui.sel = null; H.commit(true); return; } }
    for (const k of order) {
      if ((k === 'bridge' && ui_cu()) || (k === 'wire' && !ui_cu())) {
        const c = hitCutAt(h.rf, h.cf);
        if (c) { removeCut(D, c); d.any = true; ui.sel = null; H.commit(); if (c.src === 'auto' && click) H.flashHint(tr('Automatikus vágás törölve: ide nem kerül újra; ha kell, a program máshol vágja el a csíkot.')); return; }
      }
      if (k === 'wire') { const i = H.hitWire(h.rf, h.cf); if (i >= 0) { D.wires.splice(i, 1); d.any = true; ui.sel = null; H.commit(); return; } }
      if (k === 'bridge') { const i = hitBridge(D, h.rf, h.cf, ui.coarse ? 0.45 : 0.3); if (i >= 0) { D.bridges.splice(i, 1); d.any = true; ui.sel = null; H.commit(); return; } }
      if (k === 'part' && click) { const p = hitPart(D, H.boundsOf, h.rf, h.cf); if (p) { H.removeParts([p.id]); d.any = true; ui.sel = null; H.commit(); return; } }
    }
  }
  /** rézoldali nézet: a törlés sorrendje ettől függ (felül a híd és a vágás) */
  const ui_cu = () => ui.view === 'cu';

  /** Csíkvágás eszköz: ugyanoda kattintva a meglévő vágást törli (kézit és automatikusat is), különben új vágás. */
  function cutClick(h: HolePoint) {
    const D = H.D(), ct = cutHere(h);
    const exact = (D.cuts || []).some(x => sameCut(x, ct)) ? { src: 'manual' as const, cut: ct }
      : ((D.auto && D.auto.cuts) || []).some(x => sameCut(x, ct)) ? { src: 'auto' as const, cut: ct } : null;
    const hit = exact; // csak ugyanaz a vágás (helye és fajtája): a furat melletti rés külön tehető
    if (hit) { deleteCut(hit); return; }
    const ok = cutCheck(D.board, ct);
    if (ok === 'bad-hole') { H.flashMsg(tr('Ide nem tehető vágás')); return; }
    if (ok === 'nothing') { H.flashMsg(tr('Itt nincs mit elvágni (szekcióhatár vagy a csík vége)')); return; }
    H.pushUndo(); toggleCut(D, ct);
    H.commit();
  }

  function onDown(ev: ScreenPt, hAt?: HolePoint) {
    const D = H.D(), h = hAt || H.toHole(ev); ui.hover = h;
    if (ui.tool === 'pan') { ui.drag = { kind: 'pan', x: ev.clientX, y: ev.clientY }; cap(ev); return; }
    if (ui.sim) {
      const p = hitPart(D, H.boundsOf, h.rf, h.cf);
      if (!(p && H.hasPress(p))) { if (ui.tool === 'select') { ui.sel = p ? grp([p.id]) : null; H.renderLeft(); H.draw(); } return; }
      if (D.settings.btnMode === 'toggle') ui.pressed[p.id] = !ui.pressed[p.id];
      else { ui.pressed[p.id] = true; if (ev.pointerId != null) ui.holdPtr.set(ev.pointerId, p.id); cap(ev); }
      H.recompute(); return;
    }
    if (ui.placing) {
      const g = H.ghostPart(h); if (!H.partFits(g)) return;
      H.pushUndo(); H.placed(ui.placing);
      const p: PartInstance = { ...g, id: 'p' + (D.seq++), label: H.nextLabel(ui.placing) };
      if (!p.xray) delete p.xray;
      D.parts.push(p); if (H.isOff(p)) H.attachPlug(p);
      if (ev.shiftKey) { H.commit(); return; } // Shift: további példányok
      ui.sel = grp([p.id]); ui.placing = null; H.setTool('select'); H.commit(); return;
    }
    if (ui.tool === 'note') { H.addNote(h); return; }
    if (ui.tool === 'select') {
      { const n = hitNote(D, h.rf, h.cf); if (n && !ev.shiftKey) { ui.sel = { kind: 'note', id: n.id }; ui.drag = { kind: noteCorner(n, h.rf, h.cf) ? 'nsize' : 'nmove', n, h0: h, r0: n.r, c0: n.c, w0: n.w, h0n: n.h, pushed: false }; cap(ev); H.renderLeft(); H.draw(); return; } }
      const p = hitPart(D, H.boundsOf, h.rf, h.cf), sh = !!ev.shiftKey;
      if (p) {
        if (sh) { const g = isGroup() ? G() : grp(); if (g.parts.has(p.id)) g.parts.delete(p.id); else g.parts.add(p.id); ui.sel = gSize(g) ? g : null; H.renderLeft(); H.draw(); return; }
        if (!(isGroup() && G().parts.has(p.id))) ui.sel = grp([p.id]);
        ui.drag = { kind: 'gmove', h0: h, sn: groupSnap(D, G()), dr: 0, dc: 0, pushed: false }; cap(ev); H.renderLeft(); H.draw(); return;
      }
      const w = H.hitWire(h.rf, h.cf), b = w < 0 ? hitBridge(D, h.rf, h.cf, ui.coarse ? 0.45 : 0.3) : -1;
      if (w >= 0 || b >= 0) {
        if (sh || (isGroup() && (w >= 0 ? G().wires.has(w) : G().bridges.has(b)))) {
          const g = isGroup() ? G() : grp();
          if (sh) { if (w >= 0) { if (g.wires.has(w)) g.wires.delete(w); else g.wires.add(w); } else { if (g.bridges.has(b)) g.bridges.delete(b); else g.bridges.add(b); } ui.sel = gSize(g) ? g : null; H.renderLeft(); H.draw(); return; }
          ui.drag = { kind: 'gmove', h0: h, sn: groupSnap(D, g), dr: 0, dc: 0, pushed: false }; cap(ev); return;
        }
        ui.sel = w >= 0 ? { kind: 'wire', i: w } : { kind: 'bridge', i: b }; H.renderLeft(); H.draw(); return;
      }
      if (!sh) { const c = hitCutAt(h.rf, h.cf, ui.coarse ? 0.45 : 0.3); if (c) { ui.sel = { kind: 'cut', hit: c }; H.renderLeft(); H.draw(); return; } }
      ui.drag = { kind: 'box', h0: h, h1: h, add: sh }; cap(ev); return;
    }
    if (ui.tool === 'bridge') { if (!H.inb(h.r, h.c)) return; H.pushUndo(); ui.drag = { kind: 'bridge', last: [h.r, h.c], n: 0 }; cap(ev); return; }
    if (ui.tool === 'wire') {
      if (!H.inb(h.r, h.c) && !H.offPinAt(h.r, h.c)) return;
      if (!ui.wireStart) { ui.wireStart = [h.r, h.c]; H.draw(); return; }
      if (ui.wireStart[0] === h.r && ui.wireStart[1] === h.c) { ui.wireStart = null; H.draw(); return; }
      H.pushUndo(); D.wires.push({ a: ui.wireStart, b: [h.r, h.c], color: ui.wireColor }); ui.wireStart = null; H.commit(); return;
    }
    if (ui.tool === 'link') {
      const q = H.hitPin(h.rf, h.cf); if (!q) { ui.linkStart = null; H.renderLeft(); H.draw(); return; }
      const ref = q.part.id + '.' + q.id;
      if (!ui.linkStart || ui.linkStart === ref) { ui.linkStart = ui.linkStart === ref ? null : ref; H.renderLeft(); H.draw(); return; }
      H.addLink(ui.linkStart, ref); ui.linkStart = null; return;
    }
    if (ui.tool === 'cut') { if (!H.inb(h.r, h.c)) return; cutClick(h); return; }
    if (ui.tool === 'erase') { H.pushUndo(); ui.drag = { kind: 'erase', any: false }; cap(ev); eraseAt(h, true); return; }
  }

  function onMove(ev: ScreenPt, hAt?: HolePoint) {
    const D = H.D(), h = hAt || H.toHole(ev);
    const prev = ui.hover; ui.hover = h; const d = ui.drag;
    if (d && d.kind === 'pan') { const sc = H.scroll; sc.scrollLeft -= ev.clientX - d.x; sc.scrollTop -= ev.clientY - d.y; d.x = ev.clientX; d.y = ev.clientY; return; }
    if (d && d.kind === 'box') { d.h1 = h; H.draw(); return; }
    if (d && (d.kind === 'nmove' || d.kind === 'nsize')) {
      const dr = Math.round(h.rf - d.h0.rf), dc = Math.round(h.cf - d.h0.cf), NX = H.NEXT;
      const nr = d.kind === 'nmove' ? Math.max(-NX, Math.min(D.board.rows + NX - 2, d.r0 + dr)) : d.n.r, nc = d.kind === 'nmove' ? Math.max(-NX, Math.min(D.board.cols + NX - 2, d.c0 + dc)) : d.n.c;
      const nw = d.kind === 'nsize' ? Math.max(3, Math.min(60, d.w0 + dc)) : d.n.w, nh = d.kind === 'nsize' ? Math.max(2, Math.min(60, d.h0n + dr)) : d.n.h;
      if (nr !== d.n.r || nc !== d.n.c || nw !== d.n.w || nh !== d.n.h) { if (!d.pushed) { H.pushUndo(); d.pushed = true; } Object.assign(d.n, { r: nr, c: nc, w: nw, h: nh }); H.draw(); }
      return;
    }
    if (d && d.kind === 'gmove') {
      const ok = (dr: number, dc: number) => groupOk(d.sn, dr, dc, H.partFits, H.inb);
      let dr = h.r - d.h0.r, dc = h.c - d.h0.c, g = 0;
      while (!ok(dr, dc) && (dr || dc) && g++ < 300) { if (dr) dr -= Math.sign(dr); if (!ok(dr, dc) && dc) dc -= Math.sign(dc); }
      if (!ok(dr, dc)) { dr = d.dr; dc = d.dc; } else if ((h.r - d.h0.r !== dr || h.c - d.h0.c !== dc) && !d.warned) { d.warned = true; H.flashMsg(tr('Tovább nem mozdítható (panel széle)')); }
      if (dr !== d.dr || dc !== d.dc) {
        if (!d.pushed) { H.pushUndo(); d.pushed = true; if (D.settings.autoRoute && D.links.length) { const ids = new Set<string>(); for (const o of d.sn.parts) H.movedLinks(o.p).forEach(x => ids.add(x)); ui.hideAuto = ids; } }
        d.dr = dr; d.dc = dc; groupApply(D, d.sn, dr, dc); H.recompute(); H.renderLeft();
      }
    }
    if (d && d.kind === 'move') {
      let nr = d.r0 + (h.r - d.h0.r), nc = d.c0 + (h.c - d.h0.c);
      if (!H.partFits({ ...d.p, r: nr, c: nc })) {
        let g = 0;
        while (!H.partFits({ ...d.p, r: nr, c: nc }) && (nr !== d.p.r || nc !== d.p.c) && g++ < 200) { if (nr !== d.p.r) nr += Math.sign(d.p.r - nr); if (!H.partFits({ ...d.p, r: nr, c: nc }) && nc !== d.p.c) nc += Math.sign(d.p.c - nc); }
        if (!d.warned) { d.warned = true; H.flashMsg(tr('A panel szélénél tovább nem mozdítható')); }
      }
      if (nr !== d.p.r || nc !== d.p.c) {
        const t = { ...d.p, r: nr, c: nc };
        if (H.partFits(t)) { if (!d.pushed) { H.pushUndo(); d.pushed = true; if (D.settings.autoRoute && D.links.length) ui.hideAuto = H.movedLinks(d.p); } d.p.r = nr; d.p.c = nc; H.recompute(); H.renderLeft(); }
      }
    }
    if (d && d.kind === 'bridge' && H.inb(h.r, h.c)) {
      let [r, c] = d.last, guard = 0;
      while ((r !== h.r || c !== h.c) && guard++ < 200) { let nr = r, nc = c; if (r !== h.r) nr += Math.sign(h.r - r); else nc += Math.sign(h.c - c); if (H.addBridge(r, c, nr, nc)) d.n++; r = nr; c = nc; }
      d.last = [r, c]; if (d.n) H.recompute();
    }
    if (d && d.kind === 'erase') eraseAt(h, false);
    if (!prev || prev.r !== h.r || prev.c !== h.c || ui.placing || ui.wireStart || (ui.tool === 'cut' && String(cutHere(prev)) !== String(cutHere(h)))) { H.status(); H.draw(); } // csíkvágásnál a lyukon belül is követi, hová kerül
  }

  function endDrag(ev: ScreenPt) {
    const D = H.D();
    const pid = ev.pointerId != null ? ui.holdPtr.get(ev.pointerId) : undefined;
    if (pid) { ui.pressed[pid] = false; ui.holdPtr.delete(ev.pointerId!); H.recompute(); }
    const d = ui.drag; ui.drag = null; if (!d) return;
    if (d.kind === 'nmove' || d.kind === 'nsize') { if (d.pushed) { H.save(); H.renderLeft(); } return; }
    if (d.kind === 'move' && d.pushed) { ui.hideAuto = null; ui.moved = new Set([d.p.id]); H.commit(); }
    if (d.kind === 'gmove' && d.pushed) { ui.hideAuto = null; ui.moved = new Set(d.sn.parts.map(o => o.p.id)); H.commit(); }
    if (d.kind === 'box') {
      const r0 = Math.min(d.h0.rf, d.h1.rf), r1 = Math.max(d.h0.rf, d.h1.rf), c0 = Math.min(d.h0.cf, d.h1.cf), c1 = Math.max(d.h0.cf, d.h1.cf);
      const inR = (r: number, c: number) => r >= r0 - 0.5 && r <= r1 + 0.5 && c >= c0 - 0.5 && c <= c1 + 0.5;
      if (r1 - r0 < 0.5 && c1 - c0 < 0.5) { if (!d.add) ui.sel = null; }
      else {
        const g = d.add && isGroup() ? G() : grp();
        for (const p of D.parts) { const ps = placedPins(p); const mr = ps.reduce((s, q) => s + q.r, 0) / ps.length, mc = ps.reduce((s, q) => s + q.c, 0) / ps.length; if (inR(mr, mc)) g.parts.add(p.id); }
        D.bridges.forEach((b, i) => { if (inR(b[0], b[1]) && inR(b[2], b[3])) g.bridges.add(i); });
        D.wires.forEach((w, i) => { if (inR(w.a[0], w.a[1]) && inR(w.b[0], w.b[1])) g.wires.add(i); });
        ui.sel = gSize(g) ? g : null;
      }
      H.renderLeft(); H.draw();
    }
    if (d.kind === 'bridge') { if (d.n) H.commit(); else H.dropUndo(); }
    if (d.kind === 'erase' && !d.any) H.dropUndo();
  }

  /* ---------- Érintés: gesztusok ----------
     egy ujj: koppintás = kattintás; húzás alkatrészen = mozgatás, üres helyen = görgetés (híd/törlés eszköznél az eszköz);
     hosszan nyomva üres helyen = kijelölő keret; két ujj = nagyítás és görgetés (a félbehagyott művelet visszaáll);
     lerakáskor az előnézet az ujj fölött jár, felengedéskor kerül le. */
  type TPt = { x: number; y: number };
  const T: { pts: Map<number, TPt>; mode: null | 'pinch' | 'place' | 'pend' | 'active' | 'direct' | 'pan'; start: ScreenPt | null; timer: ReturnType<typeof setTimeout> | undefined; last: TPt | null;
    pinch: { d0: number; z0: number; bp: HolePoint; cx: number; cy: number } | null; raf: number } = { pts: new Map(), mode: null, start: null, timer: undefined, last: null, pinch: null, raf: 0 };
  const holeAt = (x: number, y: number) => H.toHole({ clientX: x, clientY: y });
  const liftHole = (ev: ScreenPt) => holeAt(ev.clientX, ev.clientY - PLACE_LIFT);
  function tCancel() {
    clearTimeout(T.timer);
    if (T.mode === 'active' && ui.drag) {
      const d = ui.drag; ui.drag = null;
      if ((d.kind === 'gmove' && d.pushed) || d.kind === 'bridge' || d.kind === 'erase') { H.restoreSnap(H.dropUndo()); ui.hideAuto = null; H.commit(true); } else H.draw();
    }
    if (T.mode === 'direct') { for (const [id, pid] of ui.holdPtr) { ui.pressed[pid] = false; ui.holdPtr.delete(id); } H.recompute(); }
    if (T.mode === 'place') { ui.hover = null; H.draw(); }
    T.mode = null; T.start = null;
  }
  function pinchStart() {
    const [a, b] = [...T.pts.values()], cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    T.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: ui.zoom, bp: holeAt(cx, cy), cx, cy }; T.mode = 'pinch';
  }
  function pinchMove() {
    if (T.raf) return;
    T.raf = requestAnimationFrame(() => {
      T.raf = 0; if (T.mode !== 'pinch' || T.pts.size < 2 || !T.pinch) return;
      const [a, b] = [...T.pts.values()], pc = T.pinch, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, z = Math.max(0.6, Math.min(2.6, pc.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pc.d0));
      if (Math.round(14 * z) !== H.P()) { ui.zoom = +z.toFixed(3); H.resize(); }
      const sc = H.scroll, rc = cv.getBoundingClientRect(), [vx, vy] = H.toScreen(H.hx(pc.bp.cf), H.hy(pc.bp.rf));
      sc.scrollLeft += rc.left + vx - cx; sc.scrollTop += rc.top + vy - cy;
    });
  }
  function tDown(ev: PointerEvent) {
    ui.coarse = true; if (H.sheetOpen() && T.pts.size === 0) H.closeSheet();
    T.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); try { cv.setPointerCapture(ev.pointerId); } catch { /* már elengedve */ }
    if (T.pts.size === 2) { tCancel(); pinchStart(); return; }
    if (T.pts.size > 2 || T.mode === 'pinch') return;
    const D = H.D(), h = H.toHole(ev); T.start = ev; T.last = { x: ev.clientX, y: ev.clientY };
    if (ui.sim) { const p = hitPart(D, H.boundsOf, h.rf, h.cf); if (p && H.hasPress(p)) { onDown(ev); T.mode = 'direct'; } else T.mode = 'pan'; return; }
    if (ui.placing) { ui.hover = liftHole(ev); T.mode = 'place'; H.status(); H.draw(); return; }
    T.mode = 'pend';
    if (ui.tool === 'select' && !hitPart(D, H.boundsOf, h.rf, h.cf))
      T.timer = setTimeout(() => {
        if (T.mode !== 'pend' || !T.start) return; T.mode = 'active';
        const h0 = H.toHole(T.start); ui.hover = h0; ui.drag = { kind: 'box', h0, h1: h0, add: false }; H.draw();
        if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* nem támogatott */ }
        H.flashHint(tr('Kijelölő keret: húzd az ujjad'));
      }, 450);
  }
  function tMove(ev: PointerEvent) {
    const pt = T.pts.get(ev.pointerId); if (!pt) return; pt.x = ev.clientX; pt.y = ev.clientY;
    if (T.mode === 'pinch') { pinchMove(); return; }
    if (T.mode === 'place') { ui.hover = liftHole(ev); H.status(); H.draw(); return; }
    if (T.mode === 'active' || T.mode === 'direct') { onMove(ev); return; }
    if (T.mode === 'pend' && T.start) {
      const s0 = T.start; if (Math.hypot(ev.clientX - s0.clientX, ev.clientY - s0.clientY) < 9) return; clearTimeout(T.timer);
      const D = H.D(), h = H.toHole(s0), onPart = !!hitPart(D, H.boundsOf, h.rf, h.cf) || !!hitNote(D, h.rf, h.cf);
      if ((ui.tool === 'select' && onPart) || ui.tool === 'bridge' || ui.tool === 'erase') { T.mode = 'active'; onDown(s0); onMove(ev); return; }
      T.mode = 'pan';
    }
    if (T.mode === 'pan' && T.last) { const sc = H.scroll; sc.scrollLeft -= ev.clientX - T.last.x; sc.scrollTop -= ev.clientY - T.last.y; T.last = { x: ev.clientX, y: ev.clientY }; }
  }
  function tUp(ev: PointerEvent, cancel?: boolean) {
    T.pts.delete(ev.pointerId);
    if (T.mode === 'pinch') { if (!T.pts.size) T.mode = null; return; }
    clearTimeout(T.timer); const m = T.mode; T.mode = null;
    if (cancel) { T.mode = m; tCancel(); return; }
    if (m === 'place') { const h = liftHole(ev); ui.hover = h; onDown(ev, h); H.draw(); }
    else if (m === 'pend' && T.start) { onDown(T.start); endDrag(ev); }
    else if (m === 'active' || m === 'direct') endDrag(ev);
    T.start = null;
  }

  /* pásztázás: középső gombbal, szóköz + húzással, vagy a panel melletti üres téren húzva */
  function panStart(ev: PointerEvent, el: HTMLElement) {
    ev.preventDefault(); const sc = H.scroll; let x = ev.clientX, y = ev.clientY; sc.classList.add('panning');
    try { el.setPointerCapture(ev.pointerId); } catch { /* már elengedve */ }
    const mv = (e: PointerEvent) => { sc.scrollLeft -= e.clientX - x; sc.scrollTop -= e.clientY - y; x = e.clientX; y = e.clientY; };
    const up = () => { sc.classList.remove('panning'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  function attach() {
    cv.addEventListener('pointerdown', ev => { if (ev.pointerType === 'touch') { ev.preventDefault(); tDown(ev); } else if (ev.button === 1 || ui.space) { panStart(ev, cv); } else { ui.coarse = false; onDown(ev); } });
    cv.addEventListener('pointermove', ev => { if (ev.pointerType === 'touch') tMove(ev); else onMove(ev); });
    cv.addEventListener('pointerup', ev => { if (ev.pointerType === 'touch') tUp(ev); else endDrag(ev); });
    cv.addEventListener('pointercancel', ev => { if (ev.pointerType === 'touch') tUp(ev, true); else endDrag(ev); });
    cv.addEventListener('contextmenu', ev => { if (ui.coarse) ev.preventDefault(); });
    cv.addEventListener('pointerleave', () => { if (!ui.drag) { ui.hover = null; H.status(); H.draw(); } });
    const sc = H.scroll;
    sc.addEventListener('pointerdown', ev => { if (ev.pointerType === 'touch') return; if ((ev.target === sc && ev.button === 0) || ev.button === 1) panStart(ev, sc); }, true);
  }

  return {
    onDown, onMove, endDrag, cutAt: cutHere, attach, deleteCut,
    hitCut: (rf, cf) => hitCutAt(rf, cf),
    isSelCut: ct => !!ui.sel && ui.sel.kind === 'cut' && sameCut(ui.sel.hit.cut, ct),
  };
}
