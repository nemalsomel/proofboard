import { num, tpl } from './expr';
import type { CompiledPart, Env, LocalPin, PartDef, PartInstance, PinSpec, Rect } from './schema';

type HasProps = Pick<PartInstance, 'props' | 'label'>;

/** Kiértékelési környezet egy alkatrészpéldányhoz: paraméterek alapértékkel, korlátozva. */
export function penvD(def: PartDef, p: HasProps): Env {
  const pp = p.props || {};
  const e: Env = { label: p.label, $opt: {} };
  for (const pr of def.params || []) {
    if (pr.type === 'span') {
      let dr = Math.round(+(pp.dr ?? pr.default[0])) || 0;
      let dc = Math.round(+(pp.dc ?? pr.default[1])) || 0;
      if (!dr && !dc) [dr, dc] = pr.default;
      e.dr = dr; e.dc = dc;
      continue;
    }
    let v = pp[pr.key];
    if (v == null || v === '') v = pr.default;
    if (pr.options) {
      const o = pr.options.find(o => String(o.v) === String(v))
        || pr.options.find(o => String(o.v) === String(pr.default))
        || pr.options[0];
      e[pr.key] = o.v;
      e.$opt[pr.key] = o;
    } else {
      let n = Number(v);
      if (!isFinite(n)) n = pr.default;
      if (pr.type === 'int') n = Math.round(n);
      if (pr.min != null) n = Math.max(pr.min, n);
      if (pr.max != null) n = Math.min(pr.max, n);
      e[pr.key] = n;
    }
  }
  return e;
}

/** Leírásból futtatható alkatrész: lábak, belső kötések, test-téglalap. */
export function compilePart(type: string, def: PartDef): CompiledPart {
  const defaults: Record<string, any> = {};
  for (const pr of def.params || []) {
    if (pr.type === 'span') { defaults.dr = pr.default[0]; defaults.dc = pr.default[1]; }
    else defaults[pr.key] = pr.default;
  }
  const cache = new WeakMap<object, { key: string; pins: LocalPin[] }>();
  const mkPin = (sp: PinSpec, env: Record<string, unknown>): LocalPin => {
    const id = tpl(sp.id, env);
    const t = def.pinTable && def.pinTable[id];
    const name = sp.name != null ? tpl(sp.name, env) : t ? t[0] : id;
    const o: LocalPin = { id, name, lr: num(sp.lr, env), lc: num(sp.lc, env), role: sp.role || (t ? t[1] : 'h') };
    if (/^\d+$/.test(id)) o.num = +id;
    return o;
  };
  const pins = (p: PartInstance): LocalPin[] => {
    const key = JSON.stringify(p.props || {});
    const c = cache.get(p);
    if (c && c.key === key) return c.pins;
    const env = penvD(def, p);
    const out: LocalPin[] = [];
    for (const sp of def.pins) {
      if (sp.repeat != null) {
        const n = Math.max(0, Math.round(num(sp.repeat, env)));
        for (let i = 0; i < n; i++) out.push(mkPin(sp, { ...env, i }));
      } else out.push(mkPin(sp, env));
    }
    cache.set(p, { key, pins: out });
    return out;
  };
  const internal = (): Array<[string, string]> => {
    const o: Array<[string, string]> = [];
    for (const g of def.groups || []) for (const x of g.slice(1)) o.push([g[0], x]);
    return o;
  };
  const bounds = (p: PartInstance): Rect => {
    const b = def.bounds || { pad: 0.45 };
    const E = penvD(def, p);
    if (b.r && b.c) return { r0: num(b.r[0], E), r1: num(b.r[1], E), c0: num(b.c[0], E), c1: num(b.c[1], E) };
    const ps = pins(p), pad = b.pad ?? 0.45, rs = ps.map(q => q.lr), cs = ps.map(q => q.lc);
    let r0 = Math.min(...rs) - pad, r1 = Math.max(...rs) + pad, c0 = Math.min(...cs) - pad, c1 = Math.max(...cs) + pad;
    if (b.mid != null) {
      const mr = (rs[0] + rs[rs.length - 1]) / 2, mc = (cs[0] + cs[cs.length - 1]) / 2;
      r0 = Math.min(r0, mr - b.mid); r1 = Math.max(r1, mr + b.mid);
      c0 = Math.min(c0, mc - b.mid); c1 = Math.max(c1, mc + b.mid);
    }
    return { r0, r1, c0, c1 };
  };
  return { type, def, name: def.name, fp: def.fp, prefix: def.prefix, cat: def.cat || 'Egyéb', props: defaults, pins, internal, bounds };
}

export function compileAll(parts: Record<string, PartDef>): Record<string, CompiledPart> {
  const out: Record<string, CompiledPart> = {};
  for (const [k, d] of Object.entries(parts)) out[k] = compilePart(k, d);
  return out;
}
