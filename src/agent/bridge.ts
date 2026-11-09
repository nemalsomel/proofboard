/**
 * MCP-híd: a helyi MCP-szerver (proofboard-mcp) és a böngészőben futó Proofboard közötti WebSocket-protokoll, valamint a
 * böngészős oldal kliense. A szerver a Claude (MCP-kliens) eszközhívásait a megnyitott apphoz továbbítja, az app a saját
 * élő tervén futtatja őket (ugyanazokkal az eszközökkel, mint a beépített agent), és visszaküldi az eredményt.
 * DOM-mentes: a WebSocket-konstruktort a gazda adja (böngészőben és Node 22-ben is van globális).
 */
import type { ToolResult } from './tools';

export const BRIDGE_PROTO = 1;
/** alapértelmezett helyi port (a szerver `--port` / PROOFBOARD_PORT kapcsolóval módosítható) */
export const BRIDGE_PORT = 47615;
/** belső hívások: a terv JSON-ként, illetve egy terv betöltése (fájl megnyitásához / mentéséhez) */
export const CALL_EXPORT = '__export_design', CALL_IMPORT = '__import_design';

/** szerver → app */
export type ServerMsg =
  | { t: 'welcome'; proto: number; server: string; version: string; client?: string }
  | { t: 'call'; id: number; name: string; input: Record<string, unknown> }
  | { t: 'client'; client: string }
  | { t: 'bye'; reason: string };
/** app → szerver */
export type AppMsg =
  | { t: 'hello'; proto: number; app: 'proofboard'; version: string; design: string }
  | { t: 'result'; id: number; result: ToolResult };

export function parseMsg<T>(data: unknown): T | null {
  try { const o = JSON.parse(String(data)) as { t?: unknown }; return o && typeof o.t === 'string' ? (o as T) : null; } catch { return null; }
}

export type BridgeState = 'off' | 'connecting' | 'connected' | 'waiting';
export interface BridgeHost {
  /** eszközhívás végrehajtása a gazda élő tervén */ exec(name: string, input: Record<string, unknown>): Promise<ToolResult>;
  /** a kapcsolódáskor elküldött adatok */ hello(): { version: string; design: string };
  /** állapotváltozás; `info`: a szerver és az MCP-kliens neve, ha ismert */ onState(s: BridgeState, info: { server?: string; client?: string; error?: string }): void;
}
export interface BridgeClient { state(): BridgeState; close(): void; /** a kapcsolódó MCP-kliens neve (pl. Claude Desktop) */ client(): string | undefined }

type WSCtor = new (url: string) => WebSocket;

/**
 * Kapcsolódás a helyi szerverhez; ha nem érhető el vagy megszakad, `retryMs` múlva újra próbál (a `close`-ig).
 * A hívásokat sorban hajtja végre (egyszerre egy), az eredményt a hívás azonosítójával küldi vissza.
 */
export function connectBridge(url: string, H: BridgeHost, o: { WS?: WSCtor; retryMs?: number } = {}): BridgeClient {
  const WS = o.WS || (globalThis as unknown as { WebSocket: WSCtor }).WebSocket, retry = o.retryMs ?? 3000;
  let ws: WebSocket | null = null, st: BridgeState = 'off', closed = false, timer: ReturnType<typeof setTimeout> | null = null;
  let server: string | undefined, client: string | undefined, queue = Promise.resolve();
  const set = (s: BridgeState, error?: string) => { st = s; H.onState(s, { server, client, error }); };
  const open = () => {
    if (closed) return;
    set(st === 'off' ? 'connecting' : st);
    let sock: WebSocket;
    try { sock = new WS(url); } catch (e) { set('waiting', String(e)); timer = setTimeout(open, retry); return; }
    ws = sock;
    sock.onopen = () => { const h = H.hello(); sock.send(JSON.stringify({ t: 'hello', proto: BRIDGE_PROTO, app: 'proofboard', version: h.version, design: h.design } satisfies AppMsg)); };
    sock.onmessage = ev => {
      const m = parseMsg<ServerMsg>(ev.data); if (!m) return;
      if (m.t === 'welcome') { server = `${m.server} ${m.version}`; client = m.client; set('connected'); }
      else if (m.t === 'client') { client = m.client; set('connected'); }
      else if (m.t === 'bye') { closed = true; set('off', m.reason); try { sock.close(); } catch { /* */ } }
      else if (m.t === 'call') {
        queue = queue.then(async () => {
          let result: ToolResult;
          try { result = await H.exec(m.name, m.input || {}); } catch (e) { result = { text: 'Tool failed in the app: ' + String(e), isError: true }; }
          if (sock.readyState === 1) sock.send(JSON.stringify({ t: 'result', id: m.id, result } satisfies AppMsg));
        });
      }
    };
    sock.onclose = () => { if (ws !== sock) return; ws = null; client = undefined; if (closed) { if (st !== 'off') set('off'); return; } set('waiting'); timer = setTimeout(open, retry); };
    sock.onerror = () => { /* a close követi */ };
  };
  open();
  return {
    state: () => st,
    client: () => client,
    close() { closed = true; if (timer) clearTimeout(timer); const s = ws; ws = null; if (s) try { s.close(); } catch { /* */ } set('off'); },
  };
}
