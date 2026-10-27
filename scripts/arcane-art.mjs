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

/** Offscreen canvas at device resolution whose context draws in logical units. */
export function layer(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  c._dpr = dpr;
  return c;
}

/** drawImage of a layer at its logical size. */
export function blit(ctx, c, x = 0, y = 0) {
  ctx.drawImage(c, x, y, c.width / c._dpr, c.height / c._dpr);
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
export function glow(ctx, path, { color = ARC.energy, width = 3, intensity = 1, core = true } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.14 * intensity; ctx.strokeStyle = color; ctx.lineWidth = width * 4.5; path(); ctx.stroke();
  ctx.globalAlpha = 0.32 * intensity; ctx.lineWidth = width * 2.2; path(); ctx.stroke();
  ctx.globalAlpha = 0.9 * intensity;  ctx.lineWidth = width; path(); ctx.stroke();
  if (core) { ctx.globalAlpha = 0.85 * intensity; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(0.8, width * 0.35); path(); ctx.stroke(); }
  ctx.restore();
}

/** A soft additive point of light. */
export function spark(ctx, x, y, r, color = ARC.energy, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
  g.addColorStop(0.25, hexA(color, 0.7 * alpha));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
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
  const c = layer(W, H, dpr);
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
