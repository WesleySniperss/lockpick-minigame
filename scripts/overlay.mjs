/**
 * overlay.mjs — the result screen every mini-game ends on. Over a dark wash, a
 * brass medallion with an icon sits in a glow of the outcome's colour (rays
 * for a success, cracks for a failure); under it, on a framed plate, a small
 * SUCCESS / FAILURE, the title in Cinzel with a gilt or ember gradient, an
 * ornament and a line in Amiri italic. Shared so the lock and the Arcana games
 * end the same way.
 */

import { FONT } from './arcane-art.mjs';

const TAU = Math.PI * 2;

export const TONES = {
  win : { wash: 'rgba(7,12,8,',  glow: '242,214,142', hi: '#fff1c4', mid: '#e2b65a', lo: '#8a6424', accent: '#86e09a', word: 'Success' },
  fail: { wash: 'rgba(16,7,6,',  glow: '255,106,85',  hi: '#ffd8c8', mid: '#e07a5f', lo: '#7a2f20', accent: '#ff8a72', word: 'Failure' },
};

/** Split a line in two at the space nearest its middle when it is wider than `max`. */
function wrap(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return [text];
  const mid = text.length / 2;
  let at = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i;
  return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 1)];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o  W, H (logical size), dpr, success, title, sub,
 *                    icon(ctx, x, y, tone) draws inside the medallion
 */
export function drawResultOverlay(ctx, { W, H, dpr = 1, success, title, sub, icon }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tone = success ? TONES.win : TONES.fail;
  const cx = W / 2, my = H / 2 - 58, R = 33;               // the medallion's centre and radius
  const glow = a => `rgba(${tone.glow},${a})`;

  // Dark wash with a vignette — the game stays faintly visible underneath
  const g = ctx.createRadialGradient(cx, my + 40, 30, cx, my + 40, Math.max(W, H) * 0.8);
  g.addColorStop(0, tone.wash + '0.80)');
  g.addColorStop(1, tone.wash + '0.96)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // The outcome's light behind the medallion
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(cx, my, R * 0.8, cx, my, R * 4.2);
  halo.addColorStop(0, glow(0.32)); halo.addColorStop(1, glow(0));
  ctx.fillStyle = halo;
  ctx.fillRect(cx - R * 4.2, my - R * 4.2, R * 8.4, R * 8.4);
  if (success) {
    // rays, alternately long and short
    for (let i = 0; i < 24; i++) {
      const a = i * TAU / 24 - Math.PI / 2, len = R * (i % 2 ? 2.4 : 3.6), w = i % 2 ? 0.035 : 0.05;
      const ray = ctx.createLinearGradient(cx, my, cx + Math.cos(a) * len, my + Math.sin(a) * len);
      ray.addColorStop(0, glow(0.2)); ray.addColorStop(1, glow(0));
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - w) * R, my + Math.sin(a - w) * R);
      ctx.lineTo(cx + Math.cos(a) * len, my + Math.sin(a) * len);
      ctx.lineTo(cx + Math.cos(a + w) * R, my + Math.sin(a + w) * R);
      ctx.closePath(); ctx.fill();
    }
  } else {
    // cracks running out from it
    ctx.strokeStyle = glow(0.35); ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (const [a0, n] of [[-2.5, 4], [-0.6, 5], [0.9, 4], [2.3, 3], [3.6, 4]]) {
      let a = a0, r = R + 4, x = cx + Math.cos(a) * r, y = my + Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < n; k++) {
        a += (k % 2 ? 0.28 : -0.22); r += 13 + k * 3;
        x = cx + Math.cos(a) * r; y = my + Math.sin(a) * r; ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  // The plate the words sit on: dark glass in a fine double frame with diamonds at the corners
  const pw = Math.min(W - 40, 400), top = my + R + 14, ph = 116, px = cx - pw / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(6,6,8,0.62)';
  ctx.beginPath(); ctx.roundRect(px, top, pw, ph, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(214,178,100,0.42)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(px + 0.5, top + 0.5, pw - 1, ph - 1, 8); ctx.stroke();
  ctx.strokeStyle = 'rgba(214,178,100,0.16)';
  ctx.beginPath(); ctx.roundRect(px + 4.5, top + 4.5, pw - 9, ph - 9, 5); ctx.stroke();
  ctx.fillStyle = tone.mid;
  for (const [x, y] of [[px + 4.5, top + 4.5], [px + pw - 4.5, top + 4.5], [px + 4.5, top + ph - 4.5], [px + pw - 4.5, top + ph - 4.5]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.5, -2.5, 5, 5); ctx.restore();
  }
  ctx.restore();

  // Medallion: a thin outer ring, the brass rim, the dark face
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 14 * dpr;
  ctx.shadowOffsetY = 3 * dpr;
  const ring = ctx.createLinearGradient(cx - R, my - R, cx + R, my + R);
  ring.addColorStop(0, '#f6dc96'); ring.addColorStop(0.5, '#a67e38'); ring.addColorStop(1, '#4e3a17');
  ctx.beginPath(); ctx.arc(cx, my, R, 0, TAU);
  ctx.fillStyle = ring; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = glow(0.55); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, my, R + 5, 0, TAU); ctx.stroke();
  const face = ctx.createRadialGradient(cx - 8, my - 10, 2, cx, my, R - 4);
  face.addColorStop(0, '#2e2719'); face.addColorStop(1, '#0e0b07');
  ctx.beginPath(); ctx.arc(cx, my, R - 4, 0, TAU);
  ctx.fillStyle = face; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  icon?.(ctx, cx, my, tone);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const letters = px2 => { if ('letterSpacing' in ctx) ctx.letterSpacing = px2; };

  // Success / Failure, small and spaced
  ctx.save();
  ctx.font = `700 11px ${FONT}`;
  letters('4px');
  ctx.fillStyle = tone.accent;
  ctx.globalAlpha = 0.9;
  ctx.fillText(tone.word.toUpperCase(), cx + 2, top + 25);
  ctx.restore();

  // Title: as large as fits, gilt (or ember) over a dark offset, with a soft glow
  ctx.save();
  let size = 34;
  ctx.font = `700 ${size}px ${FONT}`;
  letters('1.5px');
  while (size > 20 && ctx.measureText(title).width > pw - 36) { size -= 2; ctx.font = `700 ${size}px ${FONT}`; }
  const ty = top + 30 + size;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillText(title, cx, ty + 2);
  const tg = ctx.createLinearGradient(0, ty - size, 0, ty);
  tg.addColorStop(0, tone.hi); tg.addColorStop(0.55, tone.mid); tg.addColorStop(1, tone.lo);
  ctx.shadowColor = glow(0.45); ctx.shadowBlur = 12 * dpr;
  ctx.fillStyle = tg;
  ctx.fillText(title, cx, ty);
  ctx.restore();

  // Ornament: fading lines, dots and a diamond
  const oy = ty + 13;
  ctx.save();
  for (const side of [-1, 1]) {
    const line = ctx.createLinearGradient(cx, 0, cx + side * 120, 0);
    line.addColorStop(0, 'rgba(214,178,100,0.7)'); line.addColorStop(1, 'rgba(214,178,100,0)');
    ctx.fillStyle = line;
    ctx.fillRect(side < 0 ? cx - 120 : cx + 9, oy, 111, 1);
    ctx.fillStyle = 'rgba(230,200,130,0.8)';
    ctx.beginPath(); ctx.arc(cx + side * 14, oy + 0.5, 1.4, 0, TAU); ctx.fill();
  }
  ctx.translate(cx, oy + 0.5); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = tone.accent; ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
  ctx.restore();

  // The line underneath, in two lines if it must
  ctx.save();
  ctx.font = 'italic 400 17px "Amiri", Georgia, "Times New Roman", serif';
  ctx.fillStyle = 'rgba(238,228,204,0.9)';
  const lines = wrap(ctx, sub ?? '', pw - 30);
  lines.forEach((l, i) => ctx.fillText(l, cx, oy + 24 + i * 19));
  ctx.restore();
}

const metalOf = (ctx, x, y, tone) => {
  const m = ctx.createLinearGradient(x - 12, y - 14, x + 12, y + 14);
  m.addColorStop(0, tone.hi); m.addColorStop(1, tone.mid);
  return m;
};

/** Medallion icons for the Arcana games. */
export const ARCANE_ICONS = {
  /** Concentric rings; broken open when the ward is unwoven. */
  ward(ctx, x, y, tone, broken = false) {
    ctx.save();
    ctx.strokeStyle = metalOf(ctx, x, y, tone);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (const [r, gap] of [[14, 0.5], [9, 0.9], [4, 0]]) {
      ctx.beginPath();
      const g = broken ? gap : 0;
      ctx.arc(x, y, r, -Math.PI / 2 + g, -Math.PI / 2 + TAU - g);
      ctx.stroke();
    }
    ctx.restore();
  },
  /** Two sine waves, merged into one on success. */
  wave(ctx, x, y, tone, merged = false) {
    ctx.save();
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    const draw = (ph, col) => {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const px = x - 15 + i * 1.25, py = y + Math.sin(i / 24 * TAU * 1.5 + ph) * 7;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    };
    if (!merged) draw(1.6, tone.accent);
    draw(0, metalOf(ctx, x, y, tone));
    ctx.restore();
  },
  /** A wisp in a focus ring; slipped out through a broken ring when it failed. */
  wisp(ctx, x, y, tone, caught = false) {
    ctx.save();
    ctx.strokeStyle = metalOf(ctx, x, y, tone);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath();
    if (caught) ctx.arc(x, y, 13, 0, TAU);
    else ctx.arc(x - 3, y + 3, 11, -0.2, TAU - 1.3);
    ctx.stroke();
    ctx.fillStyle = caught ? tone.hi : tone.accent;
    ctx.beginPath(); ctx.arc(caught ? x : x + 9, caught ? y : y - 9, 4.5, 0, TAU); ctx.fill();
    ctx.restore();
  },
  /** A knot of three loops; parted when the weave is undone. */
  knot(ctx, x, y, tone, undone = false) {
    ctx.save();
    ctx.strokeStyle = metalOf(ctx, x, y, tone);
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * TAU / 3, d = undone ? 9 : 5;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 7, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  },
  /** A five-point sigil star; cracked when the trace failed. */
  sigil(ctx, x, y, tone, cracked = false) {
    ctx.save();
    ctx.strokeStyle = metalOf(ctx, x, y, tone);
    ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 2 % 5) * TAU / 5;
      const px = x + Math.cos(a) * 14, py = y + Math.sin(a) * 14;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    if (cracked) {
      ctx.strokeStyle = tone.accent; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - 3, y - 15); ctx.lineTo(x + 2, y - 4); ctx.lineTo(x - 2, y + 3); ctx.lineTo(x + 4, y + 15); ctx.stroke();
    }
    ctx.restore();
  },
};
