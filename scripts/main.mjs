/**
 * lockpick-minigame | main.mjs — Foundry VTT v12–v14
 * Uses dynamic imports so errors in other files don't break toolbar buttons.
 * Version-sensitive API lookups live in compat.mjs.
 */

import { DialogV1, getDoorControlClass } from './compat.mjs';
import { TOOL_MODES, resolveTool, toolCheckTerms, rollFormula } from './tools.mjs';
import { resultCard, checkFlavor, esc } from './cards.mjs';

export const MODULE_ID = 'lockpick-minigame';

// ─── Settings ─────────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  console.log(`%c${MODULE_ID} | LOADED ✓`, 'color:lime;font-weight:bold');

  // Systems ship Thieves' Tools, not "lockpicks" — the GM picks what is needed.
  // (Replaces the old 'breakOnMiss' setting, which nothing ever read.)
  game.settings.register(MODULE_ID, 'toolMode', {
    name: 'Tool needed to pick a lock',
    hint: "Thieves' Tools are never used up: a failed attempt only leaves the lock shut. "
        + 'Lockpicks are consumable: a failed attempt snaps one.',
    scope: 'world', config: true, type: String, default: 'thieves',
    choices: TOOL_MODES,
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
      // userIds = exact recipients. Never open a playable copy for a GM that was
      // not picked, or an assistant GM would get one on every broadcast.
      const ids = data.userIds ?? (userId ? [userId] : null);
      if (ids ? !ids.includes(game.user.id) : game.user.isGM) return;
      import('./PuzzleApp.mjs').then(m => m.openPuzzle(type, difficulty, data.opts)).catch(console.error);
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
        tool       : data.tool,
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

  const esc        = s => foundry.utils.escapeHTML?.(s) ?? String(s).replace(/[&<>"']/g, '');
  const typeOpts   = PUZZLE_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  const diffOpts   = DIFFICULTIES.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
  // Other connected users only: picking yourself used to open nothing but a
  // read-only spectator window, which looked like a puzzle that ignores clicks.
  const others     = game.users.filter(u => u.active && u.id !== game.user.id);
  const players    = others.filter(u => !u.isGM);
  const playerOpts = others
    .map(u => `<option value="${u.id}">${esc(u.name)}${u.isGM ? ' (GM)' : ''}</option>`).join('');

  const langOpts = Object.entries({infernal:'Infernal',abyssal:'Abyssal',elvish:'Elvish'})
    .map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  const d = new DialogV1({
    title: 'Open Puzzle',
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
            <option value="all" ${players.length ? 'selected' : ''}>All connected players (${players.length})</option>
            <option value="me" ${players.length ? '' : 'selected'}>Only me — I solve it</option>
            ${playerOpts ? `<optgroup label="─── Specific player ───">${playerOpts}</optgroup>` : ''}
          </select>
        </div>
      </div>
      <div class="form-group lpm-shared-group">
        <label for="lpm-pshared">Solve together</label>
        <div class="form-fields"><input type="checkbox" id="lpm-pshared" name="pshared"></div>
        <p class="hint lpm-shared-hint"></p>
      </div>
    </form>`,
    render: (html) => {
      // The window keeps the pixel height it was first given; without a refit the
      // cipher fields pushed the Open button below the window's bottom edge.
      const refit = () => d.setPosition({ height: 'auto' });
      html.find('#lpm-ptype').on('change', function() {
        html.find('#lpm-cipher-opts').toggle(this.value === 'cipher');
        refit();
      });
      // Explain the checkbox in terms of what the players will actually get.
      const syncShared = () => {
        const target = html.find('[name="ptarget"]').val();
        const box    = html.find('[name="pshared"]');
        const group  = target === 'all' && players.length > 1;
        box.prop('disabled', !group);
        html.find('.lpm-shared-group').toggleClass('lpm-disabled', !group);
        html.find('.lpm-shared-hint').text(!group
          ? 'Only matters when several players get the puzzle.'
          : box.is(':checked')
            ? 'ONE shared puzzle: everyone sees and moves the same pieces, and one solve opens it for all.'
            : 'Each player gets their OWN copy of the same puzzle and solves it alone.');
      };
      html.find('[name="ptarget"], [name="pshared"]').on('change', () => { syncShared(); refit(); });
      syncShared();
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
          const solo   = target === 'me' || target === game.user.id;
          const recipients = solo ? []
            : target === 'all' ? game.users.filter(u => u.active && !u.isGM)
            : game.users.filter(u => u.id === target && u.active);
          const shared = recipients.length > 1 && html.find('[name="pshared"]').is(':checked');

          // Pre-generate puzzle state so GM and players see the same puzzle
          const opts = generatePuzzleOpts(type, diff, {
            lang      : html.find('[name="plang"]').val() || undefined,
            customWord: html.find('[name="pword"]').val() || undefined,
            shift     : parseInt(html.find('[name="pshift"]').val()) || undefined,
            shared,
            recipients: recipients.map(u => ({ id: u.id, name: u.name })),
          });

          // Nobody on the other end: open it playable for the GM instead of a
          // read-only mirror of nothing (that looked like a puzzle that ignores clicks).
          if (!recipients.length) {
            if (!solo) ui.notifications.warn(target === 'all'
              ? 'No players are connected — opening the puzzle for you to solve.'
              : 'That player is not connected — opening the puzzle for you to solve.');
            openPuzzle(type, diff, opts);
            return;
          }

          game.socket.emit(`module.${MODULE_ID}`, {
            action: 'openPuzzle', type, difficulty: diff, userIds: recipients.map(u => u.id), opts,
          });
          ui.notifications.info(`${shared ? 'Shared puzzle' : 'Puzzle'} sent to ${recipients.map(u => u.name).join(', ')}.`);
          // The GM watches (and can join from the spectator window).
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
    title: 'Configure Lock — Lockpick Minigame',
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

/**
 * Hook the door click.
 *
 * With libWrapper present we register a MIXED wrapper instead of assigning the
 * prototype method. Assigning it directly is what produced "Lockpick Minigame
 * and Monk's Active Tile Triggers modify the same FoundryVTT functionality":
 * MATT wraps this exact method through libWrapper, and libWrapper traps any
 * direct overwrite of a wrapped method as a conflict. As MIXED we sit inside
 * MATT's WRAPPER, so MATT still runs its door triggers on every click.
 */
function _patchDoorControl() {
  const DoorControlCls = getDoorControlClass();
  if (!DoorControlCls) {
    console.error(`${MODULE_ID} | DoorControl class not found — door patching skipped.`);
    return;
  }

  const handler = function (wrapped, event) {
    if (!_shouldIntercept(this, event)) return wrapped(event);
    event.preventDefault?.();
    event.stopPropagation?.();
    _startLockpick(this.wall).catch(err => {
      _lockpickBusy = false;
      console.error(`${MODULE_ID} | failed to open lockpick mini-game:`, err);
    });
    return false;
  };

  if (globalThis.libWrapper && game.modules.get('lib-wrapper')?.active) {
    const target = foundry?.canvas?.containers?.DoorControl
      ? 'foundry.canvas.containers.DoorControl.prototype._onMouseDown'
      : 'DoorControl.prototype._onMouseDown';
    libWrapper.register(MODULE_ID, target, handler, 'MIXED');
    return;
  }

  // No libWrapper: patch directly, once.
  const proto = DoorControlCls.prototype;
  if (proto._lpmPatched) return;
  proto._lpmPatched = true;
  const orig = proto._onMouseDown;
  proto._onMouseDown = function (event) { return handler.call(this, orig.bind(this), event); };
}

/**
 * Should this click open the mini-game instead of the core door behaviour?
 * Mirrors the core guards first, so a paused game or a user without door
 * permission still gets core's own feedback.
 */
function _shouldIntercept(control, event) {
  if (event?.button !== 0) return false;                       // core only acts on left click
  if (!game.user.can?.('WALL_DOORS')) return false;
  if (game.paused && !game.user.isGM) return false;
  const doc = control.wall?.document;
  if (!doc?.getFlag(MODULE_ID, 'enabled')) return false;
  if (doc.ds !== CONST.WALL_DOOR_STATES.LOCKED) return false;
  return !_lockpickBusy;                                        // one mini-game at a time
}

/** Roll the tool check, open the mini-game and announce it to spectators. */
async function _startLockpick(wall) {
  const doc = wall.document;
  const token = canvas.tokens.controlled[0];
  if (!token?.actor) return ui.notifications.warn('Select a token to pick this lock.');

  const actor = token.actor;
  const dc    = doc.getFlag(MODULE_ID, 'dc') ?? game.settings.get(MODULE_ID, 'defaultDC');
  let mode = 'thieves';
  try { mode = game.settings.get(MODULE_ID, 'toolMode') ?? 'thieves'; } catch (e) {}
  const tool = resolveTool(actor, mode);
  if (tool.error) return ui.notifications.warn(tool.error);

  _lockpickBusy = true;
  const rollResult = await _rollToolCheck(actor, dc, tool);
  if (!rollResult) { _lockpickBusy = false; return; }

  const who     = `<strong>${esc(token.name)}</strong>`;
  const sub     = `${tool.kind === 'none' ? 'Bare hands' : tool.label} · DC ${dc}`;
  const speaker = ChatMessage.getSpeaker({ token });
  const toolInfo = { kind: tool.kind, label: tool.label, consumable: tool.consumable };

  // Picks left after a snap. Recorded when the pick is consumed (that happens
  // before the failure message), so the message never subtracts twice.
  let picksLeft = null;

  const { LockpickApp } = await import('./LockpickApp.mjs');
  const app = new LockpickApp(wall, {
    dc, rollResult,
    tool: toolInfo,
    // Only lockpicks are used up. Thieves' Tools survive any failure.
    async consumePick() {
      if (!tool.consumable || !tool.item) return;
      const q = Number(tool.item.system?.quantity ?? 1);
      picksLeft = Math.max(0, q - 1);
      if (q <= 1) await tool.item.delete();
      else        await tool.item.update({ 'system.quantity': q - 1 });
    },
    async onSuccess() {
      await doc.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
      ChatMessage.create({
        speaker,
        content: resultCard({
          tone: 'success', icon: 'fa-lock-open', title: 'Lock Picked', subtitle: sub,
          body: `${who} eases the last pin past the shear line. The door swings open.`,
        }),
      });
    },
    async onFailure() {
      const left = picksLeft ?? Math.max(0, Number(tool.item?.system?.quantity ?? 1) - 1);
      ChatMessage.create({
        speaker,
        content: tool.consumable
          ? resultCard({
              tone: 'failure', icon: 'fa-burst', title: 'Lockpick Snapped', subtitle: sub,
              body: `${who} snaps a lockpick in the keyway. The lock holds`
                  + ` — ${left} ${left === 1 ? 'pick' : 'picks'} left.`,
            })
          : resultCard({
              tone: 'failure', icon: 'fa-lock', title: 'The Lock Holds', subtitle: sub,
              body: `${who} loses the pins and they drop back into place. The tools are fine; the door stays locked.`,
            }),
      });
    },
    broadcast: true,
    onClose() { _lockpickBusy = false; }
  });
  app.render(true);

  // Announce to everyone; each client decides from its own settings whether to watch.
  game.socket.emit(`module.${MODULE_ID}`, {
    action     : 'lockpickSpectate',
    wallId     : wall.id,
    dc,
    rollResult,
    tool       : toolInfo,
    playerName : token.name,
    userId     : game.user.id,
    pins       : app.controller.pins.map(p => ({ x: p.x, set: p.set })),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 1d20 + the tool's bonus (system-aware, see tools.mjs), posted with a styled
 * flavour line. Labelled terms ("+ 3[Dex] + 2[Prof]") show in the roll tooltip.
 */
async function _rollToolCheck(actor, dc, tool) {
  const terms = toolCheckTerms(actor, tool);
  let roll;
  try {
    roll = await new Roll(rollFormula(terms)).evaluate();
  } catch (e) { console.error(e); return null; }

  let rollMode;
  try { rollMode = game.settings.get('core', 'rollMode'); } catch (e) {}
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor : checkFlavor(tool.kind === 'none' ? 'Dexterity' : tool.label, dc),
    ...(rollMode ? { rollMode } : {}),
  });

  const die = roll.dice[0];
  const d20 = die?.results?.find(r => r.active !== false)?.result ?? die?.total ?? 10;
  return { total: roll.total, d20, dc, margin: roll.total - dc };
}

