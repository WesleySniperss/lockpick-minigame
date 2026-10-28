# Lockpick Minigame — Foundry VTT v12–v14 · dnd5e & Level Up (a5e)

Mini-games the GM requests for a specific character, for **Foundry VTT** with
**dnd5e** and **Level Up Advanced 5e**: a pin-tumbler **lockpicking** game
(Thieves' Tools check) and three **Arcana** workings — unweave a ward, attune
to a resonance, trace a sigil. The character's roll, made the system's own way,
decides how hard the game is. Plus a set of puzzles the GM can hand out.

---

## Installation

Drop the `lockpick-minigame/` folder into your `Data/modules/` directory,
then enable it in **Game Settings → Manage Modules**.

---

## Requesting a challenge (GM)

Nothing is tied to doors or tiles: the GM asks a specific character for a
challenge whenever the story needs it.

1. **VTools → Request a Challenge** — choose the challenge (the lock or one of
   the Arcana workings), the character (the selected token's character is first
   in the list), the **DC** and, optionally, **what it is on** ("Iron-bound
   chest", "Sealed vault door"). Tick **Secret** to keep the DC from the
   players: it is left off the card, the roll and the game, and only the GM's
   copy of the card shows it.
2. A **request card** appears in chat. Only that character's owner (and the GM)
   gets the button (**Roll & pick the lock**, **Roll Arcana & unweave**, …);
   everyone else sees "Waiting for …". If several players own the character,
   the first one to press it gets the attempt.
3. The card follows the attempt: *picking…* → *Picked by …* or *The lock held*
   (*Unwoven by …* / *The ward held* and so on for Arcana). After a failure the
   GM can **Allow another try**.

Once the check is rolled, the attempt counts. Closing the game before the end is
giving up (*… gave up*), so a bad roll cannot be re-rolled by walking away; the
GM can still allow another try. If a player's game is cut off (reload, crash,
lost connection), the card says so on its own, and the GM also has a **Reset**
button on any card still in progress. The GM's client records the results, so a
GM has to be online for players to start a challenge.

From a macro:

```js
const api = game.modules.get('lockpick-minigame').api;
const actor = canvas.tokens.controlled[0]?.actor;
api.requestLockpick({ actor, dc: 17, label: 'Iron-bound chest' });
api.requestChallenge({ kind: 'ward', actor, dc: 16, label: 'Sealed vault door', hideDC: true });
//                     kind: 'lock' | 'ward' | 'resonance' | 'sigil'
api.openRequestDialog('sigil');   // the toolbar dialog, with a challenge preselected
```

### The roll

The check is rolled the way the game system rolls it, so its roll dialog,
advantage and disadvantage, Reliable Talent, expertise dice and situational
bonuses all apply, and the roll card is the system's own:

| | dnd5e | Level Up (a5e) | any other system |
|---|---|---|---|
| Lockpicking | Thieves' Tools check (a Dexterity check without the tools) | Dexterity check, the Thieves' Tools proficiency pre-filled as a situational bonus | 1d20 + Dex + proficiency |
| Arcana | Arcana skill check | Arcana skill check | 1d20 + the Arcana bonus |

Closing the system's roll dialog cancels the attempt and leaves the card open.
With Dice So Nice the game opens once the die has landed.

---

## Lockpicking

### How it works

1. The player presses **Roll & pick the lock** on the request card.
2. The **check** is rolled (see *The roll* above) — it sets how hard the game
   will be. Without Thieves' Tools it is a plain Dexterity check.
3. The **mini-game opens** — a cutaway of the lock with the pick in the keyway.
4. **Hold** the mouse to slide the pick, **release on green** under a pin to set
   it; releasing on red costs an attempt.
5. Set all pins → **Lock Picked**. Three misses → the attempt fails. With
   **Thieves' Tools** nothing breaks — the pins drop back and the lock stays
   shut; with **Lockpicks** one pick snaps and is removed from the inventory.

Optionally the GM and/or the other players can watch the attempt live (see
settings).

### Difficulty

The lock always has 7 pins. **The DC decides how many you must set** (the rest
start already set):

| DC      | Pins to set |
|---------|-------------|
| below 15 | 2 |
| 15–16   | 3 |
| 17–19   | 4 |
| 20–24   | 5 |
| 25–29   | 6 |
| 30+     | 7 |

**The roll decides how the pick handles.** The further the roll beats the DC,
the slower and steadier the pick moves; a roll under the DC makes it fast and
jerky (higher DCs add speed too). A natural 20 gives the calmest pick, a
natural 1 the wildest. The target zones never change size: a green zone under
each pin, with a red band on both sides.

### Tools

What a character needs is a world setting (**Tool needed to pick a lock**):

| Mode | Needs | On a failed attempt |
|------|-------|---------------------|
| Nothing *(default)* | — anyone can try; carried Thieves' Tools add their proficiency, without them it is a Dexterity check | nothing is lost |
| Thieves' Tools | an item named Thieves' Tools (or dnd5e base item `thief`) | nothing is lost |
| Lockpicks | an item named Lockpick(s), quantity ≥ 1 | one lockpick snaps |
| Either | Thieves' Tools if carried, otherwise Lockpicks | as above |

---

## Arcana challenges

Each one starts with an **Arcana check** (see *The roll* above). As with
locks, **the DC shapes the puzzle and the roll decides how much room the caster
gets**; a natural 20 and a natural 1 are the extremes. Every working is
generated from a seed, so spectators see exactly the same board.

### Unweave the Ward

The goal is written on the board: **lead the light from the core to every
crystal on the rim**. Between them sit rune rings, each with a channel that has
a **gate** on its inner edge and one on its outer edge. The light runs outward
as far as the gates line up. Where it stops, it glows at the next ring's inner
edge and that ring's gate pulses amber: turn the ring until the gate meets the
light.

**Drag** a ring to turn it (a click turns it one step clockwise, a right-click
one step back, the mouse wheel works too). Every step costs **Focus**; when it
runs out, the ward holds. A **golden link** means turning one ring turns
another as well (crossed: the other way). Hovering a ring outlines every ring
that will move with it. Nothing is hidden: every gate and link is on the board
from the start.

| DC | ≤ 12 | 13–17 | 18+ |
|----|------|-------|-----|
| Rings | 3 | 4 | 5 |
| Golden links | 0 | 1 | 2 |

From DC 15 there are two crystals instead of one. **The roll** sets the spare
Focus on top of the fewest turns that solve the ward: +10 on a natural 20, +8
when it beats the DC by 10, +6 by 5, +4 when it just makes it, +3 when it misses
by up to 4, +2 below that and +1 on a natural 1. Beating the DC by 5 (or a
natural 20) adds a dotted trace from the amber gate to the light: which way to
turn and how far.

### Attune the Resonance

An arcane hum (the violet wave) runs through the scope. Shape your own wave
(cyan) with three dials — **frequency, amplitude, phase**. Each dial has a
light: **green** when that dial matches the hum, amber when it is close. With
all three green you are **in tune**: both waves turn gold and the attunement
bar fills; out of tune it drains at half that speed. Fill it before your
**Concentration** runs out. The hum breathes slowly around its note, so keep an
eye on the lights while you hold it. The mouse wheel fine-tunes a dial (Shift
for finer steps). With sound on, you hear both tones.

| DC | ≤ 12 | 13–17 | 18+ |
|----|------|-------|-----|
| How exact (frequency / amplitude / phase) | ±0.12 / ±10% / ±24° | ±0.09 / ±8% / ±19° | ±0.065 / ±6% / ±15° |
| Time to hold it | 3 s | 4 s | 5 s |

**The roll** sets Concentration: 45 s ± 2 s per point above or below the DC,
between 30 and 70 s (80 s on a natural 20, 30 s on a natural 1). The better the
roll, the less the hum moves. Beating the DC by 5 marks the hum's true
frequency on its dial; a natural 20 marks all three.

### Trace the Sigil

A sigil flares across a field of stars and fades. Then draw it again from
memory, **star by star, in the same order** — click each star or drag through
them. A wrong star **cracks** the line; three cracks and the working fails.
**Mana** drains while you trace.

| DC | ≤ 12 | 13–17 | 18+ |
|----|------|-------|-----|
| Strokes | 4 | 6 | 8 |

**The roll** sets how long the sigil stays lit (2.6 s ± 0.15 s per point,
1.2–5 s; 6 s on a natural 20, 1 s on a natural 1) and the mana (22 s ± 1 s per
point, 10–35 s; 40 s on a natural 20, 10 s on a natural 1). A successful check
marks the first star. Beating the DC by 5 gives one **Recall** (the sigil plays
again for 4 s of mana; tracing waits until it is over); a natural 20 gives two.

---

## Puzzles (GM)

Open **VTools → Open Puzzle**: Sudoku, Sliding tiles, Cipher or Rune sequence,
each in three difficulties.

- **Send to** — all connected players, one player, or **Only me** (the GM solves
  it; also used automatically when no player is connected).
- **Solve together** (checkbox) — *checked*: one shared puzzle, every move by
  anyone appears for everyone and one solve ends it for all; *unchecked*: each
  player gets their own copy of the same puzzle.
- The GM gets a spectator window with a roster of the players and their status.
  With own copies, click a name to see that player's board; **Join in / Solve a
  copy** lets the GM play too.

---

## Module Settings (GM)

| Setting | Default | Description |
|---------|---------|-------------|
| Tool needed to pick a lock | **Nothing** | Nothing / Thieves' Tools / Lockpicks / Either — see *Tools* |
| Default DC | 15 | Pre-filled in the request dialog |
| Keep the DC secret by default | Off | Pre-ticks **Secret** in the request dialog |
| Show challenges live to the GM | **On** | Spectator window for the GM while a player picks a lock or works an Arcana challenge |
| Show challenges live to other players | Off | The same window for everyone else |

---

## Compatibility

- Foundry VTT **v12 – v14** (verified on v14)
- dnd5e system **v3.0+**
- Level Up Advanced 5e (a5e) system
- No dependencies. VTools adds the toolbar buttons; without it use the macro API.

### Foundry versions

Every window and dialog is an **ApplicationV2** / **DialogV2** (no jQuery), so
nothing depends on the V1 framework that core removes in v16. The game windows
share one base ([`scripts/app-window.mjs`](scripts/app-window.mjs)): always
dark, and never popped out into a separate browser window (the games listen
for the pointer and animation frames on the main one). The remaining
version-sensitive lookups live in [`scripts/compat.mjs`](scripts/compat.mjs):

| API | v12 | v13 / v14 |
|---|---|---|
| Chat card hook | `renderChatMessage` (jQuery) | `renderChatMessageHTML` (HTMLElement) |
| UUID lookup | `fromUuidSync` | `foundry.utils.fromUuidSync` |
| DialogV2 content | an HTML string | a `<div>` (a string would be sanitised) |
