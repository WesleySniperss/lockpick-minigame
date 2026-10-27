/**
 * resonance-logic.mjs — rules of "Attune the Resonance" (no DOM, no Foundry).
 *
 * A warded object hums with a resonance: a sine wave that slowly drifts. The
 * caster shapes their own wave with three dials — frequency, amplitude, phase
 * — and must hold it over the target until the attunement meter fills, before
 * their concentration (time) runs out. The match is the RMS difference of the
 * two waves over the scope, normalised by the target's own strength.
 *
 * The target's drift is a fixed sum of sines from a seed, so a spectator given
 * {seed, t} sees exactly the wave the player sees.
 */

import { rng } from './ward-logic.mjs';

export const RANGES = {
  freq : [0.8, 4.5],          // cycles across the scope
  amp  : [0.12, 1.0],
  phase: [0, Math.PI * 2],
};
const SAMPLES = 48;
const TAU = Math.PI * 2;

/** DC: how exact and how long; the Arcana roll: time, drift, hints. */
export function resonanceParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  return {
    threshold: dc <= 12 ? 0.80 : dc <= 17 ? 0.86 : 0.90,
    hold     : dc <= 12 ? 3.0 : dc <= 17 ? 4.0 : 5.0,                     // seconds above the threshold
    time     : nat20 ? 80 : nat1 ? 25 : Math.max(25, Math.min(70, 45 + margin * 2)),
    drift    : nat20 ? 0.5 : nat1 ? 2.4 : margin >= 5 ? 0.8 : margin >= 0 ? 1.15 : margin >= -4 ? 1.55 : 1.95,
    ghost    : nat20 ? 'all' : margin >= 5 ? 'freq' : 'none',               // dial marks of the true values
  };
}

/** Target wave parameters at time t (seconds). */
export function targetAt(res, t) {
  const { base, k, params } = res;
  const d = params.drift;
  const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
  return {
    freq : clamp(base.freq + 0.35 * d * (Math.sin(t * 0.21 + k[0]) + 0.6 * Math.sin(t * 0.53 + k[1])), [RANGES.freq[0] + 0.2, RANGES.freq[1] - 0.2]),
    amp  : clamp(base.amp + 0.12 * d * Math.sin(t * 0.33 + k[2]), [0.25, 0.95]),
    phase: base.phase + 0.55 * d * Math.sin(t * 0.17 + k[3]) + 0.08 * d * t,
  };
}

export const waveAt = (w, x) => w.amp * Math.sin(TAU * w.freq * x + w.phase);

/** 0..1 — how closely wave `p` matches wave `q` across the scope. */
export function matchQuality(p, q) {
  let diff = 0, ref = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1);
    const a = waveAt(q, x), b = waveAt(p, x);
    diff += (a - b) ** 2;
    ref += a * a;
  }
  const norm = Math.max(0.3, Math.sqrt(ref / SAMPLES));
  return Math.max(0, Math.min(1, 1 - Math.sqrt(diff / SAMPLES) / (norm * 1.6)));
}

export function generateResonance({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const params = resonanceParams(dc, roll);
  const lerp = ([lo, hi], f) => lo + (hi - lo) * f;
  const base = { freq: lerp([1.3, 3.6], R()), amp: lerp([0.4, 0.85], R()), phase: R() * TAU };
  const k = [R() * TAU, R() * TAU, R() * TAU, R() * TAU];
  const res = { seed, dc, params, base, k };
  // Start the player's wave clearly off target.
  let start;
  for (let i = 0; i < 30; i++) {
    start = { freq: lerp(RANGES.freq, R()), amp: lerp([0.2, 0.9], R()), phase: R() * TAU };
    if (matchQuality(start, targetAt(res, 0)) < 0.35) break;
  }
  res.start = start;
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
    this.quality = 0;
    this.state = 'playing';
    this.peak = 0;
  }

  /** Set one dial; phase wraps, the others clamp. */
  setDial(name, value) {
    const [lo, hi] = RANGES[name];
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    this.player[name] = name === 'phase' ? ((v % hi) + hi) % hi : Math.max(lo, Math.min(hi, v));
  }

  target() { return targetAt(this.res, this.t); }

  /** Advance by dt seconds. Returns 'won' | 'lost' | null. */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.t += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.quality = matchQuality(this.player, this.target());
    const { threshold, hold } = this.res.params;
    if (this.quality >= threshold) this.meter = Math.min(1, this.meter + dt / hold);
    else this.meter = Math.max(0, this.meter - dt / hold);       // slips as fast as it builds
    this.peak = Math.max(this.peak, this.meter);
    if (this.meter >= 1) { this.state = 'won'; return 'won'; }
    if (this.timeLeft <= 0) { this.state = 'lost'; return 'lost'; }
    return null;
  }

  snapshot() {
    return { player: { ...this.player }, t: this.t, meter: this.meter, timeLeft: this.timeLeft, state: this.state };
  }

  apply(s) {
    if (!s) return;
    Object.assign(this.player, s.player);
    this.t = s.t; this.meter = s.meter; this.timeLeft = s.timeLeft; this.state = s.state;
    this.quality = matchQuality(this.player, this.target());
  }
}
