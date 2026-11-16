---
title: Wiring and routing
description: Connections, automatic bridges and wires, manual wiring, strip cuts, Problems and Compact.
---

There are two ways to wire in Proofboard. With **connections** you only say what goes to what, and the router finds the bridges and wires. **By hand** you place the bridges and wires yourself. You can mix the two.

## Connections

A connection between two pins (or a pin and GND / a free GPIO) means: these must end up on one net.

- **Connection tool** (<kbd>C</kbd>): click one pin, then the other.
- **Properties › Pins and wiring:** for each pin, pick the target: another pin, **GND**, or a **free GPIO**. Proofboard then picks the nearest suitable GPIO (an ADC pin for an analog signal).
- **Quick button:** with a push button selected, “A → GPIO, B → GND” wires it in one click.

![The Connections tab: the list of connections with bridge counts, the status above, and the highlighted route on the board.](img:links "The Connections tab. Click a connection in the list to highlight its route on the board.")

The **Connections** tab (<kbd>Shift</kbd>+<kbd>2</kbd>) lists them all: what goes to what, which GPIO it got, and how many bridges carry it. The badge above (“10/10 routed”) shows how many connections are done. **Connection lines** (<kbd>N</kbd>) draw the still-unrouted ones as dashed lines.

## Routing

With **Automatic routing** on, it re-routes after every change. **Find routes** (<kbd>U</kbd>) starts it by hand.

- It uses sectioned and stripboard copper: where the copper already connects, it adds no bridge.
- If bridges won't do, it adds a wire (between two holes).
- It avoids occupied holes, copper of other nets, and the area under a [copper-side part](board#copper-side-parts).
- It never touches manual bridges and wires.

Useful buttons on the Connections tab:

| Button | What it does |
| --- | --- |
| Make manual | turns the automatic bridges and wires into manual ones: they won't be re-routed |
| Manual → automatic | turns manual wiring into connections; the router plans the bridges again |
| Delete auto bridges | removes the automatic bridges (the connections stay) |

## Manual wiring

- **Bridge** (<kbd>B</kbd>): solder two neighbouring holes together; drag to place several in a row.
- **Wire** (<kbd>W</kbd>): a jumper between any two holes. Its colour is set in the properties panel.
- **Delete** (<kbd>E</kbd>): click or drag to delete bridges, wires and cuts.

The **Short wires** view (<kbd>Shift</kbd>+<kbd>W</kbd>) shows only the two ends of long wires, so the drawing stays readable; hover to see the whole wire.

## Strip cuts

On a stripboard the copper runs along the whole row, so wherever two different signals would share a strip, it must be cut. There are two kinds:

- **gap:** the copper is cut between two holes (with a knife),
- **hole:** a hole is drilled out (the copper through it is broken).

**Automatic strip cuts** cuts according to the connections, at the nearest free spot between the two pins. With the **Strip cut** tool (<kbd>K</kbd>) you cut by hand; its type is chosen above the toolbar: **By position** (centre of a hole drills it, between two holes makes a gap), **Hole** or **Gap**. You can also select and delete an automatic cut; no new one will be placed there.

> **Tip:** the copper-side view (<kbd>F</kbd>) shows the board as you'll see it while soldering: mirrored, with the cuts and bridges.

## Problems

The **Problems** tab in the bottom panel (<kbd>P</kbd>) checks the design continuously. Click a line to jump to where the problem is.

![The Problems tab with two warnings: a floating input on the button pin, and too much LED current because of a small resistor.](img:problems "Two warnings: the button's GPIO floats without a pull-up resistor, and with a 22 Ω series resistor the LED current is too high.")

Among other things it watches for:

- **short circuits:** supply and GND on one net,
- **floating inputs** and unconnected pins,
- **too much current** through an LED or a GPIO, an LED without a series resistor,
- **wrong GPIO:** analog signal on a pin without ADC, ADC2 on the ESP32 while WiFi is on, a hardware bus on the wrong pins, different frequencies on one PWM slice,
- a **motor** driven straight from a GPIO, without a flyback diode; a floating transistor base,
- voltage outside the allowed range,
- solder points under a copper-side part, a pin under a mounting hole's screw head.

In Simple mode only errors are shown, not warnings and notes.

## Compact

If the design is spread out, **Compact…** (<kbd>Alt</kbd>+<kbd>K</kbd>, or on the Connections tab) moves the parts closer to each other and to the pins they connect to, so a smaller board will do.

![The Compact window: the loose–tight slider, keep-in-place options, before/after table; the board shows the preview, with the original positions faded.](img:compact)

- The **loose ↔ tight** slider sets how much it may move.
- You can keep the controller and the controls (button, potentiometer) in place; parts marked **Fixed position** don't move either.
- The board shows a live preview, with a before/after table below: area, bridges, wires.
- **Apply** is a single undo step.
