/**
 * resonance-logic.mjs — rules of "Attune the Resonance" (no DOM, no Foundry).
 *
 * The working's resonance is a wisp of light wandering a scrying pool. The
 * caster holds a focus over it: a ring that follows the pointer (gently, so
 * it glides rather than jumps). While the wisp is inside the ring the
 * attunement grows and the runes around the pool wake one by one; outside
 * it, the attunement slowly fades. Wake every rune before concentration
 * (time) runs out.
 *
 * Positions are in pool radii: (0, 0) is the centre, 1 the edge. The wisp's
 * path is a fixed sum of sines from a seed, so a spectator given {seed, t}
 * sees exactly the wisp the player sees.
 */

import { rng } from './ward-logic.mjs';

const TAU = Math.PI * 2;
export const RUNE_COUNT = 9;
export const WISP_EDGE = 0.8;          // the wisp keeps this far from the centre at most
export const FOCUS_EDGE = 0.92;        // and the focus this far

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * DC: how long the attunement takes and how restless the wisp is; the Arcana
 * roll: how wide the focus is and how long the caster can concentrate.
 */
export function resonanceParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  return {
    hold : dc <= 12 ? 6 : dc <= 17 ? 8 : 10,                 // seconds inside the focus to attune
    speed: dc <= 12 ? 0.6 : dc <= 17 ? 0.8 : 0.95,           // how fast the wisp wanders
    swerve: dc <= 12 ? 0.08 : dc <= 17 ? 0.12 : 0.16,        // how far its quick swerves reach
    // The focus is never narrower than the wisp's quickest quarter-second dash
    // (0.235 at DC 18+), so a hand that keeps up never loses it.
    focus: nat20 ? 0.38 : nat1 ? 0.24 : clamp(0.28 + margin * 0.012, 0.24, 0.36),  // focus radius
    time : nat20 ? 75 : nat1 ? 30 : clamp(40 + margin * 2, 30, 65),
    fade : 0.4,                                              // fades at 40 % of the speed it grows
  };
}

/** Where the wisp is at time t (seconds). */
export function wispAt(res, t) {
  const { k, params } = res;
  const s = t * params.speed;
  let x = 0.52 * Math.sin(s * 0.37 + k[0]) + 0.28 * Math.sin(s * 0.83 + k[1]) + params.swerve * Math.sin(s * 1.6 + k[2]);
  let y = 0.52 * Math.sin(s * 0.31 + k[3]) + 0.28 * Math.sin(s * 0.97 + k[4]) + params.swerve * Math.sin(s * 1.75 + k[5]);
  // A soft wall: the further out, the harder it is pushed back in.
  const r = Math.hypot(x, y);
  if (r > 1e-6) { const f = WISP_EDGE * Math.tanh(r / WISP_EDGE) / r; x *= f; y *= f; }
  return { x, y };
}

export function generateResonance({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const params = resonanceParams(dc, roll);
  const k = Array.from({ length: 6 }, () => R() * TAU);
  return { seed, dc, params, k, tone: 196 * Math.pow(2, Math.floor(R() * 5) / 12) };   // the hum's note
}

/** Live game state: the focus, the attunement and the clock. */
export class ResonanceGame {
  constructor(res) {
    this.res = res;
    this.t = 0;
    this.focus = { x: 0, y: 0.45 };          // starts below the centre, away from where the wisp begins
    this.aim = { ...this.focus };            // where the pointer wants it
    this.attune = 0;
    this.timeLeft = res.params.time;
    this.state = 'playing';
    this.inside = false;
  }

  wisp() { return wispAt(this.res, this.t); }

  /** Point the focus somewhere (pool radii); it glides there. */
  aimAt(x, y) {
    const r = Math.hypot(x, y), f = r > FOCUS_EDGE ? FOCUS_EDGE / r : 1;
    this.aim = { x: x * f, y: y * f };
  }

  /** Is the wisp inside the focus ring? */
  check() {
    const w = this.wisp();
    this.inside = Math.hypot(w.x - this.focus.x, w.y - this.focus.y) <= this.res.params.focus;
    return this.inside;
  }

  /** Advance by dt seconds. Returns 'won' | 'lost' | null. */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.t += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const ease = 1 - Math.exp(-dt * 10);
    this.focus.x += (this.aim.x - this.focus.x) * ease;
    this.focus.y += (this.aim.y - this.focus.y) * ease;
    const { hold, fade } = this.res.params;
    if (this.check()) this.attune = Math.min(1, this.attune + dt / hold);
    else this.attune = Math.max(0, this.attune - dt * fade / hold);
    if (this.attune >= 1) { this.state = 'won'; return 'won'; }
    if (this.timeLeft <= 0) { this.state = 'lost'; return 'lost'; }
    return null;
  }

  /** Spectators: the wisp moves on between syncs. */
  advance(dt) { this.t += dt; this.check(); }

  /** How many runes are awake. */
  runes() { return Math.floor(this.attune * RUNE_COUNT + 1e-6); }

  snapshot() {
    return { t: this.t, focus: { ...this.focus }, attune: this.attune, timeLeft: this.timeLeft, state: this.state };
  }

  apply(s) {
    if (!s) return;
    this.t = s.t; this.focus = { ...s.focus }; this.aim = { ...s.focus };
    this.attune = s.attune; this.timeLeft = s.timeLeft; this.state = s.state;
    this.check();
  }
}
