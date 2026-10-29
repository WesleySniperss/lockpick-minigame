/**
 * lockpick-minigame | main.mjs — Foundry VTT v12–v14
 * Settings, socket and the GM's one menu (menu.mjs: puzzles, and the lock and
 * Arcana challenges the GM requests for a specific character, requests.mjs).
 * Version-sensitive API lookups live in compat.mjs.
 */

import { generation } from './compat.mjs';
import { TOOL_MODES } from './tools.mjs';
import { openMenu } from './menu.mjs';
import { requestChallenge, requestLockpick, decorateRequestCard, onRequestStateMessage,
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
    hint: 'Pre-filled in the Puzzles & Challenges menu, for locks and Arcana challenges alike.',
    scope: 'world', config: true, type: Number, default: 15
  });
  game.settings.register(MODULE_ID, 'hideDC', {
    name: 'Keep the DC secret by default',
    hint: 'Pre-ticks "Secret" in the Puzzles & Challenges menu: the players see neither the DC nor how far their roll beat it.',
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
  // The GM's "Show the answers" tick in a watched sudoku, remembered on this client.
  game.settings.register(MODULE_ID, 'sudokuAnswers', { scope: 'client', config: false, type: Boolean, default: false });

  // For macros: game.modules.get('lockpick-minigame').api.requestChallenge({ kind: 'ward', actor, dc: 15, label: 'Vault door' })
  // openRequestDialog / openPuzzleDialog are kept for macros written against 3.0: both open the one menu.
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = {
    openMenu, requestChallenge, requestLockpick,
    openRequestDialog: (kind = 'lock') => openMenu(kind),
    openPuzzleDialog : (type = 'sudoku') => openMenu(type),
  };

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
  // One button: the menu has the puzzles and the rolled challenges (lock, Arcana).
  VTools.register({
    name   : `${MODULE_ID}-puzzle`,
    title  : 'Puzzles & Challenges',
    icon   : 'fa-solid fa-puzzle-piece',
    onClick: () => {
      if (!game.user.isGM) return;
      openMenu();
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
