/**
 * echo-logic.mjs — rules of "Sound the Weave" (no DOM, no Foundry).
 *
 * A working's weave lies hidden in the dark: threads of light that run out
 * from one to three knots to the edge of the field. The caster calls into the
 * dark: wherever they click, their voice spreads in a ring, and every thread
 * it reaches glints and stays faintly seen. Threads thicken towards their knot,
 * so each glimpse shows which way to follow, and a knot shows itself when a
 * call comes close to it. A call that lands on a knot undoes it. Every call costs one
 * of a few; undo every knot before they run out. From DC 13 an undone knot
 * ties itself again after a while, unless the last one falls first.
 *
 * Positions are in field radii: (0, 0) is the centre, 1 the edge. The weave
 * comes from a seed, so a spectator given the seed and the calls sees the same.
 */

import { rng } from './ward-logic.mjs';

const TAU = Math.PI * 2;
export const SAMPLES = 36;          // segments along a thread, from its knot (0) to the edge
export const RING_TIME = 0.7;       // seconds a call takes to reach as far as it goes
export const GLINT = 1.6;           // seconds a thread glints before it settles into a faint trace
export const EDGE = 0.97;           // threads end this far out
export const KNOT_SHOWS = 0.55;     // a knot shows itself only this close to a call (as a share of its reach)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * DC: how many knots, how many threads lead to each (fewer is harder), how far
 * the threads bend, how close a call must land and how soon an undone knot ties
 * again. The Arcana roll: how many calls, how far the voice carries and how long
 * the knots stay undone.
 */
export function weaveParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  const tier = dc <= 12 ? 0 : dc <= 17 ? 1 : 2;
  const knots = tier + 1, retie = [0, 12, 8][tier];
  return {
    knots,
    threads: [6, 5, 4][tier],
    bend   : [0, 0.12, 0.24][tier],          // how far a thread curves, as a share of its length
    hit    : [0.1, 0.085, 0.07][tier],       // a call this close to a knot undoes it
    calls  : 2 * knots + 2 + (nat20 ? 3 : nat1 ? -2 : clamp(Math.floor(margin / 3), -2, 3)),
    reach  : nat20 ? 0.5 : nat1 ? 0.26 : clamp(0.36 + margin * 0.012, 0.28, 0.48),   // how far a call carries
    retie  : !retie ? 0 : +(retie * (nat20 ? 1.5 : nat1 ? 0.75 : clamp(1 + margin * 0.04, 0.8, 1.4))).toFixed(1),
  };
}

/** A point on the quadratic curve from a through c to b. */
const bez = (a, c, b, t) => {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

export function generateWeave({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const params = weaveParams(dc, roll);
  const knots = [];
  for (let k = 0; k < params.knots; k++) {
    // Somewhere inside, and well apart from the other knots.
    let pos;
    for (let tries = 0; tries < 200; tries++) {
      const a = R() * TAU, r = 0.12 + 0.56 * Math.sqrt(R());
      pos = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      if (knots.every(o => Math.hypot(o.x - pos.x, o.y - pos.y) > 0.6)) break;
    }
    // Its threads, spread round it, each to the edge of the field.
    const threads = [], base = R() * TAU, n = params.threads;
    for (let i = 0; i < n; i++) {
      const a = base + (i + (R() - 0.5) * 0.5) * TAU / n, ux = Math.cos(a), uy = Math.sin(a);
      const b = pos.x * ux + pos.y * uy, len = -b + Math.sqrt(b * b - (pos.x ** 2 + pos.y ** 2 - EDGE ** 2));
      const end = { x: pos.x + ux * len, y: pos.y + uy * len };
      const bend = params.bend * len * (R() < 0.5 ? -1 : 1) * (0.6 + 0.4 * R());
      const mid = { x: (pos.x + end.x) / 2 - uy * bend, y: (pos.y + end.y) / 2 + ux * bend };
      const pts = [];
      for (let s = 0; s <= SAMPLES; s++) {
        const p = bez(pos, mid, end, s / SAMPLES), r = Math.hypot(p.x, p.y);
        pts.push(r > EDGE ? { x: p.x * EDGE / r, y: p.y * EDGE / r } : p);
      }
      threads.push(pts);
    }
    knots.push({ x: pos.x, y: pos.y, threads });
  }
  return { seed, dc, params, knots };
}

/** Live game state: the calls so far, what they have shown, the knots undone and the calls left. */
export class WeaveGame {
  constructor(weave) {
    this.weave = weave;
    this.t = 0;
    this.calls = [];                                        // { x, y, t }
    this.left = weave.params.calls;
    this.undone = weave.knots.map(() => null);              // when each knot came undone, or null
    // When each thread segment and each knot was first reached by a call (Infinity: not yet),
    // and by which call.
    this.seen = weave.knots.map(k => k.threads.map(th => new Array(th.length - 1).fill(Infinity)));
    this.seenBy = weave.knots.map(k => k.threads.map(th => new Array(th.length - 1).fill(-1)));
    this.knotSeen = weave.knots.map(() => Infinity);
    this.state = 'playing';
    this.lastRetie = -1;                                    // the knot that tied itself again last
  }

  /** What call n shows: everything within reach of it, reached as its ring spreads. */
  reveal(c, n) {
    const reach = this.weave.params.reach;
    const at = d => c.t + RING_TIME * d / reach;
    this.weave.knots.forEach((k, ki) => {
      const dk = Math.hypot(k.x - c.x, k.y - c.y);
      if (dk <= reach * KNOT_SHOWS) this.knotSeen[ki] = Math.min(this.knotSeen[ki], at(dk));
      k.threads.forEach((th, ti) => {
        const seen = this.seen[ki][ti], by = this.seenBy[ki][ti];
        for (let i = 0; i < th.length - 1; i++) {
          const mx = (th[i].x + th[i + 1].x) / 2, my = (th[i].y + th[i + 1].y) / 2, d = Math.hypot(mx - c.x, my - c.y);
          if (d <= reach && at(d) < seen[i]) { seen[i] = at(d); by[i] = n; }
        }
      });
    });
  }

  /** The not-undone knot a call at (x, y) lands on, or -1. */
  knotAt(x, y) {
    let best = -1, bd = this.weave.params.hit;
    this.weave.knots.forEach((k, i) => {
      const d = Math.hypot(k.x - x, k.y - y);
      if (this.undone[i] === null && d <= bd) { best = i; bd = d; }
    });
    return best;
  }

  /** Call at (x, y). Returns { ok, undid: knot | -1, won, lost }. */
  call(x, y) {
    if (this.state !== 'playing' || this.left <= 0) return { ok: false };
    const r = Math.hypot(x, y);
    if (r > 1) { x /= r; y /= r; }
    const c = { x, y, t: this.t };
    this.calls.push(c);
    this.left--;
    this.reveal(c, this.calls.length - 1);
    const undid = this.knotAt(x, y);
    if (undid >= 0) this.undone[undid] = this.t;
    if (this.undone.every(u => u !== null)) this.state = 'won';
    else if (this.left <= 0) this.state = 'lost';
    return { ok: true, undid, won: this.state === 'won', lost: this.state === 'lost' };
  }

  /** 0…1: how far undone knot k has come to tying itself again (0 when it is tied or never ties). */
  retieShare(k) {
    const t0 = this.undone[k], every = this.weave.params.retie;
    return t0 === null || !every ? 0 : Math.min(1, (this.t - t0) / every);
  }

  /** Advance by dt seconds. Returns 'retie' when a knot has tied itself again (see lastRetie), else null. */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.t += dt;
    let out = null;
    this.undone.forEach((t0, k) => {
      if (t0 !== null && this.retieShare(k) >= 1) { this.undone[k] = null; this.lastRetie = k; out = 'retie'; }
    });
    return out;
  }

  /** Spectators: the clock runs on between syncs (the player's game decides what ties again). */
  advance(dt) { if (this.state === 'playing') this.t += dt; }

  undoneCount() { return this.undone.filter(u => u !== null).length; }

  snapshot() {
    return { t: this.t, calls: this.calls.map(c => ({ ...c })), undone: this.undone.slice(), left: this.left, state: this.state };
  }

  apply(s) {
    if (!s) return;
    for (const c of s.calls.slice(this.calls.length)) { this.calls.push({ ...c }); this.reveal(c, this.calls.length - 1); }
    this.t = s.t;
    this.undone = s.undone.slice();
    this.left = s.left;
    this.state = s.state;
  }
}
