---
title: With Claude
description: Design by conversation – with the built-in agent (your own API key) or from Claude Desktop and Claude Code via MCP.
---

Say what you want to build: Claude places the parts, wires them, writes the program and runs the simulation – in the design you're watching. There are two ways to reach it.

| | Built-in agent | Claude Desktop / Claude Code (MCP) |
| --- | --- | --- |
| Where you chat | the app's **Agent** tab | in the Claude app or the terminal |
| What you need | your own Anthropic API key | a Claude subscription, the Proofboard MCP extension |
| Cost | by API usage | part of the subscription |

Both use the same tools: placing and moving parts, connections, routing, programs from blocks, simulation and measurement, custom parts, manufacturing data.

## Built-in agent

1. Open the **Agent** tab in the right sidebar (<kbd>Shift</kbd>+<kbd>5</kbd>).
2. Under **API key and model**, enter your Anthropic API key. The key stays in this browser only and calls the Anthropic API directly.
3. Choose a mode:
   - **Discuss:** the agent reads and analyses the design and suggests, but doesn't change anything. E.g. “Which transistor should switch a 12 V fan?”
   - **Build:** it builds. Before a bigger change it describes its plan and asks for approval.

![The Agent tab: the mode switch, the message box and the project notes.](img:agent)

- While it works, the “Agent is working” bar shows and manual editing is paused; <kbd>Esc</kbd> or **Stop** halts it.
- One task is one undo step: <kbd>Ctrl</kbd>+<kbd>Z</kbd> restores what was there before.
- Conversations are kept per project and can be reopened from **Earlier conversations**.
- **Project notes** are part of the design: write here what the agent should always know (e.g. “runs from a 3.7 V Li-ion cell, goes in a 40×60 mm box”).

## Claude Desktop and Claude Code (MCP)

With the Proofboard MCP server, Claude works with your own subscription, and the design changes live in the browser.

1. In the app: **File › Claude connection…** (<kbd>Alt</kbd>+<kbd>C</kbd>).
2. **Claude Desktop:** **Download the Claude Desktop extension** (`proofboard.mcpb`) and open it with a double click; Claude Desktop offers to install it.
3. **Claude Code:** `claude mcp add proofboard -- npx -y proofboard-mcp`
4. Keep Proofboard open in the browser: the indicator in the header shows it's connected. If it isn't open, Claude works without the UI on an in-memory design, and can save it to a file.

The connection only works on your own computer (127.0.0.1) and only accepts the Proofboard page. Consecutive calls form one undo step.

> **Tip:** good requests: “Put a button on GP14 and toggle the LED on every press.” · “Why doesn't LED1 light up?” · “Compact the design, but keep the buttons where they are.” · “Make a custom part for the BME280 module with this pinout: …”
