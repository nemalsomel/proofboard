---
title: Saving and sharing
description: Automatic saving in the browser, design files, sharing as a link, installing as an app, working offline.
---

## In the browser

Proofboard saves the design to your browser's storage after every change, on your own computer. Nothing goes to a server. After a reload or closing the browser you continue where you left off.

> **Careful:** browser storage is separate per computer and per browser, and clearing browsing data can delete it. Save what matters to a file too.

## Design files

- **File › Save to file** (<kbd>Ctrl</kbd>+<kbd>S</kbd>): the whole design in one `.json` file, with the custom parts it uses, the program and the instruments.
- **File › Open…** (<kbd>Ctrl</kbd>+<kbd>O</kbd>): load from a file. Your library is kept, and loading can be undone.
- **File › New design…** (<kbd>Alt</kbd>+<kbd>N</kbd>): an empty board; the current design can be brought back with undo.

## Sharing as a link

**File › Share as link…** (<kbd>Alt</kbd>+<kbd>L</kbd>): the design is compressed into the part of the link after the `#`. Whoever opens it gets a copy of the design in their own browser; your design doesn't change, and nothing goes to a server here either.

![The Share as link window: the link, its length, Copy and Share buttons.](img:share)

- If the recipient's design is empty, it loads right away. If they have work of their own, the app asks first, and lets them save theirs to a file.
- A big design can make a long link: the window warns when a chat app might cut it. Send a file instead.

## Installing and working offline

Proofboard can be installed as an app (**File › Install as an app…**, or the install icon in the browser's address bar). It then runs in its own window and **works without internet**. When there's a new version you get a notice, and it updates only when you ask, so open work isn't lost.

Internet is only needed for the built-in agent (the Anthropic API).

## For advanced users

- **File › JSON export / import…** (<kbd>Alt</kbd>+<kbd>J</kbd>): copy and paste the design's JSON.
- **File › Export library / Import library:** move your custom parts to another computer or browser, independent of the design.
- In the browser console, the `window.pcb` object controls the whole design (the automated tests use it too).
