/**
 * ward-logic.mjs — rules of "Unweave the Ward" (no DOM, no Foundry).
 *
 * A ward is a stack of concentric rune rings around a core, with a crystal on
 * the rim. The core shoots a straight beam at the crystal. Every ring is a
 * solid wall with one gap in it, and the beam stops at the first ring whose
 * gap is not on its line. Line up all the gaps and the light reaches the
 * crystal: the ward comes apart.
 *
 * Rings turn one sector (of 8) at a time, freely. The ward fights back by
 * knitting itself together again: the caster has until the rim closes (a time
 * limit set by the roll). Some rings are bound by a golden link: turning one
 * turns another as well (one way, not chained). Nothing is hidden: every gap
 * and link is on the board from the start.
 *
 * A ring's rotation counts from its solved position: rot[i] = 0 means its gap
 * is on the beam. The start is scrambled with real moves, and one BFS from the
 * solved position over all ring positions (at most 8^5 = 32768) gives the exact
 * minimum number of turns from anywhere.
 */

export const SECTORS = 8;
export const mod = (n, m = SECTORS) => ((n % m) + m) % m;

/** Deterministic PRNG (mulberry32) — the player and spectators build the same ward from a seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle in place with the seeded PRNG. (sort(() => R() - 0.5)
 * is not an option: each JS engine sorts differently, so a spectator in
 * another browser would rebuild a different puzzle from the same seed.)
 */
export function shuffle(arr, R) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Difficulty. The DC shapes the ward (rings, links); the Arcana roll shapes how
 * well the caster reads it: the time before the ward re-forms (2 s per point
 * above or below the DC), and with insight (beat the DC by 5, or a natural 20)
 * a trace showing which way the next ring turns.
 */
export function wardParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  const rings = dc <= 12 ? 3 : dc <= 17 ? 4 : 5;
  const base = { 3: 40, 4: 50, 5: 60 }[rings];
  return {
    rings,
    bindings: dc <= 12 ? 0 : dc <= 17 ? 1 : dc <= 21 ? 2 : 3,
    time    : nat20 ? Math.round(base * 1.8) : nat1 ? Math.round(base * 0.6)
            : Math.max(Math.round(base * 0.6), Math.min(Math.round(base * 1.6), base + margin * 2)),
    insight : nat20 || margin >= 5,
  };
}

/** Apply one turn: ring k by d (±1); rings bound to k follow. Returns the new rotations and the bindings that fired. */
export function applyTurn(ward, rot, k, d) {
  const next = rot.slice();
  next[k] = mod(next[k] + d);
  const fired = [];
  ward.bindings.forEach((b, i) => {
    if (b.from !== k) return;
    next[b.to] = mod(next[b.to] + d * b.dir);
    fired.push(i);
  });
  return { rot: next, fired };
}

/**
 * How far the beam gets for given rotations. powered[i] — the light passes
 * through ring i; blockedAt — the first ring whose gap is off the line (-1 when
 * the light reaches the crystal); win — it does.
 */
export function flow(ward, rot) {
  const n = ward.rings.length;
  const powered = new Array(n).fill(false);
  let blockedAt = -1;
  for (let i = 0; i < n; i++) {
    if (mod(rot[i]) !== 0) { blockedAt = i; break; }
    powered[i] = true;
  }
  return { powered, blockedAt, win: blockedAt === -1 };
}

/** All ring rotations as one number: ring i's rotation is digit i in base 8. */
export const encodeRot = rot => rot.reduce((acc, v, i) => acc + mod(v) * SECTORS ** i, 0);

/**
 * Turns from every position to the solved one, indexed by encodeRot (-1 =
 * unreachable). A turn is undone by the opposite turn, so one BFS outward from
 * the solved position gives the exact distance for every start. With 8 sectors
 * a ring is 3 bits of the code, so the search is bit arithmetic.
 */
export function turnDistances(ward) {
  const n = ward.rings.length, size = 1 << (3 * n);
  // Every move as per-ring steps: ring k by d, plus the rings bound to k.
  const moves = [];
  for (let k = 0; k < n; k++) for (const d of [1, -1]) {
    const step = new Array(n).fill(0);
    step[k] += d;
    for (const b of ward.bindings) if (b.from === k) step[b.to] += d * b.dir;
    moves.push(step);
  }
  const dist = new Int8Array(size).fill(-1);
  const queue = new Int32Array(size);
  let tail = 0;
  dist[0] = 0; queue[tail++] = 0;
  for (let head = 0; head < tail; head++) {
    const c = queue[head], next = dist[c] + 1;
    for (const step of moves) {
      let nc = 0;
      for (let i = 0; i < n; i++) nc |= (((c >> (3 * i)) + step[i]) & 7) << (3 * i);
      if (dist[nc] === -1) { dist[nc] = next; queue[tail++] = nc; }
    }
  }
  return dist;
}

/** Exact minimum number of turns from `rot` to the solved position. */
export function minTurns(ward, rot) {
  const d = turnDistances(ward)[encodeRot(rot)];
  return d < 0 ? Infinity : d;
}

/**
 * Build a ward. Everything random comes from `seed`, so a spectator given the
 * same {dc, roll, seed} builds the identical ward.
 */
export function generateWard({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const p = wardParams(dc, roll);
  const n = p.rings;
  const randInt = m => Math.floor(R() * m);
  const beam = randInt(SECTORS);                     // the sector the crystal sits in
  const rings = Array.from({ length: n }, () => ({ rune: randInt(22) }));

  // Links join neighbouring rings where they can (short links read best), and
  // never form a loop: turning `from` turns `to` the same or the opposite way.
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) pairs.push([a, b]);
  shuffle(pairs, R);
  pairs.sort((x, y) => Math.abs(x[0] - x[1]) - Math.abs(y[0] - y[1]));
  const bindings = [];
  const reaches = (from, to) => from === to || bindings.some(b => b.from === from && reaches(b.to, to));
  for (const [from, to] of pairs) {
    if (bindings.length >= p.bindings) break;
    if (reaches(to, from) || bindings.some(b => b.from === from || b.to === to)) continue;
    bindings.push({ from, to, dir: R() < 0.5 ? 1 : -1 });
  }

  const ward = { beam, rings, bindings, params: p, seed, dc };

  // Scramble with real turns until no gap starts on the line and it takes at least n turns.
  const dist = turnDistances(ward);
  let rot, best = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    let r = new Array(n).fill(0);
    const moves = 3 * n + randInt(n + 2);
    for (let m = 0; m < moves; m++) r = applyTurn(ward, r, randInt(n), R() < 0.5 ? 1 : -1).rot;
    const need = dist[encodeRot(r)];
    if (r.every(v => v !== 0) && need >= n) { rot = r; best = need; break; }
    if (!flow(ward, r).win && need > best) { rot = r; best = need; }
  }
  if (!rot) {                                             // practically unreachable; still guarantee a puzzle
    rot = applyTurn(ward, applyTurn(ward, new Array(n).fill(0), 0, 1).rot, 0, 1).rot;
    best = dist[encodeRot(rot)];
  }
  ward.start = rot;
  ward.minTurns = best;
  return ward;
}

/**
 * The shortest way to bring ring `i`'s gap onto the beam, in sectors (signed,
 * + = clockwise). Ignores links — it is a hint.
 */
export function nextGate(rot, i) {
  return ((-rot[i] % SECTORS) + SECTORS + SECTORS / 2) % SECTORS - SECTORS / 2;
}

/**
 * The game state on top of a ward: the rings, the light's flow and the time
 * left before the ward re-forms. Returned events let the UI play sounds and
 * effects without re-deriving rules.
 */
export class WardGame {
  constructor(ward) {
    this.ward = ward;
    this.rot = ward.start.slice();
    this.timeLeft = ward.params.time;
    this.state = 'playing';                                  // playing | won | lost
    this.flow = flow(ward, this.rot);
    this.turns = 0;
  }

  /** Turn ring k by d (turning is free). Returns { ok, fired:[binding], newlyPowered:[ring], won }. */
  turn(k, d) {
    if (this.state !== 'playing' || k < 0 || k >= this.rot.length) return { ok: false };
    const before = this.flow.powered.slice();
    const { rot, fired } = applyTurn(this.ward, this.rot, k, d);
    this.rot = rot;
    this.turns++;
    this.flow = flow(this.ward, this.rot);
    const newlyPowered = this.flow.powered.map((p, i) => (p && !before[i] ? i : -1)).filter(i => i >= 0);
    if (this.flow.win) this.state = 'won';
    return { ok: true, fired, newlyPowered, won: this.state === 'won' };
  }

  /** The clock. Returns 'lost' once the ward has re-formed. */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft > 0) return null;
    this.state = 'lost';
    return 'lost';
  }

  /** Plain data for spectators. */
  snapshot() {
    return { rot: this.rot.slice(), timeLeft: this.timeLeft, state: this.state, turns: this.turns };
  }

  apply(s) {
    if (!s) return;
    this.rot = s.rot.slice();
    this.timeLeft = s.timeLeft;
    this.state = s.state;
    this.turns = s.turns;
    this.flow = flow(this.ward, this.rot);
  }
}
