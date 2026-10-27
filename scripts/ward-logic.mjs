/**
 * ward-logic.mjs — rules of "Unweave the Ward" (no DOM, no Foundry).
 *
 * A ward is a stack of concentric rune rings around a core. Each ring has an
 * inlet on its inner edge and one or more outlets on its outer edge, joined by
 * a channel carved through the stone. Energy leaves the core at one sector; a
 * ring carries it when its inlet faces an incoming sector and passes it on
 * from its outlets. The ward unravels when the energy reaches every anchor on
 * the rim. Rings turn one sector (of 8) at a time and every turn costs focus.
 * Some rings are bound: turning one drags another along (one way, not chained).
 * Traps on the rim bite back when energy is spilled into them.
 *
 * The geometry is built aligned (all rotations 0 = solved) and then scrambled
 * with real moves, so a solution always exists. One BFS from every winning
 * position over all ring positions (at most 8^5 = 32768) gives the exact
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
 * Difficulty. The DC shapes the ward (rings, anchors, bindings, decoys); the
 * Arcana roll shapes how well the caster reads it (spare focus, traps, whether
 * the bindings are visible from the start).
 */
export function wardParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  return {
    rings   : dc <= 12 ? 3 : dc <= 17 ? 4 : 5,
    anchors : dc >= 15 ? 2 : 1,
    bindings: dc <= 12 ? 1 : dc <= 17 ? 2 : 3,
    decoys  : dc <= 12 ? 0 : dc <= 17 ? 1 : 3,
    slack   : nat20 ? 10 : nat1 ? 0 : margin >= 10 ? 8 : margin >= 5 ? 6 : margin >= 0 ? 4 : margin >= -4 ? 2 : 1,
    traps   : nat20 ? 0 : nat1 ? 2 : margin < -4 ? 2 : margin < 0 ? 1 : 0,
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
 * Where the energy goes for given rotations.
 * powered[i] — ring i carries energy; boundary[i] — sectors entering ring i
 * (boundary[0] is the core); fed — rim sectors reached; blockedAt — first ring
 * that does not carry (or -1 when the energy reaches the rim).
 */
export function flow(ward, rot) {
  const n = ward.rings.length;
  const powered = new Array(n).fill(false);
  const boundary = [[ward.core]];
  let incoming = [ward.core], blockedAt = -1;
  for (let i = 0; i < n; i++) {
    const r = ward.rings[i];
    if (!incoming.includes(mod(r.inlet + rot[i]))) { blockedAt = i; break; }
    powered[i] = true;
    incoming = r.outlets.map(o => mod(o + rot[i]));
    boundary.push(incoming);
  }
  const fed = blockedAt === -1 ? incoming : [];
  return {
    powered, boundary, blockedAt, fed,
    win : ward.anchors.every(a => fed.includes(a)),
    trap: ward.traps.filter(t => fed.includes(t)),
  };
}

/** All ring rotations as one number: ring i's rotation is digit i in base 8. */
export const encodeRot = rot => rot.reduce((acc, v, i) => acc + v * SECTORS ** i, 0);

/**
 * Every winning position, as codes. There are few: a ring only carries when
 * its inlet faces an outlet of the ring inside it, which pins its rotation to
 * one value per incoming sector. (The same rule as flow(), walked outward.)
 */
export function winningCodes(ward) {
  const n = ward.rings.length, out = [];
  const walk = (i, incoming, code) => {
    const r = ward.rings[i];
    for (let rot = 0; rot < SECTORS; rot++) {
      if (!incoming.includes(mod(r.inlet + rot))) continue;
      const outs = r.outlets.map(o => mod(o + rot));
      const c = code + rot * SECTORS ** i;
      if (i < n - 1) walk(i + 1, outs, c);
      else if (ward.anchors.every(a => outs.includes(a))) out.push(c);
    }
  };
  walk(0, [ward.core], 0);
  return out;
}

/**
 * Turns from every position to the nearest win, indexed by encodeRot (-1 =
 * unreachable). A turn is undone by the opposite turn, so one BFS outward from
 * all winning positions at once gives the exact distance for every start.
 * With 8 sectors a ring is 3 bits of the code, so the search is bit arithmetic.
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
  for (const c of winningCodes(ward)) { dist[c] = 0; queue[tail++] = c; }
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

/** Exact minimum number of turns from `rot` to any winning position. */
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
  const offsetFrom = s => mod(s + (1 + randInt(3)) * (R() < 0.5 ? 1 : -1));   // 1..3 sectors away

  const core = randInt(SECTORS);
  const rings = [];
  let inSector = core;
  // Rings that get a decoy outlet (never the outermost — it feeds the anchors)
  const decoyRings = new Set();
  const inner = shuffle(Array.from({ length: n - 1 }, (_, i) => i), R);
  inner.slice(0, Math.min(p.decoys, n - 1)).forEach(i => decoyRings.add(i));

  for (let i = 0; i < n; i++) {
    const inlet = inSector;
    const main = offsetFrom(inlet);
    const outlets = [main];
    if (decoyRings.has(i)) {
      let decoy;
      do { decoy = randInt(SECTORS); } while (decoy === main || decoy === inlet);
      outlets.push(decoy);
    }
    rings.push({ inlet, outlets });
    inSector = main;
  }

  // Anchors sit where the outer ring's outlets point when solved.
  const outer = rings[n - 1];
  const anchors = [outer.outlets[0]];
  if (p.anchors === 2) {
    let second;
    do { second = randInt(SECTORS); } while (second === outer.outlets[0] || second === outer.inlet);
    outer.outlets.push(second);
    anchors.push(second);
  }

  // Traps: rim sectors that are not anchors (never fed in the solved position).
  const free = shuffle(Array.from({ length: SECTORS }, (_, s) => s).filter(s => !anchors.includes(s)), R);
  const traps = free.slice(0, p.traps);

  // Bindings: distinct ordered pairs, turning `from` drags `to` the same or the opposite way.
  const bindings = [];
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) pairs.push([a, b]);
  shuffle(pairs, R);
  for (const [from, to] of pairs) {
    if (bindings.length >= p.bindings) break;
    if (bindings.some(b => b.from === to && b.to === from)) continue;    // no mutual pairs
    bindings.push({ from, to, dir: R() < 0.5 ? 1 : -1 });
  }

  const ward = { core, rings, anchors, traps, bindings, params: p, seed, dc };

  // Scramble with real turns until the start is unsolved and takes at least n turns.
  // Scrambled positions are reachable from the solved one, so their distance is known.
  const dist = turnDistances(ward);
  let rot, best = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    let r = new Array(n).fill(0);
    const moves = 2 * n + randInt(n + 2);
    for (let m = 0; m < moves; m++) r = applyTurn(ward, r, randInt(n), R() < 0.5 ? 1 : -1).rot;
    const f = flow(ward, r);
    if (f.win || f.trap.length) continue;
    const need = dist[encodeRot(r)];
    if (need >= n) { rot = r; best = need; break; }
    if (need > best) { rot = r; best = need; }
  }
  if (!rot) {                                             // practically unreachable; still guarantee a puzzle
    rot = applyTurn(ward, applyTurn(ward, new Array(n).fill(0), 0, 1).rot, 0, 1).rot;
    best = dist[encodeRot(rot)];
  }
  ward.start = rot;
  ward.minTurns = best;
  ward.focus = best + p.slack;
  return ward;
}

/**
 * A turn-by-turn game state on top of a ward: focus, revealed bindings, traps.
 * Returned events let the UI play sounds/effects without re-deriving rules.
 */
export class WardGame {
  constructor(ward) {
    this.ward = ward;
    this.rot = ward.start.slice();
    this.focus = ward.focus;
    this.revealed = new Set(ward.params.insight ? ward.bindings.map((_, i) => i) : []);
    this.state = 'playing';                                  // playing | won | lost
    this.flow = flow(ward, this.rot);
    this.turns = 0;
  }

  /** Turn ring k by d. Returns { ok, fired:[binding], newlyPowered:[ring], revealed:[binding], trap, won, lost }. */
  turn(k, d) {
    if (this.state !== 'playing' || k < 0 || k >= this.rot.length) return { ok: false };
    const before = this.flow.powered.slice();
    const { rot, fired } = applyTurn(this.ward, this.rot, k, d);
    this.rot = rot;
    this.turns++;
    this.focus = Math.max(0, this.focus - 1);
    const revealed = fired.filter(i => !this.revealed.has(i));
    revealed.forEach(i => this.revealed.add(i));
    this.flow = flow(this.ward, this.rot);
    const newlyPowered = this.flow.powered.map((p, i) => (p && !before[i] ? i : -1)).filter(i => i >= 0);
    let trap = false;
    if (this.flow.trap.length && !this.flow.win) {
      trap = true;
      this.focus = Math.max(0, this.focus - 2);             // backlash
    }
    if (this.flow.win) this.state = 'won';
    else if (this.focus <= 0) this.state = 'lost';
    return { ok: true, fired, newlyPowered, revealed, trap, won: this.state === 'won', lost: this.state === 'lost' };
  }

  /** Plain data for spectators. */
  snapshot() {
    return { rot: this.rot.slice(), focus: this.focus, revealed: [...this.revealed], state: this.state, turns: this.turns };
  }

  apply(s) {
    if (!s) return;
    this.rot = s.rot.slice();
    this.focus = s.focus;
    this.revealed = new Set(s.revealed);
    this.state = s.state;
    this.turns = s.turns;
    this.flow = flow(this.ward, this.rot);
  }
}
