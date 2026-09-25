/**
 * PuzzleApp.mjs — puzzle system for lockpick-minigame.
 * Puzzles: Sudoku, Sliding tiles, Cipher, Rune sequence (Simon).
 *
 * Every puzzle the GM opens is a *session* (random id) in one of two modes:
 *   • individual — every recipient solves their own copy of the same puzzle;
 *   • shared     — one puzzle for the whole party: a move made by anyone is
 *                  applied on every client, and one solve ends it for all.
 * The GM gets a read-only spectator window with a roster of the recipients.
 * In individual mode clicking a name shows that player's board. "Join in" /
 * "Solve a copy" lets the GM play as well.
 *
 * Sync traffic is {action:'puzzleSync', session, puzzle, from, name, event, …}
 * on the module socket. One socket listener fans messages out to the open
 * windows of the matching session. Messages are also delivered locally,
 * because socket.emit never echoes back to the sender's own client.
 */

import { AppV1, oocChatData } from './compat.mjs';
import { Sfx } from './Sfx.mjs';

const MODULE_ID = 'lockpick-minigame';
const CHANNEL   = `module.${MODULE_ID}`;

/** Width / height of assets/stone.jpg — the sliding tiles cut a square from it. */
const STONE_ASPECT = 679 / 452;

export const PUZZLE_TYPES = [
  { id: 'sudoku',  label: '🔢 Sudoku',                   icon: 'fas fa-th' },
  { id: 'sliding', label: '🧱 Sliding tiles',            icon: 'fas fa-border-all' },
  { id: 'cipher',  label: '🔤 Cipher (decode the word)', icon: 'fas fa-font' },
  { id: 'simon',   label: '🔮 Rune sequence (memory)',   icon: 'fas fa-circle' },
];

export const DIFFICULTIES = [
  { id: 'easy',   label: '🟢 Easy'   },
  { id: 'medium', label: '🟡 Medium' },
  { id: 'hard',   label: '🔴 Hard'   },
];

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function openPuzzle(type, difficulty, opts = {}) {
  let Cls;
  switch (type) {
    case 'sudoku':  Cls = SudokuPuzzle;  break;
    case 'sliding': Cls = SlidingPuzzle; break;
    case 'cipher':  Cls = CipherPuzzle;  break;
    case 'simon':   Cls = SimonPuzzle;   break;
    default: ui.notifications.warn(`Unknown puzzle type: ${type}`); return null;
  }
  _bindSocket();
  const app = new Cls(difficulty, opts);
  app.render(true);
  return app;
}

/**
 * Pre-generate everything random on the GM side, so every client (players and
 * the GM's spectator) gets the exact same puzzle. The cipher used to roll its
 * word and shift on each client, so the GM's "answer" was not the player's.
 */
export function generatePuzzleOpts(type, difficulty, userOpts = {}) {
  const opts = {
    ...userOpts,
    session: userOpts.session ?? foundry.utils.randomID(),
    shared : !!userOpts.shared,
  };
  switch (type) {
    case 'sudoku':  return { ...opts, ..._makeSudokuPuzzle(difficulty) };
    case 'sliding': {
      const size = _slidingSize(difficulty);
      return { ...opts, size, tiles: _slidingGenerateTiles(size, difficulty) };
    }
    case 'cipher':  return { ...opts, ..._makeCipher(difficulty, userOpts) };
    case 'simon':   return { ...opts, sequence: _simonSequence(difficulty) };
    default:        return opts;
  }
}

// ─── Session transport ───────────────────────────────────────────────────────

/** Open puzzle windows on this client. */
const OPEN = new Set();
let _listening = false;

function _bindSocket() {
  if (_listening || !game.socket) return;
  _listening = true;
  game.socket.on(CHANNEL, data => {
    if (data?.action !== 'puzzleSync') return;
    for (const app of [...OPEN]) app._receive(data);
  });
}

function _broadcast(sender, data) {
  game.socket.emit(CHANNEL, data);
  // Other windows of the same client (e.g. the GM's spectator view while the GM
  // also plays) never get this from the socket, so hand it over directly.
  for (const app of [...OPEN]) if (app !== sender) app._receive(data);
}

const _esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  waiting: { icon: '○', label: 'has not started yet' },
  solving: { icon: '✎', label: 'is solving' },
  solved:  { icon: '✓', label: 'solved it' },
  failed:  { icon: '✗', label: 'failed' },
  left:    { icon: '⏏', label: 'closed the puzzle' },
};

// ═════════════════════════════════════════════════════════════════════════════
// BASE
// ═════════════════════════════════════════════════════════════════════════════

class PuzzleBase extends AppV1 {
  /** Key used in sync messages and window ids. */
  static KEY  = 'puzzle';
  /** Human name for chat messages. */
  static NAME = 'Puzzle';

  constructor(difficulty, opts = {}) {
    const session   = opts.session ?? foundry.utils.randomID();
    const spectator = !!opts.spectator;
    // One id per session and role. The old fixed ids ('lpm-sudoku') made V1
    // render a second window of the same type INTO the first one, because it
    // looks the element up by id — e.g. a playable puzzle landing inside the
    // GM's read-only spectator frame, where nothing reacts to clicks.
    super({ id: `lpm-${new.target.KEY}-${session}${spectator ? '-watch' : ''}` });

    this.difficulty = difficulty;
    this.session    = session;
    this.shared     = !!opts.shared;
    this._opts      = opts;
    this._spectator = spectator;
    /** GM solving alone ("Only me", or nobody connected). */
    this._solo      = !spectator && !opts.recipients?.length;
    this._peers     = new Map();   // userId → { name, status, state }
    this._watch     = null;        // spectator, individual mode: whose board is shown
    this._ended     = false;
    this._joined    = false;
    this._timers    = [];
    this._html      = null;

    for (const r of opts.recipients ?? []) {
      this._peers.set(r.id, { name: r.name, status: 'waiting', state: null });
    }

    if (spectator)        this.options.title = `👁 ${this.options.title} — ${this.shared ? 'Party view' : 'Spectating'}`;
    else if (this.shared) this.options.title = `${this.options.title} — Together`;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      // theme-dark stops v14 forcing 'themed theme-light' onto every V1 app
      classes  : ['lockpick-minigame', 'lpm-puzzle', 'themed', 'theme-dark'],
      width    : 420,
      height   : 'auto',
      resizable: false,
    });
  }

  // ── Rendering helpers ────────────────────────────────────────────────────

  /** Spectator banner + roster, placed at the top of every puzzle. */
  _headerHTML() {
    let out = '';
    if (this._spectator) {
      const n   = this._peers.size;
      const who = n === 0 ? '⚠ nobody received this puzzle'
        : this.shared ? `party of ${n}` : `watching ${n} player${n === 1 ? '' : 's'}`;
      const join = this._canJoin()
        ? `<a class="lpm-join" role="button">▶ ${this.shared ? 'Join in' : 'Solve a copy'}</a>` : '';
      out += `<div class="lpm-spectator-banner"><span>👁 Spectator view — ${who}</span>${join}</div>`;
    }
    if (this._spectator || this.shared) out += `<div class="lpm-roster"></div>`;
    return out;
  }

  _canJoin() { return this._spectator && !this._joined && game.user.isGM; }

  _renderRoster(pulseId = null) {
    const el = this._html?.[0]?.querySelector('.lpm-roster');
    if (!el) return;
    const pickable = this._spectator && !this.shared;
    const chips = [...this._peers].map(([id, p]) => {
      const st  = STATUS[p.status] ?? STATUS.waiting;
      const me  = !this._spectator && id === game.user.id ? ' <em>(you)</em>' : '';
      const cls = ['lpm-chip', `is-${p.status}`];
      if (pickable) cls.push('pickable');
      if (pickable && id === this._watch) cls.push('watched');
      if (id === pulseId) cls.push('pulse');
      return `<span class="${cls.join(' ')}" data-user="${id}" title="${_esc(p.name)} ${st.label}">`
           + `<i>${st.icon}</i>${_esc(p.name)}${me}</span>`;
    });
    el.innerHTML = chips.join('') || '<span class="lpm-roster-empty">No players yet</span>';
    this._fit();
  }

  /** Grow the window when its content grew (the height is 'auto', set once in px). */
  _fit() {
    const c = this.element?.[0]?.querySelector('.window-content');
    if (c && c.scrollHeight > c.clientHeight + 1) this.setPosition({ height: 'auto' });
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._html = html;
    OPEN.add(this);
    html.find('.lpm-join').on('click', ev => { ev.preventDefault(); this._joinAsPlayer(); });
    html.find('.lpm-roster').on('click', '.lpm-chip.pickable', ev => {
      this._watch = ev.currentTarget.dataset.user;
      this._renderRoster();
      this._showPeer(this._peers.get(this._watch), null);
    });
    this._renderRoster();
    this._afterRender(html);
  }

  /** Subclass hook: wire the puzzle's own DOM. */
  _afterRender(html) {}

  // ── Sync ─────────────────────────────────────────────────────────────────

  _peer(id, name) {
    let p = this._peers.get(id);
    if (!p) {
      p = { name: name ?? game.users.get(id)?.name ?? 'Unknown', status: 'waiting', state: null };
      this._peers.set(id, p);
    }
    return p;
  }

  /** Update the roster entry of whoever produced `data`. */
  _track(data) {
    const peer = this._peer(data.from, data.name);
    if (data.state !== undefined) peer.state = data.state;
    const ev = data.event;
    if (ev === 'win' || ev === 'fail' || ev === 'leave') {
      peer.status = ev === 'win' ? 'solved' : ev === 'fail' ? 'failed' : 'left';
      // One puzzle, one outcome: the whole party shares it.
      if (this.shared && ev !== 'leave') for (const p of this._peers.values()) p.status = peer.status;
    } else if (peer.status === 'waiting') {
      peer.status = 'solving';
    }
    return peer;
  }

  _emit(event, extra = {}) {
    if (this._spectator) return;
    const data = {
      action: 'puzzleSync', session: this.session, puzzle: this.constructor.KEY,
      from: game.user.id, name: game.user.name, event, ...extra,
    };
    this._track(data);
    this._renderRoster();
    _broadcast(this, data);
  }

  _receive(data) {
    if (data.session !== this.session || data.puzzle !== this.constructor.KEY) return;
    if (!this._spectator && data.from === game.user.id) return;    // my own echo
    // Individual mode: players never see each other's boards.
    if (!this._spectator && !this.shared) return;
    const peer = this._track(data);
    if (!this._html || this._ended) return;
    this._onPeerUpdate(peer, data);
    if (this._spectator && !this.shared) {
      this._watch ??= data.from;                  // follow the first player who acts
      if (data.from === this._watch) this._showPeer(peer, data);
    } else {
      this._applyRemote(data, peer);
    }
    this._renderRoster(data.from);
  }

  /** Any message from any peer (all modes) — for per-player lists. */
  _onPeerUpdate(peer, data) {}
  /** Shared mode: apply a teammate's move (players and the GM's party view). */
  _applyRemote(data, peer) {}
  /** Individual-mode spectator: show `peer`'s board; `data` is null on a switch. */
  _showPeer(peer, data) {}
  /** Current shared state, handed to the GM when they join a running puzzle. */
  _snapshot() { return undefined; }

  _joinAsPlayer() {
    this._joined = true;
    this._html?.find('.lpm-join').remove();
    openPuzzle(this.constructor.KEY, this.difficulty, {
      ...this._opts,
      spectator   : false,
      initialState: this.shared ? this._snapshot() : undefined,
    });
  }

  // ── Endings ──────────────────────────────────────────────────────────────

  /** Replace the window body (never the header) with the outcome, then close. */
  _finish(ok, text, { post = false } = {}) {
    if (this._ended) return;
    this._ended = true;
    if (post) this._postSuccess();
    const content = this.element?.[0]?.querySelector('.window-content');
    if (content) {
      content.innerHTML = `<div class="lpm-puzzle-win ${ok ? 'is-win' : 'is-fail'}">${text}</div>`;
    }
    this._later(() => this.close(), 2600);
  }

  _postSuccess() {
    const what = `the “${this.constructor.NAME}” puzzle`;
    const me   = _esc(game.user.name);
    let content;
    if (this.shared)     content = `<p>🎉 <strong>The party solved ${what}!</strong> ${me} made the final move. The way is open.</p>`;
    else if (this._solo) content = `<p>🎉 <strong>${what[0].toUpperCase()}${what.slice(1)} is solved!</strong> The way is open.</p>`;
    else                 content = `<p>🎉 <strong>${me}</strong> solved ${what}.</p>`;
    ChatMessage.create(oocChatData({ content }));
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter(t => t !== id);
      fn();
    }, ms);
    this._timers.push(id);
    return id;
  }

  /** Subclass hook: remove document-level listeners. */
  _teardown() {}

  async close(options = {}) {
    // A player who walks away mid-puzzle shows up as such in the GM's roster.
    if (!this._spectator && !this._ended && this._html) {
      this._ended = true;
      this._emit('leave');
    }
    OPEN.delete(this);
    this._timers.forEach(clearTimeout);
    this._timers = [];
    this._teardown();
    return super.close(options);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SUDOKU
// ═════════════════════════════════════════════════════════════════════════════

// ─── Sudoku Generator ─────────────────────────────────────────────────────────

function _sudokuRandPerm(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _generateSudokuGrid() {
  // Base valid grid via modular arithmetic (each row is a left-rotation of the previous)
  const base = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      base.push((r * 3 + Math.floor(r / 3) + c) % 9 + 1);

  // Valid transformations that preserve correctness:
  //   shuffle bands (rows of 3), shuffle rows within each band,
  //   shuffle stacks (cols of 3), shuffle cols within each stack,
  //   relabel digits.
  const bandOrder  = _sudokuRandPerm(3);
  const stackOrder = _sudokuRandPerm(3);
  const rowInBand  = [_sudokuRandPerm(3), _sudokuRandPerm(3), _sudokuRandPerm(3)];
  const colInStack = [_sudokuRandPerm(3), _sudokuRandPerm(3), _sudokuRandPerm(3)];
  const digitMap   = _sudokuRandPerm(9);

  const rowMap = [];
  for (let b = 0; b < 3; b++)
    for (let i = 0; i < 3; i++)
      rowMap.push(bandOrder[b] * 3 + rowInBand[bandOrder[b]][i]);

  const colMap = [];
  for (let b = 0; b < 3; b++)
    for (let i = 0; i < 3; i++)
      colMap.push(stackOrder[b] * 3 + colInStack[stackOrder[b]][i]);

  const grid = new Array(81);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      grid[r * 9 + c] = digitMap[base[rowMap[r] * 9 + colMap[c]] - 1] + 1;

  return grid;
}

function _sudokuCanPlace(board, idx, v) {
  const r = Math.floor(idx / 9), c = idx % 9;
  for (let i = 0; i < 9; i++) {
    if (board[r * 9 + i] === v || board[i * 9 + c] === v) return false;
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (board[(br + i) * 9 + (bc + j)] === v) return false;
  return true;
}

// Returns how many solutions exist, stopping early once limit is reached.
function _sudokuCountSolutions(board, limit = 2) {
  const idx = board.indexOf(0);
  if (idx === -1) return 1;
  let count = 0;
  for (let v = 1; v <= 9 && count < limit; v++) {
    if (_sudokuCanPlace(board, idx, v)) {
      board[idx] = v;
      count += _sudokuCountSolutions(board, limit - count);
      board[idx] = 0;
    }
  }
  return count;
}

function _makeSudokuPuzzle(difficulty) {
  const solution = _generateSudokuGrid();
  // easy: 46 clues — solvable in ~3-5 min with mostly naked singles
  // medium: 34 clues; hard: 26 clues
  const clues    = difficulty === 'easy' ? 46 : difficulty === 'medium' ? 34 : 26;
  const toRemove = 81 - clues;

  const given   = [...solution];
  const indices = _sudokuRandPerm(81);
  let removed   = 0;

  for (const idx of indices) {
    if (removed >= toRemove) break;
    const saved = given[idx];
    given[idx]  = 0;
    if (_sudokuCountSolutions([...given]) === 1) {
      removed++;
    } else {
      given[idx] = saved; // removing this cell creates ambiguity — keep it
    }
  }

  return { given, solution };
}

class SudokuPuzzle extends PuzzleBase {
  static KEY  = 'sudoku';
  static NAME = 'Sudoku';

  constructor(difficulty, opts = {}) {
    super(difficulty, opts);
    const gen = (opts.given && opts.solution) ? opts : _makeSudokuPuzzle(difficulty);
    this.given    = [...gen.given];
    this.solution = [...gen.solution];
    this.board    = opts.initialState?.board ? [...opts.initialState.board] : [...this.given];
    this.selected = null;
    this._cells   = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: '🔢 Sudoku', width: 420 });
  }

  async _renderInner() {
    const pad = this._spectator ? '' : `
      <div class="lpm-sudoku-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-num="${n}">${n}</button>`).join('')}
        <button type="button" class="wide" data-num="0">Clear</button>
      </div>`;
    const hint = this._spectator
      ? (this.shared ? 'Read-only — the party’s board. Green = correct, red = wrong.'
                     : 'Read-only — click a name to see their board. Green = correct, red = wrong.')
      : (this.shared ? 'One board for everyone — click a cell, then 1–9 or the pad.'
                     : 'Click a cell → type 1–9 or use the pad (Delete / 0 clears)');
    return $(`<div class="lpm-sudoku-wrap">
      ${this._headerHTML()}
      <div class="lpm-sudoku-grid"></div>
      ${pad}
      <div class="lpm-puzzle-hint">${hint}</div>
    </div>`);
  }

  _afterRender(html) {
    const grid = html.find('.lpm-sudoku-grid')[0];
    grid.innerHTML = Array.from({ length: 81 }, (_, i) => {
      const r = Math.floor(i / 9), c = i % 9;
      const b = [r % 3 === 0 && 'border-top', c % 3 === 0 && 'border-left',
                 r === 8 && 'border-bottom', c === 8 && 'border-right'].filter(Boolean).join(' ');
      return `<div class="lpm-sudoku-cell ${b}" data-idx="${i}"></div>`;
    }).join('');
    this._cells = [...grid.children];

    if (!this._spectator) {
      grid.addEventListener('click', ev => {
        const cell = ev.target.closest('.lpm-sudoku-cell');
        if (!cell || this._ended) return;
        Sfx.select();
        this.selected = Number(cell.dataset.idx);
        this._paint();
      });
      // Number pad — makes the puzzle fully playable with the mouse alone.
      html.find('.lpm-sudoku-pad').on('click', 'button[data-num]', ev => {
        ev.preventDefault();
        this._setDigit(Number(ev.currentTarget.dataset.num));
      });
      // Keyboard: document CAPTURE phase. A listener on the app element never
      // fires reliably (focus sits on the window frame), and without capture +
      // stopPropagation the digits fall through to core and fire hotbar macros.
      this._keyHandler = this._onKey.bind(this);
      document.addEventListener('keydown', this._keyHandler, true);
    }
    this._paint();
  }

  _teardown() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
  }

  _paint() {
    const reveal = this._spectator;
    const sel    = this.selected;
    const selV   = sel !== null ? this.board[sel] : 0;
    const sr = sel !== null ? Math.floor(sel / 9) : -9, sc = sel !== null ? sel % 9 : -9;
    this._cells.forEach((cell, i) => {
      const v = this.board[i], given = !!this.given[i];
      const r = Math.floor(i / 9), c = i % 9;
      cell.textContent = v || '';
      cell.classList.toggle('given',    given);
      cell.classList.toggle('player',   !given && !!v);
      cell.classList.toggle('selected', i === sel);
      cell.classList.toggle('related',  sel !== null && i !== sel && (r === sr || c === sc
        || (Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc / 3))));
      cell.classList.toggle('same',     !!selV && i !== sel && v === selV);
      cell.classList.toggle('error',    reveal && !given && !!v && v !== this.solution[i]);
      cell.classList.toggle('correct',  reveal && !given && !!v && v === this.solution[i]);
    });
  }

  /** Brief glow on a cell someone else just changed. */
  _flashCell(i) {
    const cell = this._cells[i];
    if (!cell) return;
    cell.classList.remove('remote');
    void cell.offsetWidth;
    cell.classList.add('remote');
  }

  /** True when this window should receive keyboard input. */
  _ownsKeyboard() {
    const el = this.element?.[0];
    if (!el || this._spectator || this._ended) return false;
    const ae = document.activeElement;
    if (ae && ae !== document.body && !el.contains(ae)
        && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return false;   // a text field elsewhere wins
    return this.selected !== null;
  }

  _onKey(e) {
    if (!this._ownsKeyboard()) return;
    const i = this.selected;
    const isDigit = e.key >= '1' && e.key <= '9';
    const isClear = e.key === 'Delete' || e.key === 'Backspace' || e.key === '0';
    const isMove  = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key);
    if (!isDigit && !isClear && !isMove) return;

    // Claim the key so core doesn't also fire a hotbar macro / pan the canvas.
    e.preventDefault();
    e.stopPropagation();

    if (isDigit || isClear) { this._setDigit(isClear ? 0 : Number(e.key)); return; }
    if      (e.key === 'ArrowRight') this.selected = Math.min(80, i + 1);
    else if (e.key === 'ArrowLeft')  this.selected = Math.max(0,  i - 1);
    else if (e.key === 'ArrowDown')  this.selected = Math.min(80, i + 9);
    else if (e.key === 'ArrowUp')    this.selected = Math.max(0,  i - 9);
    this._paint();
  }

  /** Write a digit (0 = clear) into the selected cell. Shared by keyboard and pad. */
  _setDigit(n) {
    const i = this.selected;
    if (this._ended || i === null || this.given[i] || this.board[i] === n) return;
    this.board[i] = n;
    // Deliberately the SAME cue for right and wrong digits: correctness is only
    // revealed to the GM, so the sound must not leak it to the player.
    n ? Sfx.place() : Sfx.select();
    this._paint();
    this._emit('state', { state: this._snapshot(), op: { i, v: n } });
    if (n && this._solved()) {
      this._emit('win');
      Sfx.solved();
      this._finish(true, '🎉 Sudoku solved!', { post: true });
    }
  }

  _solved() { return this.board.every((v, i) => v === this.solution[i]); }

  _snapshot() { return { board: [...this.board] }; }

  _applyRemote(data, peer) {
    // Cell-level ops: two players filling different cells at once both land.
    if (data.op && !this.given[data.op.i]) {
      this.board[data.op.i] = data.op.v;
      this._paint();
      this._flashCell(data.op.i);
      if (!this._spectator) Sfx.place();
    }
    if (data.event === 'win') {
      Sfx.solved();
      this._finish(true, `🎉 Sudoku solved!<small>Final digit by ${_esc(peer.name)}</small>`);
    }
  }

  _showPeer(peer, data) {
    this.board = peer?.state?.board ? [...peer.state.board] : [...this.given];
    this._paint();
    if (data?.op) this._flashCell(data.op.i);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SLIDING TILES
// ═════════════════════════════════════════════════════════════════════════════

const _slidingSize = d => d === 'easy' ? 3 : d === 'medium' ? 4 : 5;

function _slidingValidMoves(blankIdx, size) {
  const r = Math.floor(blankIdx / size), c = blankIdx % size;
  const moves = [];
  if (r > 0)        moves.push(blankIdx - size);
  if (r < size - 1) moves.push(blankIdx + size);
  if (c > 0)        moves.push(blankIdx - 1);
  if (c < size - 1) moves.push(blankIdx + 1);
  return moves;
}

function _slidingGenerateTiles(size, difficulty) {
  const n = size * size;
  let tiles = Array.from({ length: n }, (_, i) => i);
  const shuffles = difficulty === 'easy' ? 40 : difficulty === 'medium' ? 80 : 150;
  let blankIdx = n - 1;
  for (let s = 0; s < shuffles; s++) {
    const moves = _slidingValidMoves(blankIdx, size);
    const next  = moves[Math.floor(Math.random() * moves.length)];
    [tiles[blankIdx], tiles[next]] = [tiles[next], tiles[blankIdx]];
    blankIdx = next;
  }
  return tiles;
}

class SlidingPuzzle extends PuzzleBase {
  static KEY  = 'sliding';
  static NAME = 'Sliding Tiles';

  constructor(difficulty, opts = {}) {
    super(difficulty, opts);
    this.size  = opts.size ?? _slidingSize(difficulty);
    this.start = opts.tiles ? [...opts.tiles] : _slidingGenerateTiles(this.size, difficulty);
    const init = opts.initialState;
    this.tiles = init?.tiles ? [...init.tiles] : [...this.start];
    this.moves = init?.moves ?? 0;
    // Version + author of the current layout. Shared moves are whole layouts;
    // on a tie the lower user id wins, so simultaneous moves still converge.
    this._v  = init?.v  ?? 0;
    this._by = init?.by ?? '';
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: '🧱 Sliding Tiles', width: 440 });
  }

  async _renderInner() {
    const hint = this._spectator
      ? (this.shared ? 'Read-only — the party’s board' : 'Read-only — click a name to see their board')
      : (this.shared ? 'One board for everyone — slide a glowing tile into the gap'
                     : 'Slide a glowing tile into the gap. Restore the picture 1 → ' + (this.size * this.size - 1));
    return $(`<div class="lpm-sliding-wrap">
      ${this._headerHTML()}
      <div class="lpm-sliding-moves">Moves: <span class="lpm-moves">0</span></div>
      <div class="lpm-sliding-grid" style="--sz:${this.size}"></div>
      <div class="lpm-puzzle-hint">${hint}</div>
    </div>`);
  }

  _afterRender(html) {
    this._grid = html.find('.lpm-sliding-grid')[0];
    if (!this._spectator) {
      this._grid.addEventListener('click', ev => {
        const tile = ev.target.closest('.lpm-tile[data-idx]');
        if (tile) this._move(Number(tile.dataset.idx));
      });
    }
    this._paint();
  }

  _validMoves(blankIdx) { return _slidingValidMoves(blankIdx, this.size); }

  _paint(movedTo = -1) {
    if (!this._grid) return;
    const n      = this.size;
    const blank  = this.tiles.indexOf(0);
    const canMove = !this._spectator && !this._ended ? this._validMoves(blank) : [];
    this._grid.innerHTML = this.tiles.map((val, idx) => {
      if (!val) return `<div class="lpm-tile empty" data-idx="${idx}"></div>`;
      // Slice of the stone picture that belongs to this tile's HOME square.
      const home = val - 1, gr = Math.floor(home / n), gc = home % n;
      const px = n * STONE_ASPECT > 1 ? gc / (n * STONE_ASPECT - 1) * 100 : 0;
      const py = n > 1 ? gr / (n - 1) * 100 : 0;
      const cls = ['lpm-tile'];
      if (idx === home)             cls.push('placed');
      if (canMove.includes(idx))    cls.push('movable');
      if (idx === movedTo)          cls.push('just-moved');
      return `<div class="${cls.join(' ')}" data-idx="${idx}" style="`
           + `background-size:100% 100%,auto ${n * 100}%;`
           + `background-position:0 0,${px.toFixed(2)}% ${py.toFixed(2)}%">`
           + `<span class="lpm-tile-num">${val}</span></div>`;
    }).join('');
    const m = this._html?.[0]?.querySelector('.lpm-moves');
    if (m) m.textContent = this.moves;
  }

  _move(idx) {
    if (this._ended) return;
    const blank = this.tiles.indexOf(0);
    if (!this._validMoves(blank).includes(idx)) { Sfx.select(); return; }   // not next to the gap
    [this.tiles[blank], this.tiles[idx]] = [this.tiles[idx], this.tiles[blank]];
    this.moves++;
    this._v++;
    this._by = game.user.id;
    Sfx.slide();
    this._paint(blank);
    this._emit('state', { state: this._snapshot() });
    if (this._solved()) {
      this._emit('win');
      Sfx.solved();
      this._finish(true, `🎉 Solved in ${this.moves} moves!`, { post: true });
    }
  }

  _solved() { return this.tiles.every((v, i) => v === (i === this.tiles.length - 1 ? 0 : i + 1)); }

  _snapshot() { return { tiles: [...this.tiles], moves: this.moves, v: this._v, by: this._by }; }

  _adopt(s) {
    const blankBefore = this.tiles.indexOf(0);
    this.tiles = [...s.tiles];
    this.moves = s.moves ?? this.moves;
    this._v    = s.v ?? this._v;
    this._by   = s.by ?? this._by;
    this._paint(this.tiles[blankBefore] ? blankBefore : -1);
  }

  _applyRemote(data, peer) {
    const s = data.state;
    if (s?.tiles && (s.v > this._v || (s.v === this._v && s.by < this._by))) {
      this._adopt(s);
      if (!this._spectator) Sfx.slide();
    }
    if (data.event === 'win') {
      Sfx.solved();
      this._finish(true, `🎉 Solved in ${this.moves} moves!<small>Last tile by ${_esc(peer.name)}</small>`);
    }
  }

  _showPeer(peer) {
    const s = peer?.state;
    if (s?.tiles) this._adopt(s);
    else { this.tiles = [...this.start]; this.moves = 0; this._paint(); }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CIPHER
// ═════════════════════════════════════════════════════════════════════════════

// Fantasy alphabets mapping to English letters
const FANTASY_ALPHABETS = {
  infernal: {
    name: 'Infernal',
    // Each entry: fantasy char → English letter
    map: {
      '𐌰':'A','𐌱':'B','𐌲':'C','𐌳':'D','𐌴':'E','𐌵':'F','𐌶':'G','𐌷':'H',
      '𐌸':'I','𐌹':'J','𐌺':'K','𐌻':'L','𐌼':'M','𐌽':'N','𐌾':'O','𐌿':'P',
      '𐍀':'Q','𐍁':'R','𐍂':'S','𐍃':'T','𐍄':'U','𐍅':'V','𐍆':'W','𐍇':'X',
      '𐍈':'Y','𐍉':'Z'
    }
  },
  abyssal: {
    name: 'Abyssal',
    map: {
      'ᚨ':'A','ᛒ':'B','ᚳ':'C','ᛞ':'D','ᛖ':'E','ᚠ':'F','ᚷ':'G','ᚺ':'H',
      'ᛁ':'I','ᛃ':'J','ᚲ':'K','ᛚ':'L','ᛗ':'M','ᚾ':'N','ᛟ':'O','ᛈ':'P',
      'ᛩ':'Q','ᚱ':'R','ᛊ':'S','ᛏ':'T','ᚢ':'U','ᚡ':'V','ᚹ':'W','ᛪ':'X',
      'ᚤ':'Y','ᛉ':'Z'
    }
  },
  elvish: {
    name: 'Elvish (Tengwar)',
    map: {
      'α':'A','β':'B','γ':'C','δ':'D','ε':'E','ζ':'F','η':'G','θ':'H',
      'ι':'I','κ':'J','λ':'K','μ':'L','ν':'M','ξ':'N','ο':'O','π':'P',
      'ρ':'Q','σ':'R','τ':'S','υ':'T','φ':'U','χ':'V','ψ':'W','ω':'X',
      'ϑ':'Y','ϕ':'Z'
    }
  }
};

const CIPHER_WORDS = {
  easy:   ['DOOR', 'LOCK', 'GOLD', 'FIRE', 'WOLF', 'MOON', 'STAR', 'KING', 'DARK', 'IRON'],
  medium: ['DRAGON', 'CASTLE', 'WIZARD', 'SHIELD', 'PORTAL', 'GOBLIN', 'SHADOW', 'TEMPLE'],
  hard:   ['DUNGEON MASTER', 'ANCIENT RUNES', 'FORBIDDEN TOME', 'DRAGONS HOARD'],
};

function _makeCipher(difficulty, { lang, customWord, shift } = {}) {
  const clean = String(customWord ?? '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
  const pool  = CIPHER_WORDS[difficulty] ?? CIPHER_WORDS.easy;
  const s     = Number.parseInt(shift);
  return {
    lang  : FANTASY_ALPHABETS[lang] ? lang : Object.keys(FANTASY_ALPHABETS)[0],
    answer: clean || pool[Math.floor(Math.random() * pool.length)],
    shift : s >= 1 && s <= 25 ? s : 3 + Math.floor(Math.random() * 8),
  };
}

class CipherPuzzle extends PuzzleBase {
  static KEY  = 'cipher';
  static NAME = 'Cipher';

  constructor(difficulty, opts = {}) {
    super(difficulty, opts);
    const c = opts.answer ? opts : _makeCipher(difficulty, opts);
    this.answer   = c.answer;
    this.shift    = c.shift;
    this.langData = FANTASY_ALPHABETS[c.lang] ?? Object.values(FANTASY_ALPHABETS)[0];

    // English → fantasy glyph
    this.engToFan = {};
    for (const [fan, eng] of Object.entries(this.langData.map)) this.engToFan[eng] ??= fan;

    this.caesarText  = this._caesar(this.answer, this.shift);
    this.fantasyText = [...this.caesarText].map(ch => ch === ' ' ? ' ' : (this.engToFan[ch] ?? ch)).join('');
    this._guesses    = new Map();   // userId → { typing, last }
  }

  _caesar(text, shift) {
    return [...text].map(ch => ch === ' ' ? ' '
      : String.fromCharCode(((ch.charCodeAt(0) - 65 + shift) % 26) + 65)).join('');
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: '🔤 Cipher', width: 540, resizable: true });
  }

  async _renderInner() {
    const table = Object.entries(this.langData.map).map(([fan, eng]) =>
      `<div class="lpm-cipher-pair"><span class="lpm-coded">${fan}</span><span class="lpm-plain">${eng}</span></div>`
    ).join('');
    const encoded = `<div class="lpm-cipher-encoded lpm-fantasy">${this.fantasyText}</div>`;

    if (this._spectator) {
      return $(`<div class="lpm-cipher-wrap">
        ${this._headerHTML()}
        <div class="lpm-cipher-step">
          <div class="lpm-cipher-step-label">🔑 Answer (GM only) · shift ${this.shift}</div>
          <div class="lpm-cipher-encoded lpm-cipher-answer">${_esc(this.answer)}</div>
        </div>
        <div class="lpm-cipher-step">
          <div class="lpm-cipher-step-label">Encoded text</div>
          ${encoded}
        </div>
        <div class="lpm-cipher-step">
          <div class="lpm-cipher-step-label">${this.shared ? 'The party is typing' : 'Players are typing'}</div>
          <div class="lpm-cipher-live"><div class="lpm-cipher-row lpm-dim">— waiting —</div></div>
        </div>
      </div>`);
    }

    const showTable = this.difficulty !== 'hard';
    return $(`<div class="lpm-cipher-wrap">
      ${this._headerHTML()}
      <div class="lpm-cipher-step">
        <div class="lpm-cipher-step-label">Step 1 — Decode the ${this.langData.name} alphabet</div>
        ${encoded}
        ${showTable
          ? `<div class="lpm-cipher-sublabel">${this.langData.name} → English table:</div>
             <div class="lpm-cipher-table">${table}</div>`
          : '<p class="lpm-puzzle-hint">No table provided — find the pattern.</p>'}
      </div>
      <div class="lpm-cipher-step">
        <div class="lpm-cipher-step-label">Step 2 — Caesar cipher</div>
        <p class="lpm-puzzle-hint">${this.difficulty === 'hard'
          ? 'The shift is unknown. Find the pattern.'
          : `Each letter is shifted <strong>${this.shift}</strong> positions forward in the alphabet. Subtract ${this.shift} to get the original.`}</p>
      </div>
      ${this.shared ? `<div class="lpm-cipher-step">
        <div class="lpm-cipher-step-label">Your party</div>
        <div class="lpm-cipher-live"><div class="lpm-cipher-row lpm-dim">Nobody else is typing yet</div></div>
      </div>` : ''}
      <div class="lpm-cipher-answer-box">
        <div class="lpm-cipher-input" contenteditable="true" spellcheck="false"
             data-placeholder="Type your answer in English…" data-empty="1"></div>
        <button type="button" class="lpm-cipher-check">✓ Check</button>
      </div>
      <div class="lpm-cipher-feedback"></div>
    </div>`);
  }

  _afterRender(html) {
    if (this._spectator) return;
    const input = html.find('.lpm-cipher-input')[0];
    const check = html.find('.lpm-cipher-check')[0];
    const text  = () => input.innerText.toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();

    input.addEventListener('input', () => {
      input.dataset.empty = input.innerText.trim() === '' ? '1' : '0';
      this._emit('state', { state: { typing: text() } });
    });

    // contenteditable keys must not reach core's KeyboardManager (hotkeys).
    const capture = e => {
      if (document.activeElement !== input) return;
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Enter') { e.preventDefault(); this._check(text()); }
      else if (e.key.length === 1) Sfx.key();
    };
    for (const ev of ['keydown', 'keyup', 'keypress']) window.addEventListener(ev, capture, true);
    this._capture = capture;

    check.addEventListener('click', () => this._check(text()));
    this._later(() => input.focus(), 200);
  }

  _teardown() {
    if (!this._capture) return;
    for (const ev of ['keydown', 'keyup', 'keypress']) window.removeEventListener(ev, this._capture, true);
    this._capture = null;
  }

  _check(guess) {
    if (this._ended || !guess) return;
    if (guess === this.answer) {
      this._emit('win', { state: { typing: guess } });
      Sfx.solved();
      this._finish(true, `🎉 Cipher solved!<small>${_esc(this.answer)}</small>`, { post: true });
      return;
    }
    Sfx.fail();
    this._emit('attempt', { guess });
    const fb = this._html?.[0]?.querySelector('.lpm-cipher-feedback');
    if (fb) fb.textContent = `❌ “${guess}” is not it — try again.`;
    const box = this._html?.[0]?.querySelector('.lpm-cipher-answer-box');
    if (box) { box.classList.remove('lpm-shake'); void box.offsetWidth; box.classList.add('lpm-shake'); }
  }

  _onPeerUpdate(peer, data) {
    const g = this._guesses.get(data.from) ?? { typing: '', last: '' };
    if (data.state?.typing !== undefined) g.typing = data.state.typing;
    if (data.event === 'attempt') g.last = data.guess;
    this._guesses.set(data.from, g);
    this._renderLive();
  }

  _renderLive() {
    const box = this._html?.[0]?.querySelector('.lpm-cipher-live');
    if (!box) return;
    const rows = [...this._guesses].filter(([id]) => this._spectator || id !== game.user.id).map(([id, g]) => {
      const p = this._peers.get(id);
      const st = p?.status === 'solved' ? ' is-solved' : p?.status === 'left' ? ' is-left' : '';
      const last = g.last ? `<span class="lpm-cipher-last">✗ ${_esc(g.last)}</span>` : '';
      return `<div class="lpm-cipher-row${st}"><span class="lpm-cipher-who">${_esc(p?.name ?? '?')}</span>`
           + `<span class="lpm-cipher-typing">${_esc(g.typing) || '…'}</span>${last}</div>`;
    });
    if (rows.length) box.innerHTML = rows.join('');
    this._fit();
  }

  _applyRemote(data, peer) {
    if (data.event === 'win') {
      Sfx.solved();
      this._finish(true, `🎉 Cipher solved!<small>${_esc(this.answer)} — cracked by ${_esc(peer.name)}</small>`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RUNE SEQUENCE (Simon)
// ═════════════════════════════════════════════════════════════════════════════

const SIMON_COLORS = [
  { id: 0, hex: '#2ecc71', dark: '#061409', border: '#1a6b3a', label: 'Algiz'  },  // emerald
  { id: 1, hex: '#e74c3c', dark: '#160606', border: '#6b1a1a', label: 'Tiwaz'  },  // ruby
  { id: 2, hex: '#3498db', dark: '#060e18', border: '#1a4a6b', label: 'Isa'    },  // sapphire
  { id: 3, hex: '#f39c12', dark: '#160e00', border: '#6b4800', label: 'Othala' },  // amber
];

// Elder Futhark rune paths — coords in 0-1 space (wide, bold shapes)
const RUNES = [
  // Algiz (ᚨ) — protection: tall spine + two wide upward branches
  [ [0.50,0.08, 0.50,0.92],
    [0.50,0.28, 0.18,0.58],
    [0.50,0.28, 0.82,0.58] ],
  // Tiwaz (ᛏ) — victory: upward spear (V at top) + crossbar
  [ [0.50,0.08, 0.50,0.92],
    [0.50,0.08, 0.18,0.42],
    [0.50,0.08, 0.82,0.42],
    [0.22,0.64, 0.78,0.64] ],
  // Kenaz (ᚲ) — torch: spine + two right-pointing arms (like ᚲ)
  [ [0.50,0.08, 0.50,0.92],
    [0.50,0.26, 0.82,0.50],
    [0.50,0.50, 0.82,0.74] ],
  // Othala (ᛟ) — heritage: wide diamond + two splayed legs
  [ [0.50,0.10, 0.82,0.46],
    [0.82,0.46, 0.50,0.80],
    [0.50,0.80, 0.18,0.46],
    [0.18,0.46, 0.50,0.10],
    [0.18,0.46, 0.10,0.92],
    [0.82,0.46, 0.90,0.92] ],
];

const _simonLength   = d => d === 'easy' ? 4 : d === 'medium' ? 6 : 9;
const _simonSequence = d => Array.from({ length: _simonLength(d) }, () => Math.floor(Math.random() * 4));

class SimonPuzzle extends PuzzleBase {
  static KEY  = 'simon';
  static NAME = 'Rune Sequence';

  constructor(difficulty, opts = {}) {
    super(difficulty, opts);
    this.sequence = opts.sequence ? [...opts.sequence] : _simonSequence(difficulty);
    this.step     = 0;
    this.phase    = 'ready';     // ready → watch → input → done
    this._playback = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: '🔮 Rune Sequence', width: 420 });
  }

  // Joining a shared ritual only makes sense before it starts.
  _canJoin() { return super._canJoin() && (!this.shared || this.phase === 'ready'); }

  async _renderInner() {
    const grid = SIMON_COLORS.map(c => `
      <div class="lpm-simon-btn" data-id="${c.id}" style="background:${c.dark};border-color:${c.border}">
        <canvas class="lpm-rune-canvas" data-id="${c.id}" width="120" height="110"
                style="display:block;pointer-events:none;"></canvas>
        <span class="lpm-rune-label">${c.label}</span>
      </div>`).join('');

    const status = this._spectator ? '👁 Waiting for the player…' : '🔮 Ready to begin?';
    const hint = this._spectator
      ? (this.shared ? 'Read-only — the party’s runes in real time' : 'Read-only — click a name to follow that player')
      : (this.shared ? 'One ritual for the party — anyone may press the next rune'
                     : 'Memorize the sequence → repeat the runes in the same order');
    return $(`<div class="lpm-simon-wrap">
      ${this._headerHTML()}
      <div class="lpm-simon-status">${status}</div>
      <div class="lpm-simon-progress"></div>
      <div class="lpm-simon-grid${this._spectator ? ' is-readonly' : ''}">${grid}</div>
      ${this._spectator ? '' : `<button type="button" class="lpm-simon-ready-btn">ᚱ&nbsp;&nbsp;${this.shared ? 'Begin the ritual' : 'Ready — begin!'}&nbsp;&nbsp;ᚱ</button>`}
      <div class="lpm-puzzle-hint">${hint}</div>
    </div>`);
  }

  _afterRender(html) {
    requestAnimationFrame(() => this._drawAllRunes());
    this._updateProgress();
    if (this._spectator) return;

    html.find('.lpm-simon-btn').on('click', ev => {
      if (this.phase !== 'input' || this._ended) return;
      const id = Number(ev.currentTarget.dataset.id);
      this._flash(id, 220);
      this._press(id, true);
    });
    html.find('.lpm-simon-ready-btn').on('click', () => {
      Sfx.unlock();   // create the AudioContext inside a user gesture
      if (this.phase !== 'ready') return;
      this._emit('ready', { state: { step: 0, phase: 'watch' } });
      this._startSequence();
    });
  }

  _startSequence(by = null) {
    this.phase = 'watch';
    this.step  = 0;
    this._html?.find('.lpm-simon-ready-btn, .lpm-join').remove();
    this._setStatus(by ? `🔮 ${_esc(by)} began the ritual — memorize the sequence…` : '🔮 Memorize the sequence…');
    this._updateProgress();

    let delay = 500;
    this._playback = this.sequence.map(id => {
      const t = this._later(() => this._flash(id, 550, { emit: !this.shared }), delay);
      delay += 850;
      return t;
    });
    this._playback.push(this._later(() => this._toInput(), delay + 300));
  }

  _toInput() {
    if (this.phase !== 'watch') return;
    this.phase = 'input';
    this._setStatus(this._spectator ? '⚡ Repeating the runes…'
      : this.shared ? '⚡ Your party’s turn — repeat the runes!' : '⚡ Your turn! Repeat the rune sequence.');
  }

  /** A rune pressed — locally (`local`) or by a teammate in shared mode. */
  _press(id, local, by = null) {
    if (this._ended || this.phase === 'done') return;
    if (local) {
      this._emit(this.shared ? 'press' : 'flash', { colorId: id, duration: 220, step: this.step });
    }

    if (id !== this.sequence[this.step]) {
      this.phase = 'done';
      Sfx.fail();
      if (local) this._emit('fail', { state: { step: this.step, phase: 'done' } });
      this._setStatus(local ? '❌ Wrong rune! The sequence is broken.' : `❌ ${_esc(by)} pressed the wrong rune!`);
      this._later(() => this._finish(false,
        local ? '❌ The sequence is broken!' : `❌ The sequence is broken!<small>${_esc(by)} pressed the wrong rune</small>`), 900);
      return;
    }

    this.step++;
    this._updateProgress();
    if (local && !this.shared) this._emit('progress', { state: { step: this.step, phase: 'input' } });

    if (this.step === this.sequence.length) {
      this.phase = 'done';
      this._later(() => Sfx.simonWin(), 260);   // let the last rune tone ring first
      this._setStatus('✨ The runes respond! Success!');
      if (local) this._emit('win', { state: { step: this.step, phase: 'done' } });
      this._later(() => this._finish(true, '✨ Rune sequence recreated!', { post: local }), 700);
    }
  }

  _applyRemote(data, peer) {
    switch (data.event) {
      case 'ready':
        if (this.phase === 'ready') this._startSequence(peer.name);
        break;
      case 'press':
        // Only a press made on the step we are on counts; a late duplicate from
        // a simultaneous press is dropped (a wrong one still fails via 'fail').
        if (data.step !== this.step || this.phase === 'done') break;
        if (this.phase === 'watch') {           // their playback ended a bit before ours
          this._playback.forEach(clearTimeout);
          this.phase = 'input';
        }
        this._flash(data.colorId, data.duration ?? 220, { emit: false, quiet: this._joined });
        this._press(data.colorId, false, peer.name);
        break;
      case 'fail':
        if (this._ended || this.phase === 'done') break;
        this.phase = 'done';
        Sfx.fail();
        this._finish(false, `❌ The sequence is broken!<small>${_esc(peer.name)} pressed the wrong rune</small>`);
        break;
      case 'win':
        if (this._ended || this.phase === 'done') break;
        this.phase = 'done';
        Sfx.simonWin();
        this._finish(true, '✨ Rune sequence recreated!');
        break;
    }
  }

  _showPeer(peer, data) {
    const name = _esc(peer?.name ?? 'The player');
    if (!data) {                                 // switched to another player
      this.step = peer?.state?.step ?? 0;
      this._updateProgress();
      const st = peer?.status;
      this._setStatus(st === 'solved' ? `✅ ${name} recreated the sequence`
        : st === 'failed' ? `❌ ${name} broke the sequence`
        : st === 'waiting' ? `👁 ${name} has not started yet` : `👁 Following ${name}`);
      return;
    }
    switch (data.event) {
      case 'ready':    this.step = 0; this._updateProgress(); this._setStatus(`🔮 ${name} is memorizing the sequence…`); break;
      case 'flash':    this._flash(data.colorId, data.duration, { emit: false }); break;
      case 'progress': this.step = data.state?.step ?? this.step; this._updateProgress();
                       this._setStatus(`⚡ ${name}: ${this.step} / ${this.sequence.length}`); break;
      case 'fail':     this._setStatus(`❌ ${name} broke the sequence`); Sfx.fail(); break;
      case 'win':      this.step = this.sequence.length; this._updateProgress();
                       this._setStatus(`✅ ${name} recreated the sequence`); Sfx.simonWin(); break;
      case 'leave':    this._setStatus(`⏏ ${name} closed the puzzle`); break;
    }
  }

  _flash(colorId, duration, { emit = true, quiet = false } = {}) {
    const btn = this._html?.[0]?.querySelector(`.lpm-simon-btn[data-id="${colorId}"]`);
    if (!btn) return;
    // Each rune has its own pitch — that is what makes the sequence memorable.
    if (!quiet) Sfx.simonRune(colorId, Math.min(0.5, (duration ?? 300) / 1000));
    const c = SIMON_COLORS[colorId];
    btn.classList.add('lit');
    btn.style.borderColor = c.hex;
    btn.style.boxShadow   = `0 0 32px 10px ${c.hex}77, inset 0 0 18px ${c.hex}33`;
    this._flashRune(colorId, true);
    this._later(() => {
      btn.classList.remove('lit');
      btn.style.borderColor = c.border;
      btn.style.boxShadow   = '';
      this._flashRune(colorId, false);
    }, duration);
    // Individual mode: mirror this player's flashes to the GM.
    if (emit && !this._spectator && this.phase === 'watch') {
      this._emit('flash', { colorId, duration });
    }
  }

  _flashRune(colorId, lit) {
    const c = this._html?.[0]?.querySelector(`.lpm-rune-canvas[data-id="${colorId}"]`);
    if (c) this._drawRune(c, colorId, lit);
  }

  _drawAllRunes() {
    this._html?.[0]?.querySelectorAll('.lpm-rune-canvas').forEach(c => this._drawRune(c, Number(c.dataset.id), false));
  }

  _drawRune(canvas, id, lit) {
    const w = canvas.offsetWidth  || 120;
    const h = canvas.offsetHeight || 110;
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const segments = RUNES[id];
    const c        = SIMON_COLORS[id];

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    const drawSegs = () => {
      for (const seg of segments) {
        ctx.beginPath();
        for (let j = 0; j < seg.length; j += 2)
          j === 0 ? ctx.moveTo(seg[j]*w, seg[j+1]*h) : ctx.lineTo(seg[j]*w, seg[j+1]*h);
        ctx.stroke();
      }
    };

    if (lit) {
      // Outer coloured glow pass
      ctx.shadowBlur  = 32;
      ctx.shadowColor = c.hex;
      ctx.lineWidth   = 9;
      ctx.strokeStyle = c.hex + '88';
      drawSegs();
      // Bright white core
      ctx.shadowBlur  = 20;
      ctx.shadowColor = c.hex;
      ctx.lineWidth   = 6;
      ctx.strokeStyle = '#ffffff';
      drawSegs();
      // Colour tint on top
      ctx.shadowBlur  = 0;
      ctx.lineWidth   = 3;
      ctx.strokeStyle = c.hex;
      drawSegs();
    } else {
      // Dim base — clearly visible but not lit
      ctx.shadowBlur  = 10;
      ctx.shadowColor = c.hex + '99';
      ctx.lineWidth   = 4.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      drawSegs();
      // Subtle colour tint
      ctx.shadowBlur  = 0;
      ctx.lineWidth   = 2;
      ctx.strokeStyle = c.hex + 'aa';
      drawSegs();
    }

    // Junction dots
    ctx.shadowBlur = lit ? 10 : 4;
    ctx.shadowColor = c.hex;
    ctx.fillStyle   = lit ? '#ffffff' : 'rgba(255,255,255,0.7)';
    for (const seg of segments) {
      ctx.beginPath();
      ctx.arc(seg[0]*w, seg[1]*h, lit ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _setStatus(msg) {
    const el = this._html?.[0]?.querySelector('.lpm-simon-status');
    if (el) el.innerHTML = msg;
  }

  _updateProgress() {
    const el = this._html?.[0]?.querySelector('.lpm-simon-progress');
    if (!el) return;
    el.innerHTML = this.sequence.map((_, i) =>
      `<span class="lpm-simon-dot${i < this.step ? ' done' : ''}">${i < this.step ? '●' : '○'}</span>`).join('');
  }
}
