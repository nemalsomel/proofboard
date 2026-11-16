---
title: Saját alkatrész
description: Új alkatrész az Alkatrész-szerkesztőben: lábak, belső működés diagramon, paraméterek, méretek; mentés a saját könyvtárba.
---

Ha egy alkatrész nincs a listában, megrajzolhatod. A saját alkatrészt a szimuláció, az ellenőrzés és az útvonalkereső ugyanúgy kezeli, mint a beépítetteket.

## A szerkesztő megnyitása

- **Új alkatrész** gomb a bal oldali lista tetején, üresen vagy egy beépített alkatrészből kiindulva (**Kiindulás beépítettből**),
- vagy egy lerakott alkatrész tulajdonságpanelén: **Másolat saját alkatrészként**.

Az Alkatrész-szerkesztő a munkaterület helyén nyílik meg, a nézetsávon saját füllel; egyszerre több is lehet nyitva, a panel mellette is látható.

![Az Alkatrész-szerkesztő a Működés fülön: egy XOR modul belső kapcsolása diagramon, balra az előnézet és az alapadatok.](img:editor "Működés fül: a belső kapcsolás kapukból, lábakból és kimenetekből.")

## Alapadatok és megjelenés

A bal oldalon:

- **Előnézet:** így fog kinézni a panelen.
- **Problémák:** az alkatrész saját hibái (pl. hiányzó GND láb a logikához). Kattintásra a mezőhöz ugrik.
- **Alapadatok:** név, kategória, **előtag** (a példányok neve: előtag + sorszám, pl. U1), külső alkatrész-e (a panel mellé kerül, kábellel bekötve).
- **Méretek:** valós méret (szélesség, mélység mm-ben), magasság a panel fölött, és hogy kívülről fontos-e (a méretrajzon alapból méretezve). Lásd: [Gyártás](manufacturing).
- **Megjelenés:** szín, felirat a testen, margó, a példánynév kiírása.

## Lábak

A **Lábak** fülön a lábsorokat adod meg (**Lábsor hozzáadása**), és lábanként:

| Oszlop | Jelentés |
| --- | --- |
| Hely | sor és oszlop a saját rácsán |
| Név | a lábkép felirata (pl. VCC, SDA, OUT) |
| Szerep | táp, GND, bemenet, kimenet, analóg…; ebből dolgozik az ellenőrzés és az útvonalkereső |
| Csoport | az azonos csoportú lábak gyárilag össze vannak kötve (pl. egy nyomógomb két A lába) |
| Funkció | a busz, amire a láb vár (I²C, SPI, UART); a Problémák szólnak, ha rossz GPIO-ra kerül |
| Táp (V) | tápbemenetnél a megengedett tartomány, pl. 2.7-3.6 |

## Működés

A **Működés** fül a belső kapcsolás diagramja. Elemei: **lábak**, **logikai kapuk**, **tároló**, **állandó**, **kimenet**, **villamos elemek** (ellenállás, LED, motor…) és **nyomógomb**. A kimenetek a lábakhoz kötve határozzák meg, mit csinál a láb a szimulációban.

Az elején a **Paraméterek**: szám vagy érték, egység, alapérték, tartomány. A **Csúszka** jelölővel szimuláció közben is állítható. A modell értéke kifejezés is lehet, pl. a beépített potméter ellenállása `{ohm*pos/100}`.

## JSON

A **JSON** fülön a teljes leírás látszik és szerkeszthető. Ha olyat írsz bele, amit az űrlap nem tud megjeleníteni, a szerkesztő szól, mielőtt visszaváltanál.

## Mentés

**Mentés** (<kbd>Ctrl</kbd>+<kbd>S</kbd> a szerkesztőben): a **saját könyvtárba** kerül, és ha a tervben már van belőle, ott is frissül.

- A saját könyvtár a böngésződben marad, terv váltásakor is; a **Fájl › Könyvtár exportálása / importálása** viszi át máshová.
- Amit egy tervbe leraksz, az a terv része lesz, így a tervfájllal és a megosztott linkkel együtt utazik.

> **Tipp:** a [Claude](claude) is tud saját alkatrészt készíteni egy adatlapból vagy leírásból; a szerkesztőben utána ugyanúgy módosítható.
