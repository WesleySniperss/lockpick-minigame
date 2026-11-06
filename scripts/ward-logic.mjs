/**
 * ward-logic.mjs — rules of "Unweave the Ward" (no DOM, no Foundry).
 *
 * A ward is a stack of concentric rune rings around a core, with a crystal on
 * the rim. The core shoots a straight beam at the crystal. Every ring is a
 * solid wall with one gap in it, and the beam stops at the first ring whose
 * gap is not on its line. Line up all the gaps and the light reaches the
 * crystal: the ward comes apart.
 *
 * Rings turn one sector (of 8) at a time, freely. Some rings are linked:
 * turning one turns another as well, the same way or the other way. A link
 * fires once (the ring it turns does not pass the turn on), a ring may turn
 * two others, and from DC 18 two rings may turn each other. The ward fights
 * back: the caster has until the rim closes (a time limit set by the roll),
 * and from DC 13 it turns the outermost open ring back every few seconds,
 * links and all.
 *
 * A ring's rotation counts from its solved position: rot[i] = 0 means its gap
 * is on the beam. The start is scrambled with real moves, and one BFS from the
 * solved position over all ring positions (at most 8^5 = 32768) gives the exact
 * minimum number of turns from anywhere. The ward's own turns are real turns
 * too, so whatever it does can always be undone.
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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Difficulty. The DC shapes the ward: rings, links, how tangled they may get,
 * how many turns the start is from the solution and how often the ward turns a
 * ring back. The Arcana roll shapes the caster's side: the time before the ward
 * re-forms (1.5 s per point above or below the DC) and the pace of the ward's
 * turns (4 % per point). On a natural 20 the ward does not turn rings back.
 */
export function wardParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  const tier = dc <= 12 ? 0 : dc <= 17 ? 1 : dc <= 21 ? 2 : 3;
  const base = [40, 50, 55, 55][tier], every = [0, 10, 7, 6][tier];
  return {
    rings   : tier ? 5 : 4,
    bindings: [2, 3, 4, 5][tier],
    loops   : tier >= 2,                 // two rings may turn each other
    depth   : [8, 11, 12, 13][tier],     // turns the start needs at least
    time    : nat20 ? Math.round(base * 1.6) : nat1 ? Math.round(base * 0.6)
            : clamp(Math.round(base + margin * 1.5), Math.round(base * 0.6), Math.round(base * 1.5)),
    twistEvery: !every || nat20 ? 0 : +(every * (nat1 ? 0.75 : clamp(1 + margin * 0.04, 0.8, 1.4))).toFixed(2),
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
 * Links for a ward of n rings: a ring turns at most two others and is turned by
 * at most one (by two where loops are allowed). With `loops`, one pair of rings
 * may turn each other, always one the same way and the other the opposite way:
 * two rings that turn each other the same way would only ever move as one.
 */
function makeLinks(n, count, loops, R) {
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) pairs.push([a, b]);
  shuffle(pairs, R);
  const links = [];
  // Does a chain of links lead from `from` to `to` (leaving out link `skip`)?
  const reaches = (from, to, skip = null, seen = new Set()) =>
    from === to || (!seen.has(from) && (seen.add(from), links.some(b => b !== skip && b.from === from && reaches(b.to, to, skip, seen))));
  for (const [from, to] of pairs) {
    if (links.length >= count) break;
    if (links.filter(b => b.from === from).length >= 2 || links.filter(b => b.to === to).length >= (loops ? 2 : 1)) continue;
    const back = links.find(b => b.from === to && b.to === from);
    if (back) {
      // the pair's own two links may be the only way round: no longer loop through a third ring
      if (!loops || links.some(b => links.some(c => c.from === b.to && c.to === b.from)) || reaches(to, from, back)) continue;
      links.push({ from, to, dir: -back.dir });
    } else if (!reaches(to, from)) links.push({ from, to, dir: R() < 0.5 ? 1 : -1 });
  }
  return links;
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
  const rings = Array.from({ length: n }, () => ({}));

  // A loop leaves half the positions out of reach (fine: the ward only ever sits
  // in the reachable half); links that tie the rings tighter than that are drawn again.
  let ward, dist;
  for (let tries = 0; tries < 20; tries++) {
    ward = { beam, rings, bindings: makeLinks(n, p.bindings, p.loops, R), params: p, seed, dc };
    dist = turnDistances(ward);
    let reach = 0;
    for (const d of dist) if (d >= 0) reach++;
    if (reach * 2 >= dist.length) break;
  }

  // Scramble with real turns until no gap starts on the line and the solution is deep enough.
  let rot, best = -1;
  for (let attempt = 0; attempt < 80; attempt++) {
    let r = new Array(n).fill(0);
    const moves = 4 * n + randInt(2 * n);
    for (let m = 0; m < moves; m++) r = applyTurn(ward, r, randInt(n), R() < 0.5 ? 1 : -1).rot;
    if (r.some(v => v === 0)) continue;
    const need = dist[encodeRot(r)];
    if (need > best) { rot = r; best = need; }
    if (need >= p.depth) break;
  }
  if (!rot) {                                             // practically unreachable; still guarantee a puzzle
    rot = applyTurn(ward, applyTurn(ward, new Array(n).fill(0), 0, 1).rot, 0, 1).rot;
    best = dist[encodeRot(rot)];
  }
  ward.start = rot;
  ward.minTurns = best;
  return ward;
}

/** The direction of the ward's n-th turn back: from the seed, so spectators agree. */
const twistDir = (seed, n) => (rng((seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0)() < 0.5 ? 1 : -1);

/**
 * The game state on top of a ward: the rings, the light's flow, the time left
 * before the ward re-forms and the ward's own turns. Returned events let the UI
 * play sounds and effects without re-deriving rules.
 */
export const TWIST_WARNING = 1.2;          // seconds the ring glows before the ward turns it

export class WardGame {
  constructor(ward) {
    this.ward = ward;
    this.rot = ward.start.slice();
    this.timeLeft = ward.params.time;
    this.state = 'playing';                                  // playing | won | lost
    this.flow = flow(ward, this.rot);
    this.turns = 0;
    this.twists = 0;                                         // turns back the ward has taken
    this.lastTwist = null;                                   // { k, d, fired } of the latest
  }

  elapsed() { return this.ward.params.time - this.timeLeft; }

  /** When the ward's n-th turn back is due (seconds into the game); the first comes a little later. */
  twistDue(n) {
    const every = this.ward.params.twistEvery;
    return every ? every * (n + 1.5) : Infinity;
  }

  /** The ring the ward turns back: the outermost one the light runs through, or -1. */
  twistTarget() {
    const p = this.flow.powered;
    for (let i = p.length - 1; i >= 0; i--) if (p[i]) return i;
    return -1;
  }

  /** 0…1 over the moments before the ward turns a ring back (0 when there is nothing to turn). */
  twistWarning() {
    if (this.state !== 'playing' || this.twistTarget() < 0) return 0;
    const left = this.twistDue(this.twists) - this.elapsed();
    return left > TWIST_WARNING || left < -0.3 ? 0 : Math.min(1, 1 - left / TWIST_WARNING);
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

  /**
   * The clock, and the ward turning its outermost open ring back when one is
   * due (a real turn: its links fire too). Returns 'lost' once the ward has
   * re-formed, 'twist' when it turned a ring (see lastTwist), else null.
   */
  update(dt) {
    if (this.state !== 'playing') return null;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) { this.state = 'lost'; return 'lost'; }
    let out = null;
    while (this.elapsed() >= this.twistDue(this.twists)) {
      const n = this.twists++, k = this.twistTarget();
      if (k < 0) continue;
      const d = twistDir(this.ward.seed, n), { rot, fired } = applyTurn(this.ward, this.rot, k, d);
      this.rot = rot;
      this.flow = flow(this.ward, this.rot);
      this.lastTwist = { k, d, fired };
      out = 'twist';
    }
    return out;
  }

  /** Plain data for spectators. */
  snapshot() {
    return { rot: this.rot.slice(), timeLeft: this.timeLeft, state: this.state, turns: this.turns, twists: this.twists };
  }

  apply(s) {
    if (!s) return;
    this.rot = s.rot.slice();
    this.timeLeft = s.timeLeft;
    this.state = s.state;
    this.turns = s.turns;
    this.twists = s.twists ?? this.twists;
    this.flow = flow(this.ward, this.rot);
  }
}
