/**
 * Egyszerűsített elemző a kód → program visszairányhoz: az Arduino (C++) és a MicroPython vázlatok szokásos
 * részhalmaza közös szintaxisfába (AST). Nem teljes fordító: a nem ismert szerkezetet átugorja, és sorszámmal
 * jelzi (`skipped`). DOM-mentes.
 */

export type Expr =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'name'; n: string; line: number }
  | { k: 'call'; f: Expr; args: Expr[]; line: number }
  | { k: 'attr'; o: Expr; n: string; line: number }
  | { k: 'index'; o: Expr; i: Expr; line: number }
  | { k: 'un'; op: string; a: Expr; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'tern'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'list'; items: Expr[]; line: number };

export type Stmt =
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'assign'; t: Expr; op: string; v: Expr | null; line: number; decl?: boolean }
  | { k: 'global'; names: string[]; line: number }
  | { k: 'if'; c: Expr; a: Stmt[]; b: Stmt[]; line: number }
  | { k: 'while'; c: Expr; body: Stmt[]; line: number }
  | { k: 'for'; init: Stmt[]; c: Expr | null; step: Stmt[]; body: Stmt[]; line: number }
  | { k: 'ret'; v: Expr | null; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number };

export interface Func { params: string[]; body: Stmt[]; line: number }
export interface Parsed { top: Stmt[]; funcs: Map<string, Func>; skipped: Array<{ line: number; text: string }> }

interface Tok { t: 'num' | 'str' | 'id' | 'op' | 'nl' | 'indent' | 'dedent' | 'eof' | 'pp'; v: string; line: number }

const OPS = ['<<=', '>>=', '**', '//', '->', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ',', ';', '.', '(', ')', '[', ']', '{', '}'];

/** Tokenekre bontás. Pythonnál a behúzásból INDENT/DEDENT, a zárójeleken belül a sortörés nem számít. */
function lex(src: string, py: boolean): Tok[] {
  const out: Tok[] = [], ind = [0];
  let i = 0, line = 1, depth = 0, bol = true;
  const push = (t: Tok['t'], v: string) => out.push({ t, v, line });
  while (i < src.length) {
    if (py && bol && depth === 0) {
      let w = 0, j = i;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) { w += src[j] === '\t' ? 4 : 1; j++; }
      if (src[j] === '\n' || src[j] === '#' || src[j] === '\r' || j >= src.length) { i = j; bol = false; continue; }
      if (w > ind[ind.length - 1]) { ind.push(w); push('indent', ''); }
      while (w < ind[ind.length - 1]) { ind.pop(); push('dedent', ''); }
      i = j; bol = false; continue;
    }
    const c = src[i];
    if (c === '\n') { if (py && depth === 0 && out.length && out[out.length - 1].t !== 'nl') push('nl', ''); line++; i++; bol = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (py && c === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
    if (py ? c === '#' : src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (!py && src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue; }
    if (!py && c === '#') { let j = i; while (j < src.length && src[j] !== '\n') { if (src[j] === '\\' && src[j + 1] === '\n') { j += 2; line++; continue; } j++; } push('pp', src.slice(i, j)); i = j; continue; }
    if (py && (src.startsWith('"""', i) || src.startsWith("'''", i))) { const q = src.slice(i, i + 3), e = src.indexOf(q, i + 3), end = e < 0 ? src.length : e + 3; const s = src.slice(i + 3, end - 3); line += (src.slice(i, end).match(/\n/g) || []).length; push('str', s); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { s += src[j + 1] ?? ''; j += 2; } else s += src[j++]; }
      push('str', s); i = j + 1; continue;
    }
    const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)[uUlLfF]*/.exec(src.slice(i, i + 40));
    if (m && /[\d.]/.test(c) && !(c === '.' && !/\d/.test(src[i + 1] || ''))) {
      const s = m[1]; push('num', String(/^0[bB]/.test(s) ? parseInt(s.slice(2), 2) : Number(s))); i += m[0].length; continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i, i + 80));
    if (id) { push('id', id[0]); i += id[0].length; continue; }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { if ('([{'.includes(op)) depth++; if (')]}'.includes(op)) depth = Math.max(0, depth - 1); push('op', op); i += op.length; continue; }
    i++; // ismeretlen karakter
  }
  if (py) { if (out.length && out[out.length - 1].t !== 'nl') push('nl', ''); while (ind.length > 1) { ind.pop(); push('dedent', ''); } }
  push('eof', '');
  return out;
}

const C_TYPES = new Set(['const', 'static', 'volatile', 'unsigned', 'signed', 'int', 'long', 'short', 'byte', 'bool', 'boolean', 'float', 'double', 'char', 'void', 'auto', 'constexpr', 'String', 'size_t', 'word',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'pin_size_t', 'PinStatus', 'register', 'inline', 'extern']);

class P {
  i = 0;
  readonly skipped: Array<{ line: number; text: string }> = [];
  readonly funcs = new Map<string, Func>();
  constructor(readonly toks: Tok[], readonly py: boolean, readonly src: string[]) {}
  get cur(): Tok { return this.toks[this.i]; }
  end(): boolean { return this.toks[this.i].t === 'eof'; }
  peek(n = 1): Tok { return this.toks[Math.min(this.i + n, this.toks.length - 1)]; }
  is(v: string, t: Tok['t'] = 'op'): boolean { return this.cur.t === t && this.cur.v === v; }
  isId(v: string): boolean { return this.is(v, 'id'); }
  eat(v: string, t: Tok['t'] = 'op'): boolean { if (this.is(v, t)) { this.i++; return true; } return false; }
  need(v: string, t: Tok['t'] = 'op'): void { if (!this.eat(v, t)) throw new SyntaxError(`"${v}" ${this.cur.line}`); }
  skipLine(line: number): void { this.skipped.push({ line, text: (this.src[line - 1] || '').trim() }); }

  /* ---------- kifejezések (közös, a nyelvi különbségekkel) ---------- */
  expr(): Expr { return this.tern(); }
  tern(): Expr {
    const line = this.cur.line;
    if (this.py) {
      const a = this.or();
      if (this.eat('if', 'id')) { const c = this.or(); this.need('else', 'id'); const b = this.tern(); return { k: 'tern', c, a, b, line }; }
      return a;
    }
    const c = this.or();
    if (this.eat('?')) { const a = this.tern(); this.need(':'); const b = this.tern(); return { k: 'tern', c, a, b, line }; }
    return c;
  }
  bin(next: () => Expr, ops: string[], pyOps: Record<string, string> = {}): Expr {
    let a = next();
    for (;;) {
      const t = this.cur;
      let op: string | null = null;
      if (t.t === 'op' && ops.includes(t.v)) op = t.v;
      else if (this.py && t.t === 'id' && pyOps[t.v]) op = pyOps[t.v];
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: next(), line: t.line };
    }
  }
  or(): Expr { return this.bin(() => this.and(), this.py ? [] : ['||'], { or: '||' }); }
  and(): Expr { return this.bin(() => this.not(), this.py ? [] : ['&&'], { and: '&&' }); }
  not(): Expr { if (this.py && this.isId('not')) { const line = this.cur.line; this.i++; return { k: 'un', op: '!', a: this.not(), line }; } return this.bor(); }
  bor(): Expr { return this.bin(() => this.bxor(), ['|']); }
  bxor(): Expr { return this.bin(() => this.band(), ['^']); }
  band(): Expr { return this.bin(() => this.eq(), ['&']); }
  eq(): Expr { return this.bin(() => this.rel(), ['==', '!=']); }
  rel(): Expr { return this.bin(() => this.shift(), ['<', '>', '<=', '>=']); }
  shift(): Expr { return this.bin(() => this.add(), ['<<', '>>']); }
  add(): Expr { return this.bin(() => this.mul(), ['+', '-']); }
  mul(): Expr { return this.bin(() => this.unary(), ['*', '/', '%', '//']); }
  unary(): Expr {
    const t = this.cur;
    if (t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '~' || t.v === '+')) { this.i++; const a = this.unary(); return t.v === '+' ? a : { k: 'un', op: t.v, a, line: t.line }; }
    if (!this.py && t.t === 'op' && (t.v === '++' || t.v === '--')) { this.i++; const a = this.unary(); return { k: 'call', f: { k: 'name', n: t.v === '++' ? '__preinc' : '__predec', line: t.line }, args: [a], line: t.line }; }
    // C típuskényszerítés: (int)x
    if (!this.py && t.t === 'op' && t.v === '(' && this.peek().t === 'id' && C_TYPES.has(this.peek().v) && this.peek(2).t === 'op' && (this.peek(2).v === ')' || this.peek(2).v === '*')) {
      this.i++; while (!this.is(')') && !this.end()) this.i++; this.need(')'); return this.unary();
    }
    let e = this.pow();
    return e;
  }
  pow(): Expr { const a = this.postfix(); if (this.py && this.is('**')) { const line = this.cur.line; this.i++; return { k: 'bin', op: '**', a, b: this.unary(), line }; } return a; }
  postfix(): Expr {
    let e = this.atom();
    for (;;) {
      const line = this.cur.line;
      if (this.eat('(')) { const args: Expr[] = []; while (!this.is(')') && !this.end()) { if (this.py && this.cur.t === 'id' && this.peek().t === 'op' && this.peek().v === '=') this.i += 2; args.push(this.expr()); if (!this.eat(',')) break; } this.need(')'); e = { k: 'call', f: e, args, line }; }
      else if (this.eat('[')) { const i = this.expr(); this.need(']'); e = { k: 'index', o: e, i, line }; }
      else if (this.eat('.') || (!this.py && this.eat('->'))) { const n = this.cur.v; this.i++; e = { k: 'attr', o: e, n, line }; }
      else if (!this.py && (this.is('++') || this.is('--'))) { const v = this.cur.v; this.i++; e = { k: 'call', f: { k: 'name', n: v === '++' ? '__postinc' : '__postdec', line }, args: [e], line }; }
      else return e;
    }
  }
  atom(): Expr {
    const t = this.cur, line = t.line;
    if (t.t === 'num') { this.i++; return { k: 'num', v: Number(t.v), line }; }
    if (t.t === 'str') { this.i++; let v = t.v; while (this.cur.t === 'str') { v += this.cur.v; this.i++; } return { k: 'str', v, line }; }
    if (t.t === 'id') { this.i++; return { k: 'name', n: t.v, line }; }
    if (this.eat('(')) { if (this.eat(')')) return { k: 'list', items: [], line }; const e = this.expr(); if (this.is(',')) { const items = [e]; while (this.eat(',') && !this.is(')')) items.push(this.expr()); this.need(')'); return { k: 'list', items, line }; } this.need(')'); return e; }
    if (this.eat('[') || this.eat('{')) {
      const close = this.toks[this.i - 1].v === '[' ? ']' : '}', items: Expr[] = [];
      while (!this.is(close) && !this.end()) { items.push(this.expr()); if (!this.eat(',')) break; }
      this.need(close); return { k: 'list', items, line };
    }
    throw new SyntaxError(`${t.v} ${line}`);
  }

  /** Értékadás vagy kifejezés-utasítás (az értékadás C-ben a for fejében is). */
  simple(): Stmt {
    const line = this.cur.line, lhs = this.expr();
    const t = this.cur;
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.i++;
      return { k: 'assign', t: lhs, op: t.v, v: this.expr(), line };
    }
    if (lhs.k === 'call' && lhs.f.k === 'name' && /^__(pre|post)(inc|dec)$/.test(lhs.f.n)) return { k: 'assign', t: lhs.args[0], op: /inc$/.test(lhs.f.n) ? '+=' : '-=', v: { k: 'num', v: 1, line }, line };
    return { k: 'expr', e: lhs, line };
  }

  /* ---------- C ---------- */
  cTop(): Stmt[] {
    const top: Stmt[] = [];
    while (!this.end()) {
      const line = this.cur.line;
      try {
        if (this.cur.t === 'pp') {
          const m = /^#\s*define\s+([A-Za-z_]\w*)\s+(.+)$/.exec(this.cur.v.trim());
          this.i++;
          if (m) { const sub = new P(lex(m[2], false), false, this.src); try { top.push({ k: 'assign', t: { k: 'name', n: m[1], line }, op: '=', v: fixLine(sub.expr(), line), line }); } catch { this.skipLine(line); } }
          continue;
        }
        if (this.eat(';')) continue;
        if (this.isId('enum') || this.isId('struct') || this.isId('class') || this.isId('typedef') || this.isId('namespace') || this.isId('using')) { this.skipLine(line); this.skipDecl(); continue; }
        top.push(...this.cDecl(true));
      } catch { this.skipLine(line); this.recover(); }
    }
    return top;
  }
  skipDecl(): void { let d = 0; while (!this.end()) { if (this.is('{')) d++; if (this.is('}')) { d--; if (d <= 0) { this.i++; this.eat(';'); return; } } if (this.is(';') && d === 0) { this.i++; return; } this.i++; } }
  recover(): void { let d = 0; while (!this.end()) { if (this.is('{')) d++; if (this.is('}')) { if (d <= 1) { this.i++; return; } d--; } if (this.is(';') && d === 0) { this.i++; return; } this.i++; } }
  isTypeStart(): boolean { return this.cur.t === 'id' && C_TYPES.has(this.cur.v) || (this.cur.t === 'id' && this.peek().t === 'id' && /^[A-Z]/.test(this.cur.v) && !['HIGH', 'LOW'].includes(this.cur.v)); }
  /** Deklaráció (változó vagy függvény) – a típusszavak után a név. */
  cDecl(top: boolean): Stmt[] {
    while (this.cur.t === 'id' && (C_TYPES.has(this.cur.v) || (this.peek().t === 'id' || (this.peek().t === 'op' && this.peek().v === '*')) && /^[A-Z]/.test(this.cur.v))) { this.i++; while (this.eat('*') || this.eat('&')); }
    const out: Stmt[] = [];
    for (;;) {
      const line = this.cur.line;
      while (this.eat('*') || this.eat('&'));
      if (this.cur.t !== 'id') throw new SyntaxError('decl');
      const name = this.cur.v; this.i++;
      if (top && this.is('(')) { // függvény
        this.i++; const params: string[] = [];
        while (!this.is(')') && !this.end()) { let last = ''; while (!this.is(',') && !this.is(')') && !this.end()) { if (this.cur.t === 'id') last = this.cur.v; this.i++; } if (last && last !== 'void') params.push(last); this.eat(','); }
        this.need(')');
        if (this.eat(';')) return out; // előzetes deklaráció
        this.funcs.set(name, { params, body: this.cBlock(), line });
        return out;
      }
      let arr = false;
      while (this.eat('[')) { arr = true; while (!this.is(']') && !this.end()) this.i++; this.need(']'); }
      if (this.eat('=')) out.push({ k: 'assign', t: { k: 'name', n: name, line }, op: '=', v: this.expr(), line, decl: true });
      else out.push({ k: 'assign', t: { k: 'name', n: name, line }, op: '=', v: arr ? { k: 'list', items: [], line } : { k: 'num', v: 0, line }, line, decl: true });
      if (this.eat(',')) continue;
      this.need(';');
      return out;
    }
  }
  cBlock(): Stmt[] {
    if (!this.eat('{')) return this.cStmt();
    const body: Stmt[] = [];
    while (!this.is('}') && !this.end()) {
      const line = this.cur.line;
      try { body.push(...this.cStmt()); } catch { this.skipLine(line); this.recover(); }
    }
    this.need('}');
    return body;
  }
  cStmt(): Stmt[] {
    const line = this.cur.line;
    if (this.eat(';')) return [];
    if (this.is('{')) return this.cBlock();
    if (this.eat('if', 'id')) { this.need('('); const c = this.expr(); this.need(')'); const a = this.cBlock(); const b = this.eat('else', 'id') ? this.cBlock() : []; return [{ k: 'if', c, a, b, line }]; }
    if (this.eat('while', 'id')) { this.need('('); const c = this.expr(); this.need(')'); return [{ k: 'while', c, body: this.cBlock(), line }]; }
    if (this.eat('do', 'id')) { const body = this.cBlock(); this.need('while', 'id'); this.need('('); const c = this.expr(); this.need(')'); this.eat(';'); return [...body, { k: 'while', c, body, line }]; }
    if (this.eat('for', 'id')) {
      this.need('(');
      const init = this.is(';') ? [] : this.isTypeStart() ? this.cDeclNoSemi() : [this.simple()];
      this.need(';');
      const c = this.is(';') ? null : this.expr(); this.need(';');
      const step: Stmt[] = []; while (!this.is(')')) { step.push(this.simple()); if (!this.eat(',')) break; }
      this.need(')');
      return [{ k: 'for', init, c, step, body: this.cBlock(), line }];
    }
    if (this.eat('return', 'id')) { const v = this.is(';') ? null : this.expr(); this.need(';'); return [{ k: 'ret', v, line }]; }
    if (this.eat('break', 'id')) { this.eat(';'); return [{ k: 'break', line }]; }
    if (this.eat('continue', 'id')) { this.eat(';'); return [{ k: 'continue', line }]; }
    if (this.isId('switch')) throw new SyntaxError('switch');
    if (this.isTypeStart()) return this.cDecl(false);
    const s = this.simple(); this.need(';'); return [s];
  }
  cDeclNoSemi(): Stmt[] {
    while (this.cur.t === 'id' && C_TYPES.has(this.cur.v)) this.i++;
    const out: Stmt[] = [];
    for (;;) { const line = this.cur.line, name = this.cur.v; this.i++; this.need('='); out.push({ k: 'assign', t: { k: 'name', n: name, line }, op: '=', v: this.expr(), line, decl: true }); if (!this.eat(',')) return out; }
  }

  /* ---------- Python ---------- */
  pyBlock(): Stmt[] {
    if (!this.is('', 'nl')) return this.pyLine(); // egysoros: if x: y
    this.i++; this.need('', 'indent');
    const body: Stmt[] = [];
    while (!this.is('', 'dedent') && !this.end()) {
      const line = this.cur.line;
      try { body.push(...this.pyStmt()); } catch { this.skipLine(line); this.pyRecover(); }
    }
    this.eat('', 'dedent');
    return body;
  }
  pyRecover(): void { while (this.cur.t !== 'nl' && !this.end()) this.i++; this.eat('', 'nl'); if (this.is('', 'indent')) { let d = 0; do { if (this.is('', 'indent')) d++; if (this.is('', 'dedent')) d--; this.i++; } while (d > 0 && !this.end()); } }
  pyLine(): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      const line = this.cur.line;
      if (this.eat('pass', 'id')) { /* üres */ }
      else if (this.eat('break', 'id')) out.push({ k: 'break', line });
      else if (this.eat('continue', 'id')) out.push({ k: 'continue', line });
      else if (this.eat('return', 'id')) out.push({ k: 'ret', v: this.is('', 'nl') || this.is(';') ? null : this.expr(), line });
      else if (this.isId('global') || this.isId('nonlocal')) { this.i++; const names: string[] = []; while (this.cur.t === 'id') { names.push(this.cur.v); this.i++; if (!this.eat(',')) break; } out.push({ k: 'global', names, line }); }
      else if (this.isId('import') || this.isId('from') || this.isId('del') || this.isId('assert') || this.isId('raise')) { while (!this.is('', 'nl') && !this.is(';') && !this.end()) this.i++; }
      else out.push(this.simple());
      if (!this.eat(';') || this.is('', 'nl')) break;
    }
    this.eat('', 'nl');
    return out;
  }
  pyStmt(): Stmt[] {
    const line = this.cur.line;
    if (this.eat('def', 'id')) {
      const name = this.cur.v; this.i++; this.need('(');
      const params: string[] = [];
      while (!this.is(')')) { if (this.cur.t === 'id') params.push(this.cur.v); this.i++; if (this.eat('=')) this.expr(); this.eat(','); }
      this.need(')'); if (this.eat('->')) this.expr(); this.need(':');
      this.funcs.set(name, { params, body: this.pyBlock(), line });
      return [];
    }
    if (this.eat('class', 'id') || this.eat('with', 'id')) { this.skipLine(line); this.pyRecover(); return []; }
    if (this.eat('if', 'id')) return [this.pyIf(line)];
    if (this.eat('while', 'id')) { const c = this.expr(); this.need(':'); return [{ k: 'while', c, body: this.pyBlock(), line }]; }
    if (this.eat('for', 'id')) {
      const v = this.cur.v; this.i++; this.need('in', 'id'); const it = this.expr(); this.need(':');
      const body = this.pyBlock(), V = (n: string): Expr => ({ k: 'name', n, line });
      if (it.k === 'call' && it.f.k === 'name' && it.f.n === 'range') {
        const a = it.args.length > 1 ? it.args[0] : { k: 'num', v: 0, line } as Expr, b = it.args.length > 1 ? it.args[1] : it.args[0], st = it.args[2] || { k: 'num', v: 1, line } as Expr;
        const neg = st.k === 'un' && st.op === '-' || st.k === 'num' && st.v < 0;
        return [{ k: 'for', init: [{ k: 'assign', t: V(v), op: '=', v: a, line }], c: { k: 'bin', op: neg ? '>' : '<', a: V(v), b, line }, step: [{ k: 'assign', t: V(v), op: '+=', v: st, line }], body, line }];
      }
      // for x in lista: rejtett index
      const ix = `__i${line}`, ls = `__l${line}`;
      return [{ k: 'assign', t: V(ls), op: '=', v: it, line }, { k: 'for', init: [{ k: 'assign', t: V(ix), op: '=', v: { k: 'num', v: 0, line }, line }],
        c: { k: 'bin', op: '<', a: V(ix), b: { k: 'call', f: V('len'), args: [V(ls)], line }, line }, step: [{ k: 'assign', t: V(ix), op: '+=', v: { k: 'num', v: 1, line }, line }],
        body: [{ k: 'assign', t: V(v), op: '=', v: { k: 'index', o: V(ls), i: V(ix), line }, line }, ...body], line }];
    }
    if (this.eat('try', 'id')) {
      this.need(':'); const body = this.pyBlock();
      while (this.isId('except') || this.isId('finally') || this.isId('else')) { while (!this.is(':')) this.i++; this.need(':'); this.pyBlock(); }
      return body;
    }
    return this.pyLine();
  }
  pyIf(line: number): Stmt {
    const c = this.expr(); this.need(':');
    const a = this.pyBlock();
    let b: Stmt[] = [];
    if (this.isId('elif')) { const l2 = this.cur.line; this.i++; b = [this.pyIf(l2)]; }
    else if (this.eat('else', 'id')) { this.need(':'); b = this.pyBlock(); }
    return { k: 'if', c, a, b, line };
  }
  pyTop(): Stmt[] {
    const top: Stmt[] = [];
    while (!this.end()) {
      if (this.eat('', 'nl') || this.eat('', 'dedent') || this.eat('', 'indent')) continue;
      const line = this.cur.line;
      try { top.push(...this.pyStmt()); } catch { this.skipLine(line); this.pyRecover(); }
    }
    return top;
  }
}

function fixLine(e: Expr, line: number): Expr { return JSON.parse(JSON.stringify(e), (k, v) => (k === 'line' ? line : v)); }

/** Nyelv felismerése: Python-jelek (def, import, kettőspontos blokk) vagy C-jelek (kapcsos zárójel, pontosvessző). */
export function detectLang(src: string): 'arduino' | 'micropython' {
  const py = (src.match(/^\s*(def |import |from |while True:|elif |for \w+ in )/gm) || []).length + (src.match(/:\s*(#.*)?$/gm) || []).length;
  const c = (src.match(/[{};]\s*(\/\/.*)?$/gm) || []).length + (src.match(/^\s*#include|void\s+(setup|loop)\s*\(/gm) || []).length * 3;
  return py > c ? 'micropython' : 'arduino';
}

export function parseCode(src: string, lang: 'arduino' | 'micropython'): Parsed {
  const py = lang === 'micropython', p = new P(lex(src, py), py, src.split('\n'));
  const top = py ? p.pyTop() : p.cTop();
  return { top, funcs: p.funcs, skipped: p.skipped };
}
