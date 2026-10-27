/**
 * lockpick-minigame | main.mjs — Foundry VTT v12–v14
 * Settings, socket, GM tools and the puzzle dialog. Lockpicking and the Arcana
 * workings are requested by the GM for a specific character (requests.mjs).
 * Version-sensitive API lookups live in compat.mjs.
 */

import { DialogV1, generation } from './compat.mjs';
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
    hint: "Thieves' Tools are never used up: a failed attempt only leaves the lock shut. "
        + 'Lockpicks are consumable: a failed attempt snaps one.',
    scope: 'world', config: true, type: String, default: 'thieves',
    choices: TOOL_MODES,
  });
  game.settings.register(MODULE_ID, 'defaultDC', {
    name: 'Default DC',
    hint: 'Pre-filled in the request dialog, for locks and Arcana challenges alike.',
    scope: 'world', config: true, type: Number, default: 15
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
  VTools.register({
    name   : `${MODULE_ID}-lock`,
    title  : 'Request Lockpicking',
    icon   : 'fa-solid fa-key',
    onClick: () => {
      if (!game.user.isGM) return;
      openRequestDialog('lock');
    }
  });

  VTools.register({
    name   : `${MODULE_ID}-arcana`,
    title  : 'Request Arcana Challenge',
    icon   : 'fa-solid fa-hat-wizard',
    onClick: () => {
      if (!game.user.isGM) return;
      openRequestDialog('ward');
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
        rollResult: data.rollResult,
        label     : data.label,
        playerName: data.playerName,
        playerUserId: data.userId,
        spectator : true,
      }).render(true);
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
        rollResult : data.rollResult,
        tool       : data.tool,
        label      : data.label,
        spectator  : true,
        playerName : data.playerName,
        playerUserId: data.userId,
        pins       : data.pins,
      }).render(true);
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
