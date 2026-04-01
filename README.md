# Lockpick Minigame — Foundry VTT v12 / dnd5e

A Skyrim-style pin-tumbler lockpicking mini-game for **Foundry VTT v12** with
full **dnd5e** integration (Thieves' Tools check, proficiency, DC scaling).

---

## Installation

Drop the `lockpick-minigame/` folder into your `Data/modules/` directory,
then enable it in **Game Settings → Manage Modules**.

---

## Flagging a Door (GM)

The mini-game only triggers on doors you explicitly flag.

**Step 1** — Set the door wall to **Locked** state in Foundry (right-click the
door control → lock icon).

**Step 2** — Run this macro as GM while the wall is selected on the canvas:

```js
// Macro: Flag selected door for lockpicking
const wall = canvas.walls.controlled[0];
if (!wall) return ui.notifications.warn("Select a wall (door) first.");

const dc = await new Promise(resolve => {
  new Dialog({
    title: "Set Lock DC",
    content: `<p>Enter the DC for this lock:</p>
              <input type="number" id="lpm-dc" value="15" min="5" max="30" style="width:80px">`,
    buttons: {
      ok: {
        label: "Set",
        callback: html => resolve(Number(html.find('#lpm-dc').val()) || 15)
      }
    }
  }).render(true);
});

await wall.document.setFlag('lockpick-minigame', 'enabled', true);
await wall.document.setFlag('lockpick-minigame', 'dc', dc);
ui.notifications.info(`🔒 Door flagged — DC ${dc}`);
```

Or use the JS API shortcut:
```js
// Requires wall to be selected on canvas
game.lockpickMinigame.flagDoor(15);   // DC 15
```

**To unflag a door:**
```js
const wall = canvas.walls.controlled[0];
await wall.document.unsetFlag('lockpick-minigame', 'enabled');
```

---

## How It Works

1. A **player selects their token** and clicks a flagged, locked door.
2. A **Thieves' Tools check** (1d20 + DEX mod + proficiency/expertise) is
   rolled and posted to chat.
3. The **mini-game opens** — difficulty is determined by the roll result vs. DC.
4. **Click each pin** when it touches the green zone to set it.
5. Set all pins → the door unlocks. Run out of picks → failure is posted to chat.

---

## Difficulty Scaling

### Pins and speed (from Door DC)

| DC     | Pins | Speed     |
|--------|------|-----------|
| ≤ 10   | 2    | Slow      |
| 11–14  | 3    | Medium    |
| 15–18  | 4    | Fast      |
| 19–23  | 5    | Very fast |
| ≥ 24   | 6    | Blazing   |

### Green zone size (from roll margin: `total − DC`)

| Margin      | Sweet-spot  | Difficulty    |
|-------------|-------------|---------------|
| +10 or more | Very wide   | Easy          |
| +5 to +9    | Wide        | Comfortable   |
| −4 to +4    | Medium      | Fair          |
| −5 to −9    | Narrow      | Hard          |
| −10 or less | Tiny        | Very hard     |
| Nat 20      | ∞           | Auto-success  |
| Nat 1       | 6 px, 1 pick| Near-impossible |

### Picks available

`max(1, 3 + floor(margin / 5))` — beating the DC by more gives more picks.

---

## Module Settings (GM)

| Setting | Default | Description |
|---------|---------|-------------|
| Require Thieves' Tools item | Off | Block the mini-game if the actor has no tools in inventory |
| Lose a pick on miss | **On** | Clicking outside the green zone consumes a pick |
| Default Lock DC | 15 | Fallback when no `dc` flag is set on the door |

---

## Compatibility

- Foundry VTT **v12**
- dnd5e system **v3.0+**
- No dependencies (libWrapper not required)
