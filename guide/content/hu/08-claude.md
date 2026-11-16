---
title: Claude-dal
description: Tervezés beszélgetve – a beépített agenttel (saját API-kulccsal) vagy a Claude Desktopból és a Claude Code-ból MCP-vel.
---

Mondd el, mit szeretnél építeni: a Claude lerakja az alkatrészeket, beköti, megírja a programot és lefuttatja a szimulációt – a tervben, amit közben látsz. Kétféleképpen érheted el.

| | Beépített agent | Claude Desktop / Claude Code (MCP) |
| --- | --- | --- |
| Hol beszélgetsz | az app **Agent** fülén | a Claude alkalmazásban vagy a terminálban |
| Mi kell hozzá | saját Anthropic API-kulcs | Claude-előfizetés, a Proofboard MCP-bővítménye |
| Költség | az API-használat szerint | az előfizetés része |

Mindkettő ugyanazokat az eszközöket használja: alkatrész lerakása és mozgatása, kapcsolatok, útvonalkeresés, program blokkokból, szimuláció és mérés, saját alkatrész, gyártási adatok.

## Beépített agent

1. Nyisd meg a jobb sáv **Agent** fülét (<kbd>Shift</kbd>+<kbd>5</kbd>).
2. Az **API-kulcs és modell** részben add meg az Anthropic API-kulcsodat. A kulcs csak ebben a böngészőben marad, közvetlenül az Anthropic API-t hívja.
3. Válassz módot:
   - **Megbeszélés:** az agent olvassa és elemzi a tervet, javasol, de nem módosít. Pl. „Milyen tranzisztorral kapcsoljak egy 12 V-os ventilátort?”
   - **Megvalósítás:** épít. Nagyobb változtatás előtt leírja a tervét, és jóváhagyást kér.

![Az Agent fül: a mód választó, az üzenetmező és a projektjegyzet.](img:agent)

- Futás közben az „Agent dolgozik” sáv látszik, a kézi szerkesztés szünetel; <kbd>Esc</kbd> vagy a **Leállítás** megállítja.
- Egy feladat egy visszavonási lépés: <kbd>Ctrl</kbd>+<kbd>Z</kbd> visszaállítja, ami előtte volt.
- A beszélgetések projektenként megmaradnak, a **Korábbi beszélgetések** listából megnyithatók.
- A **Projektjegyzet** a terv része: ide írd, amit az agentnek mindig tudnia kell (pl. „3,7 V-os Li-ion akkuról megy, 40×60 mm-es dobozba kerül”).

## Claude Desktop és Claude Code (MCP)

A Proofboard MCP-szerverével a Claude a saját előfizetéseddel dolgozik, a terv pedig élőben változik a böngészőben.

1. Az appban: **Fájl › Claude-kapcsolat…** (<kbd>Alt</kbd>+<kbd>C</kbd>).
2. **Claude Desktop:** töltsd le a bővítményt (**Claude Desktop-bővítmény letöltése**, `proofboard.mcpb`), és nyisd meg dupla kattintással; a Claude Desktop felajánlja a telepítést.
3. **Claude Code:** `claude mcp add proofboard -- npx -y proofboard-mcp`
4. Hagyd nyitva a Proofboardot a böngészőben: a fejlécben a jelző mutatja, hogy kapcsolódott. Ha nincs nyitva, a Claude felület nélkül, egy memóriabeli terven dolgozik, és fájlba mentheti.

A kapcsolat csak a saját gépeden megy (127.0.0.1), és csak a Proofboard oldaláról fogad el kapcsolódást. Egymás utáni hívások egy visszavonási lépést alkotnak.

> **Tipp:** jó kérések: „Tegyél egy gombot a GP14-re, és minden nyomásra váltson a LED.” · „Miért nem világít a LED1?” · „Tömörítsd a tervet, de a gombok maradjanak a helyükön.” · „Készíts saját alkatrészt a BME280 modulhoz ezzel a lábkiosztással: …”
