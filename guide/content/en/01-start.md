---
title: Getting started
description: The parts of the screen, a first design from an example, and the essential moves.
---

Proofboard runs in the browser, with nothing to install and no account. On one design you place the parts, wire them, write the controller's program, try it in simulation, and produce the build sheets.

## The screen

![Proofboard in the Design layout: the parts list on the left, the board with an ESP32, a button, an LED and a joystick in the middle with the selected LED's properties, the Connections tab on the right.](img:ui "Design layout: parts on the left, the board with the selected LED's properties in the middle, connections on the right.")

- **Header:** the board size, the **File** menu, the layouts (**Design**, **Program**, **Simulation**, **Manufacturing**), the sidebar toggles, undo, and the green **Simulation** button that starts it.
- **Left sidebar:** the **Parts** list with search, and **Instruments** (multimeter, scope, probes).
- **Middle:** the workspace. Above it you switch between **Board**, **Program** and **Both**, and between the **Component side** and **Copper side** views. At the bottom is the toolbar: Select, Bridge, Wire, Connection, Strip cut, Note, Delete, Pan.
- **Right sidebar:** the **Connections**, **Simulation**, **Code** and **Agent** tabs.
- **Bottom panel:** **Problems** and **Log**, with the status bar below (part count, used area, current tool and selection).

## A first design from an example

The fastest start is a ready-made example: **File › Examples…** (<kbd>Alt</kbd>+<kbd>P</kbd>). Examples are grouped by category (Basics, Controller, Input, Program, Semiconductor, Motor, Logic, Module…), and each has notes that explain what to look at.

![The Examples window with categories and descriptions.](img:examples)

Good first examples:

1. **LED from a battery – with the router:** three parts and two connections; the program places the bridges.
2. **Push button on the Pico:** an input on the controller, with the pull-up resistor.
3. **A button toggles the LED:** the first program, three blocks.

Loading can be undone (<kbd>Ctrl</kbd>+<kbd>Z</kbd>), so your previous design is not lost.

## Your own design from scratch

1. **File › New design…** (<kbd>Alt</kbd>+<kbd>N</kbd>): pick the board size and type (perfboard, sectioned or stripboard). See [Board and parts](board).
2. Click a part in the list on the left, then the hole on the board where it should go. While placing, <kbd>R</kbd> rotates, <kbd>M</kbd> mirrors, <kbd>Esc</kbd> cancels.
3. Wire it: with the **Connection** tool (<kbd>C</kbd>) click one pin, then the other. The router finds the bridges. See [Wiring and routing](wiring).
4. Start the simulation (<kbd>S</kbd>) and see whether the LED lights up. See [Simulation and measurement](simulation).

## Moving around the board

- **Zoom:** <kbd>Ctrl</kbd> + wheel, or the buttons in the top-left corner; <kbd>0</kbd> fits the whole board.
- **Scroll:** wheel, <kbd>Space</kbd> + drag, or the **Pan** tool (<kbd>H</kbd>).
- **Touch:** one finger scrolls, dragging a part moves it, two fingers zoom.
- **Command palette:** <kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>F1</kbd>. Type to find commands, parts and examples. Holding <kbd>Ctrl</kbd> shows each visible button's shortcut.

> **Tip:** **Simple mode** (File menu; when it's on, a badge in the header turns it off) hides the advanced parts and shows only errors among the Problems. A good starting point for learning and teaching.

## Where are my designs?

In your browser's storage, on your own computer: your work is still there after a reload. **File › Save to file** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) saves a file, and a design can be shared as a link. See [Saving and sharing](saving).
