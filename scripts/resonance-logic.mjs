/**
 * resonance-logic.mjs — rules of "Attune the Resonance" (no DOM, no Foundry).
 *
 * A warded object hums with a resonance: a sine wave that breathes gently
 * around a fixed note. The caster shapes their own wave with three dials —
 * frequency, amplitude, phase — and is in tune when every dial is within its
 * tolerance of the hum. Held in tune, the attunement meter fills; out of tune
 * it drains at half the speed. Concentration (time) runs out otherwise.
 *
 * Each dial is judged on its own, so the game can tell the player which dial
 * is off. The phase is measured at the middle of the scope, so turning the
 * frequency dial stretches the wave around the centre instead of swinging the
 * far end; and the hum's phase never wraps past 0°/360°, so the phase slider
 * never has to jump from one end to the other.
 *
 * The hum's motion is a fixed sum of sines from a seed, so a spectator given
 * {seed, t} sees exactly the wave the player sees.
 */

import { rng } from './ward-logic.mjs';

const TAU = Math.PI * 2;
export const DIALS = ['freq', 'amp', 'phase'];
export const RANGES = {
  freq : [0.8, 4.2],          // cycles across the scope
  amp  : [0.15, 1.0],
  phase: [0, TAU],
};

/** DC: how exact and how long to hold; the Arcana roll: time, how much the hum moves, hints. */
export function resonanceParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  return {
    tol  : dc <= 12 ? { freq: 0.12, amp: 0.10, phase: 0.42 }
         : dc <= 17 ? { freq: 0.09, amp: 0.08, phase: 0.33 }
         :            { freq: 0.065, amp: 0.06, phase: 0.26 },
    hold : dc <= 12 ? 3.0 : dc <= 17 ? 4.0 : 5.0,                      // seconds in tune
    time : nat20 ? 80 : nat1 ? 30 : Math.max(30, Math.min(70, 45 + margin * 2)),
    drift: nat20 ? 0.4 : nat1 ? 1.6 : margin >= 5 ? 0.6 : margin >= 0 ? 0.85 : margin >= -4 ? 1.1 : 1.35,
    ghost: nat20 ? 'all' : margin >= 5 ? 'freq' : 'none',                // dial marks of the true values
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The hum's wave at time t (seconds): slow breathing around its base note. */
export function targetAt(res, t) {
  const { base, k, params } = res;
  const d = params.drift;
  return {
    freq : clamp(base.freq + 0.10 * d * (Math.sin(t * 0.13 + k[0]) + 0.5 * Math.sin(t * 0.29 + k[1])), RANGES.freq[0] + 0.1, RANGES.freq[1] - 0.1),
    amp  : clamp(base.amp + 0.07 * d * Math.sin(t * 0.23 + k[2]), 0.25, 0.95),
    phase: clamp(base.phase + 0.5 * d * Math.sin(t * 0.17 + k[3]), 0.15, TAU - 0.15),
  };
}

/** Height of wave `w` at x in 0..1; the phase is anchored at the middle of the scope. */
export const waveAt = (w, x) => w.amp * Math.sin(TAU * w.freq * (x - 0.5) + w.phase);

/**
 * How each dial compares with the hum: err in units of its tolerance
 * (≤ 1 is in tune), and `inTune` when all three are.
 */
export function assess(player, target, tol) {
  const out = { inTune: true, worst: 0 };
  for (const key of DIALS) {
    const err = Math.abs(player[key] - target[key]) / tol[key];
    out[key] = { err, ok: err <= 1, near: err <= 2.5 };
    out.inTune &&= err <= 1;
    out.worst = Math.max(out.worst, err);
  }
  return out;
}

export function generateResonance({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const params = resonanceParams(dc, roll);
  const lerp = ([lo, hi], f) => lo + (hi - lo) * f;
  // The phase stays clear of 0°/360° even at the widest breathing (0.5 × 1.6 rad).
  const base = { freq: lerp([1.3, 3.4], R()), amp: lerp([0.45, 0.8], R()), phase: lerp([1.0, TAU - 1.0], R()) };
  const k = [R() * TAU, R() * TAU, R() * TAU, R() * TAU];
  const res = { seed, dc, params, base, k };
  // Start with every dial clearly off.
  const t0 = targetAt(res, 0);
  const away = (key, lo, hi, min) => {
    let v;
    for (let i = 0; i < 20; i++) { v = lerp([lo, hi], R()); if (Math.abs(v - t0[key]) >= min) break; }
    return v;
  };
  res.start = {
    freq : away('freq', RANGES.freq[0], RANGES.freq[1], 0.7),
    amp  : away('amp', 0.2, 0.95, 0.25),
    phase: away('phase', 0.2, TAU - 0.2, 1.2),
  };
  return res;
}

/** Live game state: the player's dials, the meter and the clock. */
export class ResonanceGame {
  constructor(res) {
    this.res = res;
    this.player = { ...res.start };
    this.t = 0;
    this.meter = 0;
    this.timeLeft = res.params.time;
    this.state = 'playing';
    this.peak = 0;
    this.match = assess(this.player, this.target(), res.params.tol);
  }

  /** Set one dial (clamped to its range). */
  setDial(name, value) {
    const [lo, hi] = RANGES[name];
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    this.player[name] = clamp(v, lo, hi);
    this.match = assess(this.player, this.target(), this.res.params.tol);
  }

  target() { return targetAt(this.res, this.t); }

  /** Advance by dt seconds. Returns 'won' | 'lost' | null. */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.t += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.match = assess(this.player, this.target(), this.res.params.tol);
    const { hold } = this.res.params;
    if (this.match.inTune) this.meter = Math.min(1, this.meter + dt / hold);
    else this.meter = Math.max(0, this.meter - dt / (hold * 2));      // slips at half the speed it builds
    this.peak = Math.max(this.peak, this.meter);
    if (this.meter >= 1) { this.state = 'won'; return 'won'; }
    if (this.timeLeft <= 0) { this.state = 'lost'; return 'lost'; }
    return null;
  }

  /** Spectators: the hum moves on between syncs. */
  advance(dt) {
    this.t += dt;
    this.match = assess(this.player, this.target(), this.res.params.tol);
  }

  snapshot() {
    return { player: { ...this.player }, t: this.t, meter: this.meter, timeLeft: this.timeLeft, state: this.state };
  }

  apply(s) {
    if (!s) return;
    Object.assign(this.player, s.player);
    this.t = s.t; this.meter = s.meter; this.timeLeft = s.timeLeft; this.state = s.state;
    this.match = assess(this.player, this.target(), this.res.params.tol);
  }
}
