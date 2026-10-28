/**
 * lockpick-minigame | main.mjs — Foundry VTT v12–v14
 * Settings, socket, GM tools and the puzzle dialog. Lockpicking and the Arcana
 * workings are requested by the GM for a specific character (requests.mjs).
 * Version-sensitive API lookups live in compat.mjs.
 */

import { generation } from './compat.mjs';
import { dialogContent } from './app-window.mjs';
import { TOOL_MODES } from './tools.mjs';
import { openRequestDialog, requestChallenge, requestLockpick, decorateRequestCard, onRequestStateMessage,
         releaseDroppedAttempts, arcanaAppClass } from './requests.mjs';

export const MODULE_ID = 'lockpick-minigame';

// ─── Settings ─────────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  console.log(`%c${MODULE_ID} | LOADED ✓`, 'color:lime;font-weight:bold');

  // Systems ship Thieves' Tools, not "lockpicks" — the GM picks what is needed.
  // (Replaces the old 'breakOnMiss' setting, which nothing ever read.)
  game.settings.register(MODULE_ID, 'toolMode', {
    name: 'Tool needed to pick a lock',
    hint: "By default anyone can try: Thieves' Tools add their proficiency, without them it is a plain Dexterity check. "
        + "Thieves' Tools are never used up; lockpicks are, a failed attempt snaps one.",
    scope: 'world', config: true, type: String, default: 'none',
    choices: TOOL_MODES,
  });
  game.settings.register(MODULE_ID, 'defaultDC', {
    name: 'Default DC',
    hint: 'Pre-filled in the request dialog, for locks and Arcana challenges alike.',
    scope: 'world', config: true, type: Number, default: 15
  });
  game.settings.register(MODULE_ID, 'hideDC', {
    name: 'Keep the DC secret by default',
    hint: 'Pre-ticks "Secret" in the request dialog: the players see neither the DC nor how far their roll beat it.',
    scope: 'world', config: true, type: Boolean, default: false
  });

  // Кому транслювати чужий злам замка. Раніше вікно спостерігача бачив лише
  // GM, і то завжди — тепер обидві аудиторії налаштовуються окремо.
  game.settings.register(MODULE_ID, 'spectateGM', {
    name: 'Show challenges live to the GM',
    hint: 'Opens a spectator window for the GM while a player picks a lock or works an Arcana challenge.',
    scope: 'world', config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, 'spectatePlayers', {
    name: 'Show challenges live to other players',
    hint: 'Opens the same spectator window for everyone else at the table.',
    scope: 'world', config: true, type: Boolean, default: false
  });

  // For macros: game.modules.get('lockpick-minigame').api.requestChallenge({ kind: 'ward', actor, dc: 15, label: 'Vault door' })
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { requestChallenge, requestLockpick, openRequestDialog, openPuzzleDialog: _openPuzzleDialog };

  // Request cards get their button / status for the viewing user on every render.
  // v13+ passes an HTMLElement to renderChatMessageHTML; v12 only has renderChatMessage (jQuery).
  // Chosen here, not at import time: game.release is only reliable from 'init' on.
  Hooks.on(generation() >= 13 ? 'renderChatMessageHTML' : 'renderChatMessage', decorateRequestCard);
  // A player who drops out mid-attempt never reports back: the GM closes their card.
  Hooks.on('userConnected', (user, active) => { if (!active) releaseDroppedAttempts(); });
});

Hooks.once('ready', () => {
  _registerSocket();
  releaseDroppedAttempts();             // cards left "busy" while no GM was here
});

// ─── VTools integration ───────────────────────────────────────────────────────

Hooks.once('vtools.ready', () => {
  // One request for every challenge: the dialog has the lock and the Arcana workings.
  VTools.register({
    name   : `${MODULE_ID}-request`,
    title  : 'Request a Challenge',
    icon   : 'fa-solid fa-dice-d20',
    onClick: () => {
      if (!game.user.isGM) return;
      openRequestDialog();
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
  // The server passes the sender's user id after the data.
  game.socket.on(`module.${MODULE_ID}`, async (data, senderId) => {
    const { action, type, difficulty, userId } = data;

    if (action === 'openPuzzle') {
      // userIds = exact recipients. Never open a playable copy for a GM that was
      // not picked, or an assistant GM would get one on every broadcast.
      const ids = data.userIds ?? (userId ? [userId] : null);
      if (ids ? !ids.includes(game.user.id) : game.user.isGM) return;
      import('./PuzzleApp.mjs').then(m => m.openPuzzle(type, difficulty, data.opts)).catch(console.error);
      return;
    }

    if (action === 'lockpickRequestState') {
      onRequestStateMessage(data, senderId);              // only the active GM writes
      return;
    }

    if (action === 'gameSpectate') {
      if (data.userId === game.user.id) return;
      if (!_wantsToWatch()) return;
      const App = await arcanaAppClass(data.kind);
      if (!App) return;
      new App({
        sessionId : data.sessionId,
        init      : data.init,
        dc        : data.dc,
        hideDC    : data.hideDC,
        rollResult: data.rollResult,
        label     : data.label,
        playerName: data.playerName,
        playerUserId: data.userId,
        spectator : true,
      }).render({ force: true });
      return;
    }

    if (action === 'lockpickSpectate') {
      // Хто саме дивиться — вирішують налаштування, а не жорстке «тільки GM».
      if (data.userId === game.user.id) return;          // сам гравець уже грає
      if (!_wantsToWatch()) return;
      const { LockpickApp } = await import('./LockpickApp.mjs');
      new LockpickApp({
        sessionId  : data.sessionId,
        dc         : data.dc,
        hideDC     : data.hideDC,
        rollResult : data.rollResult,
        tool       : data.tool,
        label      : data.label,
        spectator  : true,
        playerName : data.playerName,
        playerUserId: data.userId,
        pins       : data.pins,
      }).render({ force: true });
    }
  });
  console.log(`${MODULE_ID} | socket registered for user: ${game.user.name} (isGM: ${game.user.isGM})`);
}

/** Does this client watch other players' challenges (per the world settings)? */
function _wantsToWatch() {
  const key = game.user.isGM ? 'spectateGM' : 'spectatePlayers';
  try { return !!game.settings.get(MODULE_ID, key); } catch (e) { return game.user.isGM; }
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

  const content = `<div class="lpm-puzzle-form">
      <div class="form-group">
        <label>Type</label>
        <div class="form-fields"><select name="ptype">${typeOpts}</select></div>
      </div>
      <div class="form-group">
        <label>Difficulty</label>
        <div class="form-fields"><select name="pdiff">${diffOpts}</select></div>
      </div>
      <div class="lpm-cipher-opts" hidden>
        <div class="form-group">
          <label>Language</label>
          <div class="form-fields"><select name="plang">${langOpts}</select></div>
        </div>
        <div class="form-group">
          <label>Word / phrase</label>
          <div class="form-fields">
            <input type="text" name="pword" placeholder="Leave empty for random" autocomplete="off" spellcheck="false">
          </div>
        </div>
        <div class="form-group">
          <label>Caesar shift</label>
          <div class="form-fields">
            <input type="number" name="pshift" value="" min="1" max="25" placeholder="Random">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Send to</label>
        <div class="form-fields">
          <select name="ptarget">
            <option value="all" ${players.length ? 'selected' : ''}>All connected players (${players.length})</option>
            <option value="me" ${players.length ? '' : 'selected'}>Only me — I solve it</option>
            ${playerOpts ? `<optgroup label="─── Specific player ───">${playerOpts}</optgroup>` : ''}
          </select>
        </div>
      </div>
      <div class="form-group lpm-shared-group">
        <label>Solve together</label>
        <div class="form-fields"><input type="checkbox" name="pshared"></div>
        <p class="hint lpm-shared-hint"></p>
      </div>
    </div>`;

  const { DialogV2 } = foundry.applications.api;
  const dialog = new DialogV2({
    window  : { title: 'Open Puzzle', icon: 'fa-solid fa-puzzle-piece' },
    classes : ['lpm-puzzle-dialog'],
    position: { width: 420 },
    content : dialogContent(content),
    buttons : [{
      action: 'open', label: 'Open', icon: 'fa-solid fa-puzzle-piece', default: true,
      callback: async (event, button) => {
        const f = button.form.elements;
        const { openPuzzle, generatePuzzleOpts } = await import('./PuzzleApp.mjs');
        const type   = f.ptype.value;
        const diff   = f.pdiff.value;
        const target = f.ptarget.value;
        const solo   = target === 'me' || target === game.user.id;
        const recipients = solo ? []
          : target === 'all' ? game.users.filter(u => u.active && !u.isGM)
          : game.users.filter(u => u.id === target && u.active);
        const shared = recipients.length > 1 && f.pshared.checked;

        // Pre-generate puzzle state so GM and players see the same puzzle
        const opts = generatePuzzleOpts(type, diff, {
          lang      : f.plang.value || undefined,
          customWord: f.pword.value || undefined,
          shift     : parseInt(f.pshift.value) || undefined,
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
      },
    }, { action: 'cancel', label: 'Cancel', icon: 'fa-solid fa-xmark' }],
  });
  dialog.addEventListener('render', () => {
    const root = dialog.element;
    if (!root || root.dataset.lpmWired) return;
    root.dataset.lpmWired = '1';
    const f = root.querySelector('form').elements;
    // The window keeps its height unless asked; the cipher fields would push the buttons out.
    const refit = () => dialog.setPosition({ height: 'auto' });
    f.ptype.addEventListener('change', () => {
      root.querySelector('.lpm-cipher-opts').hidden = f.ptype.value !== 'cipher';
      refit();
    });
    // Explain the checkbox in terms of what the players will actually get.
    const syncShared = () => {
      const group = f.ptarget.value === 'all' && players.length > 1;
      f.pshared.disabled = !group;
      root.querySelector('.lpm-shared-group').classList.toggle('lpm-disabled', !group);
      root.querySelector('.lpm-shared-hint').textContent = !group
        ? 'Only matters when several players get the puzzle.'
        : f.pshared.checked
          ? 'ONE shared puzzle: everyone sees and moves the same pieces, and one solve opens it for all.'
          : 'Each player gets their OWN copy of the same puzzle and solves it alone.';
    };
    for (const el of [f.ptarget, f.pshared]) el.addEventListener('change', () => { syncShared(); refit(); });
    syncShared();
    // Typing must not reach core hotkeys (Enter / Escape still work).
    root.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== 'Escape') e.stopPropagation();
    }));
  });
  dialog.render({ force: true });
}