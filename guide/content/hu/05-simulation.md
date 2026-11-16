---
title: Szimuláció és mérés
description: A szimuláció indítása, gombok és csúszkák, GPIO-módok; multiméter, szondák, szkóp és áramfelvétel.
---

A szimuláció egyenáramú, gyors közelítés: áramokat, feszültségszinteket, zárlatokat mutat, és futtatja a programot. Tervezéshez és hibakereséshez készült, nem helyettesíti a mérést és nem SPICE-szimulátor.

## Indítás

A fejléc **Szimuláció** gombja vagy <kbd>S</kbd> indítja és állítja le. A **Szimuláció** elrendezés (<kbd>Alt</kbd>+<kbd>3</kbd>) a panelt és a Szimuláció fület teszi előtérbe.

![Szimuláció egy Nokia 5110 kijelzővel: a panelen a feszültségtérkép, jobbra a Szimuláció fül a GPIO-k módjával és szintjével.](img:sim "A rézcsíkok színe a feszültségüket mutatja; jobbra a GPIO-k és a LED-ek állapota.")

Futás közben:

- a **gombra kattintva** lenyomod. A Szimuláció fülön választhatsz, hogy a gomb **Nyomva tartás** (amíg nyomod) vagy **Kapcsoló** (kattintásra vált) módon működjön;
- a **potméter, joystick** és a többi csúszkás paraméter a tulajdonságpanelen állítható;
- a **LED** az áramával arányosan világít, a **motor** forog, a **szervó** a jel szerint áll, a **kijelző** háttérvilágítása kigyullad;
- a **rézcsíkok színe** a feszültségüket mutatja (feszültségtérkép, a Műszerek fülön jelmagyarázattal);
- a program fut, a blokkok élei az értékeket mutatják.

A szimuláció alatt a panel szerkesztése szünetel; a bekötést leállítva módosíthatod.

## GPIO-k és táp

A **Szimuláció** fülön (<kbd>Shift</kbd>+<kbd>3</kbd>) látod a vezérlőlap lábait: módjukat, szintjüket, feszültségüket. A program nélküli lábak módja kézzel is állítható:

| Mód | Jelentés |
| --- | --- |
| be, felhúzva / lehúzva | bemenet belső fel- vagy lehúzó ellenállással (gombhoz) |
| be, lebegő | bemenet ellenállás nélkül; a Problémák szólnak, ha ettől lebeg |
| analóg (ADC) | feszültségmérés (csak ADC-s lábon) |
| ki: 1 / ki: 0 | kimenet, magas vagy alacsony szint |
| ki: PWM | kitöltés % és frekvencia Hz; a gyors PWM-et a szem és a szimuláció is átlagnak látja |

Ha a programban van kimeneti blokk egy lábra, azt a program vezérli. Az **USB táp a vezérlőn** kapcsolóval azt szimulálod, hogy a lap USB-ről kap tápot (különben a panelon lévő telep vagy táp táplálja).

## Műszerek

A bal sáv **Műszerek** fülén mérőműszereket teszel a tervbe. A mérőcsúcsok helye a terv része, mentéskor megmarad.

![A Műszerek fül: multiméter feszültségmérésben és szkóp egy villogó LED jelével.](img:meters)

### Multiméter

1. Adj hozzá egy **Multimétert**, és válaszd ki a mérés módját: **Feszültségmérés**, **Árammérés**, **Ellenállásmérés** vagy **Szakadásvizsgálat**.
2. A **Piros** csúcs **Letesz** gombja után a panelen egy lyukra kattintva teszed le a csúcsot (<kbd>Esc</kbd>: mégse); a **Fekete** csúcsot ugyanígy. Fekete csúcs nélkül a GND-hez mér.
3. Áramméréshez a piros csúcsot egy alkatrész lábára tedd: az azon a lábon befolyó áramot mutatja.
4. Az ellenállást és a szakadást a táp nélküli áramkörön méri (ellenállások, motorok, tekercsek); átvezetésnél csipog.

### Szondák

Egy **szonda** egy pont feszültségét mutatja a panelen, közvetlenül a lyuk mellett: hozzáadás után kattints a lyukra. Gyors áttekintésre jó, több is lehet.

### Szkóp

A **szkóp** legfeljebb 4 csatornán rajzolja a feszültséget az idő függvényében, amíg a szimuláció fut.

- **Ablak:** 0,5–10 s.
- **Indítás:** szabadon fut, vagy az 1. csatorna felfutó / lefutó élére áll be (1,5 V-nál).
- **Megállítás** és **kurzor:** a görbére kattintva leolvasod az időt és az értékeket.
- A gyors PWM a szimulációban átlag; a csatornán felirat jelzi a beállított frekvenciát és kitöltést.

### Elrendezés

Minden műszer lebegő ablakba is húzható a panel fölé: a címsoránál fogva mozgatod, a vászon bal széléhez engedve visszakerül a fülre. Elrejtve a csúcsai halványan a panelen maradnak.

## Áramfelvétel

A Műszerek fül alján az **Áramfelvétel** a futó szimulációból mutatja:

- a **forrásokat** (USB, telep) a leadott árammal és teljesítménnyel,
- a **legnagyobb fogyasztókat** alkatrészenként,
- a **becsült üzemidőt** a **Telep kapacitása** (mAh) mezőből.

A vezérlőlap saját fogyasztása nincs benne, csak amit meghajt (GPIO-k, 3V3).
