---
title: Program and code
description: The controller's program from blocks, with live values; MicroPython and Arduino code, a PlatformIO project; importing existing code.
---

You build the controller's behaviour from blocks: input → logic or timing → output. The same program runs in the simulation, and the MicroPython or Arduino code is generated from it.

## Where to edit it

- The **Program** layout (<kbd>Alt</kbd>+<kbd>2</kbd>) shows the program large.
- Above the workspace, **Board / Program / Both** (<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>): **Both** puts the board and the program side by side. Drag the divider between them.

![The Program layout in Both view: the blocks on the left (Analog input, PWM output), the board with the joystick and the LED on the right.](img:program "The joystick position sets the LED brightness: Analog input → PWM output.")

## Blocks

Add one from the **+ Block** menu. Drag from its output (the dot on the right) to the next block's input (the dot on the left) to connect them. <kbd>Delete</kbd> removes the selected block or edge.

| Group | Blocks |
| --- | --- |
| Input | **Digital input** (button, switch), **Analog input** (potentiometer, joystick, ADC), **Constant** |
| Logic | **NOT**, **AND**, **OR**, **XOR**, **Compare** (e.g. analog value > threshold) |
| Time | **Clock** (blinking), **Toggle** (flips on an edge), **Counter**, **Timer** (delayed off), **Sequence** (steps on a timeline, e.g. a chaser or a stepper motor) |
| Output | **Digital output** (LED, relay), **PWM output** (brightness, motor speed, servo) |

Input and output blocks refer to **a pin on the board** (e.g. SW1.A, LED1.A), not a GPIO number. The wiring decides the GPIO, so if you rewire or [swap the controller](board#controllers-and-swapping), the program stays valid.

> **Tip:** during simulation, block edges and ports show their current value: you can see where a signal gets stuck.

Examples in the Program category of **File › Examples**: blinking LED, toggle, brightness from a joystick, a chaser with Sequence, two buttons with AND, stairwell light with delayed off.

## Code

The **Code** tab (<kbd>Shift</kbd>+<kbd>4</kbd>) shows the code generated from the program, in **MicroPython** or **Arduino**. Proofboard handles the board-specific details (pin numbers, PWM, ADC).

![The Code tab: the chaser program as Arduino code.](img:code)

- **Copy:** paste it into Thonny or the Arduino IDE.
- **PlatformIO project:** as a zip, for advanced users (VS Code + PlatformIO).
- Click a line of code to highlight the block it came from.

## Importing code

If you already have an Arduino or MicroPython sketch, **Code › Import…** (<kbd>Alt</kbd>+<kbd>I</kbd>) turns it into a block program.

1. Paste the code or choose a file; the language is detected.
2. The preview shows which blocks it becomes, and what it couldn't translate (with line numbers; click one to select it in the code).
3. **Replace** (replaces the current program) or **Add**. One step to undo.

Recognised patterns: outputs with `delay` (Clock or Sequence), `digitalRead` / `analogRead` and conditions (logic blocks, Compare), `x = !x` (Toggle), `(n+1) % M` (Counter), `millis()` timers (Clock, Timer). Debouncing is skipped, because the blocks handle it themselves.

> **Careful:** importing isn't a line-by-line translation; it recognises what the program is meant to do. With complex control flow (functions, arrays, interrupts) only the recognised parts come across; the list shows the rest.
