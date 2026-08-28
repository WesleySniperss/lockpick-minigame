/**
 * lockpick-minigame | main.mjs — Foundry VTT v12–v14
 * Uses dynamic imports so errors in other files don't break toolbar buttons.
 * Version-sensitive API lookups live in compat.mjs.
 */

import { DialogV1, getDoorControlClass } from './compat.mjs';

export const MODULE_ID = 'lockpick-minigame';

// ─── Settings ─────────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  console.log(`%c${MODULE_ID} | LOADED ✓`, 'color:lime;font-weight:bold');

  game.settings.register(MODULE_ID, 'breakOnMiss', {
    name: 'Lose a pick on miss',
    scope: 'world', config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, 'defaultDC', {
    name: 'Default Lock DC',
    scope: 'world', config: true, type: Number, default: 15
  });

  // Кому транслювати чужий злам замка. Раніше вікно спостерігача бачив лише
  // GM, і то завжди — тепер обидві аудиторії налаштовуються окремо.
  game.settings.register(MODULE_ID, 'spectateGM', {
    name: 'Show lockpicking to the GM',
    hint: 'Opens a live spectator window for the GM when a player picks a lock.',
    scope: 'world', config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, 'spectatePlayers', {
    name: 'Show lockpicking to other players',
    hint: 'Opens the same live spectator window for everyone else at the table.',
    scope: 'world', config: true, type: Boolean, default: false
  });
});

Hooks.once('ready', () => {
  try { _patchDoorControl(); } catch(e) { console.error(`${MODULE_ID} | _patchDoorControl failed:`, e); }
  _registerSocket();
});

// ─── VTools integration ───────────────────────────────────────────────────────

Hooks.once('vtools.ready', () => {
  VTools.register({
    name   : `${MODULE_ID}-lock`,
    title  : 'Configure Lock',
    icon   : 'fa-solid fa-lock',
    onClick: () => {
      if (!game.user.isGM) return;
      const wall = canvas.walls?.controlled?.[0];
      if (!wall) { ui.notifications.warn('Select a door on the canvas first.'); return; }
      if (wall.document.door === (CONST.WALL_DOOR_TYPES?.NONE ?? 0)) {
        ui.notifications.warn('Selected wall is not a door.'); return;
      }
      openFlagDialog(wall);
    }
  });

  VTools.register({
    name   : `${MODULE_ID}-puzzle`,
    title  : 'Open Puzzle',
    icon   : 'fa-solid fa-puzzle-piece',
    onClick: () => {
      if (!game.user.isGM) return;
      _openPuzzleDialog();
    }
  });
});

// ─── Socket ───────────────────────────────────────────────────────────────────

function _registerSocket() {
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    const { action, type, difficulty, userId } = data;
    console.log(`${MODULE_ID} | socket received:`, action, 'userId:', userId, 'me:', game.user.id);

    if (action === 'openPuzzle') {
      if (!userId || userId === game.user.id) {
        import('./PuzzleApp.mjs').then(m => m.openPuzzle(type, difficulty, data.opts)).catch(console.error);
      }
      return;
    }

    if (action === 'lockpickSpectate') {
      // Хто саме дивиться — вирішують налаштування, а не жорстке «тільки GM».
      if (data.userId === game.user.id) return;          // сам гравець уже грає
      const key = game.user.isGM ? 'spectateGM' : 'spectatePlayers';
      let allowed = game.user.isGM;
      try { allowed = game.settings.get(MODULE_ID, key); } catch (e) {}
      if (!allowed) return;
      const wall = canvas.walls?.get(data.wallId);
      if (!wall) return;
      const { LockpickApp } = await import('./LockpickApp.mjs');
      new LockpickApp(wall, {
        dc         : data.dc,
        rollResult : data.rollResult,
        pickQty    : data.pickQty,
        spectator  : true,
        playerName : data.playerName,
        pins       : data.pins,
      }).render(true);
    }
  });
  console.log(`${MODULE_ID} | socket registered for user: ${game.user.name} (isGM: ${game.user.isGM})`);
}

// ─── Puzzle dialog ────────────────────────────────────────────────────────────

async function _openPuzzleDialog() {
  const { PUZZLE_TYPES, DIFFICULTIES } = await import('./PuzzleApp.mjs');

  const typeOpts   = PUZZLE_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  const diffOpts   = DIFFICULTIES.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
  const playerOpts = game.users.filter(u => u.active)
    .map(u => `<option value="${u.id}">${u.name}${u.isGM ? ' (GM)' : ''}</option>`).join('');

  const langOpts = Object.entries({infernal:'Infernal',abyssal:'Abyssal',elvish:'Elvish'})
    .map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  const d = new DialogV1({
    title: '🧩 Open Puzzle',
    content: `<form id="lpm-puzzle-form" style="padding:4px 0">
      <div class="form-group">
        <label>Type</label>
        <div class="form-fields"><select id="lpm-ptype" name="ptype" style="width:100%">${typeOpts}</select></div>
      </div>
      <div class="form-group">
        <label>Difficulty</label>
        <div class="form-fields"><select name="pdiff">${diffOpts}</select></div>
      </div>
      <div id="lpm-cipher-opts" style="display:none">
        <div class="form-group">
          <label>Language</label>
          <div class="form-fields"><select name="plang" style="width:100%">${langOpts}</select></div>
        </div>
        <div class="form-group">
          <label>Word / phrase</label>
          <div class="form-fields">
            <input type="text" name="pword" placeholder="Leave empty for random" style="width:100%"
                   autocomplete="off" spellcheck="false">
          </div>
        </div>
        <div class="form-group">
          <label>Caesar shift</label>
          <div class="form-fields">
            <input type="number" name="pshift" value="" min="1" max="25" placeholder="Random" style="width:80px">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Send to</label>
        <div class="form-fields">
          <select name="ptarget" style="width:100%">
            <option value="all">👥 All players</option>
            <option value="me">🛡️ Only me (GM)</option>
            <optgroup label="─── Specific player ───">${playerOpts}</optgroup>
          </select>
        </div>
      </div>
    </form>`,
    render: (html) => {
      html.find('#lpm-ptype').on('change', function() {
        html.find('#lpm-cipher-opts').toggle(this.value === 'cipher');
      });
      // Stop keydown propagation so input fields work
      html.find('input').on('keydown', e => e.stopPropagation());
    },
    buttons: {
      open: {
        icon: '<i class="fa-solid fa-puzzle-piece"></i>', label: 'Open',
        callback: async (html) => {
          const { openPuzzle, generatePuzzleOpts } = await import('./PuzzleApp.mjs');
          const type   = html.find('[name="ptype"]').val();
          const diff   = html.find('[name="pdiff"]').val();
          const target = html.find('[name="ptarget"]').val();
          const baseOpts = {
            lang      : html.find('[name="plang"]').val() || undefined,
            customWord: html.find('[name="pword"]').val() || undefined,
            shift     : parseInt(html.find('[name="pshift"]').val()) || undefined,
          };
          // Pre-generate puzzle state so GM and players see the same puzzle
          const opts = generatePuzzleOpts(type, diff, baseOpts);
          const emit = (uid) => game.socket.emit(`module.${MODULE_ID}`, { action:'openPuzzle', type, difficulty:diff, userId:uid, opts });

          if (target === 'me') {
            openPuzzle(type, diff, opts);   // GM plays it themselves
            return;
          }

          // Everything else opens a watch-only mirror for the GM. Warn loudly if
          // there is nobody on the other end, otherwise it just looks broken.
          const recipients = target === 'all'
            ? game.users.filter(u => u.active && !u.isGM)
            : game.users.filter(u => u.id === target && u.active);
          if (!recipients.length) {
            ui.notifications.warn(
              target === 'all'
                ? 'No players are connected — nobody received the puzzle. Use "Only me" to solve it yourself.'
                : 'That player is not connected — they did not receive the puzzle.'
            );
          } else {
            ui.notifications.info(`🧩 Puzzle sent to ${recipients.map(u => u.name).join(', ')}.`);
          }
          emit(target === 'all' ? null : target);
          openPuzzle(type, diff, { ...opts, spectator: true });
        }
      },
      cancel: { label: 'Cancel' }
    },
    default: 'open'
  });
  d.render(true);
}

// ─── Flag dialog ──────────────────────────────────────────────────────────────

export async function openFlagDialog(wall) {
  const doc     = wall.document;
  const enabled = doc.getFlag(MODULE_ID, 'enabled') ?? false;
  const dc      = doc.getFlag(MODULE_ID, 'dc')      ?? game.settings.get(MODULE_ID, 'defaultDC');

  new DialogV1({
    title: '🔒 Configure Lock — Lockpick Minigame',
    content: `<form style="padding:4px 0">
      <div class="form-group">
        <label>Enable lockpick mini-game</label>
        <div class="form-fields">
          <input type="checkbox" name="enabled" ${enabled ? 'checked' : ''}>
        </div>
      </div>
      <div class="form-group">
        <label>Lock DC</label>
        <div class="form-fields">
          <input type="number" name="dc" value="${dc}" min="5" max="30" step="1" style="width:80px">
        </div>
      </div>
    </form>`,
    buttons: {
      save: {
        icon: '<i class="fa-solid fa-save"></i>', label: 'Save',
        callback: async (html) => {
          const newEnabled = html.find('[name="enabled"]').is(':checked');
          const newDc      = parseInt(html.find('[name="dc"]').val()) || 15;
          await doc.setFlag(MODULE_ID, 'enabled', newEnabled);
          await doc.setFlag(MODULE_ID, 'dc', newDc);
          ui.notifications.info(newEnabled ? `Lock enabled — DC ${newDc}` : 'Lockpick minigame disabled.');
        }
      },
      remove: {
        icon: '<i class="fa-solid fa-trash"></i>', label: 'Remove',
        callback: async () => {
          await doc.unsetFlag(MODULE_ID, 'enabled');
          await doc.unsetFlag(MODULE_ID, 'dc');
          ui.notifications.info('Lock flag removed.');
        }
      },
      cancel: { label: 'Cancel' }
    },
    default: 'save'
  }).render(true);
}

// ─── Door click patching ──────────────────────────────────────────────────────

/** Guards against opening several mini-games from repeated clicks on a door. */
let _lockpickBusy = false;

function _patchDoorControl() {
  const DoorControlCls = getDoorControlClass();
  if (!DoorControlCls) {
    console.error(`${MODULE_ID} | DoorControl class not found — door patching skipped.`);
    return;
  }
  const proto = DoorControlCls.prototype;
  const _orig = proto._onMouseDown;
  if (proto._lpmPatched) return;   // guard against double-patching (e.g. hot reload)
  proto._lpmPatched = true;

  proto._onMouseDown = async function (event) {
    // Core only treats button 0 as an activation; don't hijack middle/right clicks.
    if (event.button !== 0) return _orig.call(this, event);

    const doc = this.wall.document;
    if (!doc.getFlag(MODULE_ID, 'enabled'))       return _orig.call(this, event);
    if (doc.ds !== CONST.WALL_DOOR_STATES.LOCKED) return _orig.call(this, event);

    event.preventDefault();
    event.stopPropagation();

    // Don't stack a second mini-game while one is already opening/open.
    if (_lockpickBusy) return;

    const token = canvas.tokens.controlled[0];
    if (!token?.actor)
      return ui.notifications.warn('Select a token to pick this lock.');

    const actor   = token.actor;
    const dc      = doc.getFlag(MODULE_ID, 'dc') ?? game.settings.get(MODULE_ID, 'defaultDC');
    const pickItem = _findLockpicks(actor);

    if (!pickItem)
      return ui.notifications.warn(`🗝️ ${actor.name} has no lockpicks in their inventory!`);
    if ((pickItem.system?.quantity ?? 1) < 1)
      return ui.notifications.warn(`🗝️ ${actor.name} has used up all their lockpicks!`);

    _lockpickBusy = true;
    try {
      const rollResult = await _rollThievesTools(actor, dc);
      if (!rollResult) { _lockpickBusy = false; return; }

      const { LockpickApp } = await import('./LockpickApp.mjs');
      const _wall = this.wall;
      const app = new LockpickApp(_wall, {
        dc, rollResult,
        pickQty: pickItem.system?.quantity ?? 1,
        async consumePick() {
          const q = pickItem.system?.quantity ?? 1;
          if (q <= 1) await pickItem.delete();
          else        await pickItem.update({ 'system.quantity': q - 1 });
        },
        async onSuccess() {
          await doc.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
          ChatMessage.create({
            content: `<p>🔓 <strong>${token.name}</strong> skillfully picked the lock.</p>`,
            speaker: ChatMessage.getSpeaker({ token })
          });
        },
        async onFailure() {
          ChatMessage.create({
            content: `<p>💥 <strong>${token.name}</strong> broke every lockpick. The lock holds.</p>`,
            speaker: ChatMessage.getSpeaker({ token })
          });
        },
        broadcast: true,
        onClose() { _lockpickBusy = false; }
      });
      app.render(true);

      // Оголошуємо злам усім — хто саме побачить вікно, вирішує приймальна
      // сторона за налаштуваннями. GM теж транслює, бо гравці можуть дивитись.
      {
        game.socket.emit(`module.${MODULE_ID}`, {
          action     : 'lockpickSpectate',
          wallId     : _wall.id,
          dc,
          rollResult,
          pickQty    : pickItem.system?.quantity ?? 1,
          playerName : token.name,
          userId     : game.user.id,
          pins       : app.controller.pins.map(p => ({ x: p.x, set: p.set })),
        });
      }
    } catch (err) {
      _lockpickBusy = false;
      console.error(`${MODULE_ID} | failed to open lockpick mini-game:`, err);
    }
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _findLockpicks(actor) {
  return actor.items.find(i => {
    const n = i.name.toLowerCase();
    return n.includes('lockpick') || n.includes('lock pick') ||
           n.includes('відмичк')  || n.includes("thieves' tools") ||
           n.includes('thieves tools') ||
           i.system?.type?.baseItem === 'thievesTools';
  }) ?? null;
}

async function _rollThievesTools(actor, dc) {
  const dexMod    = actor.system.abilities?.dex?.mod ?? 0;
  const prof      = actor.system.attributes?.prof    ?? 2;
  const toolVal   = actor.system.tools?.thievesTools?.value ?? 0;
  const profBonus = Math.floor(toolVal * prof);
  const total     = dexMod + profBonus;
  const sign      = total >= 0 ? '+' : '';

  let roll;
  try {
    roll = await new Roll(`1d20${sign}${total}`).evaluate();
  } catch(e) { console.error(e); return null; }

  await roll.toMessage({
    speaker : ChatMessage.getSpeaker({ actor }),
    flavor  : `🗝️ <strong>Thieves' Tools</strong> — DC ${dc}`,
    rollMode: game.settings.get('core', 'rollMode')
  });

  return { total: roll.total, d20: roll.dice[0].results[0].result, dc, margin: roll.total - dc };
}

