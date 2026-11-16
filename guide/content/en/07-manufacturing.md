---
title: Manufacturing
description: Parts list, assembly order, 1:1 printable sheets, dimension drawing as SVG and DXF; mounting holes.
---

When the design is done, the **Manufacturing** layout (<kbd>Alt</kbd>+<kbd>4</kbd>, or **File › Manufacturing: parts list, sheets…**) puts together what you need to build it. It has four tabs: **Bill of materials**, **Assembly**, **Drawing**, **Sheets**. The drawings zoom (<kbd>Ctrl</kbd> + wheel or pinch) and pan; double-click shows the whole drawing.

## Bill of materials

Parts of the same type and value on one line, with quantity and labels (e.g. “3 × 330 Ω: R1, R2, R5”). Next to them: the board, wire length per colour in millimetres, and the number of bridges and cuts. **Download CSV** takes it to a spreadsheet.

## Assembly

The assembly order, step by step, as a checklist. The order follows how you solder:

1. preparing the board (cutting to size, mounting holes),
2. strip cuts (copper side),
3. wires,
4. parts in groups, from low to tall (resistors, diodes, then capacitors, headers, finally the controller),
5. bridges (copper side),
6. [copper-side parts](board#copper-side-parts),
7. connecting off-board parts,
8. checks.

![The Assembly tab: the steps with ticks, next to the board with the current step's items highlighted.](img:assembly "Click a step to highlight its items on the board.")

Ticks are kept per design (**Clear ticks** starts over), so you can pick up a half-finished build later. The marks (cut X1…, bridge chain H1…, wire V1…) appear the same way on the sheets.

## Sheets

The component side and the copper side **at 1:1 scale**, for printing. The copper side is mirrored, as you see it while soldering. A 50 mm ruler lets you check the printer didn't rescale it. Laid on the board, it works as a template: where to cut, where each bridge goes.

**Print…** (<kbd>Ctrl</kbd>+<kbd>P</kbd>) makes an A4 package: sheets, parts list, assembly steps, drawing – whatever you tick.

## Drawing

For designing a box, a front panel or mounting: the position and size of the parts in millimetres, top view, with a front view below and a side view on the right showing the tallest point.

![The Drawing tab: the board's top view with clearance dimensions, a front view below, a side view on the right.](img:dims)

Dimensioning modes:

| Mode | What it measures |
| --- | --- |
| **Clearance** (default) | each body to its nearest neighbour or the board edge, in all four directions |
| **Chain** | from the edges and from each other, in a line |
| **From edge** | each item from the nearest board edge |
| **Coordinates** | from an origin (a board corner or a chosen item) to the centres |

**Measure to** chooses body edges or centres. By default the parts that matter from outside (button, display, connector) and the controller are dimensioned, including its USB connector; turn any of them on or off in the table.

Export: **SVG** and **DXF** (AutoCAD R12, with layers: board, holes, parts, dimensions), for CAD or a laser cutter.

> **Careful:** heights and real sizes are estimates from the part descriptions. For an exact box, measure your own parts and update them in the [editor](custom-parts#basics-and-appearance).

## Mounting holes

The **Mounting hole** part (Mechanical category; M2, M2.5, M3) is for screwing the board down. It's drawn as a drilled hole on the sheets and the drawing, and appears in the board-preparation step. The checks warn if a pin ends up under the screw head, or if the hole's strip carries a connection (a metal screw would connect it to the case).
