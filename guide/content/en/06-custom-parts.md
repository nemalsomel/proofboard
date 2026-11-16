---
title: Custom parts
description: A new part in the Part editor: pins, internal behaviour as a diagram, parameters, dimensions; saving to your own library.
---

If a part isn't in the list, you can draw it. The simulation, the checks and the router treat custom parts exactly like built-in ones.

## Opening the editor

- The **New part** button at the top of the parts list, empty or **starting from a built-in** part,
- or in a placed part's properties panel: **Copy as a custom part**.

The Part editor opens in place of the workspace, with its own tab in the view bar; several can be open at once, and the board can stay visible next to it.

![The Part editor on the Behavior tab: an XOR module's internal circuit as a diagram, with the preview and basics on the left.](img:editor "Behavior tab: the internal circuit from gates, pins and outputs.")

## Basics and appearance

On the left:

- **Preview:** how it will look on the board.
- **Problems:** the part's own problems (e.g. the logic needs a GND pin). Click to jump to the field.
- **Basics:** name, category, **prefix** (instances are named prefix + number, e.g. U1), and whether it's an off-board part (placed next to the board, wired with a cable).
- **Dimensions:** real size (width, depth in mm), height above the board, and whether it matters from outside (dimensioned on the drawing by default). See [Manufacturing](manufacturing).
- **Appearance:** colour, label on the body, margin, showing the instance name.

## Pins

On the **Pins** tab you add pin rows (**Add pin row**), and for each pin:

| Column | Meaning |
| --- | --- |
| Position | row and column on the part's own grid |
| Name | the pin label (e.g. VCC, SDA, OUT) |
| Role | supply, GND, input, output, analog…; the checks and the router work from this |
| Group | pins in the same group are connected inside the part (e.g. a push button's two A pins) |
| Function | the bus the pin expects (I²C, SPI, UART); Problems warn if it lands on the wrong GPIO |
| Supply (V) | for a supply input, the allowed range, e.g. 2.7-3.6 |

## Behavior

The **Behavior** tab is the internal circuit as a diagram. Its elements: **pins**, **logic gates**, **register**, **constant**, **output**, **electrical elements** (resistor, LED, motor…) and **push button**. Outputs wired to pins decide what the pin does in the simulation.

At the top are the **Parameters**: number or value, unit, default, range. Tick **Slider** to make it adjustable during simulation. A model value can be an expression; the built-in potentiometer's resistance, for instance, is `{ohm*pos/100}`.

## JSON

The **JSON** tab shows the full description, editable. If you write something the form can't show, the editor tells you before you switch back.

## Saving

**Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd> in the editor) puts it into **your library**, and updates it in the design if it's already used there.

- Your library stays in your browser, across designs; **File › Export library / Import library** moves it elsewhere.
- Whatever you place in a design becomes part of the design, so it travels with the design file and the share link.

> **Tip:** [Claude](claude) can also make a custom part from a datasheet or a description; you can edit it in the editor afterwards just the same.
