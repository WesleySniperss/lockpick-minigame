/**
 * arcane-art.mjs — shared look of the Arcana mini-games: dark carved stone,
 * engraved circles and runes, glowing ley-energy. Canvas helpers only.
 */

import { rng } from './ward-logic.mjs';

export const TAU = Math.PI * 2;

export const ARC = {
  energy  : '#86ecff',      // ley light
  energyLo: '#2f8fd6',
  violet  : '#b48cff',
  gold    : '#f2d68e',
  brass   : '#c99a3c',
  danger  : '#ff6a55',
  ink     : 'rgba(150,175,230,',   // engraving colour prefix (append alpha + ')')
};

/**
 * Offscreen canvas at device resolution whose context draws in logical units.
 * `opaque`: it will be covered edge to edge, so blitting it needs no blending.
 */
export function layer(w, h, dpr, { opaque = false } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  c.getContext('2d', { alpha: !opaque }).setTransform(dpr, 0, 0, dpr, 0, 0);
  c._dpr = dpr;
  return c;
}

/** drawImage of a layer at its logical size. */
export function blit(ctx, c, x = 0, y = 0) {
  ctx.drawImage(c, x, y, c.width / c._dpr, c.height / c._dpr);
}

/**
 * The parts of a layer that hold a ring around its centre, between radii r0 and
 * r1, as whole-pixel rects. A thin ring's bounding box is mostly empty, and
 * copying it through a few small rects touches a quarter of the pixels. (Only
 * for 1:1 copies: drawn rotated, small rects cost more than they save.)
 */
export function ringCells(c, r0, r1) {
  const d = c._dpr, W = c.width, H = c.height, mx = W / 2, my = H / 2;
  const a = r0 * d, b = r1 * d, size = Math.max(16, Math.ceil((b - a) * 1.5));
  const cells = [];
  for (let y = 0; y < H; y += size) for (let x = 0; x < W; x += size) {
    const w = Math.min(size, W - x), h = Math.min(size, H - y);
    const nx = Math.max(x - mx, 0, mx - (x + w)), ny = Math.max(y - my, 0, my - (y + h));      // the cell's nearest point
    const fx = Math.max(Math.abs(x - mx), Math.abs(x + w - mx)), fy = Math.max(Math.abs(y - my), Math.abs(y + h - my));  // and farthest
    if (Math.hypot(nx, ny) > b || Math.hypot(fx, fy) < a) continue;
    cells.push([x, y, w, h]);
  }
  return cells;
}

/**
 * Copy the cells of layer `c`, its centre over (cx, cy), pixel for pixel: whole
 * device pixels need no resampling. Expects (and leaves) the plain DPR transform.
 */
export function blitCells(ctx, c, cells, cx, cy) {
  const d = c._dpr, dx = Math.round(cx * d - c.width / 2), dy = Math.round(cy * d - c.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const [x, y, w, h] of cells) ctx.drawImage(c, x, y, w, h, dx + x, dy + y, w, h);
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

/**
 * Elder Futhark-style glyphs as line segments in a unit box (-0.5..0.5).
 * Engraved round the rings, on the rim and in the backdrop.
 */
export const RUNES = [
  [[0, -.5, 0, .5], [0, -.25, .3, -.45], [0, 0, .3, -.2]],                 // fehu
  [[-.25, .5, -.25, -.5], [-.25, -.5, .25, -.25], [.25, -.25, .25, .5]],   // uruz
  [[-.2, -.5, -.2, .5], [-.2, -.25, .2, 0], [.2, 0, -.2, .25]],            // thurisaz
  [[-.1, -.5, -.1, .5], [-.1, -.3, .25, -.1], [-.1, -.05, .25, .15]],      // ansuz
  [[-.2, -.5, -.2, .5], [-.2, -.5, .2, -.25], [.2, -.25, -.2, 0], [-.2, 0, .25, .5]], // raidho
  [[.2, -.4, -.2, 0], [-.2, 0, .2, .4]],                                   // kenaz
  [[-.3, -.5, .3, .5], [.3, -.5, -.3, .5]],                                // gebo
  [[-.2, -.5, -.2, .5], [-.2, -.5, .2, -.25], [.2, -.25, -.2, 0]],         // wunjo
  [[-.25, -.5, -.25, .5], [.25, -.5, .25, .5], [-.25, -.1, .25, .1]],      // hagalaz
  [[0, -.5, 0, .5], [-.25, -.15, .25, .15]],                               // nauthiz
  [[0, -.5, 0, .5]],                                                       // isa
  [[-.05, -.45, -.3, -.15], [-.3, -.15, -.05, .15], [.05, -.15, .3, .15], [.3, .15, .05, .45]], // jera
  [[0, -.5, 0, .5], [0, -.5, .2, -.35], [0, .5, -.2, .35]],               // eihwaz
  [[-.2, -.5, -.2, .5], [-.2, -.5, .2, -.3], [-.2, .5, .2, .3]],           // perthro
  [[0, -.5, 0, .5], [0, -.15, -.3, -.45], [0, -.15, .3, -.45]],            // algiz
  [[.15, -.5, -.15, -.15], [-.15, -.15, .15, .15], [.15, .15, -.15, .5]],  // sowilo
  [[0, -.5, 0, .5], [0, -.5, -.3, -.2], [0, -.5, .3, -.2]],               // tiwaz
  [[-.2, -.5, -.2, .5], [-.2, -.5, .2, -.25], [.2, -.25, -.2, 0], [-.2, 0, .2, .25], [.2, .25, -.2, .5]], // berkano
  [[-.25, .5, -.25, -.5], [-.25, -.5, 0, -.2], [0, -.2, .25, -.5], [.25, -.5, .25, .5]], // ehwaz
  [[0, -.5, 0, .5], [0, -.5, .25, -.25]],                                  // laguz
  [[0, -.45, -.25, 0], [-.25, 0, 0, .45], [0, .45, .25, 0], [.25, 0, 0, -.45]], // ingwaz
  [[-.3, -.4, -.3, .4], [.3, -.4, .3, .4], [-.3, -.4, .3, .4], [.3, -.4, -.3, .4]], // dagaz
];

/** Stroke rune `idx` centred at (x, y), `size` px tall, rotated by `rot`. */
export function drawRune(ctx, idx, x, y, size, rot = 0) {
  const segs = RUNES[((idx % RUNES.length) + RUNES.length) % RUNES.length];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) {
    ctx.moveTo(x1 * size, y1 * size);
    ctx.lineTo(x2 * size, y2 * size);
  }
  ctx.stroke();
  ctx.restore();
}

/** Engraved stroke: a dark groove with a faint lit lower lip. `path()` builds the path. */
export function engrave(ctx, path, width = 1.2, alpha = 1) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.translate(0, 0.8);
  path(); ctx.strokeStyle = `rgba(190,205,240,${0.10 * alpha})`; ctx.lineWidth = width; ctx.stroke();
  ctx.translate(0, -0.8);
  path(); ctx.strokeStyle = `rgba(0,0,0,${0.55 * alpha})`; ctx.lineWidth = width; ctx.stroke();
  ctx.restore();
}

/**
 * Glowing energy line: wide soft halo, a coloured body and a white-hot core,
 * all additive. `path()` builds the path (called once per pass).
 */
export function glow(ctx, path, { color = ARC.energy, width = 3, intensity = 1, core = true, cap = 'round' } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = cap; ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.14 * intensity; ctx.strokeStyle = color; ctx.lineWidth = width * 4.5; path(); ctx.stroke();
  ctx.globalAlpha = 0.32 * intensity; ctx.lineWidth = width * 2.2; path(); ctx.stroke();
  ctx.globalAlpha = 0.9 * intensity;  ctx.lineWidth = width; path(); ctx.stroke();
  if (core) { ctx.globalAlpha = 0.85 * intensity; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(0.8, width * 0.35); path(); ctx.stroke(); }
  ctx.restore();
}

const SPRITES = new Map();

/** A small square canvas drawn once per page, per key. */
function sprite(key, px, paint) {
  let c = SPRITES.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = px;
    paint(c.getContext('2d'), px / 2);
    SPRITES.set(key, c);
  }
  return c;
}

/**
 * A soft additive point of light: one sprite per colour and size class, not a
 * new gradient for each light in each frame.
 */
export function spark(ctx, x, y, r, color = ARC.energy, alpha = 1) {
  if (!(alpha > 0) || !(r > 0)) return;
  const px = r > 24 ? 256 : 64;
  const s = sprite(`spark${color}${px}`, px, (g, m) => {
    const rg = g.createRadialGradient(m, m, 0, m, m, m);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)');
    rg.addColorStop(0.25, hexA(color, 0.7));
    rg.addColorStop(1, hexA(color, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, px, px);
  });
  const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = ga * Math.min(1, alpha);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = ga;
}

/** A solid round dot as a sprite (many small ones cost less this way than as paths). */
export const discSprite = color => sprite(`disc${color}`, 32, (g, m) => {
  g.fillStyle = color;
  g.beginPath(); g.arc(m, m, m - 0.5, 0, TAU); g.fill();
});

/**
 * A long glowing arc that creeps along, clockwise from the top: a meter round a
 * board. Stroking all of it three times a frame costs 3–4 ms without a GPU, so
 * everything up to the last whole step stays in a layer, updated step by step,
 * and only the tip is stroked live. The two meet with flat ends: additive light
 * adds up to the same line, without a seam.
 */
export class ArcMeter {
  constructor(dpr, r, { color, width, steps = 72 }) {
    this.r = r;
    this.style = { color, width, core: false, cap: 'butt' };
    this.steps = steps;
    this.whole = 0;
    const halo = width * 2.25 + 1.5;
    this.m = r + halo + 1;
    this.c = layer(this.m * 2, this.m * 2, dpr);
    this.m = this.c.width / dpr / 2;                  // the centre as the layer really is
    this.cells = ringCells(this.c, r - halo, r + halo);
  }

  stroke(ctx, x, y, f0, f1, intensity) {
    const a = t => -Math.PI / 2 + t * TAU;
    glow(ctx, () => { ctx.beginPath(); ctx.arc(x, y, this.r, a(f0), a(f1)); }, { ...this.style, intensity });
  }

  /** Draw the arc up to fraction f around (x, y). */
  draw(ctx, x, y, f, intensity = 1) {
    f = Math.max(0, Math.min(1, f));
    const whole = Math.floor(f * this.steps), n = this.steps, m = this.m;
    if (whole > this.whole) this.stroke(this.c.getContext('2d'), m, m, this.whole / n, whole / n, 1);
    else if (whole < this.whole) {
      const g = this.c.getContext('2d'), a = t => -Math.PI / 2 + t * TAU;
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(m, m); g.arc(m, m, m, a(whole / n), a(this.whole / n)); g.closePath(); g.fill();
      g.restore();
    }
    this.whole = whole;
    if (whole) {
      const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ga * intensity;
      blitCells(ctx, this.c, this.cells, x, y);
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = ga;
    }
    if (f * n > whole) this.stroke(ctx, x, y, whole / n, f, intensity);
  }
}

/** '#rrggbb' + alpha → 'rgba(...)'. */
export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const BACKDROPS = new Map();

/**
 * Dark carved stone slab with a faint engraved circle of runes — the surface
 * the working is cut into. Cached per size and DPR (built once per page).
 */
export function backdrop(W, H, dpr, { cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.47, seed = 3 } = {}) {
  const key = `${W}x${H}@${dpr}|${cx},${cy},${r}`;
  if (BACKDROPS.has(key)) return BACKDROPS.get(key);
  const c = layer(W, H, dpr, { opaque: true });
  const ctx = c.getContext('2d');
  const R = rng(seed);

  const g = ctx.createRadialGradient(cx, cy * 0.9, 20, cx, cy, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#20232e');
  g.addColorStop(0.55, '#14161e');
  g.addColorStop(1, '#090a0e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Mottled stone
  for (let i = 0; i < 260; i++) {
    const x = R() * W, y = R() * H, rad = 6 + R() * 34;
    const mg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const light = R() < 0.4;
    mg.addColorStop(0, light ? 'rgba(150,165,200,0.035)' : 'rgba(0,0,0,0.10)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < Math.round(W * H / 90); i++) {
    ctx.fillStyle = R() < 0.3 ? 'rgba(190,200,230,0.06)' : 'rgba(0,0,0,0.16)';
    ctx.fillRect(R() * W, R() * H, 1, 1);
  }
  // Hairline cracks
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 7; i++) {
    let x = R() * W, y = R() * H, a = R() * TAU;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { a += (R() - 0.5) * 1.1; x += Math.cos(a) * (8 + R() * 18); y += Math.sin(a) * (8 + R() * 18); ctx.lineTo(x, y); }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
  }

  // Engraved outer circles with a ring of faint runes between them
  for (const rr of [r, r - 18]) engrave(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); }, 1.4, 0.8);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.1;
  const count = 28;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + i * TAU / count;
    const x = cx + Math.cos(a) * (r - 9), y = cy + Math.sin(a) * (r - 9);
    ctx.save(); ctx.translate(0, 0.7); ctx.strokeStyle = 'rgba(190,205,240,0.07)'; drawRune(ctx, i * 5 + 2, x, y, 9, a + Math.PI / 2); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; drawRune(ctx, i * 5 + 2, x, y, 9, a + Math.PI / 2);
  }

  // Vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  BACKDROPS.set(key, c);
  return c;
}
