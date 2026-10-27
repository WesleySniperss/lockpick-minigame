/**
 * sigil-logic.mjs — rules of "Trace the Sigil" (no DOM, no Foundry).
 *
 * A sigil flares across a ring of star nodes and fades; the caster must trace
 * it again from memory, node by node, in the same order, before their mana
 * runs out. A wrong node cracks the line (three cracks and the working fails).
 * Strokes never pass close to an unrelated node, so the drawing is never
 * ambiguous and dragging through it never touches a stray star.
 */

import { rng, shuffle } from './ward-logic.mjs';

const TAU = Math.PI * 2;

/** 14 nodes in unit coordinates: the centre, an inner ring of 5, an outer ring of 8. */
export const NODES = (() => {
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5; pts.push({ x: Math.cos(a) * 0.44, y: Math.sin(a) * 0.44 }); }
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + TAU / 16 + i * TAU / 8; pts.push({ x: Math.cos(a) * 0.92, y: Math.sin(a) * 0.92 }); }
  return pts;
})();

/** DC: how long the sigil is; the Arcana roll: how long you see it, mana, recalls. */
export function sigilParams(dc = 15, roll = {}) {
  const margin = Number(roll.margin ?? 0), d20 = Number(roll.d20 ?? 10);
  const nat20 = d20 === 20, nat1 = d20 === 1;
  return {
    strokes  : dc <= 12 ? 4 : dc <= 17 ? 6 : 8,
    showTime : nat20 ? 6 : nat1 ? 1.0 : Math.max(1.2, Math.min(5, 2.6 + margin * 0.15)),   // seconds fully lit
    traceTime: nat20 ? 40 : nat1 ? 10 : Math.max(10, Math.min(35, 22 + margin)),
    recalls  : nat20 ? 2 : margin >= 5 ? 1 : 0,
    markStart: nat20 || margin >= 0,
    cracks   : 3,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Can the stroke a→b be drawn without brushing another node? */
export function clearStroke(a, b) {
  const A = NODES[a], B = NODES[b];
  if (dist(A, B) < 0.4) return false;                       // too short to read
  return NODES.every((p, i) => i === a || i === b || distToSegment(p, A, B) > 0.13);
}

/** A random path of `strokes` strokes over distinct nodes (DFS with random order). */
export function generateSigil({ dc = 15, roll = {}, seed = 1 } = {}) {
  const R = rng(seed);
  const params = sigilParams(dc, roll);
  const need = params.strokes + 1;
  let path = null;
  const dfs = (cur, used) => {
    if (cur.length === need) return cur;
    const last = cur[cur.length - 1];
    const options = NODES.map((_, i) => i).filter(i => !used.has(i) && clearStroke(last, i));
    shuffle(options, R);
    for (const nxt of options) {
      // avoid sharp reversals that redraw over the previous stroke
      if (cur.length >= 2) {
        const p = NODES[cur[cur.length - 2]], q = NODES[last], r = NODES[nxt];
        const v1x = q.x - p.x, v1y = q.y - p.y, v2x = r.x - q.x, v2y = r.y - q.y;
        const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
        if (cos < -0.92) continue;
      }
      used.add(nxt);
      const res = dfs([...cur, nxt], used);
      if (res) return res;
      used.delete(nxt);
    }
    return null;
  };
  for (let attempt = 0; attempt < 30 && !path; attempt++) {
    const start = Math.floor(R() * NODES.length);
    path = dfs([start], new Set([start]));
  }
  return { seed, dc, params, path };
}

/** Live state: memorize → trace → won | lost. */
export class SigilGame {
  constructor(sigil) {
    this.sigil = sigil;
    this.phase = 'memorize';
    this.progress = 0;                 // nodes correctly traced (the first one starts the line)
    this.cracks = 0;
    this.mana = sigil.params.traceTime;
    this.recalls = sigil.params.recalls;
    this.state = 'playing';
    this.wrong = null;                 // last wrong node (for the crack effect)
  }

  get path() { return this.sigil.path; }

  startTracing() { if (this.phase === 'memorize') this.phase = 'trace'; }

  /** Spend a recall: the sigil shows again (costs 4 s of mana). */
  recall() {
    if (this.phase !== 'trace' || this.recalls <= 0 || this.state !== 'playing') return false;
    this.recalls--;
    this.mana = Math.max(1, this.mana - 4);
    return true;
  }

  /** The player touched node i. Returns 'right' | 'wrong' | 'same' | 'won' | 'lost' | null. */
  touch(i) {
    if (this.state !== 'playing' || this.phase !== 'trace') return null;
    if (this.progress > 0 && i === this.path[this.progress - 1]) return 'same';
    if (i === this.path[this.progress]) {
      this.progress++;
      if (this.progress === this.path.length) { this.state = 'won'; return 'won'; }
      return 'right';
    }
    this.cracks++;
    this.wrong = i;
    if (this.cracks >= this.sigil.params.cracks) { this.state = 'lost'; return 'lost'; }
    return 'wrong';
  }

  /** Mana drains while tracing. Returns 'lost' when it runs out. */
  update(dt) {
    if (this.state !== 'playing' || this.phase !== 'trace') return null;
    this.mana = Math.max(0, this.mana - dt);
    if (this.mana <= 0) { this.state = 'lost'; return 'lost'; }
    return null;
  }

  snapshot() {
    return { phase: this.phase, progress: this.progress, cracks: this.cracks, mana: this.mana, recalls: this.recalls, state: this.state, wrong: this.wrong };
  }

  apply(s) { if (s) Object.assign(this, s); }
}
