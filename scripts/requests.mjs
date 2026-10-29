/**
 * requests.mjs — the GM asks a specific character to take on a challenge:
 * pick a lock or one of the Arcana workings (unweave a ward, attune a
 * resonance, trace a sigil).
 *
 *   1. GM: "Puzzles & Challenges" (VTools, menu.mjs, or the API from a macro)
 *      → challenge, character, DC (shown or secret), optionally what it is on
 *      → a request card in chat.
 *   2. The character's owner presses the card's button → the check is rolled
 *      the system's own way (rolls.mjs; the roll decides how hard the game
 *      is) → the game opens.
 *   3. The outcome is posted as a result card, and the request card shows it.
 *
 * The card's state lives in message flags: open → busy → success | failed.
 * Only a GM may update a GM's message, so players ask the active GM to change
 * it over the socket. The GM also referees: the attempt belongs to whoever
 * claimed it first (flag userId), only they can report its outcome, and an
 * attempt left unfinished (window closed, player gone) counts as failed until
 * the GM allows another try — a bad roll cannot be thrown away by leaving.
 */

import { docFromUuid } from './compat.mjs';
import { resolveTool } from './tools.mjs';
import { rollArcana, rollLockpicking } from './rolls.mjs';
import { resultCard, requestCard, esc } from './cards.mjs';
import { CHALLENGES, isChallenge } from './challenges.mjs';

const MODULE_ID = 'lockpick-minigame';
const CHANNEL   = `module.${MODULE_ID}`;
const FLAG      = 'request';
const STATES    = new Set(['open', 'busy', 'success', 'failed']);
const QUITS     = new Set(['left', 'dropped']);       // how a failed attempt ended without a result

/** One mini-game window per client at a time. */
let _busy = false;

const setting = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch (e) { return fallback; }
};

/** Players (not GMs) who own the actor — shown next to the name in the menu. */
export const ownerNames = actor =>
  game.users.filter(u => !u.isGM && actor.testUserPermission?.(u, 'OWNER')).map(u => u.name);

/** Characters the GM can ask: the selected tokens' actors first, then every player-owned actor. */
export function candidates() {
  const picked = (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
  const owned  = (game.actors?.filter(a => a.hasPlayerOwner) ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set();
  return [...picked, ...owned].filter(a => !seen.has(a.uuid) && seen.add(a.uuid));
}

/** The game window class for an Arcana challenge (loaded on demand). */
export async function arcanaAppClass(kind) {
  if (kind === 'ward')      return (await import('./WardApp.mjs')).WardApp;
  if (kind === 'resonance') return (await import('./ResonanceApp.mjs')).ResonanceApp;
  if (kind === 'sigil')     return (await import('./SigilApp.mjs')).SigilApp;
  return null;
}

/** Subtitle of a result card: what it was on, the check, the DC unless it is secret. */
const resultSub = (label, check, dc, hideDC) => [label, check, hideDC ? '' : `DC ${dc}`].filter(Boolean).join(' · ');

// ─── GM side ─────────────────────────────────────────────────────────────────

/**
 * Post a request card. Also usable from a macro:
 *   game.modules.get('lockpick-minigame').api.requestChallenge({ kind: 'ward', actor, dc: 15, label: 'Vault door', hideDC: true })
 */
export async function requestChallenge({ kind = 'lock', actor, dc, label = '', hideDC = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn('Only the GM can request a challenge.');
  if (!isChallenge(kind)) return ui.notifications.warn(`Unknown challenge: ${kind}`);
  if (typeof actor === 'string') actor = docFromUuid(actor) ?? game.actors.get(actor);
  if (!actor) return ui.notifications.warn('Choose a character to ask.');
  dc = Math.max(1, Math.round(Number(dc) || Number(setting('defaultDC', 15))));
  hideDC = !!hideDC;
  return ChatMessage.create({
    content: requestCard({ kind, name: actor.name, dc, label, hideDC }),
    flags  : { [MODULE_ID]: { [FLAG]: { kind, actorUuid: actor.uuid, actorName: actor.name, dc, hideDC, label, state: 'open' } } },
  });
}

/** Lockpicking shortcut (kept for macros written against 3.0). */
export const requestLockpick = (opts = {}) => requestChallenge({ ...opts, kind: 'lock' });

/**
 * Apply a state change to a request card (GM only). `senderId` is the user
 * who asked: a free card goes to the first claim, the outcome may only come
 * from the one playing, and only a GM reopens or resets a card.
 */
async function applyState(messageId, patch, senderId) {
  const msg = game.messages?.get(messageId);
  const req = msg?.getFlag(MODULE_ID, FLAG);
  if (!req || !STATES.has(patch?.state)) return;
  const fromGM = !!game.users.get(senderId)?.isGM;
  const holder = req.state === 'busy' && !!senderId && req.userId === senderId;
  const allowed = patch.state === 'busy' ? req.state === 'open'
                : patch.state === 'open' ? fromGM || holder        // the holder may back out before playing
                : fromGM || holder;
  if (!allowed) return;
  // Every field is written (null when unused): setFlag merges, it never drops keys.
  await msg.setFlag(MODULE_ID, FLAG, {
    ...req,
    state  : patch.state,
    userId : patch.state === 'busy' ? senderId : patch.state === 'open' ? null : (req.userId ?? null),
    by     : typeof patch.by === 'string' ? patch.by.slice(0, 80) : null,
    snapped: !!patch.snapped,
    quit   : patch.state === 'failed' && QUITS.has(patch.quit) ? patch.quit : null,
  });
}

/**
 * Socket: a player asks to update a card. Only the active GM writes, so two
 * GMs never race. `senderId` comes from the server, not from the message.
 */
export function onRequestStateMessage(data, senderId) {
  const gm = game.users.activeGM;
  if (gm ? !gm.isSelf : !game.user.isGM) return;
  applyState(data.messageId, data.patch, senderId ?? data.userId);
}

function setState(messageId, patch) {
  if (game.user.isGM) return applyState(messageId, patch, game.user.id);
  game.socket.emit(CHANNEL, { action: 'lockpickRequestState', messageId, patch, userId: game.user.id });
}

/**
 * Ask for the attempt and wait until the card names us, so two owners
 * clicking at once cannot both play. Without a GM online nothing could be
 * recorded, so nothing starts. Returns whether the attempt is ours.
 */
async function claim(message) {
  if (!game.user.isGM && !game.users.activeGM) {
    ui.notifications.warn('A GM has to be online to record the result. Try again when they are back.');
    return false;
  }
  const flag = () => (game.messages?.get(message.id) ?? message).getFlag(MODULE_ID, FLAG);
  await setState(message.id, { state: 'busy' });
  for (let waited = 0; waited <= 5000; waited += 100) {
    const r = flag();
    if (r?.state === 'busy' && r.userId === game.user.id) return true;
    if (r?.state !== 'open') {
      const who = game.users.get(r?.userId)?.name;
      ui.notifications.warn(who ? `${who} is already on it.` : 'Someone else is already on it.');
      return false;
    }
    await new Promise(res => setTimeout(res, 100));
  }
  ui.notifications.warn('The GM did not answer. Try again in a moment.');
  return false;
}

/**
 * Attempts whose player is gone (reload, crash, lost connection) end as cut
 * off, so a card never hangs on "busy". The active GM runs this when someone
 * disconnects and once at start-up.
 */
export function releaseDroppedAttempts() {
  if (!game.users.activeGM?.isSelf) return;
  for (const msg of game.messages?.contents ?? []) {
    const req = msg.getFlag?.(MODULE_ID, FLAG);
    if (req?.state !== 'busy') continue;
    const holder = game.users.get(req.userId);
    // Our own attempt cannot have survived a reload of this client.
    if (!holder?.active || (holder.id === game.user.id && !_busy)) {
      applyState(msg.id, { state: 'failed', quit: 'dropped' }, game.user.id);
    }
  }
}

// ─── The card in chat ────────────────────────────────────────────────────────

/** renderChatMessageHTML / renderChatMessage: fill in the button and status for this viewer. */
export function decorateRequestCard(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const req = message?.getFlag?.(MODULE_ID, FLAG);
  const card = root?.querySelector?.('.lpm-request');
  if (!req || !card) return;

  const c      = CHALLENGES[req.kind] ?? CHALLENGES.lock;
  const actor  = docFromUuid(req.actorUuid);
  const owner  = !!actor?.isOwner;                       // GMs own everything
  const name   = esc(req.actorName ?? actor?.name ?? 'The character');
  const button = card.querySelector('[data-lpm-action="pick"]');
  const status = card.querySelector('.lpm-card__status');
  card.dataset.state = req.state;

  // A secret DC is left out of the card itself; the GM still sees it here.
  if (req.hideDC && game.user.isGM && !card.querySelector('.lpm-card__secret')) {
    let sub = card.querySelector('.lpm-card__sub');
    if (!sub) {
      sub = document.createElement('span');
      sub.className = 'lpm-card__sub';
      card.querySelector('.lpm-card__titles')?.append(sub);
    }
    const secret = document.createElement('span');
    secret.className = 'lpm-card__secret';
    secret.title = 'The players do not see this DC';
    secret.innerHTML = `<i class="fa-solid fa-eye-slash"></i> DC ${Number(req.dc)}`;
    sub.append(sub.textContent ? ' · ' : '', secret);
  }

  const text = {
    open   : owner ? '' : `<i class="fa-solid fa-hourglass-start"></i> Waiting for ${name}`,
    busy   : `<i class="fa-solid fa-hourglass-half"></i> ${name} ${esc(c.busy)}`,
    success: `<i class="fa-solid ${req.kind === 'lock' || !req.kind ? 'fa-lock-open' : 'fa-wand-sparkles'}"></i> ${esc(c.done)} ${esc(req.by ?? req.actorName)}`,
    failed : req.quit === 'left'    ? `<i class="fa-solid fa-flag"></i> ${name} gave up`
           : req.quit === 'dropped' ? `<i class="fa-solid fa-link-slash"></i> ${name}’s attempt was cut off`
           : req.snapped ? `<i class="fa-solid fa-burst"></i> A lockpick snapped — the lock held`
                         : `<i class="fa-solid fa-xmark"></i> ${esc(c.failed)}`,
  }[req.state] ?? '';
  if (status) status.innerHTML = text;
  if (button) {
    button.hidden = !(req.state === 'open' && owner);
    button.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); startFromRequest(message); };
  }

  // The GM may let them try again after a failure, or free a card whose attempt is stuck.
  const gmAction = game.user.isGM && {
    failed: { label: 'Allow another try', icon: 'fa-rotate-right', tip: '' },
    busy  : { label: 'Reset', icon: 'fa-rotate-left', tip: 'Reopen the request, e.g. when the attempt was interrupted' },
  }[req.state];
  if (gmAction && !card.querySelector('[data-lpm-action="reopen"]')) {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'lpm-card__button lpm-card__button--quiet';
    again.dataset.lpmAction = 'reopen';
    if (gmAction.tip) again.title = gmAction.tip;
    again.innerHTML = `<i class="fa-solid ${gmAction.icon}"></i> ${gmAction.label}`;
    again.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); setState(message.id, { state: 'open' }); };
    card.querySelector('.lpm-card__actions')?.appendChild(again);
  }
}

/** The owner pressed the card's button. */
async function startFromRequest(message) {
  const req = message.getFlag(MODULE_ID, FLAG);
  if (!req || req.state !== 'open') return;
  if (_busy) return ui.notifications.warn('You are already in the middle of a challenge.');
  const actor = docFromUuid(req.actorUuid);
  if (!actor) return ui.notifications.warn('That character no longer exists.');
  if (!actor.isOwner) return ui.notifications.warn(`Only ${actor.name}'s player can do this.`);
  const kind = isChallenge(req.kind) ? req.kind : 'lock';

  let tool = null;
  if (kind === 'lock') {
    tool = resolveTool(actor, setting('toolMode', 'none'));
    if (tool.error) return ui.notifications.warn(tool.error);
  }

  _busy = true;
  if (!(await claim(message))) { _busy = false; return; }
  const onSettled = outcome => setState(message.id, outcome ?? { state: 'open' });
  const opts = { actor, dc: req.dc, hideDC: !!req.hideDC, label: req.label, onSettled };
  try {
    if (kind === 'lock') await startLockpick({ ...opts, tool });
    else                 await startArcana({ ...opts, kind });
  } catch (e) {
    _busy = false;
    setState(message.id, { state: 'open' });
    console.error(`${MODULE_ID} | could not start the challenge:`, e);
  }
}

// ─── Lockpicking ─────────────────────────────────────────────────────────────

/**
 * Roll the check, open the lockpicking game and announce it to spectators.
 * `onSettled({state, by, snapped, quit})` fires once: success, failed (also
 * when the window is closed before the end), or null when nothing was rolled.
 */
export async function startLockpick({ actor, tool, dc, hideDC = false, label = '', onSettled = () => {} }) {
  const rolled = await rollLockpicking(actor, tool, { dc, hideDC });
  if (!rolled) { _busy = false; onSettled(null); return; }
  const rollResult = { total: rolled.total, d20: rolled.d20, dc, margin: rolled.total - dc };

  const bare     = tool.kind === 'none' && !tool.item;
  const who      = `<strong>${esc(actor.name)}</strong>`;
  const sub      = resultSub(label, bare ? 'Bare hands' : tool.label, dc, hideDC);
  const speaker  = ChatMessage.getSpeaker({ actor });
  const toolInfo = { kind: tool.kind, label: tool.label, consumable: tool.consumable };
  const sessionId = foundry.utils.randomID();
  let settled   = false;
  let picksLeft = null;   // recorded when a pick is consumed, so the message never subtracts twice
  const settle = outcome => { if (settled) return; settled = true; onSettled(outcome); };

  const { LockpickApp } = await import('./LockpickApp.mjs');
  const app = new LockpickApp({
    sessionId, dc, hideDC, rollResult, label,
    tool: toolInfo,
    playerName: actor.name,
    broadcast: true,
    async consumePick() {                // only lockpicks are used up
      if (!tool.consumable || !tool.item) return;
      const q = Number(tool.item.system?.quantity ?? 1);
      picksLeft = Math.max(0, q - 1);
      if (q <= 1) await tool.item.delete();
      else        await tool.item.update({ 'system.quantity': q - 1 });
    },
    async onSuccess() {
      settle({ state: 'success', by: actor.name });
      await ChatMessage.create({
        speaker,
        content: resultCard({
          tone: 'success', icon: 'fa-lock-open', title: 'Lock Picked', subtitle: sub,
          body: `${who} eases the last pin past the shear line. The lock clicks open.`,
        }),
      });
    },
    async onFailure() {
      settle({ state: 'failed', snapped: tool.consumable });
      const left = picksLeft ?? Math.max(0, Number(tool.item?.system?.quantity ?? 1) - 1);
      await ChatMessage.create({
        speaker,
        content: tool.consumable
          ? resultCard({
              tone: 'failure', icon: 'fa-burst', title: 'Lockpick Snapped', subtitle: sub,
              body: `${who} snaps a lockpick in the keyway. The lock holds`
                  + ` — ${left} ${left === 1 ? 'pick' : 'picks'} left.`,
            })
          : resultCard({
              tone: 'failure', icon: 'fa-lock', title: 'The Lock Holds', subtitle: sub,
              body: bare ? `${who} loses the pins and they drop back into place. The lock stays shut.`
                         : `${who} loses the pins and they drop back into place. The tools are fine; the lock stays shut.`,
            }),
      });
    },
    onClose() {
      _busy = false;
      settle({ state: 'failed', quit: 'left' });   // closed before the end: gave up (the GM can allow another try)
    },
  });
  await app.render({ force: true });

  // Announce to everyone; each client decides from its own settings whether to watch.
  game.socket.emit(CHANNEL, {
    action: 'lockpickSpectate',
    sessionId, dc, hideDC, rollResult, label,
    tool: toolInfo,
    playerName: actor.name,
    userId: game.user.id,
    pins: app.controller.pins.map(p => ({ x: p.x, set: p.set })),
  });
  return app;
}

// ─── Arcana ──────────────────────────────────────────────────────────────────

/**
 * Roll Arcana, open the chosen working and announce it to spectators. The
 * game is generated from a seed, so spectators rebuild exactly the same one.
 */
export async function startArcana({ kind, actor, dc, hideDC = false, label = '', onSettled = () => {} }) {
  const c = CHALLENGES[kind];
  const rolled = await rollArcana(actor, { dc, hideDC, icon: c.icon });
  if (!rolled) { _busy = false; onSettled(null); return; }
  const rollResult = { total: rolled.total, d20: rolled.d20, dc, margin: rolled.total - dc };
  const who = `<strong>${esc(actor.name)}</strong>`;
  const sub = resultSub(label, 'Arcana', dc, hideDC);
  const speaker = ChatMessage.getSpeaker({ actor });
  const sessionId = foundry.utils.randomID();
  const init = { seed: Math.floor(Math.random() * 2 ** 31), dc, roll: { margin: rollResult.margin, d20: rollResult.d20 } };
  let settled = false;
  const settle = outcome => { if (settled) return; settled = true; onSettled(outcome); };

  const App = await arcanaAppClass(kind);
  const app = new App({
    sessionId, dc, hideDC, rollResult, label, init,
    playerName: actor.name,
    broadcast: true,
    async onSuccess() {
      settle({ state: 'success', by: actor.name });
      await ChatMessage.create({ speaker, content: resultCard({
        tone: 'success', icon: c.icon, title: c.win.title, subtitle: sub, body: c.win.body.replace('{who}', who) }) });
    },
    async onFailure() {
      settle({ state: 'failed' });
      await ChatMessage.create({ speaker, content: resultCard({
        tone: 'failure', icon: c.icon, title: c.lose.title, subtitle: sub, body: c.lose.body.replace('{who}', who) }) });
    },
    onClose() {
      _busy = false;
      settle({ state: 'failed', quit: 'left' });
    },
  });
  await app.render({ force: true });

  game.socket.emit(CHANNEL, {
    action: 'gameSpectate', kind, sessionId, init, dc, hideDC, rollResult, label,
    playerName: actor.name, userId: game.user.id,
  });
  return app;
}
