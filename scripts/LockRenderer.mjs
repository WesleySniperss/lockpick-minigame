/**
 * LockRenderer.mjs — розріз замка збоку, врізаного в дерев'яні двері (canvas 520×366).
 *
 * Будова (зверху вниз):
 *   - латунний корпус: клеймо майстра і вікно механізму з чотирма зчепленими
 *     колесами (крутяться лише коли гачок реально б'є по піну);
 *   - блок камер: сталева планка-кришка → пружина → суцільний латунний пін;
 *   - під лінією зрізу — плаг (циліндр) з отворами і фрезерованим пазом ключа
 *     з вардами; у пазу ходить сталева гачкова відмичка, хвіст якої йде за
 *     лівий край екрана; натяжний ключ — лише темний силует на дні паза;
 *   - під корпусом — латунна лінійка шкали натягу.
 *
 * Невстановлений пін висить у заглибленні плага і блокує зріз; встановлений —
 * піднятий вище зрізу, тож плаг при відкритті ковзає під пінами.
 *
 * Незмінне (дерево, корпус, камери, гирло паза, лінійка) малюється один раз у
 * кешований шар; щокадру — плаг, піни з пружинами, колеса (лише коли
 * повернулись), відмичка та маркер. Єдине джерело світла — згори-зліва.
 */

import { TRACK_W, HIT_ZONE, RED_W } from './LockController.mjs';

const TAU = Math.PI * 2;

// Reused dash patterns — setLineDash([..]) inside a per-frame loop would
// allocate a fresh array for every pin, every frame.
const DASH_GUIDE = [2, 4];
const DASH_NONE  = [];

export const CANVAS_W = 520;
export const CANVAS_H = 366;

// ── Розкладка ────────────────────────────────────────────────────────────
const CASE    = { x: 30, y: 14, w: 460, h: 266, r: 12 };  // корпус 14..280
const GEARBAY = { x: 258, y: 22, w: 204, h: 58 };         // вікно механізму
const HOUSE   = { x: 64, y: 88, w: 392, h: 86 };          // блок камер 88..174
export const SHEAR_Y = HOUSE.y + HOUSE.h;                 // лінія зрізу = 174
const BORE_BOT   = SHEAR_Y + 34;                          // 208 — низ отворів плага
const KEYWAY_BOT = SHEAR_Y + 88;                          // 262 — дно паза
const PLUG_BOT   = SHEAR_Y + 96;                          // 270 — низ плага
export const KEYWAY_CY = SHEAR_Y + 44;                    // 218 — рівень відмички
export const TRACK_X = 80;                                // ігровий 0 → canvas x

const CAP_H        = 8;     // сталева планка над камерами
const PIN_PROTRUDE = 46;    // наскільки суцільний пін опускається у заглиблення плага
const CHAMBER_W    = 32;
const PIN_W        = 20;
const PIN_H        = 52;
const NOSE_H       = 9;     // заокруглений ніс піна

// Лінійка шкали під корпусом
const PLATE    = { x: 56, y: 288, w: 408, h: 60, r: 7 };
const SCALE    = { y: 297, h: 22 };
const SCALE_X0 = TRACK_X;
const SCALE_X1 = TRACK_X + TRACK_W;

// Відмичка. Локальні координати: (0,0) — вершина гака, вісь стрижня на y = PICK_AX.
const PICK_AX  = 36;        // глибина гака (мусить дістати ніс піна з дна паза)
const PICK_T   = 3.5;       // половина товщини стрижня
const PICK_ANG = 0.10;      // фіксований нахил: інструмент жорсткий, нічого не тягнеться
const PICK_LEN = 600;       // хвіст завжди за лівим краєм екрана
const PICK_OX  = PICK_LEN + 14, PICK_OY = 34;   // де вершина гака лежить у спрайті

// ── Матеріали ────────────────────────────────────────────────────────────
// Cylindrical-metal colour sets: {edge, hi (specular), mid, lo (core shadow), rim (reflected light)}
const MAT = {
  brass:  { edge: '#3a2b0f', hi: '#f3d98e', mid: '#bd8e33', lo: '#664916', rim: '#d7b25a' },
  brassL: { edge: '#4a3712', hi: '#ffeaa8', mid: '#d9a63c', lo: '#7e5c1c', rim: '#f0cd72' }, // намацаний
  gold:   { edge: '#7c5a12', hi: '#fff4c8', mid: '#f2c24d', lo: '#a57a1c', rim: '#ffe28c' }, // встановлений
};
const ZONE = {
  green: '#34b158', greenHi: '#a4f7bb', greenLo: '#166a38',
  red:   '#c63b2c', redHi:   '#ff8f78', redLo:   '#6c190f',
};

/**
 * Кут ВЕДЕНОГО колеса із зачеплення.
 *
 * Зубці спрайта при куті 0 дивляться вгору, тобто на −π/2. Нехай θ — напрям
 * від центра 1 до центра 2:
 *   зуб колеса 1 дивиться на θ    ⟺  a1 = θ + π/2
 *   у колеса 2 в цю мить має бути западина з боку θ+π:  a2 = θ + 3π/2 + π/N2
 * Разом з коченням без ковзання a2 = −(N1/N2)·a1 + const це дає:
 */
function meshAngle(a1, N1, N2, th) {
  return -(N1 / N2) * (a1 - th - Math.PI / 2) + th + 3 * Math.PI / 2 + Math.PI / N2;
}

/** Deterministic PRNG (mulberry32) — textures look random but never flicker between builds. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Horizontal cylindrical-metal gradient across [x, x+w], lit from top-left. */
function cyl(ctx, x, w, m) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0.00, m.edge);
  g.addColorStop(0.24, m.hi);
  g.addColorStop(0.46, m.mid);
  g.addColorStop(0.72, m.lo);
  g.addColorStop(0.89, m.rim);
  g.addColorStop(1.00, m.edge);
  return g;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Шліфований метал: нерівні горизонтальні волокна + крап. Викликати всередині clip. */
function brushed(ctx, x, y, w, h, seed = 1, k = 1) {
  const R = rng(seed);
  const n = Math.round(h * 2.4);
  for (let i = 0; i < n; i++) {
    const yy = Math.floor(y + R() * h);
    const x0 = x + R() * w;
    const len = 12 + R() * w * 0.45;
    const lit = R() < 0.42;
    ctx.fillStyle = lit
      ? `rgba(255,240,205,${(0.025 + R() * 0.05) * k})`
      : `rgba(0,0,0,${(0.035 + R() * 0.06) * k})`;
    ctx.fillRect(x0, yy, Math.min(len, x + w - x0), 1);
  }
  const dots = Math.round(w * h / 240);
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = R() < 0.25 ? `rgba(255,246,220,${0.07 * k})` : `rgba(0,0,0,${0.09 * k})`;
    ctx.fillRect(x + R() * w, y + R() * h, 1, 1);
  }
}

/** М'які темні плями патини. Викликати всередині clip. */
function grime(ctx, x, y, w, h, seed, n = 7, a = 0.1) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const cx = x + R() * w, cy = y + R() * h, r = 18 + R() * 60;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(34,24,8,${a * (0.5 + R())})`);
    g.addColorStop(1, 'rgba(34,24,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

/** Дрібні подряпини від роботи. Викликати всередині clip. */
function scratches(ctx, x, y, w, h, seed, n = 18) {
  const R = rng(seed);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < n; i++) {
    const sx = x + R() * w, sy = y + R() * h;
    const len = 5 + R() * 24, ang = (R() - 0.5) * 0.9;
    ctx.strokeStyle = R() < 0.5 ? 'rgba(255,244,215,0.11)' : 'rgba(0,0,0,0.13)';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    ctx.stroke();
  }
}

/** Гвинт з прямим шліцом, утоплений у метал. */
function screw(ctx, x, y, r, ang = 0.6, steel = false) {
  ctx.beginPath();
  ctx.arc(x, y + 0.4, r + 1.5, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
  if (steel) { g.addColorStop(0, '#eef1f6'); g.addColorStop(0.5, '#8b919c'); g.addColorStop(1, '#383c44'); }
  else       { g.addColorStop(0, '#f6e1a4'); g.addColorStop(0.5, '#a88445'); g.addColorStop(1, '#473414'); }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(-r * 0.86, -0.9, r * 1.72, 1.8);
  ctx.fillStyle = 'rgba(255,240,200,0.28)';
  ctx.fillRect(-r * 0.86, 0.9, r * 1.72, 0.6);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** Напівкругла заклепка. */
function rivet(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, 0.2, x, y, r);
  g.addColorStop(0, '#f4f6fa');
  g.addColorStop(0.55, '#8d939e');
  g.addColorStop(1, '#2e3238');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

export class LockRenderer {
  constructor(canvas) {
    // Crisp on HiDPI screens: the bitmap is devicePixelRatio× larger, all
    // drawing stays in logical 520×366 units (capped at 2× — memory).
    this._dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    this.canvas = canvas;
    this.W = CANVAS_W;
    this.H = CANVAS_H;
    canvas.width  = Math.round(this.W * this._dpr);
    canvas.height = Math.round(this.H * this._dpr);
    this.ctx = canvas.getContext('2d');
    this._t = 0;
    this._boltSlide = 0;
    this._gearAngle = 0;
    this._static = null;        // cached layer: wood, case, mark, bay, housing, keyway mouth, plate
    this._plugSprite = null;
    this._scaleSprite = null;
    this._scaleKey = -1;
    this._gearSprites = null;
    this._gearLayer = null;     // rendered wheels; re-rendered only when they turned
    this._gearKey = null;
    this._pick = null;          // { full, shadow, snapped, snappedShadow, hook }
    this._grads = new Map();    // memoized gradients for the main context (perf)
  }

  /**
   * Memoized gradient for the main context. Gradients are immutable once built,
   * and ours depend only on fixed geometry, so rebuilding them 60×/s is waste.
   */
  _grad(key, build) {
    if (!this._grads) return build();          // post-dispose safety
    let g = this._grads.get(key);
    if (!g) { g = build(); this._grads.set(key, g); }
    return g;
  }

  /** Offscreen canvas at device resolution; its context draws in logical units. */
  _canvas(w, h) {
    const d = this._dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * d);
    c.height = Math.ceil(h * d);
    c.getContext('2d').setTransform(d, 0, 0, d, 0, 0);
    return c;
  }

  /** drawImage of an offscreen canvas at its logical size. */
  _blit(ctx, c, x, y) {
    ctx.drawImage(c, x, y, c.width / this._dpr, c.height / this._dpr);
  }

  /**
   * Release cached offscreen canvases. Called when the app closes so that
   * repeatedly opening the mini-game doesn't retain several full-size layers
   * plus every cached sprite in memory.
   */
  dispose() {
    const all = [this._static, this._plugSprite, this._scaleSprite, this._gearLayer,
      ...Object.values(this._pick ?? {}), ...Object.values(this._gearSprites ?? {})];
    for (const c of all) if (c) { c.width = 0; c.height = 0; }
    this._static = this._plugSprite = this._scaleSprite = this._gearLayer = null;
    this._pick = null;
    this._gearSprites = null;
    this._grads?.clear();
    this._grads = null;
    this.canvas = null;
    this.ctx = null;
  }

  /** Render everything that never moves once, then just blit it each frame. */
  _buildStatic(state) {
    const c = this._canvas(this.W, this.H);
    const ctx = c.getContext('2d');
    this._drawWood(ctx);
    this._drawCase(ctx);
    this._drawMakerMark(ctx);
    this._drawGearBay(ctx);
    this._drawHousing(ctx, state.pins);
    this._drawKeywayMouth(ctx);
    this._drawPlate(ctx);
    this._static = c;
  }

  /**
   * state: { pins, pickX, pickIn, zone }   zone: 'green'|'red'|'neutral'
   * fx:    { deflect, vibrate, shake, particles, breakPiece, hitFlash, missFlash, success, press }
   */
  draw(state, fx = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    this._t += 1 / 60;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    const success = fx.success ?? 0;
    this._boltSlide += ((success > 0 ? 1 : 0) - this._boltSlide) * 0.08;

    const shx = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
    const shy = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;

    if (!this._static) this._buildStatic(state);

    // Base fill so screen-shake never reveals a transparent edge sliver
    ctx.fillStyle = '#0a0705';
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(shx, shy);

    this._blit(ctx, this._static, 0, 0);
    this._drawGears(ctx, state, fx, success);
    this._drawPlug(ctx, state, success);     // plug + bores + keyway; slides out on success
    this._drawPins(ctx, state, fx, success); // springs and solid pins
    this._drawWrench(ctx);                   // dark silhouette on the keyway floor
    this._drawPick(ctx, state, fx);
    if (fx.breakPiece) this._drawBreakPiece(ctx, fx.breakPiece);
    this._drawGuides(ctx, state);
    this._drawScale(ctx, state);

    ctx.restore();

    // Частинки та спалахи поверх усього
    if (fx.particles?.length) {
      for (const p of fx.particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.r * p.life), 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (fx.hitFlash && fx.hitFlash.t > 0) {
      const g = ctx.createRadialGradient(fx.hitFlash.x, SHEAR_Y, 2, fx.hitFlash.x, SHEAR_Y, 54);
      g.addColorStop(0, `rgba(255,215,120,${0.38 * fx.hitFlash.t})`);
      g.addColorStop(1, 'rgba(255,215,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(fx.hitFlash.x - 60, SHEAR_Y - 60, 120, 120);
    }

    if (fx.missFlash > 0) {
      const g = ctx.createRadialGradient(this.W / 2, this.H / 2, this.W * 0.25, this.W / 2, this.H / 2, this.W * 0.65);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(160,30,10,${0.4 * fx.missFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  // ── Дерево дверей / скрині ─────────────────────────────────────────────

  _drawWood(ctx) {
    const W = this.W, H = this.H;
    const R = rng(7);
    const plankW = 104;
    const tones = ['#3b2815', '#33220f', '#3f2b17', '#2f1f0f', '#392714', '#35240f'];
    for (let px = -8, i = 0; px < W; px += plankW, i++) {
      ctx.fillStyle = tones[i % tones.length];
      ctx.fillRect(px, 0, plankW, H);

      // Волокна — довгі хвилясті лінії, у кожної дошки свій малюнок
      for (let k = 0; k < 30; k++) {
        const gx = px + 3 + R() * (plankW - 6);
        const amp = 1.5 + R() * 5, ph = R() * TAU, freq = 0.006 + R() * 0.012;
        const lit = R() < 0.35;
        ctx.strokeStyle = lit ? `rgba(176,126,72,${0.05 + R() * 0.08})` : `rgba(8,4,0,${0.12 + R() * 0.16})`;
        ctx.lineWidth = 0.6 + R() * 1.2;
        ctx.beginPath();
        for (let y = -6; y <= H + 6; y += 7) {
          const x = gx + Math.sin(y * freq + ph) * amp;
          if (y === -6) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Опуклість дошки: краї темніші
      const eg = ctx.createLinearGradient(px, 0, px + plankW, 0);
      eg.addColorStop(0,    'rgba(0,0,0,0.30)');
      eg.addColorStop(0.14, 'rgba(0,0,0,0)');
      eg.addColorStop(0.4,  'rgba(255,220,170,0.03)');
      eg.addColorStop(0.86, 'rgba(0,0,0,0)');
      eg.addColorStop(1,    'rgba(0,0,0,0.36)');
      ctx.fillStyle = eg;
      ctx.fillRect(px, 0, plankW, H);

      // Шов між дошками
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(px + plankW - 2, 0, 2, H);
      ctx.fillStyle = 'rgba(196,146,88,0.10)';
      ctx.fillRect(px + plankW, 0, 1, H);
    }

    // Сучки — лише там, де дерево видно
    for (const [kx, ky, kr] of [[14, 322, 6], [506, 150, 5], [300, 358, 4.5]]) {
      for (let ring = kr * 2.6; ring > 0.8; ring -= 1.6) {
        ctx.strokeStyle = `rgba(10,5,0,${0.10 + (1 - ring / (kr * 2.6)) * 0.18})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(kx, ky, ring * 0.62, ring, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(12,6,0,0.55)';
      ctx.beginPath(); ctx.ellipse(kx, ky, kr * 0.5, kr * 0.8, 0, 0, TAU); ctx.fill();
    }

    // Глибина: віньєтка
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Латунний корпус ────────────────────────────────────────────────────

  _drawCase(ctx) {
    const { x, y, w, h, r } = CASE;

    // Корпус трохи виступає з деревини — тінь униз-праворуч
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.78)';
    ctx.shadowBlur = 14 * this._dpr;
    ctx.shadowOffsetX = 3 * this._dpr;
    ctx.shadowOffsetY = 5 * this._dpr;
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = '#1a120a';
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0,    '#a5874d');
    g.addColorStop(0.35, '#8a6d3b');
    g.addColorStop(0.75, '#6a522b');
    g.addColorStop(1,    '#4b3a1c');
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    brushed(ctx, x, y, w, h, 11, 1);
    grime(ctx, x, y, w, h, 12, 9, 0.12);
    scratches(ctx, x, y, w, h, 13, 26);
    // Широкий діагональний відблиск від джерела світла
    const s = ctx.createLinearGradient(x, y, x + w * 0.7, y + h);
    s.addColorStop(0,   'rgba(255,240,200,0.17)');
    s.addColorStop(0.3, 'rgba(255,240,200,0.03)');
    s.addColorStop(0.7, 'rgba(0,0,0,0)');
    s.addColorStop(1,   'rgba(0,0,0,0.18)');
    ctx.fillStyle = s;
    ctx.fillRect(x, y, w, h);
    // Затінення до країв (ambient occlusion)
    const v = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.35, x + w / 2, y + h / 2, w * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = v;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Фаска по периметру: згори-зліва світла, знизу-справа в тіні
    const b = ctx.createLinearGradient(x, y, x + w * 0.55, y + h);
    b.addColorStop(0,    'rgba(255,238,185,0.60)');
    b.addColorStop(0.48, 'rgba(255,238,185,0.10)');
    b.addColorStop(0.52, 'rgba(0,0,0,0.12)');
    b.addColorStop(1,    'rgba(0,0,0,0.60)');
    rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1.5);
    ctx.strokeStyle = b;
    ctx.lineWidth = 3;
    ctx.stroke();
    rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = 'rgba(10,6,2,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    rr(ctx, x + 3.5, y + 3.5, w - 7, h - 7, r - 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    screw(ctx, x + 12,     y + 12,    4.6,  0.5);
    screw(ctx, x + w - 12, y + 12,    4.6, -0.9);
    screw(ctx, x + 12,     y + h - 9, 4.6,  1.2);
    screw(ctx, x + w - 12, y + h - 9, 4.6,  0.1);
  }

  /**
   * Гравіювання: темна борозна зі світлою нижньою кромкою (її стінка ловить
   * світло згори). Так напис належить металу, а не лежить поверх шаром UI.
   */
  _engrave(ctx, text, x, y, { align = 'left', size = 9, serif = false, spacing = 0, alpha = 1 } = {}) {
    ctx.save();
    ctx.font = serif
      ? `700 ${size}px Georgia, "Times New Roman", serif`
      : `700 ${size}px "Segoe UI", ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = `rgba(255,238,190,${0.34 * alpha})`;
    ctx.fillText(text, x, y + 1);
    ctx.fillStyle = `rgba(34,22,6,${0.82 * alpha})`;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** Engraved line (groove + lit lower edge). */
  _engraveLine(ctx, x0, y, x1) {
    ctx.fillStyle = 'rgba(34,22,6,0.7)';
    ctx.fillRect(x0, y, x1 - x0, 1);
    ctx.fillStyle = 'rgba(255,238,190,0.26)';
    ctx.fillRect(x0, y + 1, x1 - x0, 1);
  }

  /** Клеймо майстра на вільній латуні ліворуч від вікна механізму. */
  _drawMakerMark(ctx) {
    const x = CASE.x + 26, y = 46;
    this._engrave(ctx, 'AETHERLOCK', x, y, { size: 17, serif: true, spacing: 3.2 });
    this._engraveLine(ctx, x, y + 7, x + 88);
    // ромбик-розділювач
    ctx.save();
    ctx.translate(x + 95, y + 7.5);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(255,238,190,0.28)'; ctx.fillRect(-2, -1, 4, 4);
    ctx.fillStyle = 'rgba(34,22,6,0.75)';     ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
    this._engraveLine(ctx, x + 102, y + 7, x + 190);
    this._engrave(ctx, 'SEVEN-PIN  ·  WARDED CORE', x + 1, y + 21, { size: 8, spacing: 1.6 });
  }

  // ── Вікно механізму ────────────────────────────────────────────────────

  _drawGearBay(ctx) {
    const { x, y, w, h } = GEARBAY;
    const r = 7;
    rr(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#090705');
    g.addColorStop(1, '#16120c');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    brushed(ctx, x, y, w, h, 21, 0.45);
    ctx.restore();

    // Фаска вирізу: верх і лівий бік дивляться вглиб (тінь), низ і правий — на світло
    const ch = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    ch.addColorStop(0,    'rgba(0,0,0,0.8)');
    ch.addColorStop(0.5,  'rgba(0,0,0,0.35)');
    ch.addColorStop(0.52, 'rgba(255,232,170,0.16)');
    ch.addColorStop(1,    'rgba(255,232,170,0.5)');
    rr(ctx, x - 1, y - 1, w + 2, h + 2, r + 1);
    ctx.strokeStyle = ch;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** Four meshed wheels, larger than the window so only parts of them show. */
  _gearTrain() {
    const m = 4.4;                                      // спільний модуль → однакові зубці
    const chain = [
      { N: 24, tone: 'brass' },
      { N: 12, tone: 'steel', th: -1.02 },              // піньйон угору-праворуч
      { N: 18, tone: 'brass', th: 0.30 },
      { N: 14, tone: 'steel', th: -0.62 },              // іде за правий верхній край
    ];
    for (const g of chain) g.r = m * g.N / 2;
    chain[0].x = 44; chain[0].y = 76;                   // велике колесо: у вікні лише корона
    for (let i = 1; i < chain.length; i++) {
      const p = chain[i - 1], c = chain[i];
      const d = p.r + c.r;                              // ділильні кола дотичні
      c.x = p.x + Math.cos(c.th) * d;
      c.y = p.y + Math.sin(c.th) * d;
    }
    return chain;
  }

  /**
   * Привід — лише РЕАЛЬНИЙ контакт з піном: крок на кожен зафіксований пін і
   * поштовх під час удару; на відкритті механізм провертається. Проїзд повз
   * пін (deflect) навмисно нічого не крутить.
   */
  _drawGears(ctx, state, fx, success) {
    let set = 0;
    for (const p of state.pins) if (p.set) set++;
    const press = fx.press && fx.press.t < 1 ? Math.sin(fx.press.t * Math.PI) : 0;
    const target = set * 0.34 + press * 0.12 + success * 1.4;
    this._gearAngle += (target - this._gearAngle) * 0.14;

    const key = Math.round(this._gearAngle * 2000);
    if (!this._gearLayer || key !== this._gearKey) {
      this._renderGearLayer(this._gearAngle);
      this._gearKey = key;
    }
    const gb = GEARBAY;
    ctx.save();
    rr(ctx, gb.x, gb.y, gb.w, gb.h, 7);
    ctx.clip();
    this._blit(ctx, this._gearLayer, gb.x, gb.y);
    ctx.restore();
  }

  _renderGearLayer(a1) {
    const gb = GEARBAY;
    if (!this._gearLayer) this._gearLayer = this._canvas(gb.w, gb.h);
    const g = this._gearLayer.getContext('2d');
    g.clearRect(0, 0, gb.w, gb.h);

    const chain = this._gearTrain();
    chain[0].a = a1;
    for (let i = 1; i < chain.length; i++) {
      chain[i].a = meshAngle(chain[i - 1].a, chain[i - 1].N, chain[i].N, chain[i].th);
    }

    // Колеса з тінню на задню стінку
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 5 * this._dpr;
    g.shadowOffsetX = 2 * this._dpr;
    g.shadowOffsetY = 3 * this._dpr;
    for (const c of chain) {
      const spr = this._gearSprite(c.r, c.N, c.tone);
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.a);
      const half = spr.width / this._dpr / 2;
      this._blit(g, spr, -half, -half);
      g.restore();
    }
    g.restore();

    // Нерухоме світло: при повороті блік лишається згори-зліва, як і має бути
    g.save();
    g.globalCompositeOperation = 'source-atop';
    for (const c of chain) {
      const R = c.r + 4;
      const lg = g.createRadialGradient(c.x - R * 0.45, c.y - R * 0.55, R * 0.05, c.x, c.y, R * 1.25);
      lg.addColorStop(0,    'rgba(255,244,210,0.34)');
      lg.addColorStop(0.42, 'rgba(255,244,210,0.02)');
      lg.addColorStop(0.75, 'rgba(0,0,0,0.22)');
      lg.addColorStop(1,    'rgba(0,0,0,0.45)');
      g.beginPath();
      g.arc(c.x, c.y, R, 0, TAU);
      g.fillStyle = lg;
      g.fill();
    }
    g.restore();

    // Край вирізу затуляє колеса згори й зліва
    const t = g.createLinearGradient(0, 0, 0, 12);
    t.addColorStop(0, 'rgba(0,0,0,0.75)');
    t.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = t;
    g.fillRect(0, 0, gb.w, 12);
    const l = g.createLinearGradient(0, 0, 9, 0);
    l.addColorStop(0, 'rgba(0,0,0,0.6)');
    l.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = l;
    g.fillRect(0, 0, 9, gb.h);
  }

  /** A gear, textured but unlit (light is applied per frame so it never rotates). */
  _gearSprite(r, teeth, tone) {
    this._gearSprites ??= {};
    const key = `${r}|${teeth}|${tone}`;
    if (this._gearSprites[key]) return this._gearSprites[key];

    // r — ДІЛИЛЬНИЙ радіус. Головка вкорочена (0.78m), ніжка 1.25m; тіло по
    // колу западин, інакше зуб сусіда впирався б у суцільний диск.
    const mod   = 2 * r / teeth;
    const tipR  = r + mod * 0.78;
    const rootR = Math.max(2, r - 1.25 * mod);
    const toothW = (TAU * r / teeth) * 0.30;   // трапеція, тож потрібен боковий зазор
    const C = tone === 'steel'
      ? { face: '#8e949e', deep: '#4b5058', ring: '#a7adb7', hub: '#b9bec8' }
      : { face: '#b28b45', deep: '#5e4520', ring: '#caa35a', hub: '#d8b56a' };

    const size = Math.ceil(tipR * 2 + 4);
    const c = this._canvas(size, size);
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);

    // Силует: диск по западинах + зубці
    g.beginPath();
    g.arc(0, 0, rootR + 0.5, 0, TAU);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU;
      const cs = Math.cos(a), sn = Math.sin(a);
      const pt = (px, py) => [px * cs - py * sn, px * sn + py * cs];
      const p1 = pt(-toothW / 2, -rootR), p2 = pt(-toothW / 2 + toothW * 0.22, -tipR);
      const p3 = pt(toothW / 2 - toothW * 0.22, -tipR), p4 = pt(toothW / 2, -rootR);
      g.moveTo(...p1); g.lineTo(...p2); g.lineTo(...p3); g.lineTo(...p4); g.closePath();
    }
    g.fillStyle = C.face;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 0.8;
    g.stroke();

    // Обід, маточина і спиці; між спицями — наскрізні вікна
    const rimIn = rootR * 0.74, hubR = rootR * 0.34;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const spokes = rootR > 26 ? 5 : 4, sw = Math.max(2.4, rootR * 0.09);
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU, a1 = ((k + 1) / spokes) * TAU;
      g.beginPath();
      g.arc(0, 0, rimIn, a0 + sw / rimIn, a1 - sw / rimIn);
      g.arc(0, 0, hubR + 2, a1 - sw / (hubR + 2), a0 + sw / (hubR + 2), true);
      g.closePath();
      g.fill();
    }
    g.restore();
    // кромки вікон
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1;
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU, a1 = ((k + 1) / spokes) * TAU;
      g.beginPath();
      g.arc(0, 0, rimIn, a0 + sw / rimIn, a1 - sw / rimIn);
      g.arc(0, 0, hubR + 2, a1 - sw / (hubR + 2), a0 + sw / (hubR + 2), true);
      g.closePath();
      g.stroke();
    }

    // Проточка на обіді
    g.beginPath(); g.arc(0, 0, rootR - 1.5, 0, TAU);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.arc(0, 0, rimIn + 1.5, 0, TAU);
    g.strokeStyle = C.ring; g.globalAlpha = 0.35; g.stroke(); g.globalAlpha = 1;

    // Концентричні сліди різця
    for (let rad = hubR + 4; rad < rootR; rad += 3.2) {
      g.beginPath(); g.arc(0, 0, rad, 0, TAU);
      g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1; g.stroke();
    }

    // Маточина, вісь зі шліцом
    const hg = g.createRadialGradient(-hubR * 0.3, -hubR * 0.3, 0.5, 0, 0, hubR);
    hg.addColorStop(0, C.hub);
    hg.addColorStop(1, C.deep);
    g.beginPath(); g.arc(0, 0, hubR, 0, TAU);
    g.fillStyle = hg; g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
    g.beginPath(); g.arc(0, 0, hubR * 0.42, 0, TAU);
    g.fillStyle = '#26282d'; g.fill();
    g.fillStyle = 'rgba(0,0,0,0.8)';
    g.fillRect(-hubR * 0.4, -0.8, hubR * 0.8, 1.6);

    this._gearSprites[key] = c;
    return c;
  }

  // ── Блок камер ─────────────────────────────────────────────────────────

  _drawHousing(ctx, pins) {
    const { x, y, w, h } = HOUSE;

    // Площина розрізу: трохи світліша, тонко проточена латунь
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0,   '#a08146');
    g.addColorStop(0.5, '#866a39');
    g.addColorStop(1,   '#5d4723');
    rr(ctx, x, y, w, h, 4);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    rr(ctx, x, y, w, h, 4);
    ctx.clip();
    for (let yy = y + 1; yy < y + h; yy += 2) {
      ctx.fillStyle = (yy % 4 === 1) ? 'rgba(0,0,0,0.05)' : 'rgba(255,240,200,0.035)';
      ctx.fillRect(x, yy, w, 1);
    }
    brushed(ctx, x, y, w, h, 31, 0.55);
    grime(ctx, x, y, w, h, 32, 4, 0.08);
    ctx.restore();

    // Шов між розрізом і кришкою корпуса
    rr(ctx, x - 1, y - 1, w + 2, h + 2, 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.62)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,236,180,0.2)';
    ctx.fillRect(x + 4, y + 0.5, w - 8, 1);

    // Сталева планка-кришка над камерами
    const cy = y + 1;
    const capL = x + 22, capW = w - 44;
    const cg = ctx.createLinearGradient(0, cy, 0, cy + CAP_H);
    cg.addColorStop(0,    '#d3d8e0');
    cg.addColorStop(0.45, '#838993');
    cg.addColorStop(1,    '#3b3f47');
    ctx.fillStyle = cg;
    ctx.fillRect(capL, cy, capW, CAP_H);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(capL + 0.5, cy + 0.5, capW - 1, CAP_H - 1);
    for (const p of pins) rivet(ctx, TRACK_X + p.x, cy + CAP_H / 2, 2.1);
    rivet(ctx, capL + 6, cy + CAP_H / 2, 1.8);
    rivet(ctx, capL + capW - 6, cy + CAP_H / 2, 1.8);

    for (const p of pins) this._drawChamber(ctx, TRACK_X + p.x);

    screw(ctx, x + 14,     y + h / 2 + 6, 4.2,  0.3);
    screw(ctx, x + w - 14, y + h / 2 + 6, 4.2, -0.6);
  }

  /** A drilled bore: far wall faintly lit on the right, deep shadow on the left and under the cap. */
  _drawChamber(ctx, cx) {
    const L = cx - CHAMBER_W / 2;
    const top = HOUSE.y + CAP_H + 1;
    const h = SHEAR_Y - top;
    ctx.fillStyle = '#0b0906';
    ctx.fillRect(L, top, CHAMBER_W, h);
    const g = ctx.createLinearGradient(L, 0, L + CHAMBER_W, 0);
    g.addColorStop(0,    'rgba(0,0,0,0.9)');
    g.addColorStop(0.3,  'rgba(0,0,0,0.12)');
    g.addColorStop(0.72, 'rgba(255,205,130,0.08)');
    g.addColorStop(0.9,  'rgba(255,205,130,0.03)');
    g.addColorStop(1,    'rgba(0,0,0,0.8)');
    ctx.fillStyle = g;
    ctx.fillRect(L, top, CHAMBER_W, h);
    const t = ctx.createLinearGradient(0, top, 0, top + 10);
    t.addColorStop(0, 'rgba(0,0,0,0.85)');
    t.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = t;
    ctx.fillRect(L, top, CHAMBER_W, 10);
    // кромки отвору на площині розрізу
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(L - 1, top, 1, h);
    ctx.fillStyle = 'rgba(255,232,170,0.24)';
    ctx.fillRect(L + CHAMBER_W, top, 1, h);
  }

  // ── Паз ключа ──────────────────────────────────────────────────────────

  /** Back wall of the keyway slot between x and x+w (cool dark steel, two warding grooves). */
  _keywayWall(ctx, x, w) {
    const top = BORE_BOT, bot = KEYWAY_BOT, h = bot - top;
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0,    '#040506');
    g.addColorStop(0.18, '#0e1014');
    g.addColorStop(0.55, '#181b21');
    g.addColorStop(0.85, '#101216');
    g.addColorStop(1,    '#08090b');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, w, h);
    // Варди — поздовжні ребра профілю паза
    for (const f of [0.40, 0.70]) {
      const yy = Math.round(top + h * f);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, yy - 1, w, 2);
      ctx.fillStyle = 'rgba(165,180,205,0.10)';
      ctx.fillRect(x, yy + 1, w, 1);
    }
    const o = ctx.createLinearGradient(0, top, 0, top + 9);
    o.addColorStop(0, 'rgba(0,0,0,0.85)');
    o.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = o;
    ctx.fillRect(x, top, w, 9);
    ctx.fillStyle = 'rgba(255,220,160,0.22)';
    ctx.fillRect(x, bot - 1, w, 1);
  }

  /** Where the keyway leaves the case on the left: the slot cut through the case wall. */
  _drawKeywayMouth(ctx) {
    const x = CASE.x - 1, w = HOUSE.x - CASE.x + 3;
    this._keywayWall(ctx, x, w);
    // фаски гирла
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, BORE_BOT - 3, w, 3);
    ctx.fillStyle = 'rgba(255,232,170,0.30)';
    ctx.fillRect(x, KEYWAY_BOT, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, KEYWAY_BOT + 2, w, 1);
  }

  // ── Плаг ───────────────────────────────────────────────────────────────

  _drawPlug(ctx, state, success) {
    const x = HOUSE.x, w = HOUSE.w;
    const top = SHEAR_Y, bot = PLUG_BOT;
    const dx = this._boltSlide * 58;     // на відкритті плаг виїжджає праворуч

    // Порожнина позаду плага — видно (і вона тепло світиться), коли він виїжджає
    ctx.fillStyle = '#070503';
    ctx.fillRect(x - 1, top, w + 2, bot - top);
    if (success > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cav = ctx.createLinearGradient(0, top, 0, bot);
      cav.addColorStop(0, `rgba(255,200,90,${0.5 * success})`);
      cav.addColorStop(1, `rgba(255,150,40,${0.2 * success})`);
      ctx.fillStyle = cav;
      ctx.fillRect(x - 1, top, w + 2, bot - top);
      ctx.restore();
    }

    if (!this._plugSprite) this._buildPlugSprite(state);
    ctx.save();
    ctx.beginPath();
    ctx.rect(CASE.x + 2, top - 2, CASE.w - 4, bot - top + 4);
    ctx.clip();
    this._blit(ctx, this._plugSprite, dx, 0);
    ctx.restore();
  }

  /** Бронзовий плаг: отвори під носи пінів, паз ключа з вардами, нижній бортик. */
  _buildPlugSprite(state) {
    const x = HOUSE.x, w = HOUSE.w;
    const top = SHEAR_Y, boreB = BORE_BOT, keyB = KEYWAY_BOT, bot = PLUG_BOT;
    const c = this._canvas(this.W, this.H);
    const ctx = c.getContext('2d');

    // Трохи тепліший тон, ніж у корпуса, — плаг читається окремою деталлю
    const pg = ctx.createLinearGradient(0, top, 0, bot);
    pg.addColorStop(0,   '#94703c');
    pg.addColorStop(0.4, '#735429');
    pg.addColorStop(1,   '#4a3517');
    ctx.fillStyle = pg;
    ctx.fillRect(x, top, w, bot - top);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, top, w, bot - top); ctx.clip();
    brushed(ctx, x, top, w, bot - top, 41, 0.9);
    const refl = ctx.createLinearGradient(0, top, 0, boreB);
    refl.addColorStop(0,   'rgba(255,244,210,0.16)');
    refl.addColorStop(0.5, 'rgba(255,240,200,0.02)');
    refl.addColorStop(1,   'rgba(0,0,0,0.10)');
    ctx.fillStyle = refl;
    ctx.fillRect(x, top, w, boreB - top);
    ctx.restore();

    // Лінія зрізу: тонкий зазор між корпусом і плагом (без жодного світіння)
    ctx.fillStyle = 'rgba(12,8,3,0.95)';
    ctx.fillRect(x, top - 0.5, w, 1.5);
    ctx.fillStyle = 'rgba(255,236,176,0.26)';
    ctx.fillRect(x, top + 1, w, 1);

    // Отвори плага під ноги пінів
    for (const pin of state.pins) {
      const hL = TRACK_X + pin.x - CHAMBER_W / 2;
      const hg = ctx.createLinearGradient(hL, 0, hL + CHAMBER_W, 0);
      hg.addColorStop(0,    'rgba(0,0,0,0.92)');
      hg.addColorStop(0.3,  'rgba(10,7,3,0.96)');
      hg.addColorStop(0.75, 'rgba(34,24,10,0.96)');
      hg.addColorStop(1,    'rgba(0,0,0,0.9)');
      ctx.fillStyle = hg;
      ctx.fillRect(hL, top + 1, CHAMBER_W, boreB - top - 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(hL - 1, top + 1, 1, boreB - top - 1);
      ctx.fillStyle = 'rgba(255,232,170,0.2)';
      ctx.fillRect(hL + CHAMBER_W, top + 1, 1, boreB - top - 1);
    }

    this._keywayWall(ctx, x, w);

    // Нижній бортик плага
    const bg = ctx.createLinearGradient(0, keyB, 0, bot);
    bg.addColorStop(0, '#8a6836');
    bg.addColorStop(1, '#3d2c12');
    ctx.fillStyle = bg;
    ctx.fillRect(x, keyB, w, bot - keyB);
    ctx.fillStyle = 'rgba(255,232,170,0.3)';
    ctx.fillRect(x, keyB, w, 1);
    ctx.fillStyle = 'rgba(12,8,3,0.85)';
    ctx.fillRect(x, bot - 1, w, 1);

    // Правий торець
    ctx.fillStyle = 'rgba(12,8,3,0.8)';
    ctx.fillRect(x + w - 2, top, 2, bot - top);

    this._plugSprite = c;
  }

  // ── Піни: СУЦІЛЬНІ латунні циліндри ────────────────────────────────────
  // Невстановлений пін висить, опустившись у заглиблення плага (блокує зріз).
  // Встановлений — повністю піднятий у корпус, вище лінії зрізу, тож плаг
  // при відкритті вільно ковзає ПІД пінами, не зачіпаючи їх.

  _drawPins(ctx, state, fx, success) {
    const press = fx.press;
    const SET_RISE = PIN_PROTRUDE + 2;
    const chTop = HOUSE.y + CAP_H + 1;

    for (const pin of state.pins) {
      const px = TRACK_X + pin.x;

      // Хід піна: 0 у спокої, SET_RISE коли встановлений; press = снап / відскок
      let raise;
      if (pin.set) {
        raise = SET_RISE;
        if (press && press.pinIndex === pin.index && press.hit && press.t < 1) {
          const p = press.t, c1 = 1.70158, c3 = c1 + 1;          // easeOutBack
          raise = SET_RISE * (1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2));
        }
      } else {
        raise = 0;
        if (press && press.pinIndex === pin.index && !press.hit && press.t < 1) {
          raise = Math.sin(press.t * Math.PI) * 10;
        }
      }
      const felt = !pin.set && raise > 1.5;

      const noseY  = SHEAR_Y - 1 + PIN_PROTRUDE - raise;
      const pinTop = noseY - PIN_H;
      this._drawSpring(ctx, px, chTop + 1, pinTop - 1);
      this._drawPin(ctx, px - PIN_W / 2, pinTop, pin.set ? MAT.gold : (felt ? MAT.brassL : MAT.brass));
    }
  }

  /**
   * Steel compression spring as a real helix: back half-turns darker, front
   * half-turns lit — reads as a coil, not a zigzag.
   */
  _drawSpring(ctx, cx, top, bot) {
    const len = bot - top;
    if (len < 3) return;
    const coils = Math.max(3, Math.round(len / 5.5));
    const pitch = len / coils;
    const rx = PIN_W * 0.4;
    const ey = Math.min(2.6, pitch * 0.42);
    const pt = t => [cx + rx * Math.cos(t), Math.min(bot, Math.max(top, top + pitch * t / TAU + ey * Math.sin(t)))];
    const halfTurns = (front) => {
      ctx.beginPath();
      for (let k = 0; k < coils; k++) {
        const t0 = k * TAU + (front ? 0 : Math.PI);
        for (let s = 0; s <= 8; s++) {
          const [x, y] = pt(t0 + (Math.PI * s) / 8);
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    halfTurns(false);
    ctx.strokeStyle = '#2c2f35'; ctx.lineWidth = 1.8; ctx.stroke();
    halfTurns(true);
    ctx.strokeStyle = '#3b3f46'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.strokeStyle = '#9aa1ac'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.6; ctx.stroke();
  }

  /** A solid cylindrical pin with a chamfered top and a rounded (bullet) nose. */
  _drawPin(ctx, x, top, m) {
    const w = PIN_W, h = PIN_H, r = 2.2;
    const bodyBot = top + h - NOSE_H;
    ctx.beginPath();
    ctx.moveTo(x, top + r);
    ctx.quadraticCurveTo(x, top, x + r, top);
    ctx.lineTo(x + w - r, top);
    ctx.quadraticCurveTo(x + w, top, x + w, top + r);
    ctx.lineTo(x + w, bodyBot);
    ctx.bezierCurveTo(x + w, bodyBot + NOSE_H * 0.6, x + w * 0.66, top + h, x + w / 2, top + h);
    ctx.bezierCurveTo(x + w * 0.34, top + h, x, bodyBot + NOSE_H * 0.6, x, bodyBot);
    ctx.closePath();
    // Memoized: pins sit at fixed x, so there are only a handful of unique fills.
    ctx.fillStyle = this._grad(`cyl${x}|${m.mid}`, () => cyl(ctx, x, w, m));
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Фаска торця
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(x + 2, top + 0.8, w - 4, 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 1.5, top + 3, w - 3, 0.8);
    // Спекуляр уздовж циліндра
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x + w * 0.22, top + 3.5, 1.4, h - NOSE_H - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x + w * 0.86, top + 3.5, 1, h - NOSE_H - 3);
    // Відблиск на носі
    ctx.beginPath();
    ctx.ellipse(x + w * 0.36, bodyBot + NOSE_H * 0.35, 2.2, 1.3, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
  }

  // ── Натяжний ключ ──────────────────────────────────────────────────────
  // Статична темна текстура на дні паза (як у Скайрімі) — нічого не грає.

  _drawWrench(ctx) {
    const wy = KEYWAY_BOT - 7;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this._grad('wrench', () => {
      const g = ctx.createLinearGradient(0, wy - 4, 0, wy + 4);
      g.addColorStop(0, '#454850');
      g.addColorStop(0.5, '#25272c');
      g.addColorStop(1, '#101114');
      return g;
    });
    rr(ctx, -20, wy - 4, HOUSE.x + 78, 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(-20, wy - 3, HOUSE.x + 70, 1);
    ctx.restore();
  }

  // ── Відмичка ───────────────────────────────────────────────────────────
  // Жорсткий сталевий інструмент незмінної форми. Кут і довжина фіксовані,
  // хвіст завжди за лівим краєм екрана — всередину повністю не заходить.
  // Спрайт будується один раз; щокадру він лише зсувається.

  /** Profile of the pick in local coordinates (tip at 0,0). */
  _pickPath(g, snapped = false) {
    const A = PICK_AX, T = PICK_T;
    g.beginPath();
    if (snapped) {
      // гак відламано — рваний торець стрижня
      g.moveTo(-PICK_LEN, A - T);
      g.lineTo(-11, A - T);
      g.lineTo(-8.5, A - 1.2);
      g.lineTo(-10.5, A + 0.6);
      g.lineTo(-8, A + T);
      g.lineTo(-PICK_LEN, A + T);
      g.closePath();
      return;
    }
    g.moveTo(-PICK_LEN, A - T);
    g.lineTo(-17, A - T);                                   // верхня кромка стрижня
    g.quadraticCurveTo(-6.4, A - T, -6.4, A - 14);          // галтель біля основи гака
    g.bezierCurveTo(-6.4, 17, -5.8, 7, -3.8, 2.4);          // спинка гака
    g.quadraticCurveTo(-1.6, -1.1, 1.2, -0.5);              // заокруглена вершина
    g.quadraticCurveTo(2.9, 0.2, 2.8, 3.4);
    g.lineTo(2.3, A - 6);                                   // робоча грань гака
    g.quadraticCurveTo(2.1, A + T, -8, A + T);              // п'ята
    g.lineTo(-PICK_LEN, A + T);                             // нижня кромка стрижня
    g.closePath();
  }

  /** Paint polished steel into the pick profile (called with the rotation applied). */
  _paintPick(g, snapped) {
    const A = PICK_AX, T = PICK_T;
    this._pickPath(g, snapped);
    g.fillStyle = '#8c939e';
    g.fill();

    g.save();
    this._pickPath(g, snapped);
    g.clip();
    // Стрижень: пласка сталь з блиском у верхній третині
    const sg = g.createLinearGradient(0, A - T, 0, A + T);
    sg.addColorStop(0,    '#cdd3dc');
    sg.addColorStop(0.3,  '#9ea5b0');
    sg.addColorStop(0.7,  '#646b76');
    sg.addColorStop(1,    '#33373f');
    g.fillStyle = sg;
    g.fillRect(-PICK_LEN, A - T - 1, PICK_LEN + 12, T * 2 + 2);
    // Гак: широкий м'який блік на пласкій грані
    const hg = g.createLinearGradient(-6, 0, 3, 0);
    hg.addColorStop(0,   '#747b86');
    hg.addColorStop(0.4, '#b3bac5');
    hg.addColorStop(1,   '#6c737e');
    g.fillStyle = hg;
    g.fillRect(-8, -2, 12, A - T - 3);
    const fade = g.createLinearGradient(0, A - T - 12, 0, A - T);
    fade.addColorStop(0, 'rgba(140,147,158,0)');
    fade.addColorStop(1, 'rgba(140,147,158,0.6)');
    g.fillStyle = fade;
    g.fillRect(-8, A - T - 12, 12, 12);
    // Поздовжня шліфовка
    const R = rng(5);
    for (let i = 0; i < 26; i++) {
      const yy = A - T + 0.5 + R() * (T * 2 - 1);
      const x0 = -PICK_LEN + R() * PICK_LEN, len = 30 + R() * 140;
      g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
      g.fillRect(x0, yy, len, 0.6);
    }
    // Фаски: світла кромка там, де нормаль дивиться на світло, темна — навпаки
    g.lineWidth = 1.4;
    g.translate(1.1, 1.1);
    this._pickPath(g, snapped);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.stroke();
    g.translate(-2.2, -2.2);
    this._pickPath(g, snapped);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();
    g.restore();

    // Відполірований кінчик
    if (!snapped) {
      const tg = g.createRadialGradient(-0.6, 2.2, 0, -0.6, 2.2, 4.5);
      tg.addColorStop(0, 'rgba(255,255,255,0.85)');
      tg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = tg;
      g.fillRect(-6, -3, 10, 10);
    }
    this._pickPath(g, snapped);
    g.strokeStyle = 'rgba(8,10,14,0.75)';
    g.lineWidth = 0.8;
    g.stroke();
  }

  _buildPickSprites() {
    const W = PICK_OX + 18, H = 84;
    const make = snapped => {
      const c = this._canvas(W, H);
      const g = c.getContext('2d');
      g.translate(PICK_OX, PICK_OY);
      g.rotate(PICK_ANG);
      this._paintPick(g, snapped);
      return c;
    };
    // М'яка тінь: силует, намальований далеко за полотном, лишає тут лише тінь
    const shadowOf = src => {
      const c = this._canvas(W, H);
      const g = c.getContext('2d');
      g.shadowColor = 'rgba(0,0,0,0.75)';
      g.shadowBlur = 4 * this._dpr;
      g.shadowOffsetX = 2000 * this._dpr;
      this._blit(g, src, -2000, 0);
      return c;
    };
    const full = make(false), snapped = make(true);
    // Відламаний гак — окремий маленький спрайт для уламка
    const hook = this._canvas(24, 44);
    const hg = hook.getContext('2d');
    hg.translate(12, 4);
    hg.save();
    hg.beginPath(); hg.rect(-9.5, -6, 20, PICK_AX + 4); hg.clip();
    this._paintPick(hg, false);
    hg.restore();
    this._pick = { full, snapped, shadow: shadowOf(full), snappedShadow: shadowOf(snapped), hook };
  }

  _drawPick(ctx, state, fx) {
    if (!this._pick) this._buildPickSprites();
    const tipX = TRACK_X + state.pickX;
    const deflect = (fx.deflect ?? 0) * 6;
    const jab = (fx.press && fx.press.t < 1) ? Math.sin(fx.press.t * Math.PI) * 9 : 0;
    const lift = deflect + jab;
    const moved = Math.abs(tipX - (this._lastTipX ?? tipX)) > 0.15;
    this._lastTipX = tipX;
    const tipBob = moved ? Math.sin(this._t * 34) * 0.8 : 0;

    const noseRest = SHEAR_Y - 1 + PIN_PROTRUDE;
    const cx0 = tipX;                               // вершина гака = точка контакту
    const cy0 = noseRest + 4 - lift + tipBob;
    const broken = !!fx.breakPiece;
    const spr = broken ? this._pick.snapped : this._pick.full;
    const shd = broken ? this._pick.snappedShadow : this._pick.shadow;
    const sx = cx0 - PICK_OX, sy = cy0 - PICK_OY;

    // Тінь лягає на задню стінку паза; поза корпусом — далі й м'якше, на дерево
    ctx.save();
    ctx.beginPath();
    ctx.rect(CASE.x, BORE_BOT, HOUSE.x + HOUSE.w - CASE.x, KEYWAY_BOT - BORE_BOT);
    ctx.clip();
    ctx.globalAlpha = 0.8;
    this._blit(ctx, shd, sx + 3, sy + 4);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CASE.x, this.H);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    this._blit(ctx, shd, sx + 7, sy + 10);
    ctx.restore();

    this._blit(ctx, spr, sx, sy);

    // Теплий відблиск контакту, коли гак реально тисне на пін
    if (lift > 0.5 && !broken) {
      const a = Math.min(1, lift / 8);
      const g = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, 7);
      g.addColorStop(0, `rgba(255,236,180,${0.75 * a})`);
      g.addColorStop(1, 'rgba(255,236,180,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx0 - 8, cy0 - 8, 16, 16);
    }
  }

  /** The snapped-off hook tumbling away. */
  _drawBreakPiece(ctx, p) {
    if (!this._pick) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    this._blit(ctx, this._pick.hook, -12, -20);
    ctx.restore();
  }

  // ── Прив'язка механізму до шкали ──────────────────────────────────────
  // Кожен пін з'єднаний тонкою лінією зі своєю зоною на шкалі, а позиція
  // відмички — вертикаллю до маркера.

  _drawGuides(ctx, state) {
    const { pins, pickX, zone } = state;
    const top = PLUG_BOT + 3;
    const bot = SCALE.y - 3;

    let target = null;
    for (const p of pins) if (!p.set && (!target || p.x < target.x)) target = p;

    ctx.save();
    ctx.lineWidth = 1;
    for (const pin of pins) {
      const x = TRACK_X + pin.x + 0.5;
      if (pin.set) {
        ctx.strokeStyle = 'rgba(214,176,90,0.22)';
        ctx.setLineDash(DASH_GUIDE);
      } else if (target && pin.index === target.index) {
        const pulse = 0.5 + 0.5 * Math.sin(this._t * 4);
        ctx.strokeStyle = `rgba(140,255,170,${0.3 + 0.25 * pulse})`;
        ctx.setLineDash(DASH_NONE);
      } else {
        ctx.strokeStyle = 'rgba(150,255,180,0.16)';
        ctx.setLineDash(DASH_GUIDE);
      }
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bot);
      ctx.stroke();
    }
    ctx.setLineDash(DASH_NONE);

    // Вертикаль від кінчика відмички до маркера
    const mx = TRACK_X + pickX + 0.5;
    ctx.strokeStyle = zone === 'red'   ? 'rgba(255,120,95,0.5)'
                    : zone === 'green' ? 'rgba(150,255,180,0.6)'
                    :                    'rgba(235,232,220,0.24)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(mx, KEYWAY_CY + 10);
    ctx.lineTo(mx, bot);
    ctx.stroke();
    ctx.restore();
  }

  // ── Лінійка шкали натягу ──────────────────────────────────────────────

  /** Brass rule mounted on the wood under the case: bezel, channel, label, legend. */
  _drawPlate(ctx) {
    const { x, y, w, h, r } = PLATE;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8 * this._dpr;
    ctx.shadowOffsetX = 2 * this._dpr;
    ctx.shadowOffsetY = 3 * this._dpr;
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = '#1a120a';
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0,   '#ab8c50');
    g.addColorStop(0.5, '#917340');
    g.addColorStop(1,   '#6c5429');
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    brushed(ctx, x, y, w, h, 51, 0.9);
    scratches(ctx, x, y, w, h, 52, 8);
    ctx.restore();
    const b = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    b.addColorStop(0,    'rgba(255,238,185,0.55)');
    b.addColorStop(0.45, 'rgba(255,238,185,0.08)');
    b.addColorStop(0.55, 'rgba(0,0,0,0.12)');
    b.addColorStop(1,    'rgba(0,0,0,0.55)');
    rr(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
    ctx.strokeStyle = b;
    ctx.lineWidth = 2;
    ctx.stroke();
    rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = 'rgba(10,6,2,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();

    screw(ctx, x + 11,     SCALE.y + SCALE.h / 2, 4,  0.7);
    screw(ctx, x + w - 11, SCALE.y + SCALE.h / 2, 4, -0.4);

    // Канавка під шкалу
    rr(ctx, SCALE_X0 - 3, SCALE.y - 3, SCALE_X1 - SCALE_X0 + 6, SCALE.h + 6, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    rr(ctx, SCALE_X0 - 3, SCALE.y - 3, SCALE_X1 - SCALE_X0 + 6, SCALE.h + 6, 6);
    const ch = ctx.createLinearGradient(0, SCALE.y - 3, 0, SCALE.y + SCALE.h + 3);
    ch.addColorStop(0, 'rgba(0,0,0,0.6)');
    ch.addColorStop(1, 'rgba(255,236,180,0.45)');
    ctx.strokeStyle = ch;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Підпис і легенда — гравіювання під шкалою
    const ly = SCALE.y + SCALE.h + 22;
    this._engrave(ctx, 'TENSION  GAUGE', SCALE_X0, ly, { size: 9, spacing: 2 });
    ctx.save();
    ctx.font = '700 8px "Segoe UI", ui-sans-serif, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    const items = [['RELEASE', ZONE.green], ['AVOID', ZONE.red]];
    const widths = items.map(([t]) => ctx.measureText(t).width);
    ctx.restore();
    let lx = SCALE_X1 - (widths[0] + widths[1] + 11 * 2 + 12);
    items.forEach(([label, col], i) => {
      rr(ctx, lx, ly - 7.5, 7, 7, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      rr(ctx, lx + 0.5, ly - 7, 6, 6, 1.2);
      ctx.fillStyle = col;
      ctx.fill();
      this._engrave(ctx, label, lx + 10, ly, { size: 8, spacing: 1 });
      lx += 10 + widths[i] + 13;
    });
  }

  /**
   * Enamel inlays of the gauge. Rebuilt only when a pin's set-state changes —
   * not 60×/s.
   */
  _buildScaleSprite(pins) {
    const y = SCALE.y, h = SCALE.h;
    const x0 = SCALE_X0, w = SCALE_X1 - SCALE_X0;
    const sx = gx => SCALE_X0 + gx;
    const half = HIT_ZONE / 2;
    const rad = 5;

    if (!this._scaleSprite) this._scaleSprite = this._canvas(this.W, this.H);
    const ctx = this._scaleSprite.getContext('2d');
    ctx.clearRect(0, 0, this.W, this.H);

    ctx.save();
    rr(ctx, x0, y, w, h, rad);
    ctx.clip();

    const base = ctx.createLinearGradient(0, y, 0, y + h);
    base.addColorStop(0,   '#15120e');
    base.addColorStop(0.5, '#221e17');
    base.addColorStop(1,   '#2b261d');
    ctx.fillStyle = base;
    ctx.fillRect(x0, y, w, h);
    // дрібні поділки по всій довжині
    for (let gx = 0; gx <= w; gx += 9) {
      const major = gx % 45 === 0;
      ctx.fillStyle = major ? 'rgba(214,190,140,0.30)' : 'rgba(214,190,140,0.14)';
      ctx.fillRect(x0 + gx, y + h - (major ? 7 : 4), 1, major ? 7 : 4);
    }

    const greenG = ctx.createLinearGradient(0, y, 0, y + h);
    greenG.addColorStop(0, ZONE.greenHi); greenG.addColorStop(0.45, ZONE.green); greenG.addColorStop(1, ZONE.greenLo);
    const redG = ctx.createLinearGradient(0, y, 0, y + h);
    redG.addColorStop(0, ZONE.redHi); redG.addColorStop(0.45, ZONE.red); redG.addColorStop(1, ZONE.redLo);
    const goldG = ctx.createLinearGradient(0, y, 0, y + h);
    goldG.addColorStop(0, 'rgba(255,226,150,0.85)'); goldG.addColorStop(1, 'rgba(170,124,48,0.75)');

    for (const pin of pins) {
      const c = sx(pin.x);
      if (pin.set) {
        // уже відкритий: тонка золота мітка, а не суцільний блок — інакше шкала
        // перетворюється на «клавіатуру» і цілі губляться серед виконаного
        ctx.fillStyle = goldG;
        ctx.fillRect(c - 1.5, y + 2, 3, h - 4);
        continue;
      }
      ctx.fillStyle = redG;
      ctx.fillRect(c - half - RED_W, y, RED_W, h);
      ctx.fillRect(c + half, y, RED_W, h);
      ctx.fillStyle = greenG;
      ctx.fillRect(c - half, y, HIT_ZONE, h);
      ctx.fillStyle = 'rgba(225,255,230,0.6)';     // центр цілі
      ctx.fillRect(c - 0.6, y + 3, 1.2, h - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';          // межі емалі
      ctx.fillRect(c - half - 0.5, y, 1, h);
      ctx.fillRect(c + half - 0.5, y, 1, h);
    }

    // Скло емалі: блиск зверху, тінь знизу
    const sheen = ctx.createLinearGradient(0, y, 0, y + h);
    sheen.addColorStop(0,    'rgba(255,255,255,0.22)');
    sheen.addColorStop(0.4,  'rgba(255,255,255,0.03)');
    sheen.addColorStop(0.55, 'rgba(0,0,0,0)');
    sheen.addColorStop(1,    'rgba(0,0,0,0.3)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0, y, w, h);
    // внутрішня тінь канавки
    const inner = ctx.createLinearGradient(0, y, 0, y + 5);
    inner.addColorStop(0, 'rgba(0,0,0,0.55)');
    inner.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = inner;
    ctx.fillRect(x0, y, w, 5);
    ctx.restore();

    rr(ctx, x0, y, w, h, rad);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  _drawScale(ctx, state) {
    const { pins, pickX, zone } = state;
    const y = SCALE.y, h = SCALE.h;
    const half = HIT_ZONE / 2;

    // Bitmask instead of map()+join(): the key only changes ~7 times a game.
    let key = 0;
    for (let i = 0; i < pins.length; i++) if (pins[i].set) key |= (1 << i);
    if (!this._scaleSprite || key !== this._scaleKey) {
      this._buildScaleSprite(pins);
      this._scaleKey = key;
    }
    this._blit(ctx, this._scaleSprite, 0, 0);

    // Легке мерехтіння наступної цілі
    let target = null;
    for (const p of pins) if (!p.set && (!target || p.x < target.x)) target = p;
    if (target) {
      const c = SCALE_X0 + target.x;
      const pulse = 0.5 + 0.5 * Math.sin(this._t * 4);
      ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.09 * pulse})`;
      ctx.fillRect(c - half, y, HIT_ZONE, h);
    }

    // ── Бігунок: сталевий візир, як на логарифмічній лінійці ──
    const mx = SCALE_X0 + pickX;
    const inGreen = zone === 'green', inRed = zone === 'red';
    if (inGreen || inRed) {
      const gl = ctx.createRadialGradient(mx, y + h / 2, 2, mx, y + h / 2, 22);
      gl.addColorStop(0, inGreen ? 'rgba(130,255,160,0.55)' : 'rgba(255,100,80,0.55)');
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(mx - 24, y - 12, 48, h + 24);
    }
    // волосина візира
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(mx - 1.5, y - 2, 3, h + 4);
    ctx.fillStyle = inRed ? '#ffb3a5' : inGreen ? '#d8ffe2' : '#f3f1ea';
    ctx.fillRect(mx - 0.75, y - 2, 1.5, h + 4);
    // голівки бігунка зверху і знизу
    for (const [hy, dir] of [[y - 3, -1], [y + h + 3, 1]]) {
      ctx.beginPath();
      ctx.moveTo(mx, hy);
      ctx.lineTo(mx - 5, hy + dir * 4);
      ctx.lineTo(mx - 5, hy + dir * 7);
      ctx.lineTo(mx + 5, hy + dir * 7);
      ctx.lineTo(mx + 5, hy + dir * 4);
      ctx.closePath();
      ctx.fillStyle = this._grad(`runner${dir}`, () => {
        const g = ctx.createLinearGradient(0, hy + dir * 7, 0, hy);
        g.addColorStop(dir < 0 ? 0 : 1, '#eef1f6');
        g.addColorStop(0.5, '#9aa0ab');
        g.addColorStop(dir < 0 ? 1 : 0, '#4a4e57');
        return g;
      });
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (inGreen || inRed) {
        ctx.fillStyle = inGreen ? 'rgba(120,255,150,0.8)' : 'rgba(255,110,90,0.8)';
        ctx.fillRect(mx - 3, hy + dir * 5.5 - 0.75, 6, 1.5);
      }
    }
  }

  // ── Фінальний оверлей ─────────────────────────────────────────────────

  drawEndOverlay(success) {
    const ctx = this.ctx;
    if (!ctx) return;
    const cx = this.W / 2, cy = this.H / 2;

    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, this.W * 0.7);
    g.addColorStop(0, success ? 'rgba(12,26,12,0.86)' : 'rgba(26,10,8,0.86)');
    g.addColorStop(1, success ? 'rgba(4,10,4,0.95)' : 'rgba(10,3,2,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    const font = 'Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.save();
    ctx.shadowColor = success ? 'rgba(120,255,140,0.55)' : 'rgba(255,80,60,0.55)';
    ctx.shadowBlur = 20 * this._dpr;
    ctx.fillStyle = success ? '#8be896' : '#e8604f';
    ctx.font = `700 36px ${font}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText(success ? 'Lock Picked' : 'Pick Broken', cx, cy - 12);
    ctx.restore();

    ctx.strokeStyle = success ? 'rgba(120,220,140,0.4)' : 'rgba(220,90,70,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 90, cy + 12); ctx.lineTo(cx + 90, cy + 12);
    ctx.stroke();

    ctx.fillStyle = 'rgba(224,214,186,0.7)';
    ctx.font = `italic 500 14px ${font}`;
    ctx.fillText(success ? 'The mechanism gives way' : 'The broken tip jams the lock', cx, cy + 32);
  }
}
