/**
 * echo-logic.mjs — rules of "Echo the Hum" (no DOM, no Foundry).
 *
 * A working hums: a ribbon of light that sways, swells and now and then changes
 * its note. The caster sings it back with a ribbon of their own, shaped by
 * hand: the crest under the pointer follows it (where it lies, how high it
 * rises), and the number of crests is a note picked from a few. Where the two
 * ribbons lie together they turn gold; keep enough of the ribbon gold and the
 * runes wake one by one, let it slip and they fade. Wake every rune before
 * concentration (time) runs out.
 *
 * A ribbon is amp·sin(2π·crests·(x − ½) + phase) across the stave, x from 0 to
 * 1, so a crest held at the middle stays put when the crests change. The hum's
 * whole course comes from a seed, so a spectator given {seed, t} hears the
 * same hum as the player.
 */

import { rng } from './ward-logic.mjs';

const TAU = Math.PI * 2;
export const NOTES = [2, 3, 4, 5, 6];      // crests across the stave
export const RUNE_COUNT = 5;
export const AMP_MIN = 0.12;               // your ribbon never lies quite flat
export const ASPECT = 4.4;                 // the stave is this many half-heights long
export const SAMPLES = 48;                 // points along the stave the match is judged at
export const GLIDE = 0.7;                  // seconds the hum takes to slide to a new note
export const SHIFT_WARNING = 1.1;          // seconds it shimmers before it does

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = u => u * u * (3 - 2 * u);

/**
 * DC: how close counts as in tune, how much of the ribbon must be, how long it
 * takes, how fast the hum moves and how often it changes note. The Arcana roll:
 * how steady the hum is for this caster, how sharply their ribbon answers the
 * hand, how long they can concentrate and how often the note changes.
 */
export function echoParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  const tier = dc <= 12 ? 0 : dc <= 17 ? 1 : 2;
  return {
    tol   : [0.16, 0.12, 0.1][tier],                 // in tune within this, in heights of the stave's half
    need  : [0.78, 0.86, 0.9][tier],                 // share of the ribbon that must be in tune
    hold  : [7, 9, 11][tier],                         // seconds in tune to wake every rune
    fade  : [0.5, 0.75, 1][tier],                    // share of that speed it fades at
    flow  : [0.45, 0.7, 0.95][tier],                 // how fast the hum drifts along, radians a second
    leap  : tier === 2 ? 2 : 1,                      // how far a change of note may go
    shiftEvery: +([9, 6.5, 5][tier] * (nat20 ? 1.6 : nat1 ? 0.75 : clamp(1 + margin * 0.03, 0.8, 1.3))).toFixed(2),
    drift : nat20 ? 0.6 : nat1 ? 1.5 : clamp(1.1 - margin * 0.035, 0.75, 1.4),   // the hum's pace for this caster
    follow: nat20 ? 30 : nat1 ? 9 : clamp(16 + margin * 0.8, 10, 26),            // how fast your ribbon closes on the hand, per second
    time  : nat20 ? 75 : nat1 ? 30 : clamp(45 + margin * 2, 30, 65),
  };
}

/** The ribbon's height at x (0…1 across the stave). `crests` may be fractional while a note slides. */
export const waveAt = (w, x) => w.amp * Math.sin(TAU * w.crests * (x - 0.5) + w.phase);

export function generateEcho({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const params = echoParams(dc, roll);
  const k = Array.from({ length: 6 }, () => R() * TAU);
  // The hum's notes, one per change: a step or two up or down, never off the scale.
  let i = 1 + Math.floor(R() * 3);
  const notes = [NOTES[i]];
  for (let n = 0; n < 40; n++) {
    const step = (1 + Math.floor(R() * params.leap)) * (R() < 0.5 ? -1 : 1);
    i = i + step < 0 || i + step >= NOTES.length ? i - step : i + step;
    notes.push(NOTES[i]);
  }
  const echo = {
    seed, dc, params, k, notes,
    flowDir : R() < 0.5 ? -1 : 1,
    baseAmp : 0.5 + R() * 0.25,
    shiftOffset: params.shiftEvery * (0.45 + 0.3 * R()),
    tone    : 196 * Math.pow(2, Math.floor(R() * 4) / 12),
  };
  // Start the caster on another note, low and out of step.
  const others = NOTES.filter(n => n !== notes[0]);
  echo.start = { crests: others[Math.floor(R() * others.length)], amp: 0.3, phase: R() * TAU };
  return echo;
}

/** Which change of note the hum is on at time t (0 = none yet), and how far into it. */
export function shiftAt(echo, t) {
  const P = echo.params.shiftEvery, since = t - echo.shiftOffset;
  if (since < 0) return { n: 0, into: Infinity, next: -since };
  const n = Math.min(echo.notes.length - 1, Math.floor(since / P) + 1);
  const into = since - (n - 1) * P;
  return { n, into, next: P - into };
}

/** The hum at time t: { crests, amp, phase, note } (crests slides between notes). */
export function humAt(echo, t) {
  const { k, params } = echo, s = t * params.drift;
  const { n, into } = shiftAt(echo, t);
  const note = echo.notes[n], u = clamp(into / GLIDE, 0, 1);
  const crests = n && u < 1 ? echo.notes[n - 1] + (note - echo.notes[n - 1]) * smooth(u) : note;
  return {
    note, crests,
    amp  : clamp(echo.baseAmp + 0.2 * Math.sin(0.37 * s + k[3]) + 0.08 * Math.sin(1.1 * s + k[4]), 0.35, 0.95),
    phase: k[0] + echo.flowDir * params.flow * s + 0.9 * Math.sin(0.5 * s + k[1]) + 0.36 * Math.sin(1.3 * s + k[2]),
  };
}

/**
 * Which of the SAMPLES points along your ribbon lie in tune, and the share that
 * do. In tune: the hum passes within `tol` of the point as the eye sees it
 * (half-heights both ways), so a crest a little to one side still counts on
 * the steep flanks, not only where the two happen to cross.
 */
export function tuneOf(you, hum, tol) {
  const marks = new Array(SAMPLES), reach = tol / ASPECT;
  let good = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = 0.03 + 0.94 * i / (SAMPLES - 1), y = waveAt(you, x);
    let ok = false;
    for (let j = -3; j <= 3 && !ok; j++) {
      const o = reach * j / 3, dy = y - waveAt(hum, x + o);
      ok = (o * ASPECT) ** 2 + dy * dy <= tol * tol;
    }
    marks[i] = ok;
    if (ok) good++;
  }
  return { marks, share: good / SAMPLES };
}

/** The shortest signed turn from angle a to angle b. */
const turnTo = (a, b) => ((((b - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;

/** Live game state: your ribbon, where your hand wants it, the attunement and the clock. */
export class EchoGame {
  constructor(echo) {
    this.echo = echo;
    this.t = 0;
    this.you = { ...echo.start };          // your ribbon as it is
    this.aim = { ...echo.start };          // where the hand wants it
    this.anchor = 0.5;                     // where along the stave the hand last held it
    this.attune = 0;
    this.timeLeft = echo.params.time;
    this.state = 'playing';
    this.share = 0;
    this.marks = new Array(SAMPLES).fill(false);
  }

  hum() { return humAt(this.echo, this.t); }

  /**
   * The hand at (x, y): x along the stave (0…1), y up from the middle in
   * half-heights (−1…1). A crest of your ribbon (a trough below the middle)
   * comes to rest under it.
   */
  holdAt(x, y) {
    const amp = clamp(Math.abs(y), AMP_MIN, 1), up = y >= 0;
    this.anchor = clamp(x, -0.2, 1.2);
    this.aim.amp = amp;
    this.aim.phase = (up ? Math.PI / 2 : -Math.PI / 2) - TAU * this.aim.crests * (this.anchor - 0.5);
  }

  /** Pick a note (crests); the crest by the hand stays where it is. */
  setNote(crests) {
    if (!NOTES.includes(crests) || crests === this.aim.crests) return false;
    const shift = TAU * (this.aim.crests - crests) * (this.anchor - 0.5);
    this.aim.phase += shift;
    this.you.phase += shift;
    this.aim.crests = this.you.crests = crests;
    return true;
  }

  /** One note up or down the scale. */
  stepNote(d) {
    const i = NOTES.indexOf(this.aim.crests) + d;
    return i >= 0 && i < NOTES.length && this.setNote(NOTES[i]);
  }

  /** Your ribbon closes on the hand as sharply as the roll allows. */
  follow(dt) {
    const k = 1 - Math.exp(-dt * this.echo.params.follow);
    this.you.amp += (this.aim.amp - this.you.amp) * k;
    this.you.phase += turnTo(this.you.phase, this.aim.phase) * k;
  }

  check() {
    const { marks, share } = tuneOf(this.you, this.hum(), this.echo.params.tol);
    this.marks = marks;
    this.share = share;
    return share >= this.echo.params.need;
  }

  /** In tune right now? */
  get inTune() { return this.share >= this.echo.params.need; }

  /** 0…1 while the hum shimmers before it changes note; 1 while it slides. */
  shiftWarning() {
    const s = shiftAt(this.echo, this.t);
    if (s.n && s.into < GLIDE) return 1;
    return Math.max(0, 1 - s.next / SHIFT_WARNING);
  }

  /** Advance by dt seconds. Returns 'won' | 'lost' | null. */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.t += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.follow(dt);
    const { hold, fade } = this.echo.params;
    if (this.check()) this.attune = Math.min(1, this.attune + dt / hold);
    else this.attune = Math.max(0, this.attune - dt * fade / hold);
    if (this.attune >= 1) { this.state = 'won'; return 'won'; }
    if (this.timeLeft <= 0) { this.state = 'lost'; return 'lost'; }
    return null;
  }

  /** Spectators: the hum goes on between syncs, and the ribbon eases to where it was last seen. */
  advance(dt) {
    if (this.state !== 'playing') return;
    this.t += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const ease = 1 - Math.exp(-dt * 25);
    this.you.amp += (this.aim.amp - this.you.amp) * ease;
    this.you.phase += turnTo(this.you.phase, this.aim.phase) * ease;
    this.you.crests = this.aim.crests;
    const { hold, fade } = this.echo.params;
    if (this.check()) this.attune = Math.min(1, this.attune + dt / hold);
    else this.attune = Math.max(0, this.attune - dt * fade / hold);
  }

  /** How many runes are awake. */
  runes() { return Math.floor(this.attune * RUNE_COUNT + 1e-6); }

  /** For spectators: where the hand holds the ribbon (theirs eases there), the attunement and the clock. */
  snapshot() {
    return { t: this.t, aim: { ...this.aim }, attune: this.attune, timeLeft: this.timeLeft, state: this.state };
  }

  apply(s) {
    if (!s) return;
    this.t = s.t;
    this.aim = { ...s.aim };
    this.you.crests = s.aim.crests;
    this.attune = s.attune; this.timeLeft = s.timeLeft; this.state = s.state;
    this.check();
  }
}
