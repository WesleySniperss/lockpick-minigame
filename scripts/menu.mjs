/**
 * menu.mjs — the one GM menu (VTools → "Puzzles & Challenges") for everything
 * the module runs:
 *   • a rolled challenge (lock, ward, resonance, sigil) — a request card in
 *     chat for one character, whose roll sets the difficulty (requests.mjs);
 *   • a puzzle (sudoku, sliding tiles, cipher, rune sequence) — sent straight
 *     to the chosen players (PuzzleApp.mjs).
 * The form shows the fields of whichever is picked.
 */

import { docFromUuid } from './compat.mjs';
import { dialogContent } from './app-window.mjs';
import { esc } from './cards.mjs';
import { CHALLENGES, isChallenge } from './challenges.mjs';
import { requestChallenge, candidates, ownerNames } from './requests.mjs';

const MODULE_ID = 'lockpick-minigame';

/** What a puzzle is about, under the "What" list. */
const PUZZLE_BLURBS = {
  sudoku : 'Classic 9×9 sudoku. Sent straight to the players you pick.',
  sliding: 'Slide the stone tiles back into the picture. Sent straight to the players you pick.',
  cipher : 'Decode a word written in a fantasy alphabet and a Caesar shift.',
  simon  : 'Memorise a sequence of runes, then repeat it.',
};

let lastWhat = 'lock';        // the menu reopens on what was used last this session

const setting = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch (e) { return fallback; }
};

/** @param {string} [what] preselected: a challenge kind ('lock', 'ward', …) or a puzzle type ('sudoku', …). */
export async function openMenu(what) {
  if (!game.user.isGM) return ui.notifications.warn('Only the GM can do this.');
  const { PUZZLE_TYPES, DIFFICULTIES } = await import('./PuzzleApp.mjs');
  const puzzles = new Set(PUZZLE_TYPES.map(t => t.id));
  if (!isChallenge(what) && !puzzles.has(what)) what = lastWhat;

  // Rolled challenges: a character of a player
  const list = candidates();
  const actorOpts = list.map((a, i) => {
    const owners = ownerNames(a);
    return `<option value="${esc(a.uuid)}" ${i ? '' : 'selected'}>${esc(a.name)}${owners.length ? ` — ${esc(owners.join(', '))}` : ''}</option>`;
  }).join('');
  // Puzzles: other connected users (picking yourself would open a read-only mirror)
  const others  = game.users.filter(u => u.active && u.id !== game.user.id);
  const players = others.filter(u => !u.isGM);
  const userOpts = others.map(u => `<option value="${u.id}">${esc(u.name)}${u.isGM ? ' (GM)' : ''}</option>`).join('');

  const opt = (v, label) => `<option value="${v}" ${v === what ? 'selected' : ''}>${esc(label)}</option>`;
  const whatOpts = `<optgroup label="Rolled challenge — a card in chat">${Object.entries(CHALLENGES).map(([k, c]) => opt(k, c.title)).join('')}</optgroup>`
    + `<optgroup label="Puzzle — sent to players">${PUZZLE_TYPES.map(t => opt(t.id, t.label)).join('')}</optgroup>`;
  const langOpts = Object.entries({ infernal: 'Infernal', abyssal: 'Abyssal', elvish: 'Elvish' })
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  const content = `<div class="lpm-menu-form">
      <div class="form-group">
        <label>What</label>
        <div class="form-fields"><select name="what">${whatOpts}</select></div>
        <p class="hint lpm-menu-blurb"></p>
      </div>

      <div class="lpm-menu-challenge">
        <div class="form-group">
          <label>Character</label>
          <div class="form-fields">${list.length ? `<select name="actor">${actorOpts}</select>`
            : '<span class="lpm-menu-none">No player has a character yet.</span>'}</div>
        </div>
        <div class="form-group">
          <label>DC</label>
          <div class="form-fields lpm-dc-fields">
            <input type="number" name="dc" value="${Number(setting('defaultDC', 15))}" min="5" max="30" step="1">
            <label class="checkbox lpm-hide-dc"><input type="checkbox" name="hideDC" ${setting('hideDC', false) ? 'checked' : ''}> Secret</label>
          </div>
          <p class="hint">A secret DC is never shown to the players: not on the card, the roll or in the game.</p>
        </div>
        <div class="form-group">
          <label>What is it on</label>
          <div class="form-fields"><input type="text" name="label" autocomplete="off"></div>
          <p class="hint">The player gets a card in chat. Their roll decides how hard it is.</p>
        </div>
      </div>

      <div class="lpm-menu-puzzle">
        <div class="form-group">
          <label>Difficulty</label>
          <div class="form-fields"><select name="pdiff">${DIFFICULTIES.map(d => `<option value="${d.id}">${d.label}</option>`).join('')}</select></div>
        </div>
        <div class="lpm-cipher-opts">
          <div class="form-group">
            <label>Language</label>
            <div class="form-fields"><select name="plang">${langOpts}</select></div>
          </div>
          <div class="form-group">
            <label>Word / phrase</label>
            <div class="form-fields"><input type="text" name="pword" placeholder="Leave empty for random" autocomplete="off" spellcheck="false"></div>
          </div>
          <div class="form-group">
            <label>Caesar shift</label>
            <div class="form-fields"><input type="number" name="pshift" value="" min="1" max="25" placeholder="Random"></div>
          </div>
        </div>
        <div class="form-group">
          <label>Send to</label>
          <div class="form-fields">
            <select name="ptarget">
              <option value="all" ${players.length ? 'selected' : ''}>All connected players (${players.length})</option>
              <option value="me" ${players.length ? '' : 'selected'}>Only me — I solve it</option>
              ${userOpts ? `<optgroup label="Specific player">${userOpts}</optgroup>` : ''}
            </select>
          </div>
        </div>
        <div class="form-group lpm-shared-group">
          <label>Solve together</label>
          <div class="form-fields"><input type="checkbox" name="pshared"></div>
          <p class="hint lpm-shared-hint"></p>
        </div>
      </div>

      <div class="form-group lpm-watch-group">
        <label>Others can watch</label>
        <div class="form-fields"><input type="checkbox" name="watch" ${setting('spectatePlayers', false) ? 'checked' : ''}></div>
        <p class="hint lpm-watch-hint"></p>
      </div>
    </div>`;

  const { DialogV2 } = foundry.applications.api;
  const dialog = new DialogV2({
    window  : { title: 'Puzzles & Challenges', icon: 'fa-solid fa-puzzle-piece' },
    classes : ['lpm-menu-dialog'],
    position: { width: 460 },
    content : dialogContent(content),
    buttons : [{
      action: 'go', label: 'Send to chat', icon: 'fa-solid fa-paper-plane', default: true,
      callback: (event, button) => submit(button.form.elements),
    }, { action: 'cancel', label: 'Cancel', icon: 'fa-solid fa-xmark' }],
  });
  dialog.addEventListener('render', () => wire(dialog, players));
  dialog.render({ force: true });
  return dialog;
}

/** Show the fields of what is picked, and keep the hints and the main button in step. */
function wire(dialog, players) {
  const root = dialog.element;
  if (!root || root.dataset.lpmWired) return;
  root.dataset.lpmWired = '1';
  const f = root.querySelector('form').elements;
  const go = root.querySelector('button[data-action="go"]');
  // Typing must not reach core hotkeys (Enter / Escape still work).
  root.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Escape') e.stopPropagation();
  }));
  const sync = () => {
    const what = f.what.value, challenge = isChallenge(what);
    root.querySelector('.lpm-menu-challenge').hidden = !challenge;
    root.querySelector('.lpm-menu-puzzle').hidden = challenge;
    root.querySelector('.lpm-cipher-opts').hidden = what !== 'cipher';
    root.querySelector('.lpm-menu-blurb').textContent = challenge ? CHALLENGES[what].blurb : PUZZLE_BLURBS[what] ?? '';
    if (challenge) f.label.placeholder = `Optional — ${CHALLENGES[what].placeholder}`;
    const label = go.querySelector('span') ?? go, icon = go.querySelector('i');
    label.textContent = challenge ? 'Send to chat' : 'Open';
    if (icon) icon.className = challenge ? 'fa-solid fa-paper-plane' : 'fa-solid fa-puzzle-piece';
    go.disabled = challenge && !f.actor;
    // Explain "Solve together" in terms of what the players will actually get.
    const group = f.ptarget.value === 'all' && players.length > 1;
    f.pshared.disabled = !group;
    root.querySelector('.lpm-shared-group').classList.toggle('lpm-disabled', !group);
    root.querySelector('.lpm-shared-hint').textContent = !group
      ? 'Only matters when several players get the puzzle.'
      : f.pshared.checked
        ? 'ONE shared puzzle: everyone sees and moves the same pieces, and one solve opens it for all.'
        : 'Each player gets their OWN copy of the same puzzle and solves it alone.';
    // Watching needs someone left over to watch: not when every player gets the puzzle.
    const nobodyLeft = !challenge && f.ptarget.value === 'all';
    f.watch.disabled = nobodyLeft;
    root.querySelector('.lpm-watch-group').classList.toggle('lpm-disabled', nobodyLeft);
    root.querySelector('.lpm-watch-hint').textContent = nobodyLeft
      ? 'Every player is solving it, so nobody is left to watch.'
      : 'The other players get a read-only window and can follow every move live.';
    dialog.setPosition({ height: 'auto' });
  };
  for (const el of [f.what, f.ptarget, f.pshared]) el.addEventListener('change', sync);
  sync();
}

async function submit(f) {
  const what = f.what.value;
  lastWhat = what;
  if (isChallenge(what)) {
    return requestChallenge({
      kind  : what,
      actor : docFromUuid(f.actor?.value),
      dc    : f.dc.value,
      hideDC: f.hideDC.checked,
      watch : f.watch.checked,
      label : String(f.label.value ?? '').trim(),
    });
  }

  const { openPuzzle, generatePuzzleOpts } = await import('./PuzzleApp.mjs');
  const diff   = f.pdiff.value;
  const target = f.ptarget.value;
  const solo   = target === 'me' || target === game.user.id;
  const recipients = solo ? []
    : target === 'all' ? game.users.filter(u => u.active && !u.isGM)
    : game.users.filter(u => u.id === target && u.active);
  const shared = recipients.length > 1 && f.pshared.checked;
  // Whoever is online and not solving it can watch (in a read-only window).
  const watcherIds = f.watch.checked && !f.watch.disabled
    ? game.users.filter(u => u.active && u.id !== game.user.id && !recipients.includes(u)).map(u => u.id) : [];
  // Everything random is rolled here, so the GM and every player get the same puzzle.
  const opts = generatePuzzleOpts(what, diff, {
    lang      : f.plang.value || undefined,
    customWord: f.pword.value || undefined,
    shift     : parseInt(f.pshift.value) || undefined,
    shared,
    recipients: recipients.map(u => ({ id: u.id, name: u.name })),
  });
  // Nobody on the other end: open it playable for the GM instead of a read-only mirror.
  if (!recipients.length) {
    if (!solo) ui.notifications.warn(target === 'all'
      ? 'No players are connected — opening the puzzle for you to solve.'
      : 'That player is not connected — opening the puzzle for you to solve.');
    if (watcherIds.length) {                // the watchers' roster names the GM, who is the one solving
      game.socket.emit(`module.${MODULE_ID}`, { action: 'openPuzzle', type: what, difficulty: diff, userIds: [], watcherIds,
        opts: { ...opts, recipients: [{ id: game.user.id, name: game.user.name }] } });
    }
    openPuzzle(what, diff, opts);
    return;
  }
  game.socket.emit(`module.${MODULE_ID}`, { action: 'openPuzzle', type: what, difficulty: diff, userIds: recipients.map(u => u.id), watcherIds, opts });
  ui.notifications.info(`${shared ? 'Shared puzzle' : 'Puzzle'} sent to ${recipients.map(u => u.name).join(', ')}.`);
  openPuzzle(what, diff, { ...opts, spectator: true });   // the GM watches (and can join from there)
}
