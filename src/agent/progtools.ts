/**
 * Az agent (és az MCP-szerver) programeszközei: a blokkos program olvasása, szerkesztése, elrendezése, futtatása
 * idővonalon. A blokkok alkatrészlábra hivatkoznak („S1.A1”, „R1.1”); a GPIO-t a bekötés adja. A közös segédeket
 * a tools.ts adja át (így nincs körkörös betöltés).
 */
import type { Tr } from '../i18n/i18n';
import { simulateFor, traceProgram, type Press } from '../engine/headless';
import { addBlock, arrangeProgram, coerceProps, connectBlocks, disconnectBlocks, progOf, removeBlocks } from '../engine/progops';
import { NODE_DEFS, type PNode } from '../engine/program';
import { hasPress } from '../engine/defs';
import type { PartInstance } from '../core/schema';
import type { Design, PlacedPin } from '../engine/types';
import type { JsonSchema, ToolCtx, ToolDef, ToolResult } from './tools';

export interface ProgToolHelpers {
  ok(text: string, changed?: boolean): ToolResult; err(text: string): ToolResult; en: Tr;
  num(x: unknown): number | null; str(x: unknown): string;
  partOf(D: Design, label: string): PartInstance | null;
  pinOf(D: Design, ref: string): { p: PartInstance; q: PlacedPin; ref: string } | null;
  pinLabelOf(D: Design, ref: string): string;
  S: { str(d: string): JsonSchema; int(d: string): JsonSchema; num(d: string): JsonSchema; bool(d: string): JsonSchema; arr(i: JsonSchema, d: string): JsonSchema; obj(p: Record<string, JsonSchema>, r?: string[]): JsonSchema };
}

export function makeProgTools(h: ProgToolHelpers): ToolDef[] {
  const { ok, err, en, num, str, S } = h;
  const fmtVal = (v: unknown) => (typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : '–');
  const paramText = (D: Design, n: PNode) => NODE_DEFS[n.type].params.map(p => {
    const v = n.props[p.key];
    if (p.when && String(n.props[p.when.key]) !== p.when.is) return null;
    return `${p.key}=${p.type === 'pin' ? (v ? h.pinLabelOf(D, String(v)) : '(none)') : JSON.stringify(v)}${p.unit && p.type === 'number' ? p.unit : ''}`;
  }).filter(Boolean).join(', ');
  const blockOf = (D: Design, id: string) => (D.program ? D.program.nodes.find(n => n.id === id.trim()) : undefined);
  const changed = (ctx: ToolCtx, fit = false) => { ctx.commit(); if (ctx.showProgram) ctx.showProgram(fit); };
  const props = (D: Design, type: string, raw: unknown) => coerceProps(type, (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, s => { const q = h.pinOf(D, s); return q ? q.ref : null; });
  const programText = (D: Design): string => {
    const P = D.program; if (!P || !P.nodes.length) return 'The program is empty. Add blocks with add_block (see list_block_types).';
    const { prog } = simulateFor(D, { ms: 0 });
    const errs = prog ? prog.errors : new Map<string, string>();
    const L = [`Blocks (${P.nodes.length}):`];
    for (const n of P.nodes) { const d = NODE_DEFS[n.type], pt = paramText(D, n); L.push(`- ${n.id}: ${n.type} (${en(d.label)})${pt ? ' — ' + pt : ''}${errs.has(n.id) ? ' — PROBLEM: ' + en(errs.get(n.id)!) : ''}`); }
    L.push(P.edges.length ? `Connections (${P.edges.length}): ` + P.edges.map(e => `${e.from} → ${e.to}`).join('; ') : 'Connections: none');
    const free = P.nodes.flatMap(n => NODE_DEFS[n.type].ins.filter(p => !P.edges.some(e => e.to === n.id + '.' + p.id)).map(p => `${n.id}.${p.id}`));
    if (free.length) L.push('Unconnected inputs (read as 0/false): ' + free.join(', '));
    return L.join('\n');
  };
  const pressSchema: JsonSchema = { type: 'array', description: 'button presses during the run: [{ "button": "S1", "from_ms": 200, "to_ms": 400 }] (to_ms omitted = held to the end)', items: { type: 'object', properties: { button: S.str('button label'), from_ms: S.int('press start (ms)'), to_ms: S.int('release (ms)') }, required: ['button', 'from_ms'] } };

  return [
    {
      name: 'list_block_types', mutates: false,
      description: 'Block types of the visual program (shown in the Program view; firmware code is generated from it): inputs and outputs (id: bool|num), parameters (key, type, default, options) and what each block does.',
      input_schema: S.obj({}),
      run() {
        return ok(Object.entries(NODE_DEFS).map(([k, d]) => `${k} — ${en(d.label)} [${en(d.cat)}]: ${en(d.help)}\n  in: ${d.ins.map(p => `${p.id}:${p.kind}`).join(', ') || '–'}; out: ${d.outs.map(p => `${p.id}:${p.kind}`).join(', ') || '–'}; params: ${d.params.map(p => `${p.key} (${p.type}${p.options ? ': ' + p.options.map(o => o[0]).join('|') : ''}${p.unit ? ', ' + p.unit : ''}; default ${JSON.stringify(p.default)})`).join(', ') || '–'}`).join('\n') +
          '\nPins are part pins ("S1.A1", "R1.1" or a controller pin "PICO1.GP15"); the program follows the wiring to the GPIO. A bool output can drive a num input (0/1) and vice versa (> 0.5 = true).');
      },
    },
    {
      name: 'get_program', mutates: false,
      description: 'The visual block program: blocks (id, type, parameters, pin references, problems such as "pin not wired to a GPIO"), connections and unconnected inputs.',
      input_schema: S.obj({}),
      run(ctx) { return ok(programText(ctx.D())); },
    },
    {
      name: 'add_block', mutates: true,
      description: 'Add a block to the visual program (it appears in the Program view). Give parameters by key, pins as part pins ("S1.A1", "R1.1"). Returns the new block id (e.g. n3) to use in connect_blocks. Call arrange_program when done adding blocks.',
      input_schema: S.obj({ type: S.str('block type from list_block_types (e.g. "in", "blink", "toggle", "out", "pwm")'), params: { type: 'object', description: 'parameters, e.g. {"pin": "R1.1"} or {"period": 500}' } }, ['type']),
      run(ctx, i) {
        const D = ctx.D(), type = str(i.type); if (!NODE_DEFS[type]) return err(`Unknown block type "${type}". Use list_block_types.`);
        const pr = props(D, type, i.params); if ('error' in pr) return err(pr.error);
        const n = addBlock(D, type, pr.props)!; changed(ctx);
        const d = NODE_DEFS[type];
        return ok(`Added ${n.id}: ${type}${paramText(D, n) ? ' — ' + paramText(D, n) : ''}. Inputs: ${d.ins.map(p => `${n.id}.${p.id}`).join(', ') || 'none'}; outputs: ${d.outs.map(p => `${n.id}.${p.id}`).join(', ') || 'none'}.`, true);
      },
    },
    {
      name: 'set_block_params', mutates: true,
      description: 'Change parameters of a program block (e.g. period, pin, mode).',
      input_schema: S.obj({ block: S.str('block id, e.g. "n2"'), params: { type: 'object', description: 'parameters to change' } }, ['block', 'params']),
      run(ctx, i) {
        const D = ctx.D(), n = blockOf(D, str(i.block)); if (!n) return err(`No block "${str(i.block)}". Use get_program.`);
        const pr = props(D, n.type, i.params); if ('error' in pr) return err(pr.error);
        Object.assign(n.props, pr.props); changed(ctx);
        return ok(`${n.id}: ${paramText(D, n)}`, true);
      },
    },
    {
      name: 'connect_blocks', mutates: true,
      description: 'Connect a block output to a block input: from "n1.v" to "n2.a". An input takes one connection (an existing one is replaced).',
      input_schema: S.obj({ from: S.str('output, "block.port", e.g. "n1.v"'), to: S.str('input, "block.port", e.g. "n2.a"') }, ['from', 'to']),
      run(ctx, i) {
        const D = ctx.D(), r = connectBlocks(D, str(i.from).trim(), str(i.to).trim());
        if (typeof r === 'string') return err(r);
        changed(ctx); return ok(`Connected ${r.from} → ${r.to}.`, true);
      },
    },
    {
      name: 'disconnect_blocks', mutates: true,
      description: 'Remove the connection into a block input ("n2.a"), optionally only if it comes from a given output.',
      input_schema: S.obj({ to: S.str('input, e.g. "n2.a"'), from: S.str('output (optional)') }, ['to']),
      run(ctx, i) {
        const n = disconnectBlocks(ctx.D(), str(i.to).trim(), i.from ? str(i.from).trim() : undefined);
        if (!n) return err(`No connection into ${str(i.to)}.`);
        changed(ctx); return ok(`Removed ${n} connection.`, true);
      },
    },
    {
      name: 'remove_blocks', mutates: true,
      description: 'Delete program blocks (with their connections). Use ["all"] to clear the whole program.',
      input_schema: S.obj({ blocks: S.arr(S.str('block id'), 'block ids, or ["all"]') }, ['blocks']),
      run(ctx, i) {
        const D = ctx.D(), ids = Array.isArray(i.blocks) ? i.blocks.map(str) : [];
        const all = ids.length === 1 && ids[0] === 'all', list = all ? (D.program ? D.program.nodes.map(n => n.id) : []) : ids;
        const miss = all ? [] : list.filter(x => !blockOf(D, x)); if (miss.length) return err(`No block(s): ${miss.join(', ')}.`);
        const n = removeBlocks(D, list); changed(ctx); return ok(`Removed ${n} block(s).`, true);
      },
    },
    {
      name: 'arrange_program', mutates: true,
      description: 'Lay out the program blocks left to right in signal-flow order (inputs left, outputs right), so the Program view is easy to read. Call after adding or connecting blocks.',
      input_schema: S.obj({}),
      run(ctx) { const D = ctx.D(); if (!D.program || !D.program.nodes.length) return err('The program is empty.'); arrangeProgram(progOf(D)); changed(ctx, true); return ok('Program arranged.', true); },
    },
    {
      name: 'run_program', mutates: false,
      description: 'Run the block program in the simulator for some time, optionally pressing buttons at given times, and return a timeline: block outputs, GPIO levels (or PWM duty) and LEDs at regular sample points. Use it to verify the program (e.g. that an LED blinks at 2 Hz, or toggles on each press).',
      input_schema: S.obj({ ms: S.int('run time in ms (max 20000)'), presses: pressSchema, sample_ms: S.int('sample interval in ms (default: about 20 samples)') }, ['ms']),
      run(ctx, i) {
        const D = ctx.D(); if (!D.program || !D.program.nodes.length) return err('The program is empty.');
        const ms = Math.min(20000, Math.max(0, num(i.ms) ?? 0)), presses: Press[] = [];
        for (const x of (Array.isArray(i.presses) ? i.presses : []) as Array<Record<string, unknown>>) {
          const p = h.partOf(D, str(x.button)); if (!p || !hasPress(p)) return err(`"${str(x.button)}" is not a button.`);
          presses.push({ part: p.id, from: num(x.from_ms) ?? 0, to: x.to_ms == null ? undefined : num(x.to_ms) ?? undefined });
        }
        const tr = traceProgram(D, { ms, every: num(i.sample_ms) ?? undefined, presses });
        const keys = [...new Set(tr.samples.flatMap(s => Object.keys(s.vals)))], gk = [...new Set(tr.samples.flatMap(s => Object.keys(s.gpio)))], lk = [...new Set(tr.samples.flatMap(s => Object.keys(s.leds)))];
        const head = ['t(ms)', ...keys, ...gk, ...lk.map(l => l + '(lit)')];
        const rows = tr.samples.map(s => [String(s.t), ...keys.map(k => fmtVal(s.vals[k])), ...gk.map(k => s.gpio[k] ?? '–'), ...lk.map(k => (s.leds[k] ? '1' : '0'))]);
        const errs = [...tr.errors].map(([id, m]) => `${id}: ${en(m)}`);
        return ok([head.join(' | '), ...rows.map(r => r.join(' | '))].join('\n') + (errs.length ? '\nProblems: ' + errs.join('; ') : ''));
      },
    },
  ];
}
