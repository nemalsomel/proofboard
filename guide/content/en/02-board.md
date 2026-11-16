---
title: Board and parts
description: Board types and size, placing, moving and editing parts; off-board parts, swapping the controller, copper-side parts.
---

The board is the perfboard you design on. Part pins go into its holes, and depending on the board type, the copper connects them.

## Board types

**File › Board settings…** (<kbd>Alt</kbd>+<kbd>B</kbd>), or **File › New design…** for a new one:

- **Dot board** (no sections): every hole has its own copper pad; you connect everything with bridges or wires.
- **Sectioned** (1×2 … 1×5): neighbouring holes share small copper sections. Fewer bridges needed.
- **Stripboard** (full strip): each row is connected end to end, so the strip must be cut wherever two different signals would meet. See [Strip cuts](wiring#strip-cuts).

![The Board settings window: type, size in holes, section.](img:boardset)

Changing the size or the copper layout can be undone. Bridges and wires that would hang off the board are removed.

## Placing a part

1. Find it in the list on the left. The search box (<kbd>/</kbd>) matches names, pins and functions (e.g. “pwm”, “adc”, “i2c”).
2. Click it, then the hole on the board. Before placing, <kbd>R</kbd> rotates, <kbd>M</kbd> mirrors.
3. The star adds a part you use often to your favourites.

The list is grouped by category (Controller, Input, Passive, Semiconductor, Module…); groups can be collapsed.

## Selecting and moving

- Click: select. <kbd>Shift</kbd> + click or a selection box: several items.
- Drag: move; pins always land in holes. If it doesn't fit at the new spot (it would overlap another part), it stays.
- <kbd>R</kbd> rotate, <kbd>M</kbd> mirror, <kbd>D</kbd> duplicate, <kbd>Delete</kbd> delete, <kbd>Ctrl</kbd>+<kbd>A</kbd> select all.

## Properties

The selected part's details appear in the properties panel (floating over the board, or docked in the right sidebar):

![The selected push button's properties: name, rotate, mirror, options, and pin wiring.](img:props)

- **Name:** the label (R1, LED1, SW1…). Connections and the program refer to it.
- **Parameters:** value (e.g. resistance in Ω), colour, potentiometer position; slider parameters can be changed during simulation too.
- **X-ray:** only the outline and pins are drawn, so you can see what's underneath.
- **Fixed position:** [Compact](wiring#compact) and Claude won't move it; you still can by hand. A padlock marks it on the drawing.
- **On the copper side:** see below.
- **Pins and wiring:** for each pin, where it should go (GND, a free GPIO, another pin). This becomes a connection. See [Wiring](wiring).
- **Copy as a custom part:** turns its description into a custom part you can edit. See [Custom parts](custom-parts).

## Controllers and swapping

Built-in controller boards: **Raspberry Pi Pico W**, **ESP32 DevKit V1** (30 pins) and **ESP32-C3 SuperMini**. Proofboard knows each pin's capabilities: which can measure an analog signal (ADC), which is input-only, which is a boot strapping pin, which is the serial port. Hover over a pin to see its note.

With a controller selected, the **Swap** button in the properties panel changes it to another board: connections are kept, the GPIOs are reassigned, and the program follows, because blocks refer to pins, not GPIO numbers.

## Off-board parts and connectors

Things that don't sit on the board (a display on a cable, a motor, a joystick module) go next to it, with their pins shown as leads. Their cable can be plugged into a **connector** (pin header): the route then continues from the connector's pin. With the part selected, you can add a connector to the board from the properties panel.

## Copper-side parts

Sometimes a part goes on the other side of the board (say, a button that should be pressable from outside the box). Tick **On the copper side (underneath)** in the properties panel, or use the “copper side” command in the palette.

- By default **no bridge and no other solder point may go under its body**, because there's no room to solder there. The router avoids that area; red hatching marks it on the drawing.
- If you need it anyway, tick **Allow bridges and solder points under it**.
- It's drawn faded in the component-side view and in full in the copper-side view. It gets its own step in the assembly order, after the bridges.

![A stripboard from the copper side: the strips, cuts and bridges.](img:copper "Copper-side view (F): mirrored, as you see it while soldering.")

## Notes

The **Note** tool (<kbd>J</kbd>) puts a text label on the board: an explanation or a reminder. The examples explain themselves this way.
