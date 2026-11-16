---
title: Gyártás
description: Anyaglista, beültetési sorrend, 1:1-es nyomtatható lapok, méretrajz SVG-ben és DXF-ben; rögzítőfurat.
---

Amikor a terv kész, a **Gyártás** elrendezés (<kbd>Alt</kbd>+<kbd>4</kbd>, vagy **Fájl › Gyártás: anyaglista, lapok…**) összeállítja, ami a megépítéshez kell. Négy füle van: **Anyaglista**, **Beültetés**, **Méretrajz**, **Lapok**. A rajzok nagyíthatók (<kbd>Ctrl</kbd> + görgő vagy csípés) és mozgathatók; dupla kattintás az egészet mutatja.

## Anyaglista

Az azonos típusú és értékű alkatrészek egy sorban, darabszámmal és címkékkel (pl. „3 × 330 Ω: R1, R2, R5”). Mellette a panel, a vezeték színenként milliméterben, a hidak és a vágások száma. A **CSV letöltése** táblázatkezelőbe viszi.

## Beültetés

A beültetési sorrend lépésenként, pipálható listában. A sorrend a forrasztás logikáját követi:

1. a panel előkészítése (méretre vágás, rögzítőfuratok),
2. a csíkvágások (rézoldal),
3. a vezetékek,
4. az alkatrészek csoportonként, az alacsonyaktól a magasakig (ellenállások, diódák, aztán kondenzátorok, tüskesorok, végül a vezérlőlap),
5. a hidak (rézoldal),
6. a [rézoldali alkatrészek](board#rezoldali-alkatresz),
7. a külső alkatrészek bekötése,
8. ellenőrzés.

![A Beültetés fül: a lépések listája pipákkal, mellette a panel az aktuális lépés elemeinek kiemelésével.](img:assembly "Egy lépésre kattintva a panelen kiemelődnek a hozzá tartozó elemek.")

A pipák tervenként megmaradnak (a **Pipák törlése** újrakezdi), így egy félbehagyott beültetést később folytathatsz. A jelölések (vágás X1…, hídlánc H1…, vezeték V1…) a lapokon is ugyanígy szerepelnek.

## Lapok

Az alkatrészoldal és a rézoldal **1:1 méretarányú** rajza, nyomtatásra. A rézoldal tükrözve van, ahogy forrasztáskor látod. Egy 50 mm-es vonalzó segít ellenőrizni, hogy a nyomtató nem méretezte-e át. A panelre fektetve sablonként használható: hol kell vágni, hová kerül a híd.

A **Nyomtatás…** (<kbd>Ctrl</kbd>+<kbd>P</kbd>) A4-es csomagot készít: lapok, anyaglista, beültetési lépések, méretrajz – amit bejelölsz.

## Méretrajz

Doboz, előlap vagy rögzítés tervezéséhez: az alkatrészek helye és mérete milliméterben, felülnézetben, alatta elölnézet, jobbra oldalnézet a legmagasabb pont magasságával.

![A Méretrajz fül: a panel felülnézete térközméretekkel, alatta elölnézet, jobbra oldalnézet.](img:dims)

A méretezés módja:

| Mód | Mit mér |
| --- | --- |
| **Térköz** (alapértelmezés) | minden test a négy irányban a legközelebbi szomszédjáig vagy a panel széléig |
| **Lánc** | a szélektől és egymástól, egy vonalban |
| **Széltől** | minden elem a legközelebbi panelszéltől |
| **Koordináta** | egy origótól (a panel sarka vagy egy kiválasztott elem) a középpontokig |

A **Mérés** kapcsolóval választod, hogy a testek széléig vagy a középpontjukig mérjen. Alapból a kívülről fontos alkatrészek (gomb, kijelző, csatlakozó) és a vezérlőlap van méretezve, és annak USB-csatlakozója is; a táblázatban bármelyiket ki- vagy bekapcsolhatod.

Export: **SVG** és **DXF** (AutoCAD R12, rétegekkel: panel, furatok, alkatrészek, méretek), CAD-programba vagy lézervágóhoz.

> **Figyelem:** a magasságok és a valós méretek becslések az alkatrészleírásból. Pontos dobozhoz mérd le a saját alkatrészeidet, és írd át őket a [szerkesztőben](custom-parts#alapadatok-es-megjelenes).

## Rögzítőfurat

A **Rögzítőfurat** alkatrész (Mechanika kategória; M2, M2,5, M3) a panel csavaros rögzítéséhez. Furatként jelenik meg a lapokon és a méretrajzon, és a panel előkészítése lépésben szerepel. Az ellenőrzés szól, ha egy láb a csavarfej alá kerül, vagy ha a furat csíkján bekötés van (a fém csavar azt a házzal is összekötné).
