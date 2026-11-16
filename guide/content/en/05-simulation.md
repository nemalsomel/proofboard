---
title: Simulation and measurement
description: Starting the simulation, buttons and sliders, GPIO modes; multimeter, probes, scope and current consumption.
---

The simulation is a fast DC approximation: it shows currents, voltage levels and short circuits, and runs the program. It's made for designing and debugging; it doesn't replace measuring and isn't a SPICE simulator.

## Starting it

The green **Simulation** button in the header, or <kbd>S</kbd>, starts and stops it. The **Simulation** layout (<kbd>Alt</kbd>+<kbd>3</kbd>) brings the board and the Simulation tab forward.

![Simulation with a Nokia 5110 display: the voltage map on the board, and the Simulation tab with the GPIO modes and levels on the right.](img:sim "The colour of the copper strips shows their voltage; on the right, the GPIOs and the LEDs.")

While it runs:

- **click a button** to press it. On the Simulation tab you choose whether buttons work as **Hold** (pressed while you hold) or **Toggle** (each click flips);
- the **potentiometer, joystick** and other slider parameters are set in the properties panel;
- the **LED** glows in proportion to its current, the **motor** turns, the **servo** follows its signal, the **display** backlight comes on;
- the **colour of the copper strips** shows their voltage (voltage map, with a legend on the Instruments tab);
- the program runs, and block edges show their values.

Editing the board is paused during simulation; stop it to change the wiring.

## GPIOs and power

The **Simulation** tab (<kbd>Shift</kbd>+<kbd>3</kbd>) shows the controller's pins: mode, level and voltage. Pins not driven by the program can be set by hand:

| Mode | Meaning |
| --- | --- |
| in, pull-up / pull-down | input with an internal pull-up or pull-down resistor (for a button) |
| in, floating | input with no resistor; Problems will warn if it floats |
| analog (ADC) | voltage measurement (ADC pins only) |
| out: 1 / out: 0 | output, high or low |
| out: PWM | duty % and frequency in Hz; fast PWM looks like its average to the eye and to the simulation |

If the program has an output block on a pin, the program drives it. **USB power on the controller** simulates the board being powered over USB (otherwise a battery or supply on the board powers it).

## Instruments

On the **Instruments** tab of the left sidebar you add measuring instruments to the design. Probe positions are part of the design and are saved with it.

![The Instruments tab: a multimeter measuring voltage and a scope showing a blinking LED's signal.](img:meters)

### Multimeter

1. Add a **Multimeter** and pick the measurement: **Voltage**, **Current**, **Resistance** or **Continuity test**.
2. Press **Place** next to the **Red** probe, then click a hole on the board (<kbd>Esc</kbd> cancels); the **Black** probe works the same. Without a black probe it measures to GND.
3. To measure current, put the red probe on a part's pin: it shows the current flowing into that pin.
4. Resistance and continuity are measured on the unpowered circuit (resistors, motors, coils); it beeps on continuity.

### Probes

A **probe** shows the voltage of one point on the board, right next to the hole. Good for a quick overview; you can have several. After adding one, click the hole.

### Scope

The **scope** plots voltage over time on up to 4 channels while the simulation runs.

- **Window:** 0.5–10 s.
- **Trigger:** free-running, or on a rising / falling edge of channel 1 (at 1.5 V).
- **Stop** and **cursor:** click the plot to read the time and values.
- Fast PWM is an average in the simulation; a label on the channel shows the set frequency and duty.

### Arranging them

Every instrument can be dragged out into a floating window over the board: move it by its title bar, and drop it at the left edge of the canvas to dock it back on the tab. Hidden instruments keep their probes faintly on the board.

## Current consumption

At the bottom of the Instruments tab, **Current consumption** shows from the running simulation:

- the **sources** (USB, battery) with the current and power they deliver,
- the **biggest consumers**, part by part,
- the **estimated battery life** from the **Battery capacity (mAh)** field.

The controller's own consumption isn't included, only what it drives (GPIOs, 3V3).
