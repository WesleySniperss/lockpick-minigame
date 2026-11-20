/**
 * overlay.mjs — the result screen every canvas game ends on. Over a dark wash
 * sits a picture of what the player actually did, drawn small by the game
 * itself (the sigil they traced, the ward's rings as they left them, the pins
 * they set). A success lights it in gold with soft rays; a failure leaves it as
 * it ended, gone cold and silver. Under it, on
 * a framed plate: SUCCESS / FAILURE, the title in Cinzel, an ornament and a
 * line in Amiri italic. Shared so the lock and the Arcana games end the same way.
 */

import { FONT } from './arcane-art.mjs';

const TAU = Math.PI * 2;

/** The picture's radius, in canvas units. */
export const SCENE_R = 72;

export const TONES = {
  win : { wash: 'rgba(12,10,6,',  glow: '242,214,142', hi: '#fff1c4', mid: '#e2b65a', lo: '#8a6424', accent: '#f6dc96', word: 'Success' },
  fail: { wash: 'rgba(9,9,10,',   glow: '176,182,192', hi: '#f4f5f7', mid: '#aeb3bb', lo: '#4f535b', accent: '#c9ccd2', word: 'Failure' },
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
 *                    scene(ctx, x, y, R, tone): the game draws what was done, within radius R of (x, y)
 */
export function drawResultOverlay(ctx, { W, H, dpr = 1, success, title, sub, scene }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tone = success ? TONES.win : TONES.fail;
  const R = SCENE_R, gap = 16, ph = 116;
  const y0 = Math.max(8, (H - (2 * R + gap + ph)) / 2);
  const cx = W / 2, my = y0 + R, top = y0 + 2 * R + gap;
  const glow = a => `rgba(${tone.glow},${a})`;

  // Dark wash with a vignette — the game stays faintly visible underneath
  const g = ctx.createRadialGradient(cx, my + 40, 30, cx, my + 40, Math.max(W, H) * 0.8);
  g.addColorStop(0, tone.wash + '0.84)');
  g.addColorStop(1, tone.wash + '0.97)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // The outcome's light behind the picture: rays for a success, a low smoulder for a failure
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(cx, my, R * 0.7, cx, my, R * (success ? 2.5 : 1.9));
  halo.addColorStop(0, glow(success ? 0.26 : 0.16)); halo.addColorStop(1, glow(0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, top);
  if (success) {
    for (let i = 0; i < 28; i++) {
      const a = i * TAU / 28 - Math.PI / 2, len = R * (i % 2 ? 1.75 : 2.35), w = i % 2 ? 0.022 : 0.032;
      const ray = ctx.createLinearGradient(cx, my, cx + Math.cos(a) * len, my + Math.sin(a) * len);
      ray.addColorStop(0.45, glow(0.16)); ray.addColorStop(1, glow(0));
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - w) * R, my + Math.sin(a - w) * R);
      ctx.lineTo(cx + Math.cos(a) * len, my + Math.sin(a) * len);
      ctx.lineTo(cx + Math.cos(a + w) * R, my + Math.sin(a + w) * R);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();

  // A dark lens, so the picture reads against whatever the board left behind
  const lens = ctx.createRadialGradient(cx, my, 0, cx, my, R * 1.22);
  lens.addColorStop(0, 'rgba(4,4,6,0.72)'); lens.addColorStop(0.78, 'rgba(4,4,6,0.6)'); lens.addColorStop(1, 'rgba(4,4,6,0)');
  ctx.fillStyle = lens;
  ctx.beginPath(); ctx.arc(cx, my, R * 1.22, 0, TAU); ctx.fill();

  if (scene) { ctx.save(); scene(ctx, cx, my, R, tone); ctx.restore(); }

  // The plate the words sit on: dark glass in a fine double frame with diamonds at the corners
  const pw = Math.min(W - 40, 400), px = cx - pw / 2;
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

/**
 * Helpers for the pictures. Every picture is drawn in the game's own board
 * coordinates, shrunk round (x, y): `fit` sets that up and returns one screen
 * pixel in board units, for line widths that stay crisp.
 */
export function fit(ctx, x, y, R, boardR, cx, cy) {
  const k = R / boardR;
  ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-cx, -cy);
  return 1 / k;
}

/** A soft stroke of light along the current path: a wide faint pass and a bright core. */
export function lightStroke(ctx, px, color, width = 2.4, core = '#fffaf0') {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = color; ctx.globalAlpha = 0.22; ctx.lineWidth = width * 4 * px; ctx.stroke();
  ctx.globalAlpha = 0.5; ctx.lineWidth = width * 1.8 * px; ctx.stroke();
  ctx.globalAlpha = 0.95; ctx.strokeStyle = core; ctx.lineWidth = width * 0.7 * px; ctx.stroke();
  ctx.restore();
}

/** A round glow (a star, a gem, a knot) of radius r board units. */
export function bloom(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,252,240,${alpha})`);
  g.addColorStop(0.25, color.replace('A', String(0.8 * alpha)));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}
