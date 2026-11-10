/**
 * Proofboard MCP-szerver: a Claude (MCP-kliens) a Proofboard eszközeivel (src/agent/tools.ts) dolgozik.
 * - Élő híd: ha a böngészőben megnyitott Proofboard kapcsolódik (Fájl › Claude-kapcsolat…), a hívások ott futnak, az
 *   élő terven – a felhasználó látja a változást, és visszavonhatja.
 * - Felület nélkül: ha nincs kapcsolódó app, egy memóriabeli terven (fájlba menthető, fájlból megnyitható).
 * A WebSocket csak a 127.0.0.1-en figyel, és csak a Proofboard oldaláról (Origin) fogad kapcsolatot.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_PORT, BRIDGE_PROTO, CALL_EXPORT, CALL_IMPORT, parseMsg, type AppMsg, type BridgeTool, type ServerMsg } from '../../src/agent/bridge';
import { engineCtx, runTool, TOOLS, type ToolResult } from '../../src/agent/tools';
import { syncDefs } from '../../src/engine/defs';
import { emptyDesign, normalize } from '../../src/engine/design';
import type { Design } from '../../src/engine/types';

export const APP_URL = 'https://nemalsomel.github.io/proofboard/';
const ALLOWED = ['https://nemalsomel.github.io'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface ServerOpts {
  version: string;
  /** a WebSocket-híd portja (0: véletlen szabad port, tesztekhez); null: nincs híd */ port?: number | null;
  /** további engedélyezett Origin-ek (pl. saját telepítés) */ origins?: string[];
  /** napló (stderr) */ log?: (s: string) => void;
  /** a hívás várakozási ideje (ms) */ callTimeout?: number;
}

const INSTRUCTIONS = `Proofboard is a perfboard/stripboard circuit designer and simulator. These tools build and check a design: place parts, connect pins (wiring is routed automatically), simulate, check problems, generate code.
Call bridge_status first. If the Proofboard app is connected, every change appears live in the user's browser and the user can undo it; otherwise you work on an in-memory design (save it with save_design_file, or ask the user to open ${APP_URL}, then File › Claude connection… › Connect).
Refer to parts by label ("R1") and pins as "R1.2" or "PICO1.GP15". Program behaviour (blinking, buttons, PWM, sequences) is built from blocks in the app's Program view (list_block_types, add_block, connect_blocks, arrange_program, run_program); generate_code makes firmware from it. Missing a part type? Copy a similar one (get_part_definition), edit and save it (save_custom_part). Place parts next to the pin they connect to (place_part "near"); keep layouts compact (plan_compaction / compact_layout). Ask before large changes or replacing the user's design.`;

const LOCAL_TOOLS = [
  { name: 'bridge_status', description: 'Whether the Proofboard app is connected (live editing in the user\'s browser) or the server works on an in-memory design. Call this first.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'open_design_file', description: 'Load a design from a Proofboard JSON file (as saved by the app\'s File › Save to file). Replaces the current design (in the app it can be undone).', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'file path' } }, required: ['path'], additionalProperties: false } },
  { name: 'save_design_file', description: 'Save the current design to a Proofboard JSON file (it can be opened in the app with File › Open).', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'file path, e.g. my-board.proofboard.json' } }, required: ['path'], additionalProperties: false } },
];

export function createProofboardServer(o: ServerOpts) {
  const log = o.log || (() => {});
  const head = engineCtx(emptyDesign());
  let app: WebSocket | null = null, appInfo = '', seq = 0;
  /** a kapcsolódó app eszközei (ha küldte): az app újabb lehet a szervernél, ilyenkor az ő listája számít */
  let appTools: BridgeTool[] | null = null;
  const pending = new Map<number, { res: (r: ToolResult) => void; timer: ReturnType<typeof setTimeout> }>();
  const mcp = new Server({ name: 'proofboard', version: o.version }, { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS });
  const toolList = (): BridgeTool[] => [...LOCAL_TOOLS, ...(app && appTools ? appTools : TOOLS)];
  const listChanged = () => { try { void mcp.sendToolListChanged().catch(() => {}); } catch { /* nincs még kliens */ } };
  const clientName = () => { const c = mcp.getClientVersion(); return c ? c.name : undefined; };
  const send = (ws: WebSocket, m: ServerMsg) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

  /** hívás továbbítása az apphoz */
  function forward(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const ws = app; if (!ws) return Promise.resolve({ text: 'The Proofboard app is not connected.', isError: true });
    const id = ++seq;
    return new Promise(res => {
      const timer = setTimeout(() => { pending.delete(id); res({ text: 'The Proofboard app did not answer in time (it may be busy or the tab is in the background).', isError: true }); }, o.callTimeout ?? 120000);
      pending.set(id, { res, timer });
      send(ws, { t: 'call', id, name, input });
    });
  }
  const dropPending = (why: string) => { for (const [id, p] of pending) { clearTimeout(p.timer); p.res({ text: why, isError: true }); pending.delete(id); } };

  async function call(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (name === 'bridge_status') return { text: app
      ? `Connected to the Proofboard app (${appInfo}). Changes appear live in the user's browser; the user sees a "Claude is working" bar and can undo each burst of changes with Ctrl+Z.`
      : `The Proofboard app is not connected: you are working on an in-memory design (${head.D().parts.length} parts). To edit live, ask the user to open ${APP_URL} and choose File › Claude connection… › Connect${o.port === BRIDGE_PORT || o.port == null ? '' : ` (port ${o.port})`}. Save your work with save_design_file.` };
    if (name === 'open_design_file') {
      const p = resolve(String(input.path || '')); let d: Design;
      try { d = normalize(JSON.parse(await readFile(p, 'utf8'))); } catch (e) { return { text: `Cannot open ${p}: ${(e as Error).message}`, isError: true }; }
      if (app) return forward(CALL_IMPORT, { design: d });
      syncDefs(d.customParts); head.setD(d); head.commit();
      return { text: `Opened ${p} (${d.parts.length} parts).`, changed: true };
    }
    if (name === 'save_design_file') {
      const p = resolve(String(input.path || '')); let json: string;
      if (app) { const r = await forward(CALL_EXPORT, {}); if (r.isError) return r; json = r.text; } else json = JSON.stringify(head.D(), null, 1);
      try { await writeFile(p, json); } catch (e) { return { text: `Cannot write ${p}: ${(e as Error).message}`, isError: true }; }
      return { text: `Saved to ${p}. Open it in the app with File › Open.` };
    }
    if (app) return forward(name, input);
    return runTool(head, name, input);
  }

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolList().map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema as { type: 'object'; [k: string]: unknown } })),
  }));
  mcp.setRequestHandler(CallToolRequestSchema, async req => {
    const r = await call(req.params.name, (req.params.arguments || {}) as Record<string, unknown>);
    return { content: [{ type: 'text' as const, text: r.text }, ...(r.image ? [{ type: 'image' as const, data: r.image, mimeType: 'image/png' }] : [])], isError: !!r.isError };
  });
  mcp.oninitialized = () => { const c = clientName(); if (c && app) send(app, { t: 'client', client: c }); };

  let wss: WebSocketServer | null = null;
  /** a híd indítása; a tényleges port (foglalt portnál null: csak felület nélkül) */
  function listen(): Promise<number | null> {
    if (o.port === null) return Promise.resolve(null);
    const okOrigin = (origin: string | undefined) => !origin || LOCAL.test(origin) || [...ALLOWED, ...(o.origins || [])].includes(origin);
    return new Promise(done => {
      const s = new WebSocketServer({ host: '127.0.0.1', port: o.port ?? BRIDGE_PORT, verifyClient: (info: { origin: string }) => okOrigin(info.origin) });
      s.on('error', e => { log(`Bridge not started (${(e as Error).message}); working without the app.`); wss = null; done(null); });
      s.on('listening', () => { wss = s; const a = s.address(); const port = typeof a === 'object' && a ? a.port : null; log(`Bridge listening on ws://127.0.0.1:${port}`); done(port); });
      s.on('connection', ws => {
        let hello = false;
        ws.on('message', data => {
          const m = parseMsg<AppMsg>(data); if (!m) return;
          if (m.t === 'hello') {
            if (m.proto !== BRIDGE_PROTO || m.app !== 'proofboard') { send(ws, { t: 'bye', reason: `Unsupported protocol ${m.proto}; update proofboard-mcp.` }); ws.close(); return; }
            if (app && app !== ws) { send(app, { t: 'bye', reason: 'Another Proofboard tab connected.' }); app.close(); }
            hello = true; app = ws; appInfo = `Proofboard ${m.version}, design: ${m.design}`; log(`App connected: ${appInfo}`);
            const before = JSON.stringify(toolList().map(t => t.name));
            appTools = Array.isArray(m.tools) && m.tools.length ? m.tools.filter(t => t && typeof t.name === 'string' && !LOCAL_TOOLS.some(l => l.name === t.name)) : null;
            if (JSON.stringify(toolList().map(t => t.name)) !== before) listChanged();
            send(ws, { t: 'welcome', proto: BRIDGE_PROTO, server: 'proofboard-mcp', version: o.version, client: clientName() });
          } else if (m.t === 'result' && hello) { const p = pending.get(m.id); if (p) { clearTimeout(p.timer); pending.delete(m.id); p.res(m.result); } }
        });
        ws.on('close', () => { if (app === ws) { const had = !!appTools; app = null; appTools = null; log('App disconnected.'); dropPending('The Proofboard app disconnected before answering.'); if (had) listChanged(); } });
      });
    });
  }

  return {
    mcp, call, listen,
    tools: () => toolList().map(t => t.name),
    connected: () => !!app,
    headless: head,
    async close() { dropPending('Server closing.'); for (const c of wss ? [...wss.clients] : []) c.terminate(); await new Promise<void>(r => (wss ? wss.close(() => r()) : r())); wss = null; await mcp.close().catch(() => {}); },
  };
}
