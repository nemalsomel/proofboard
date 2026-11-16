---
title: Glossary
description: Proofboard's words: one word for one thing, in the interface, the guide and the messages.
---

These names are used everywhere: in the interface, this guide, the example notes and the problem messages.

### Board and wiring

| Term | Meaning |
| --- | --- |
| **board** | the perfboard you design on (size, holes, copper layout) |
| **hole** | one hole of the board; its position is `row:column` |
| **section** | on a sectioned board, the copper piece joining a few holes (e.g. 1×3) |
| **strip** | on a stripboard, a full copper strip or a cut piece of it |
| **dot board** | a board where every hole has its own copper pad |
| **strip cut** | breaking the copper: a **gap** (between two holes) or a **hole** (drilling one out) |
| **bridge** | two neighbouring holes joined with solder |
| **wire** | a jumper between any two holes |
| **connection** | a wanted link between two pins; the router finds the bridges and wires for it |
| **route** | how a connection is made, with bridges and wires |
| **manual** / **automatic** | a bridge or wire placed by you, or by the router |
| **net** | pins and copper that are electrically connected |

### Parts

| Term | Meaning |
| --- | --- |
| **part** | an item placed on the board (resistor, LED, controller…) |
| **pin** | a part's lead; it goes into a hole |
| **floating pin** | connected to nothing: no connection, no net |
| **controller** | a microcontroller development board (Pico W, ESP32…) |
| **GPIO** | a programmable pin of the controller |
| **off-board part** | a part next to the board (motor, display), connected with a cable |
| **connector** | a pin header or module socket on the board; an off-board part's cable plugs into it |
| **custom part** | a part you described yourself |
| **internal circuit** | a custom part's behaviour as a diagram (Behavior tab) |
| **library** | your custom parts in the browser, independent of designs |

### Design, program, checks

| Term | Meaning |
| --- | --- |
| **design** | everything saved in one file: board, parts, wiring, program, notes |
| **example** | a ready design with explanatory notes |
| **note** | a text label on the board |
| **program** | control logic made of blocks, setting the GPIOs while running |
| **block** / **edge** | one operation of the program, and a link between two blocks |
| **sequence** | stepping a pattern row by row onto outputs (e.g. stepper coils) |
| **code** | MicroPython or Arduino source generated from the program |
| **simulation** | the DC calculation of the circuit, running the program |
| **Problems** | the result of the checks: **error** (won't work), **warning** (suspicious), **note** (information) |
| **log** | events in time order: loading, saving, routing, simulation |

### Interface

| Term | Meaning |
| --- | --- |
| **tool** | what you work with on the board: Select, Bridge, Wire, Connection, Strip cut, Note, Delete, Pan |
| **view** | one way of showing the design: Board, Program, Part editor |
| **layout** | the starting arrangement of the panels for a task: Design, Program, Simulation, Manufacturing |
| **properties** | the settings of the selection, floating over the board or docked in the right sidebar |
| **bottom panel** | the collapsible strip under the canvas: Problems and Log |
| **status bar** | the line under the canvas: hovered hole, tool, selection, problems, simulation |
| **Simple mode** | hides the advanced parts for beginners; Problems shows errors only |
