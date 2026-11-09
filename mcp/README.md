# proofboard-mcp

MCP server for **[Proofboard](https://nemalsomel.github.io/proofboard/)** – a perfboard / stripboard circuit designer and simulator.
It lets Claude (Claude Desktop, Claude Code or any MCP client) place parts, connect pins (wiring is routed automatically),
compact the layout, simulate, check problems and generate firmware code.

- **Live in the browser:** open Proofboard and choose *File › Claude connection… › Connect*. Claude's changes then appear
  live on your board; a bar shows while Claude is working (manual editing pauses), and each working session is one undo step.
  A *read only* switch lets Claude look and check without changing anything.
- **Headless:** without the app, the server works on an in-memory design that Claude can save to a file
  (`save_design_file`) and you can open in the app (*File › Open*).

Claude uses your own Claude subscription – no API key is needed.

## Setup

Requires Node.js 18+.

**Claude Desktop** – Settings › Developer › Edit Config (`claude_desktop_config.json`), then restart Claude:

```json
{ "mcpServers": { "proofboard": { "command": "npx", "args": ["-y", "proofboard-mcp"] } } }
```

**Claude Code:**

```sh
claude mcp add proofboard -- npx -y proofboard-mcp
```

Then open https://nemalsomel.github.io/proofboard/ › *File › Claude connection…* › *Connect*, and ask Claude e.g.
“Design a LED blinker on the Pico, then check that it is compact.”

## Options

| Option | |
|---|---|
| `--port N` (or `PROOFBOARD_PORT`) | bridge port (default 47615; set the same port in the app under *Advanced*) |
| `--no-bridge` | headless only |
| `--allow-origin URL` | also accept the app from another origin (self-hosted copy) |

## Security

The bridge listens on `127.0.0.1` only and accepts browser connections only from the Proofboard site (and localhost).
The app connects only when you press *Connect* (or enable auto-connect), and you can disconnect at any time.

## Tools

`bridge_status`, `open_design_file`, `save_design_file`, and the Proofboard design tools: `get_design`, `list_part_types`,
`describe_part_type`, `get_part`, `place_part`, `move_part`, `set_params`, `remove_parts`, `connect`, `disconnect`, `route`,
`get_problems`, `simulate`, `set_gpio_mode`, `add_note`, `generate_code`, `get_board_image` (live only), `set_project_notes`,
`plan_compaction`, `compact_layout`, `set_fixed`, `list_examples` / `load_example` (live only), `new_design`.
