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

1. **VTools → Puzzles & Challenges** (the module's only button) — under
   **What**, pick a rolled challenge (the lock or one of the Arcana workings),
   then the character (the selected token's character is first in the list),
   the **DC** and, optionally, **what it is on** ("Iron-bound chest", "Sealed
   vault door"). Tick **Secret** to keep the DC from the players: it is left
   off the card, the roll and the game, and only the GM's copy of the card
   shows it. Tick **Others can watch** to give the other players a read-only
   window of the attempt, so they can follow every move live. (The same menu
   sends puzzles — see *Puzzles*.)
2. A **request card** appears in chat. Only that character's owner (and the GM)
   gets the button (**Roll & pick the lock**, **Roll Arcana & unweave**, …);
   everyone else sees "Waiting for …". If several players own the character,
   the first one to press it gets the attempt.
3. The card follows the attempt: *picking…* → *Picked by …* or *The lock held*
   (*Unwoven by …* / *The ward held* and so on for Arcana). After a failure the
   GM can **Allow another try**.

The cards have no colours of their own: they sit on your chat's message card
and take its theme (core, the game system, Carolingian UI and its colour
scheme), with the outcome shown by the icon's colour.

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
api.requestChallenge({ kind: 'ward', actor, dc: 16, label: 'Sealed vault door', hideDC: true, watch: true });
//                     kind: 'lock' | 'ward' | 'resonance' | 'sigil'
api.openMenu('sigil');            // the menu, with a challenge or a puzzle ('sudoku', …) preselected
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

The GM watches the attempt live, and so do the other players when **Others can
watch** is ticked on the request (see *Module Settings*).

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

The goal is written on the board: **line up the gaps to light the crystal**. The
core at the centre shoots a straight beam at a crystal on the rim. Between them
sit rune rings, each a solid wall with one **gap** in it, and the beam stops at
the first ring whose gap is off its line; that gap pulses amber. Turn the ring
until its gap is on the beam and the light runs on to the next ring. When every
gap is on the line, the crystal lights and the ward comes apart.

**Drag** a ring to turn it (a click turns it one step clockwise, a right-click
one step back, the mouse wheel works too). Turning is free. A **golden link**
means turning the ring at its knot also turns the ring at its arrow (crossed:
the other way). Hovering a ring outlines every ring that will move with it.
Nothing is hidden: every gap and link is on the board from the start.

**How you lose:** the ward knits itself back together. A violet seam stitches
its way round the rim from the top, clockwise; when it closes the circle, the
ward holds. The seconds count down in the corner of the board and in the footer
(*Rim closes in*).

| DC | ≤ 12 | 13–17 | 18–21 | 22+ |
|----|------|-------|-------|-----|
| Rings | 3 | 4 | 5 | 5 |
| Golden links | 0 | 1 | 2 | 3 |
| Time before the rim closes | 40 s | 50 s | 60 s | 60 s |

**The roll** adds or takes 2 s per point above or below the DC (from 60 % to
160 % of the base time; ×1.8 on a natural 20, ×0.6 on a natural 1). Beating the
DC by 5 (or a natural 20) adds a dotted trace from the amber gap to the beam:
which way to turn and how far.

### Attune the Resonance

The working's resonance is a **wandering light** in a dark scrying pool ringed
with nine runes. Your **focus** is a ring of light that chases the mouse. Keep
the light inside it: the ring turns gold, the runes around the pool wake one by
one and a clean fifth sounds over the hum. Outside the ring the attunement
slowly fades (at 40 % of the speed it grows). Wake all nine runes before your
**Concentration** runs out.

| DC | ≤ 12 | 13–17 | 18+ |
|----|------|-------|-----|
| Time inside the focus to attune | 6 s | 8 s | 10 s |
| How restless the light is | quick | fast | very fast, with sudden swerves |

**The roll** decides how well your focus obeys you. The better it beats the DC,
the wider the ring, the sharper it answers the mouse and the faster it can move
at all; a low roll leaves it narrow and dragging behind your hand, and at a high
DC the light can outrun it for a moment, so you have to lead it. A natural 20 is
the widest and sharpest, a natural 1 the narrowest and slowest. Concentration:
40 s ± 2 s per point, between 30 and 65 s (75 s on a natural 20, 30 s on a
natural 1).

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

Open **VTools → Puzzles & Challenges** and pick a puzzle under **What**:
Sudoku, Sliding tiles, Cipher or Rune sequence, each in three difficulties.

- **Send to** — all connected players, one player, or **Only me** (the GM solves
  it; also used automatically when no player is connected).
- **Solve together** (checkbox) — *checked*: one shared puzzle, every move by
  anyone appears for everyone and one solve ends it for all; *unchecked*: each
  player gets their own copy of the same puzzle.
- **Others can watch** (checkbox) — when the puzzle goes to one player, or the GM
  solves it alone, everyone else online gets a read-only window and can follow it
  live. Only the GM sees a cipher's answer, and only the GM can join in.
- The GM gets a spectator window with a roster of the players and their status.
  With own copies, click a name to see that player's board; **Join in / Solve a
  copy** lets the GM play too.
- Watching a sudoku, the GM can tick **Show the answers**: the players' right
  digits turn green, wrong ones red, and every empty cell shows its answer
  faintly. Only the GM's window shows it; the tick is remembered.

---

## Module Settings (GM)

| Setting | Default | Description |
|---------|---------|-------------|
| Tool needed to pick a lock | **Nothing** | Nothing / Thieves' Tools / Lockpicks / Either — see *Tools* |
| Default DC | 15 | Pre-filled in the Puzzles & Challenges menu |
| Keep the DC secret by default | Off | Pre-ticks **Secret** in the menu |
| Show challenges live to the GM | **On** | Spectator window for the GM while a player picks a lock or works an Arcana challenge |
| Others can watch by default | Off | Pre-ticks **Others can watch** in the menu |

---

## Compatibility

- Foundry VTT **v12 – v14** (verified on v14)
- dnd5e system **v3.0+**
- Level Up Advanced 5e (a5e) system
- No dependencies. VTools adds the toolbar button; without it use the macro API (`api.openMenu()`).

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
