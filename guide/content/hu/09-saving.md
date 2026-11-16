---
title: Mentés és megosztás
description: Automatikus mentés a böngészőben, tervfájl, megosztás linkkel, telepítés alkalmazásként, offline használat.
---

## A böngészőben

A Proofboard minden módosítás után elmenti a tervet a böngésződ tárolójába, a saját gépeden. Szerverre nem kerül semmi. Újratöltés vagy a böngésző bezárása után ott folytatod, ahol abbahagytad.

> **Figyelem:** a böngésző tárolója gépenként és böngészőnként külön van, és a böngészési adatok törlésével elveszhet. Ami fontos, mentsd fájlba is.

## Tervfájl

- **Fájl › Mentés fájlba** (<kbd>Ctrl</kbd>+<kbd>S</kbd>): a teljes terv egy `.json` fájlba, a benne használt saját alkatrészekkel, a programmal és a műszerekkel együtt.
- **Fájl › Megnyitás…** (<kbd>Ctrl</kbd>+<kbd>O</kbd>): betöltés fájlból. A saját könyvtárad megmarad, a betöltés visszavonható.
- **Fájl › Új terv…** (<kbd>Alt</kbd>+<kbd>N</kbd>): üres panel; a mostani terv visszavonással visszahozható.

## Megosztás linkkel

**Fájl › Megosztás linkkel…** (<kbd>Alt</kbd>+<kbd>L</kbd>): a terv tömörítve a link `#` része mögé kerül. Aki megnyitja, a saját böngészőjében kapja meg a terv másolatát; a te terved nem változik, és szerverre itt sem kerül semmi.

![A Megosztás linkkel ablak: a link, a hossza, Másolás és Megosztás gomb.](img:share)

- Ha a megnyitónak üres a terve, rögtön betöltődik. Ha van saját munkája, az app megkérdezi, és előbb fájlba mentheti a sajátját.
- Nagy tervnél a link hosszú lehet: az ablak szól, ha egy csevegőprogram már levághatja. Ilyenkor küldd fájlként.

## Telepítés és offline használat

A Proofboard telepíthető alkalmazásként (**Fájl › Telepítés alkalmazásként…**, vagy a böngésző címsorának telepítés ikonja). Ilyenkor saját ablakban fut, és **internet nélkül is működik**. Új verziónál értesítést kapsz, és csak akkor frissül, amikor te kéred, így a nyitott munka nem vész el.

Az internet csak a beépített agenthez kell (az Anthropic API-hoz).

## Haladóknak

- **Fájl › JSON export / import…** (<kbd>Alt</kbd>+<kbd>J</kbd>): a terv JSON-ja másolható és beilleszthető.
- **Fájl › Könyvtár exportálása / importálása:** a saját alkatrészeid átvitele másik gépre vagy böngészőbe, a tervtől függetlenül.
- A böngésző konzoljában a `window.pcb` objektum a teljes tervet vezérli (ezt használják az automatikus tesztek is).
