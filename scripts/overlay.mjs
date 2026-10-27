/**
 * overlay.mjs — the result screen every mini-game ends on: a dark wash, a
 * brass medallion with an icon, the title in Modesto Condensed and a subtitle
 * in Amiri (both are core fonts). Shared so the lock and the Arcana games end
 * the same way.
 */

const TAU = Math.PI * 2;

export const TONES = {
  win : { wash: 'rgba(8,18,10,', hi: '#f6e3a4', mid: '#d6ac52', lo: '#8a6424', accent: '#7fdc93' },
  fail: { wash: 'rgba(20,8,6,',  hi: '#f3c6b6', mid: '#d0715a', lo: '#7a2f20', accent: '#ff8a72' },
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o  W, H (logical size), dpr, success, title, sub,
 *                    icon(ctx, x, y, tone) draws inside the medallion
 */
export function drawResultOverlay(ctx, { W, H, dpr = 1, success, title, sub, icon }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = W / 2, cy = H / 2;
  const tone = success ? TONES.win : TONES.fail;

  // Dark wash with a vignette — the game stays faintly visible underneath
  const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, W * 0.72);
  g.addColorStop(0, tone.wash + '0.80)');
  g.addColorStop(1, tone.wash + '0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Medallion
  const my = cy - 52, R = 30;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 12 * dpr;
  ctx.shadowOffsetY = 3 * dpr;
  const ring = ctx.createLinearGradient(cx - R, my - R, cx + R, my + R);
  ring.addColorStop(0, '#f2d68e'); ring.addColorStop(0.5, '#a07a36'); ring.addColorStop(1, '#4e3a17');
  ctx.beginPath(); ctx.arc(cx, my, R, 0, TAU);
  ctx.fillStyle = ring; ctx.fill();
  ctx.restore();
  const face = ctx.createRadialGradient(cx - 8, my - 10, 2, cx, my, R - 4);
  face.addColorStop(0, '#2c2619'); face.addColorStop(1, '#100d08');
  ctx.beginPath(); ctx.arc(cx, my, R - 4, 0, TAU);
  ctx.fillStyle = face; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  icon?.(ctx, cx, my, tone);

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.save();
  ctx.font = '700 40px "Modesto Condensed", "Signika", Georgia, serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillText(title, cx, cy + 24);
  const tg = ctx.createLinearGradient(0, cy - 8, 0, cy + 24);
  tg.addColorStop(0, tone.hi); tg.addColorStop(0.55, tone.mid); tg.addColorStop(1, tone.lo);
  ctx.fillStyle = tg;
  ctx.fillText(title, cx, cy + 22);
  ctx.restore();

  // Divider with a diamond
  const ry = cy + 38;
  ctx.fillStyle = 'rgba(214,178,100,0.45)';
  ctx.fillRect(cx - 96, ry, 86, 1);
  ctx.fillRect(cx + 10, ry, 86, 1);
  ctx.save();
  ctx.translate(cx, ry + 0.5); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = tone.accent; ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();

  // Subtitle
  ctx.font = 'italic 400 16px "Amiri", Georgia, "Times New Roman", serif';
  ctx.fillStyle = 'rgba(232,222,196,0.82)';
  ctx.fillText(sub, cx, ry + 26);
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
