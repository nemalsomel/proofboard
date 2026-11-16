---
title: Program és kód
description: A vezérlőlap programja blokkokból, élő értékekkel; MicroPython- és Arduino-kód, PlatformIO-projekt; meglévő kód importálása.
---

A vezérlőlap viselkedését blokkokból rakod össze: bemenet → logika vagy időzítés → kimenet. Ugyanez fut a szimulációban, és ebből készül a MicroPython- vagy Arduino-kód.

## Hol szerkeszted?

- A **Program** elrendezés (<kbd>Alt</kbd>+<kbd>2</kbd>) a programot mutatja nagyban.
- A munkaterület fölötti **Panel / Program / Mindkettő** (<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>) közül a **Mindkettő** egymás mellé teszi a panelt és a programot. A határuk húzható.

![A Program elrendezés Mindkettő nézetben: balra a blokkok (Analóg bemenet, PWM kimenet), jobbra a panel a joystickkal és a LED-del.](img:program "A joystick állása szabályozza a LED fényerejét: Analóg bemenet → PWM kimenet.")

## Blokkok

A **+ Blokk** menüből adsz hozzá újat. A kimenetét (jobb oldali pont) a következő blokk bemenetére (bal oldali pont) húzva kötöd össze. A kijelölt blokkot vagy élt a <kbd>Delete</kbd> törli.

| Csoport | Blokkok |
| --- | --- |
| Bemenet | **Digitális bemenet** (gomb, kapcsoló), **Analóg bemenet** (potméter, joystick, ADC), **Állandó** |
| Logika | **NEM**, **ÉS**, **VAGY**, **KIZÁRÓ VAGY**, **Összehasonlítás** (pl. analóg érték > küszöb) |
| Idő | **Ütemadó** (villogás), **Váltókapcsoló** (élre vált), **Számláló**, **Időzítő** (utánfutás), **Sorozat** (lépések idővonalon, pl. futófény, léptetőmotor) |
| Kimenet | **Digitális kimenet** (LED, relé), **PWM kimenet** (fényerő, motor sebesség, szervó) |

A bemeneti és kimeneti blokk **a panel egy lábára** hivatkozik (pl. SW1.A, LED1.A), nem egy GPIO-számra. A GPIO-t a bekötés adja, így ha átkötöd vagy [lecseréled a vezérlőlapot](board#vezerlolapok-es-vezerlocsere), a program érvényes marad.

> **Tipp:** szimuláció közben a blokkok élei és portjai az aktuális értéket mutatják: látod, hol akad el a jel.

Néhány példa a **Fájl › Példák** Program kategóriájából: villogó LED, váltókapcsoló, fényerő joystickkal, futófény Sorozattal, két gomb ÉS kapuval, lépcsőházi világítás utánfutással.

## Kód

A **Kód** fülön (<kbd>Shift</kbd>+<kbd>4</kbd>) a programból generált kód látszik, **MicroPython** vagy **Arduino** nyelven. A vezérlőlap szerinti részleteket (lábszámok, PWM, ADC) a program tudja.

![A Kód fül: a futófény programja Arduino-kódként.](img:code)

- **Másolás:** a vágólapra, a Thonny-ba vagy az Arduino IDE-be beilleszthető.
- **PlatformIO-projekt:** zip-ben, a haladóknak (VS Code + PlatformIO).
- A kódsorra kattintva kiemelődik a blokk, amelyből készült.

## Kód importálása

Ha már van egy Arduino- vagy MicroPython-vázlatod, a **Kód › Importálás…** (<kbd>Alt</kbd>+<kbd>I</kbd>) blokkprogrammá alakítja.

1. Illeszd be a kódot vagy válassz fájlt; a nyelvet felismeri.
2. Az előnézet mutatja, milyen blokkok lesznek belőle, és mi az, amit nem tudott lefordítani (sorszámmal; rákattintva a kódban kijelöli).
3. **Csere** (a mostani programot lecseréli) vagy **Hozzáadás**. Egy lépésben visszavonható.

A felismert minták: kimenetek `delay`-jel (Ütemadó vagy Sorozat), `digitalRead` / `analogRead` és feltételek (logikai blokkok, Összehasonlítás), `x = !x` (Váltókapcsoló), `(n+1) % M` (Számláló), `millis()`-időzítők (Ütemadó, Időzítő). A pergésmentesítést kihagyja, mert a blokkok ezt maguk kezelik.

> **Figyelem:** az importálás nem soronkénti fordítás, hanem a program szándékának felismerése. Bonyolult vezérlési szerkezeteknél (függvények, tömbök, megszakítások) csak a felismert részek kerülnek át, a többit a lista jelzi.
