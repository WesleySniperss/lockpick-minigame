/**
 * MiniGameApp.mjs — the window every Arcana mini-game runs in.
 *
 * A DPR-aware canvas, an optional controls row and the footer: roll badge, a
 * meter (focus / time / steadiness), a hint and Leave. The base runs the frame
 * loop, resolves the outcome exactly once (also when the window is closed
 * early), plays the ending, draws the result screen and keeps spectators in
 * sync (they rebuild the same game from `init` and mirror `syncState()`).
 *
 * Subclasses provide:
 *   static KIND / TITLE / CANVAS {w, h}
 *   buildGame(init)           — create the game from {seed, dc, roll}
 *   update(dt)                — advance; return 'won' | 'lost' | null
 *   draw(ctx, dt)             — draw one frame in logical units (render() is the window's own)
 *   bindInput(canvas, root)   — player only; root is the window content element
 *   meterHTML()               — right side of the footer
 *   hintHTML(), controlsHTML()
 *   syncState() / applySync(state)
 *   endScreen(success)        — { title, sub, icon(ctx, x, y, tone) }
 *   endDelay / renderEnding(ctx, t, success) — optional animation before the result screen
 */

import { GameWindow } from './app-window.mjs';
import { drawResultOverlay } from './overlay.mjs';
import { esc } from './cards.mjs';

const MODULE_ID = 'lockpick-minigame';
const CHANNEL   = `module.${MODULE_ID}`;

/**
 * Roll badge in the footer (same look as the lockpick window). With `hidden`
 * the DC stays secret: only the total and a natural 20 / 1 show.
 */
export function rollBadge(el, rollResult, { hidden = false } = {}) {
  if (!el || !rollResult) return;
  const { total, d20, dc, margin } = rollResult;
  const nat = d20 === 20 ? 'crit' : d20 === 1 ? 'fumble' : null;
  const state = nat ?? (hidden ? 'secret' : margin >= 0 ? 'beat' : 'miss');
  const note = { crit: 'Natural 20', fumble: 'Natural 1', secret: 'The DC is secret',
                 beat: margin === 0 ? 'Exactly the DC' : `Beat by ${margin}`, miss: `Short by ${-margin}` }[state];
  el.className = `lpm-roll-result lpm-roll lpm-roll--${state}`;
  el.innerHTML = `<i class="fa-solid fa-dice-d20 lpm-roll__die"></i>`
    + `<span class="lpm-roll__total">${total}</span>`
    + `<span class="lpm-roll__meta"><span class="lpm-roll__vs">${hidden ? 'Your roll' : `vs DC ${dc}`}</span>`
    + `<span class="lpm-roll__note">${note}</span></span>`;
}

/** Hide the DC from this client? Only from players: a GM always sees it. */
export const dcHiddenHere = hideDC => !!hideDC && !game.user?.isGM;

/** A labelled bar: "Focus ▮▮▮▯ 9 / 12". */
export function barHTML(label, value, max, { text = `${Math.round(value)} / ${Math.round(max)}`, tip = '', low = 0.25 } = {}) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return `<span class="lpm-attempts-label" title="${esc(tip)}">${esc(label)}</span>`
    + `<span class="lpm-bar${f <= low ? ' is-low' : ''}" title="${esc(tip)}"><i style="width:${(f * 100).toFixed(1)}%"></i></span>`
    + `<span class="lpm-bar__num">${esc(text)}</span>`;
}

export class MiniGameApp extends GameWindow {
  static KIND   = 'game';
  static TITLE  = 'Mini-game';
  static CANVAS = { w: 520, h: 420 };

  static DEFAULT_OPTIONS = { classes: ['lpm-arcana'] };

  constructor(opts = {}) {
    const spectator = !!opts.spectator;
    const sessionId = opts.sessionId ?? foundry.utils.randomID();
    const what = opts.label ? ` — ${opts.label}` : '';
    super({
      id      : `lpm-${new.target.KIND}-${sessionId}${spectator ? '-watch' : ''}`,
      window  : { title: spectator ? `${opts.playerName ?? 'Player'} — ${new.target.TITLE}${what}` : `${new.target.TITLE}${what}` },
      position: { width: new.target.CANVAS.w },
    });
    this.sessionId  = sessionId;
    this._spectator = spectator;
    this.label      = opts.label ?? '';
    this.playerName = opts.playerName ?? '';
    this.playerUserId = opts.playerUserId ?? null;   // spectators: whose game this is
    this.dc         = opts.dc ?? 15;
    this.rollResult = opts.rollResult ?? { total: 10, d20: 10, dc: this.dc, margin: 10 - this.dc };
    this.hideDC     = !!opts.hideDC;
    this.init       = opts.init ?? { seed: Math.floor(Math.random() * 2 ** 31), dc: this.dc,
                                     roll: { margin: this.rollResult.margin, d20: this.rollResult.d20 } };
    this.onSuccess  = opts.onSuccess ?? (() => {});
    this.onFailure  = opts.onFailure ?? (() => {});
    this.onClose    = opts.onClose ?? (() => {});
    this._broadcast = !!opts.broadcast && !spectator;
    this._timers    = [];
    this._raf       = null;
    this._over      = false;        // no more input; ending plays
    this._dead      = false;        // loop stopped
    this._ending    = null;         // { success, t }
    this._syncAcc   = 0;
    this._t         = 0;
    this._dpr       = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    this._boundTick = this._tick.bind(this);
    this.endDelay   = 1.1;
    this._built     = false;
  }

  /** Build the game once (not in the constructor: subclass fields are not set up yet there). */
  ensureGame() {
    if (!this._built) { this._built = true; this.buildGame(this.init); }
    return this;
  }

  // ── subclass hooks (defaults) ─────────────────────────────────────────
  buildGame() {}
  update() { return null; }
  draw() {}
  bindInput() {}
  meterHTML() { return ''; }
  hintHTML() { return ''; }
  controlsHTML() { return ''; }
  syncState() { return {}; }
  applySync() {}
  endScreen(success) { return { title: success ? 'Success' : 'Failure', sub: '', icon: null }; }
  renderEnding() {}

  // ── window ────────────────────────────────────────────────────────────

  contentHTML() {
    this.ensureGame();
    const { w, h } = this.constructor.CANVAS;
    const banner = this._spectator
      ? `<div class="lpm-spectator-banner"><i class="fa-solid fa-eye"></i> Spectating — ${esc(this.playerName)}</div>` : '';
    return `<div class="lpm-root lpm-arcana-root">
      ${banner}
      <canvas class="lpm-canvas lpm-arcana-canvas" width="${w}" height="${h}"
              style="width:${w}px;height:${h}px;${this._spectator ? 'pointer-events:none;' : ''}"></canvas>
      ${this.controlsHTML()}
      <div class="lpm-footer">
        <div class="lpm-footer-top">
          <div class="lpm-roll-result"></div>
          <div class="lpm-attempts lpm-meter"></div>
        </div>
        <div class="lpm-footer-bottom">
          <div class="lpm-hint">${this.hintHTML()}</div>
          <button type="button" class="lpm-leave-btn">Leave</button>
        </div>
      </div>
    </div>`;
  }

  onReady(root) {
    const { w, h } = this.constructor.CANVAS;
    this.W = w; this.H = h;
    this.canvas = root.querySelector('.lpm-arcana-canvas');
    this.canvas.width = Math.round(w * this._dpr);
    this.canvas.height = Math.round(h * this._dpr);
    this.ctx = this.canvas.getContext('2d');
    this._meterEl = root.querySelector('.lpm-meter');
    rollBadge(root.querySelector('.lpm-roll-result'), this.rollResult, { hidden: dcHiddenHere(this.hideDC) });
    this.refreshMeter();

    if (this._spectator) {
      this._syncHandler = d => {
        if (d?.action !== 'gameSync' || d.sessionId !== this.sessionId) return;
        if (d.left) { this.close(); return; }                 // the player walked away
        this.applySync(d.state);
        this.refreshMeter();
        if (d.ended !== undefined && d.ended !== null && !this._over) this._end(!!d.ended);
      };
      game.socket.on(CHANNEL, this._syncHandler);
      // …or their client went away (reload, crash) and will never say so.
      this._userHook = Hooks.on('userConnected', (user, active) => {
        if (!active && user?.id === this.playerUserId) this.close();
      });
    } else {
      this.bindInput(this.canvas, root);
    }
    root.querySelector('.lpm-leave-btn').addEventListener('click', () => this.close());

    this._last = performance.now();
    this._raf = requestAnimationFrame(this._boundTick);
  }

  refreshMeter() {
    if (this._meterEl) this._meterEl.innerHTML = this.meterHTML();
  }

  /** setTimeout that is cancelled when the window closes. */
  later(fn, ms) {
    const id = setTimeout(() => { this._timers = this._timers.filter(t => t !== id); if (!this._dead) fn(); }, ms);
    this._timers.push(id);
    return id;
  }

  _tick(now) {
    if (this._dead) return;
    // rAF timestamps can be a little earlier than performance.now() taken at start → never negative
    const dt = Math.max(0, Math.min(0.05, (now - this._last) / 1000 || 0.016));
    this._last = now;
    this._t += dt;
    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    if (this._ending) {
      this._ending.t += dt;
      this.draw(ctx, dt);
      this.renderEnding(ctx, this._ending.t, this._ending.success);
      if (this._ending.t >= this.endDelay) { this.finishEnding(); return; }
    } else {
      if (!this._spectator) {
        const out = this.update(dt);
        if (out === 'won' || out === 'lost') this._end(out === 'won');
      } else {
        this.update(dt);                    // spectators animate locally between syncs
      }
      this.draw(ctx, dt);
      if (this._broadcast) {
        this._syncAcc += dt;
        if (this._syncAcc >= 0.08) { this._syncAcc = 0; this._emitSync(); }
      }
    }
    this._raf = requestAnimationFrame(this._boundTick);
  }

  _emitSync(ended = undefined) {
    if (!this._broadcast) return;
    game.socket.emit(CHANNEL, { action: 'gameSync', sessionId: this.sessionId, state: this.syncState(), ended });
  }

  /** Resolve the game once: ending animation → result screen → close. */
  _end(success) {
    if (this._over) return;
    this._over = true;
    this._pendingOutcome = success;
    this.refreshMeter();
    this._emitSync(success);
    this._ending = { success, t: 0 };
    // Safety net: frames stop while the tab is hidden; the outcome must still land.
    const id = setTimeout(() => { this._timers = this._timers.filter(t => t !== id); this.finishEnding(); },
      (this.endDelay + 4) * 1000);
    this._timers.push(id);
  }

  /** Result screen, then close a moment later. Runs once. */
  finishEnding() {
    if (this._finished || !this._ending) return;
    this._finished = true;
    this._dead = true;
    cancelAnimationFrame(this._raf);
    if (this.ctx) {
      const e = this.endScreen(this._ending.success);
      drawResultOverlay(this.ctx, { W: this.W, H: this.H, dpr: this._dpr, success: this._ending.success, ...e });
    }
    const id = setTimeout(() => { this._timers = this._timers.filter(t => t !== id); this.close(); }, 1800);
    this._timers.push(id);
  }

  async _fireOutcome() {
    if (this._pendingOutcome === undefined || this._outcomeFired || this._spectator) return;
    this._outcomeFired = true;
    try { this._pendingOutcome ? await this.onSuccess() : await this.onFailure(); } catch (e) { console.error(e); }
  }

  /** Stop sounds etc. — subclasses extend. */
  teardown() {}

  async close(opts = {}) {
    // Closed before the end: spectator windows close too instead of idling forever.
    if (this._broadcast && this._pendingOutcome === undefined && !this._dead) {
      game.socket.emit(CHANNEL, { action: 'gameSync', sessionId: this.sessionId, left: true });
    }
    this._dead = true;
    cancelAnimationFrame(this._raf);
    for (const t of this._timers) clearTimeout(t);
    this._timers.length = 0;
    if (this._syncHandler) { game.socket.off(CHANNEL, this._syncHandler); this._syncHandler = null; }
    if (this._userHook !== undefined) { Hooks.off('userConnected', this._userHook); this._userHook = undefined; }
    try { this.teardown(); } catch (e) { console.error(e); }
    await this._fireOutcome();
    try { this.onClose(); } catch (e) { console.error(e); }
    return super.close(opts);
  }
}
