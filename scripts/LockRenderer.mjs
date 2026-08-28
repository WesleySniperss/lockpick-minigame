/**
 * LockRenderer.mjs — розріз замка з видимим механізмом (canvas 520×366).
 *
 * Композиція (зверху вниз):
 *   - латунна рама-накладка з заклепками
 *   - ніша механізму: зубчастий ряд, приводжений станом пінів
 *   - латунний блок з 7 камерами пінів: пружина → драйвер → ключовий пін
 *   - канал keyway, по якому ковзає відмичка
 *
 * Піни видно: невстановлені звисають у канал, встановлені (зокрема ті,
 * що вже відкриті на старті) — підняті до лінії зрізу і світяться золотом.
 * Розмір пінів фіксований; складність виражена швидкістю маркера.
 *
 * Знизу — інтерактивна ШКАЛА: зелені зони (цілі) під невідкритими пінами,
 * за кожною зеленою — червона (заборонена). Маркер їде по шкалі.
 */

import { TRACK_W, HIT_ZONE, RED_W } from './LockController.mjs';

const TAU = Math.PI * 2;

// Reused dash patterns — setLineDash([..]) inside a per-frame loop would
// allocate a fresh array for every pin, every frame.
const DASH_GUIDE = [2, 4];
const DASH_SHEAR = [6, 5];
const DASH_NONE  = [];

export const CANVAS_W = 520;
export const CANVAS_H = 366;

// ── Розкладка ──────────────────────────────────────────────────────────
// Латунний корпус замка, врізаний у деревину дверей/скрині (зріз збоку).
// Пропорції підпорядковані грі: камери пінів + лінія зрізу — головний елемент;
// декоративні шестерні стиснуто до вузької смуги, мертвий канал скорочено,
// шкала піднята ближче до механізму.
const CASE    = { x: 30, y: 14, w: 460, h: 266, r: 10 }; // корпус замка 14..280
const GEARBAY = { x: 296, y: 22, w: 176, h: 60 };         // компактний вузол праворуч
const HOUSE   = { x: 64, y: 88, w: 392, h: 86 };          // блок камер пінів 88..174
export const SHEAR_Y = HOUSE.y + HOUSE.h;                 // лінія зрізу = 174
const BORE_BOT   = SHEAR_Y + 34;                          // 208 — низ свердловин
const KEYWAY_BOT = SHEAR_Y + 88;                          // 262 — низ каналу
const PLUG_BOT   = SHEAR_Y + 96;                          // 270 — низ плага
export const KEYWAY_CY = SHEAR_Y + 44;                    // 218 — рівень відмички
export const TRACK_X = 80;                                // ігровий 0 → canvas x

const PIN_PROTRUDE = 46;    // наскільки суцільний пін опускається у заглиблення плага
const CHAMBER_W = 32;       // фіксована ширина камери піна
const PIN_W = 20;           // фіксована ширина самих пінів

// Нижня шкала
const SCALE = { y: 302, h: 30 };
const SCALE_X0 = TRACK_X;                   // лівий край шкали = ігровий 0
const SCALE_X1 = TRACK_X + TRACK_W;         // правий край шкали

// ── Матеріальна палітра (єдине джерело світла — верх-ліво) ────────────────
const COL = {
  woodHi: '#4a331c', wood: '#33230f', woodLo: '#1d1408',
  brassHi: '#caa862', brass: '#836a3c', brassLo: '#3c2e16',
  steelHi: '#dadde6', steel: '#818693', steelLo: '#32363d',
  cavity: '#08070a',
  green: '#33b257', greenHi: '#8bf3a6', greenLo: '#1c7d3c',
  red: '#c53a2b', redHi: '#ff7c66', redLo: '#7f2015',
  gold: '#ffcf6a',
};

// Cylindrical-metal colour sets: {edge, hi (specular), mid, lo (core shadow), rim (reflected light)}
const MAT = {
  steel:  { edge: '#2b2e36', hi: '#f0f2f8', mid: '#9aa0ac', lo: '#4a4e58', rim: '#c2c7d2' },
  brass:  { edge: '#3a2b0f', hi: '#f6df95', mid: '#c1902f', lo: '#6a4c17', rim: '#dcb75e' },
  brassL: { edge: '#4a3712', hi: '#ffe9a2', mid: '#d9a63c', lo: '#7e5c1c', rim: '#f0cd72' }, // worked/lit
  gold:   { edge: '#8a6416', hi: '#fff0b8', mid: '#ffce5c', lo: '#b78a26', rim: '#ffe08a' },
};

/**
 * Кут ВЕДЕНОГО колеса із зачеплення.
 *
 * Зубці спрайта при куті 0 дивляться вгору, тобто на −π/2 — саме цього
 * доданка бракувало раніше, через що зубці сходились «зуб у зуб».
 *
 * Виведення: нехай θ — напрям від центра 1 до центра 2.
 *   зуб колеса 1 дивиться на θ    ⟺  a1 = θ + π/2
 *   у колеса 2 в цю мить має бути западина з боку θ+π:
 *                                     a2 = θ + 3π/2 + π/N2
 * Разом з коченням без ковзання a2 = −(N1/N2)·a1 + const це дає:
 */
function meshAngle(a1, N1, N2, th) {
  return -(N1 / N2) * (a1 - th - Math.PI / 2) + th + 3 * Math.PI / 2 + Math.PI / N2;
}

/** Horizontal cylindrical-metal gradient across [x, x+w], lit from top-left. */
function cyl(ctx, x, w, m) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0.00, m.edge);
  g.addColorStop(0.26, m.hi);    // primary specular
  g.addColorStop(0.48, m.mid);
  g.addColorStop(0.72, m.lo);    // core shadow
  g.addColorStop(0.89, m.rim);   // reflected rim light
  g.addColorStop(1.00, m.edge);
  return g;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Шліфована латунь: горизонтальний штрих + нерівномірність і крап, щоб
 * поверхня читалась як метал, а не як залитий прямокутник.
 * Викликати всередині clip; малюється один раз у кешований шар.
 */
function brushed(ctx, x, y, w, h) {
  // базовий штрих
  for (let yy = Math.floor(y) + 1; yy < y + h; yy += 2) {
    ctx.fillStyle = (yy % 4 === 0) ? 'rgba(255,238,195,0.045)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(x, yy, w, 1);
  }
  // довгі нерівні волокна — слід від шліфувального круга
  for (let i = 0; i < Math.round(h * 1.1); i++) {
    const yy = y + ((i * 47) % Math.max(1, Math.floor(h)));
    const x0 = x + ((i * 131) % Math.max(1, Math.floor(w * 0.8)));
    const len = 18 + ((i * 29) % Math.max(1, Math.floor(w * 0.35)));
    ctx.fillStyle = (i % 3 === 0) ? 'rgba(255,244,210,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x0, yy, Math.min(len, x + w - x0), 1);
  }
  // крап
  for (let i = 0; i < Math.round(w * h / 260); i++) {
    const px = x + ((i * 191) % Math.max(1, Math.floor(w)));
    const py = y + ((i * 71) % Math.max(1, Math.floor(h)));
    ctx.fillStyle = (i % 5 === 0) ? 'rgba(255,246,220,0.09)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(px, py, 1.3, 1.3);
  }
}

export class LockRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this._t = 0;
    this._boltSlide = 0;
    this._gearAngle = 0;
    this._static = null;     // cached offscreen layer (background + plate + interior + housing)
    this._grads = new Map(); // memoized gradients for the main context (perf)
    this._scaleSprite = null;
    this._scaleKey = -1;
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

  /**
   * Release cached offscreen canvases. Called when the app closes so that
   * repeatedly opening the mini-game doesn't retain several full-size layers
   * plus every cached sprite in memory.
   */
  dispose() {
    for (const c of [this._static, this._plugSprite, this._scaleSprite]) {
      if (c) { c.width = 0; c.height = 0; }
    }
    if (this._gearSprites) {
      for (const k of Object.keys(this._gearSprites)) {
        const c = this._gearSprites[k];
        if (c) { c.width = 0; c.height = 0; }
      }
      this._gearSprites = null;
    }
    this._static = null;
    this._plugSprite = null;
    this._scaleSprite = null;
    this._grads?.clear();
    this._grads = null;
    this.canvas = null;
    this.ctx = null;
  }

  /** Render the unchanging brass shell once to an offscreen canvas, then just blit it each frame. */
  _buildStatic() {
    const c = document.createElement('canvas');
    c.width = this.W;
    c.height = this.H;
    const octx = c.getContext('2d');
    this._drawBackground(octx);
    this._drawCase(octx);
    this._drawPinHousing(octx);
    this._static = c;
  }

  /**
   * state: { pins, pickX, pickIn, zone }   zone: 'green'|'red'|'neutral'
   * fx:    { deflect, vibrate, shake, particles, breakPiece, hitFlash, missFlash, success, press }
   */
  draw(state, fx = {}) {
    const ctx = this.ctx;
    this._t += 1 / 60;

    const success = fx.success ?? 0;
    this._boltSlide += ((success > 0 ? 1 : 0) - this._boltSlide) * 0.08;



    const shx = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
    const shy = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;

    if (!this._static) this._buildStatic();

    // Base fill so screen-shake never reveals a transparent edge sliver
    ctx.fillStyle = '#050402';
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(shx, shy);

    ctx.drawImage(this._static, 0, 0);       // cached shell (wood + brass case + housing)
    this._drawMakerMark(ctx);
    this._drawGears(ctx, state, fx, success);
    this._drawPlug(ctx, state, success);     // plug strip + drilled chambers; slides out on success
    this._drawPins(ctx, state, fx, success); // pins on top, tips visible inside the chambers
    this._drawPickTool(ctx, state, fx);      // the lockpick + tension wrench in the keyway channel

    this._drawGuides(ctx, state);           // прив'язка пінів до зон шкали
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
      const g = ctx.createRadialGradient(fx.hitFlash.x, SHEAR_Y, 2, fx.hitFlash.x, SHEAR_Y, 60);
      g.addColorStop(0, `rgba(255,215,120,${0.5 * fx.hitFlash.t})`);
      g.addColorStop(1, 'rgba(255,215,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    if (fx.missFlash > 0) {
      const g = ctx.createRadialGradient(this.W / 2, this.H / 2, this.W * 0.25, this.W / 2, this.H / 2, this.W * 0.65);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(160,30,10,${0.4 * fx.missFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  // ── Фон ───────────────────────────────────────────────────────────────

  _drawBackground(ctx) {
    // The timber of the door / chest, seen in cross-section — fills everything
    const g = ctx.createLinearGradient(0, 0, this.W, 0);
    g.addColorStop(0,   '#33220f');
    g.addColorStop(0.5, '#402b15');
    g.addColorStop(1,   '#2b1c0c');
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, this.W + 24, this.H + 24);

    // Vertical plank seams
    const plankW = 104;
    for (let px = plankW; px < this.W; px += plankW) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(px, -12); ctx.lineTo(px, this.H + 12); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,110,65,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 2, -12); ctx.lineTo(px + 2, this.H + 12); ctx.stroke();
    }

    // Long wood grain
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#8a6638';
    ctx.lineWidth = 1;
    for (let i = 0; i < 44; i++) {
      const gx = (i * 53) % this.W + (i * 7) % 13;
      ctx.beginPath();
      ctx.moveTo(gx, -12);
      ctx.bezierCurveTo(gx + 7, this.H * 0.34, gx - 7, this.H * 0.66, gx + 3, this.H + 12);
      ctx.stroke();
    }
    ctx.restore();

    // Depth vignette
    const v = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.32, this.W / 2, this.H / 2, this.W * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  // ── Brass lock case (set into the timber) ──────────────────────────────

  _drawCase(ctx) {
    const { x, y, w, h, r } = CASE;

    // Drop shadow into the mortise
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = '#140e08';
    ctx.fill();
    ctx.restore();

    // Brass body
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0,   '#8c7140');
    g.addColorStop(0.5, '#6a5430');
    g.addColorStop(1,   '#473719');
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();

    // Brushed texture + reflections (clipped to the case)
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    brushed(ctx, x, y, w, h);
    // Broad horizontal reflection band — polished metal catching ambient light
    const refl = ctx.createLinearGradient(0, y, 0, y + h);
    refl.addColorStop(0,    'rgba(255,242,205,0.05)');
    refl.addColorStop(0.13, 'rgba(255,244,210,0.16)');
    refl.addColorStop(0.28, 'rgba(255,240,200,0.02)');
    refl.addColorStop(0.6,  'rgba(0,0,0,0.05)');
    refl.addColorStop(1,    'rgba(0,0,0,0.16)');
    ctx.fillStyle = refl;
    ctx.fillRect(x, y, w, h);
    // Soft side sheen (lit left edge, shaded right)
    const sheen = ctx.createLinearGradient(x, 0, x + w, 0);
    sheen.addColorStop(0,    'rgba(255,236,180,0.10)');
    sheen.addColorStop(0.16, 'rgba(255,236,180,0)');
    sheen.addColorStop(0.84, 'rgba(0,0,0,0)');
    sheen.addColorStop(1,    'rgba(0,0,0,0.20)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Bevel edges: dark outline + lit inner top-left
    rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
    ctx.strokeStyle = 'rgba(255,235,170,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dark recessed bay that holds the sear-bar mechanism (top)
    const gb = GEARBAY;
    rr(ctx, gb.x, gb.y, gb.w, gb.h, 6);
    const cg = ctx.createLinearGradient(0, gb.y, 0, gb.y + gb.h);
    cg.addColorStop(0, '#0c0a07');
    cg.addColorStop(1, '#14110b');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.save();
    rr(ctx, gb.x, gb.y, gb.w, gb.h, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(gb.x, gb.y, gb.w, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(gb.x, gb.y, 6, gb.h); ctx.fillRect(gb.x + gb.w - 6, gb.y, 6, gb.h);
    ctx.restore();
    rr(ctx, gb.x, gb.y, gb.w, gb.h, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    rr(ctx, gb.x - 1, gb.y - 1, gb.w + 2, gb.h + 2, 7);
    ctx.strokeStyle = 'rgba(255,235,170,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Шестерні ──────────────────────────────────────────────────────────
  /**
   * Зубчастий ряд у ніші механізму.
   *
   * Привід — стан гри, не таймер: кожен звільнений пін довертає ряд на крок,
   * поки пін ворушиться під гачком — ряд ледь веде, на відкритті провертається.
   *
   * Кінематика виводиться, а не задається: спільний модуль m = 2r/N (тому
   * зубці всіх коліс однакові), міжцентрова = r₁+r₂ (ділильні кола дотичні),
   * а кут кожного наступного колеса — наслідок попереднього:
   *     ω₂ = −ω₁ · N₁/N₂
   * з фазовою поправкою π/N₂, щоб зуб потрапляв у западину, а не в зуб.
   */
  /**
   * Клеймо на вільній частині кришки. Вузол механізму компактний і сидить
   * праворуч, тож ліворуч лишається суцільна латунь — без клейма вона
   * читалась би як «недомальоване місце», а не як тіло замка.
   */
  _drawMakerMark(ctx) {
    const gb = GEARBAY;
    const x = CASE.x + 26, y = gb.y + 34;

    this._engrave(ctx, 'A E T H E R L O C K', x, y, { size: 11 });
    this._engrave(ctx, 'SEVEN·PIN  ·  WARDED CORE', x, y + 13, { size: 8 });

    // Розділова риска до вузла механізму
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 20.5); ctx.lineTo(gb.x - 22, y + 20.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,200,0.10)';
    ctx.beginPath();
    ctx.moveTo(x, y + 21.5); ctx.lineTo(gb.x - 22, y + 21.5);
    ctx.stroke();
  }

  /**
   * Механізм показано ФРАГМЕНТАРНО: колеса навмисно більші за нішу, тож у
   * вікні видно лише їхні дуги. Повністю вміщене колесо читається як
   * іграшка, зрізане — як частина більшого механізму, що триває за кришкою.
   *
   * Кінематика від цього не страждає: спільний модуль m = 2r/N, міжцентрові
   * строго r₁+r₂, кут кожного наступного колеса виводиться з попереднього
   * (ω₂ = −ω₁·N₁/N₂ з фазовою поправкою π/N₂) — зубці сходяться і на дугах.
   */
  _drawGears(ctx, state, fx, success) {
    let set = 0;
    for (const p of state.pins) if (p.set) set++;

    // Привід тільки від РЕАЛЬНОГО контакту з піном: крок на кожен зафіксований
    // пін + поштовх під час удару. Близькість відмички (deflect) навмисно НЕ
    // враховується — інакше ряд ворушився б від самого проїзду повз пін.
    const press = fx.press && fx.press.t < 1 ? Math.sin(fx.press.t * Math.PI) : 0;
    const target = set * 0.34 + press * 0.12 + success * 1.4;
    this._gearAngle += (target - this._gearAngle) * 0.14;

    const gb = GEARBAY;
    const m = 4.4;                                   // великий модуль — крупні зубці

    // Ланцюг: (зубці, кут напрямку на наступне колесо від попереднього)
    const N1 = 24, N2 = 12, N3 = 18;
    const r1 = m * N1 / 2, r2 = m * N2 / 2, r3 = m * N3 / 2;   // 52.8 / 26.4 / 39.6

    // Велике колесо піднімається з-під кришки — у вікні лише його корона
    const c1x = gb.x + 46, c1y = gb.y + 76;
    const a1 = this._gearAngle;

    const th12 = -1.02;                              // піньйон вгору-праворуч
    const d12 = r1 + r2;
    const c2x = c1x + Math.cos(th12) * d12;
    const c2y = c1y + Math.sin(th12) * d12;
    const a2 = meshAngle(a1, N1, N2, th12);

    const th23 = 0.30;                               // третє йде за правий край
    const d23 = r2 + r3;
    const c3x = c2x + Math.cos(th23) * d23;
    const c3y = c2y + Math.sin(th23) * d23;
    const a3 = meshAngle(a2, N2, N3, th23);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gb.x, gb.y, gb.w, gb.h);
    ctx.clip();

    this._gear(ctx, c3x, c3y, r3, N3, a3, '#413b31', '#635b4b', 1, true);
    this._gear(ctx, c1x, c1y, r1, N1, a1, '#4a4438', '#6e6454', 1, true);
    this._gear(ctx, c2x, c2y, r2, N2, a2, '#56504a', '#7c7468', 1, true);

    // Тінь від кромки вікна — підкреслює, що колеса йдуть углиб за кришку
    const sh = ctx.createLinearGradient(0, gb.y, 0, gb.y + 14);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(gb.x, gb.y, gb.w, 14);

    ctx.restore();
  }

  _gear(ctx, x, y, r, teeth, angle, dark, light, alpha = 1, detailed = false) {
    const spr = this._getGearSprite(r, teeth, dark, light, detailed);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
    ctx.restore();
  }

  /** Pre-render a gear once to an offscreen canvas; reused (rotated) every frame. */
  _getGearSprite(r, teeth, dark, light, detailed) {
    this._gearSprites = this._gearSprites || {};
    const key = `${r}|${teeth}|${dark}|${light}|${detailed}`;
    if (this._gearSprites[key]) return this._gearSprites[key];

    // Спрайт мусить умістити головку зуба: tipR = r + m
    const pad = Math.ceil(2 * r / teeth) + 4;
    const size = Math.ceil((r + pad) * 2);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    this._gearShape(g, r, teeth, dark, light, detailed);
    this._gearSprites[key] = c;
    return c;
  }

  /** Draw a gear centered at the current origin (used only to build the sprite). */
  _gearShape(ctx, r, teeth, dark, light, detailed) {
    // r — ДІЛИЛЬНИЙ радіус (по ньому рахується міжцентрова).
    // Стандартна пропорція: головка = m назовні, ніжка = 1.25m всередину.
    // Тіло малюється по колу ЗАПАДИН, інакше зубець сусіда впирався б
    // у суцільний диск — саме через це колеса наїжджали одне на одне.
    const mod   = 2 * r / teeth;
    const tipR  = r + mod * 0.78;                  // вкорочена головка — запас на зачіпання
    const rootR = Math.max(2, r - 1.25 * mod);
    // Зуб — трапеція, а не евольвента, тож потрібен помітний боковий зазор,
    // інакше на частині кутів сусідні зубці візуально перетинаються.
    const toothW = (TAU * r / teeth) * 0.30;

    ctx.fillStyle = dark;
    for (let i = 0; i < teeth; i++) {
      ctx.save();
      ctx.rotate((i / teeth) * TAU);
      ctx.beginPath();
      ctx.moveTo(-toothW / 2, -rootR);
      ctx.lineTo(-toothW / 2 + toothW * 0.22, -tipR);
      ctx.lineTo(toothW / 2 - toothW * 0.22, -tipR);
      ctx.lineTo(toothW / 2, -rootR);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    const bg = ctx.createRadialGradient(-rootR * 0.3, -rootR * 0.3, 1, 0, 0, rootR);
    bg.addColorStop(0, light);
    bg.addColorStop(1, dark);
    ctx.beginPath();
    ctx.arc(0, 0, rootR, 0, TAU);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Текстура металу ──────────────────────────────────────────────
    // Запікається у спрайт, тож не коштує нічого на кадр.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rootR, 0, TAU);
    ctx.clip();

    // Радіальне шліфування — сліди від обточки на верстаті
    const rays = Math.max(48, Math.round(rootR * 2.6));
    for (let i = 0; i < rays; i++) {
      const ra = (i / rays) * TAU;
      const inner = rootR * (0.30 + ((i * 37) % 11) / 44);
      ctx.strokeStyle = (i % 3 === 0)
        ? 'rgba(255,244,214,0.055)' : 'rgba(0,0,0,0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ra) * inner, Math.sin(ra) * inner);
      ctx.lineTo(Math.cos(ra) * rootR, Math.sin(ra) * rootR);
      ctx.stroke();
    }

    // Концентричні кільця проточки
    for (let rr2 = rootR * 0.42; rr2 < rootR; rr2 += Math.max(3, rootR * 0.13)) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, rr2, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,205,0.05)';
      ctx.beginPath(); ctx.arc(0, 0, rr2 + 1, 0, TAU); ctx.stroke();
    }

    // Крап і задирки — щоб поверхня не читалась як пластик
    for (let i = 0; i < Math.round(rootR * 1.8); i++) {
      const sa = ((i * 2.399) % TAU), sd = rootR * (0.32 + ((i * 53) % 61) / 92);
      ctx.fillStyle = (i % 4 === 0) ? 'rgba(255,246,220,0.10)' : 'rgba(0,0,0,0.13)';
      ctx.fillRect(Math.cos(sa) * sd, Math.sin(sa) * sd, 1.2, 1.2);
    }

    // Широкий відблиск згори-зліва, як на точеній сталі
    const sheen = ctx.createLinearGradient(-rootR, -rootR, rootR * 0.6, rootR);
    sheen.addColorStop(0,    'rgba(255,248,225,0.16)');
    sheen.addColorStop(0.35, 'rgba(255,248,225,0.03)');
    sheen.addColorStop(0.62, 'rgba(0,0,0,0.05)');
    sheen.addColorStop(1,    'rgba(0,0,0,0.20)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-rootR, -rootR, rootR * 2, rootR * 2);
    ctx.restore();

    if (detailed) {
      ctx.beginPath();
      ctx.arc(0, 0, rootR - 3, 0, TAU);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const holes = 4;
      for (let i = 0; i < holes; i++) {
        const ha = (i / holes) * TAU + TAU / 8;
        const hx = Math.cos(ha) * rootR * 0.52;
        const hy = Math.sin(ha) * rootR * 0.52;
        ctx.beginPath();
        ctx.arc(hx, hy, rootR * 0.18, 0, TAU);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(-rootR * 0.25, -rootR * 0.25, rootR * 0.5, Math.PI * 0.8, Math.PI * 1.6);
      ctx.strokeStyle = 'rgba(255,235,180,0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const hub = ctx.createRadialGradient(-1, -1, 0.5, 0, 0, rootR * 0.28);
    hub.addColorStop(0, light);
    hub.addColorStop(1, '#1a160f');
    ctx.beginPath();
    ctx.arc(0, 0, rootR * 0.28, 0, TAU);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.09, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();
  }

  // ── Блок камер пінів ──────────────────────────────────────────────────

  _drawPinHousing(ctx) {
    const { x, y, w, h } = HOUSE;

    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#7a6234');
    g.addColorStop(0.3, '#67522a');
    g.addColorStop(0.85, '#4e3d1e');
    g.addColorStop(1, '#3a2d14');
    rr(ctx, x, y, w, h, 5);
    ctx.fillStyle = g;
    ctx.fill();

    // Brushed-metal texture
    ctx.save();
    rr(ctx, x, y, w, h, 5);
    ctx.clip();
    brushed(ctx, x, y, w, h);
    ctx.restore();

    // Верхня кромка
    ctx.strokeStyle = 'rgba(255,225,150,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 1);
    ctx.lineTo(x + w - 4, y + 1);
    ctx.stroke();

    rr(ctx, x, y, w, h, 5);
    ctx.strokeStyle = 'rgba(15,10,3,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Нижній бортик — лінія зрізу
    ctx.fillStyle = '#2c2110';
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.strokeStyle = 'rgba(255,220,140,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + h - 4);
    ctx.lineTo(x + w, y + h - 4);
    ctx.stroke();

    // Кріпильні гвинтики між камерами
    for (const sx of [x + 12, x + w - 12]) {
      ctx.beginPath();
      ctx.arc(sx, y + 10, 3, 0, TAU);
      ctx.fillStyle = '#33260e';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,160,0.18)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx - 2, y + 10);
      ctx.lineTo(sx + 2, y + 10);
      ctx.stroke();
    }
  }

  // ── Піни: СУЦІЛЬНІ латунні циліндри ────────────────────────────────────
  // Невстановлений пін висить, опустившись у заглиблення плага (блокує зріз).
  // Встановлений — повністю піднятий у корпус, вище лінії зрізу, тож плаг
  // при відкритті вільно ковзає ПІД пінами, не зачіпаючи їх.

  _drawPins(ctx, state, fx, success) {
    const { pins } = state;
    const press = fx.press;
    const cw = CHAMBER_W, pw = PIN_W;
    const PIN_H = 52;                          // суцільний пін
    const SET_RISE = PIN_PROTRUDE + 2;         // повний хід: з заглиблення → вище зрізу

    for (const pin of pins) {
      const px = TRACK_X + pin.x;
      const pinL = px - pw / 2;
      const chL = px - cw / 2;
      const chTop = HOUSE.y + 5;
      const chBot = SHEAR_Y - 1;
      const chH = chBot - chTop;

      // Хід піна: 0 у спокої, SET_RISE коли встановлений; press = снап / відскок
      let raise;
      if (pin.set) {
        raise = SET_RISE;
        if (press && press.pinIndex === pin.index && press.hit && press.t < 1) {
          const p = press.t, c1 = 1.70158, c3 = c1 + 1;
          raise = SET_RISE * (1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2));
        }
      } else {
        raise = 0;
        if (press && press.pinIndex === pin.index && !press.hit && press.t < 1) {
          raise = Math.sin(press.t * Math.PI) * 10;
        }
      }
      const felt = !pin.set && raise > 1.5;

      // Просвердлений канал у корпусі (темний, з увігнутими стінками)
      ctx.fillStyle = COL.cavity;
      ctx.fillRect(chL, chTop, cw, chH);
      ctx.fillStyle = this._grad(`bore${chL}`, () => {
        const g = ctx.createLinearGradient(chL, 0, chL + cw, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.8)');
        g.addColorStop(0.22, 'rgba(0,0,0,0)');
        g.addColorStop(0.78, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.8)');
        return g;
      });
      ctx.fillRect(chL, chTop, cw, chH);
      ctx.fillStyle = 'rgba(255,240,200,0.05)';
      ctx.fillRect(chL + 2, chTop + 2, 1.2, chH - 4);

      // Один суцільний пін: ніс унизу, тіло проходить крізь лінію зрізу
      const noseY = chBot + PIN_PROTRUDE - raise;   // кінчик носа
      const pinTop = noseY - PIN_H;

      // Пружина над піном — стискається, коли пін піднято
      this._drawSpring(ctx, px, chTop + 2, pinTop - 2, pw);
      this._drawCylPin(ctx, pinL, pinTop, pw, PIN_H,
        pin.set ? MAT.gold : (felt ? MAT.brassL : MAT.brass), 7);

      // Свічення на зрізі коли встановлений / тепла підсвітка коли намацали
      if (pin.set) {
        // Memoized gradient + alpha pulse: rebuilding this per set pin per frame
        // meant up to 420 gradient objects a second for a glow that never
        // changes shape, only brightness.
        const gy = chBot;
        const gg = this._grad('pinSeat', () => {
          const g2 = ctx.createLinearGradient(0, gy - 9, 0, gy + 9);
          g2.addColorStop(0, 'rgba(255,200,80,0)');
          g2.addColorStop(0.5, 'rgba(255,214,120,1)');
          g2.addColorStop(1, 'rgba(255,200,80,0)');
          return g2;
        });
        const pulse = 0.6 + 0.4 * Math.sin(this._t * 3 + pin.index);
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.45 + 0.34 * pulse + success * 0.2);
        ctx.fillStyle = gg;
        ctx.fillRect(chL - 3, gy - 9, cw + 6, 18);
        ctx.restore();
      } else if (felt) {
        ctx.fillStyle = `rgba(255,220,130,${(raise / 10) * 0.12})`;
        ctx.fillRect(chL, chTop, cw, chH);
      }
    }
  }

  /** Steel compression spring from y=top to y=bot, centred on cx. */
  _drawSpring(ctx, cx, top, bot, pw) {
    const len = bot - top;
    if (len < 2) return;
    const coils = Math.max(2, Math.round(len / 6));
    const amp = pw * 0.36;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = 0; s <= coils * 2; s++) {
      const sy = top + (s / (coils * 2)) * len;
      const sx = cx + (s % 2 === 0 ? -amp : amp);
      s === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = MAT.steel.lo;  ctx.lineWidth = 2.4; ctx.stroke();
    ctx.strokeStyle = MAT.steel.mid; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 0.6; ctx.stroke();
  }

  /** A cylindrical pin segment with metallic shading. nose>0 → pointed bottom. */
  _drawCylPin(ctx, x, top, w, h, m, nose = 0) {
    const r = 2;
    const bodyBot = top + h - nose;
    ctx.beginPath();
    ctx.moveTo(x, top + r);
    ctx.quadraticCurveTo(x, top, x + r, top);
    ctx.lineTo(x + w - r, top);
    ctx.quadraticCurveTo(x + w, top, x + w, top + r);
    ctx.lineTo(x + w, bodyBot);
    if (nose) ctx.lineTo(x + w / 2, top + h);
    ctx.lineTo(x, bodyBot);
    ctx.closePath();
    // Memoized: pins sit at fixed x, so there are only a handful of unique fills.
    ctx.fillStyle = this._grad(`cyl${x}|${w}|${m.mid}`, () => cyl(ctx, x, w, m));
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Machined top rim catches light
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x + 2, top + 0.8, w - 4, 1.2);
    // Sharp specular glint aligned with the gradient highlight (~26%)
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillRect(x + w * 0.24, top + 2, 1.3, (h - nose) - 3);
    // Faint reflected rim on the shadow side
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x + w * 0.85, top + 2, 1, (h - nose) - 3);
  }

  // ── Plug with drilled chambers + big keyway channel ────────────────────
  // Brass plug below the shear line: each pin has a bore it sits in, and a
  // large keyway channel runs along the bottom — that is where the picks ride.

  _drawPlug(ctx, state, success) {
    const x = HOUSE.x, w = HOUSE.w;
    const top = SHEAR_Y;
    const bot = PLUG_BOT;
    const dx = this._boltSlide * 58;  // how far the plug slides out on success

    // Fixed cavity behind the plug — revealed (and lit) as it slides out
    ctx.fillStyle = '#070503';
    ctx.fillRect(x - 6, top, w + 12, bot - top);
    if (success > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cav = ctx.createLinearGradient(0, top, 0, bot);
      cav.addColorStop(0, `rgba(255,200,90,${0.55 * success})`);
      cav.addColorStop(1, `rgba(255,150,40,${0.22 * success})`);
      ctx.fillStyle = cav;
      ctx.fillRect(x - 6, top, w + 12, bot - top);
      ctx.restore();
    }

    if (!this._plugSprite) this._buildPlugSprite(state);
    ctx.save();
    ctx.beginPath();
    ctx.rect(CASE.x + 2, top - 2, CASE.w - 4, bot - top + 4);
    ctx.clip();
    ctx.drawImage(this._plugSprite, dx, 0);
    ctx.restore();
  }

  /** Pre-render the (static) plug once: brass body, bores, and the big keyway channel. */
  _buildPlugSprite(state) {
    const x = HOUSE.x, w = HOUSE.w;
    const top    = SHEAR_Y;
    const boreB  = BORE_BOT;       // bottom of the pin bores / top of the keyway channel
    const keyB   = KEYWAY_BOT;     // bottom of the keyway channel
    const bot    = PLUG_BOT;
    const holeW  = CHAMBER_W;

    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const ctx = c.getContext('2d');

    // Brass body (only the solid part above the keyway shows metal)
    const pg = ctx.createLinearGradient(0, top, 0, boreB);
    pg.addColorStop(0,   '#967842');
    pg.addColorStop(0.5, '#6f5732');
    pg.addColorStop(1,   '#4a3a1d');
    ctx.fillStyle = pg;
    ctx.fillRect(x, top, w, bot - top);
    // Reflection band on the solid brass strip below the shear
    const prefl = ctx.createLinearGradient(0, top, 0, boreB);
    prefl.addColorStop(0,   'rgba(255,244,210,0.18)');
    prefl.addColorStop(0.5, 'rgba(255,240,200,0.02)');
    prefl.addColorStop(1,   'rgba(0,0,0,0.12)');
    ctx.fillStyle = prefl;
    ctx.fillRect(x, top, w, boreB - top);

    // Shear seam
    ctx.fillStyle = 'rgba(20,14,5,0.9)';
    ctx.fillRect(x, top - 1, w, 1.5);
    ctx.fillStyle = 'rgba(255,240,180,0.32)';
    ctx.fillRect(x, top + 0.5, w, 1);

    // Brushed-metal texture on the brass
    ctx.save();
    ctx.beginPath(); ctx.rect(x, top, w, bot - top); ctx.clip();
    brushed(ctx, x, top, w, bot - top);
    ctx.restore();

    // Drilled pin bores (dark holes the key pins sit in)
    for (const pin of state.pins) {
      const cx = TRACK_X + pin.x;
      const hL = cx - holeW / 2;
      const hg = ctx.createLinearGradient(hL, 0, hL + holeW, 0);
      hg.addColorStop(0,   'rgba(0,0,0,0.85)');
      hg.addColorStop(0.5, 'rgba(8,6,3,0.95)');
      hg.addColorStop(1,   'rgba(0,0,0,0.85)');
      ctx.fillStyle = hg;
      ctx.fillRect(hL, top, holeW, boreB - top);
      ctx.fillStyle = 'rgba(255,240,200,0.05)';
      ctx.fillRect(hL + 1.5, top, 1.2, boreB - top);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(hL + holeW - 2.5, top, 1.2, boreB - top);
    }

    // The big keyway channel (where the picks ride)
    const kg = ctx.createLinearGradient(0, boreB, 0, keyB);
    kg.addColorStop(0,   '#040303');
    kg.addColorStop(0.5, '#0c0a07');
    kg.addColorStop(1,   '#040303');
    ctx.fillStyle = kg;
    ctx.fillRect(x, boreB, w, keyB - boreB);
    // top lip (where bores open into the channel) + bottom warm rim
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(x, boreB, w, 3);
    ctx.fillStyle = 'rgba(255,225,150,0.12)';
    ctx.fillRect(x, boreB - 1, w, 1);
    ctx.fillStyle = 'rgba(255,225,150,0.10)';
    ctx.fillRect(x, keyB - 1, w, 1);
    // faint warded ridges along the channel for depth
    ctx.strokeStyle = 'rgba(255,225,150,0.05)';
    ctx.lineWidth = 1;
    for (const ry of [boreB + (keyB - boreB) * 0.36, boreB + (keyB - boreB) * 0.64]) {
      ctx.beginPath(); ctx.moveTo(x + 6, ry); ctx.lineTo(x + w - 6, ry); ctx.stroke();
    }

    // Bottom edge + right end cap
    ctx.strokeStyle = 'rgba(20,14,5,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, bot - 0.5);
    ctx.lineTo(x + w, bot - 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(20,14,5,0.7)';
    ctx.fillRect(x + w - 2, top, 2, bot - top);

    this._plugSprite = c;
  }

  // ── Відмичка: жорсткий прямий стрижень під кутом ───────────────────────
  // Входить з-за лівого краю екрана крізь гирло каналу і, як кий, повертається
  // навколо точки входу: чим глибший пін — тим пологіший кут. Кінчик
  // натискає на носи пінів знизу. Жодних ручок і другого інструмента.

  _drawPickTool(ctx, state, fx) {
    const tipX = TRACK_X + state.pickX;

    const deflect = (fx.deflect ?? 0) * 6;
    const jab = (fx.press && fx.press.t < 1) ? Math.sin(fx.press.t * Math.PI) * 9 : 0;
    const lift = deflect + jab;
    const moved = Math.abs(tipX - (this._lastTipX ?? tipX)) > 0.15;
    this._lastTipX = tipX;
    const tipBob = moved ? Math.sin(this._t * 34) * 0.8 : 0;

    // Гирло каналу — отвір у лівій стінці корпуса
    ctx.fillStyle = '#060409';
    ctx.fillRect(CASE.x, BORE_BOT, HOUSE.x - CASE.x + 4, KEYWAY_BOT - BORE_BOT);
    ctx.strokeStyle = 'rgba(255,225,150,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(CASE.x, BORE_BOT, HOUSE.x - CASE.x + 4, KEYWAY_BOT - BORE_BOT);

    // ── Натяжний ключ — статична темна силуетна ТЕКСТУРА на дні каналу ──
    // (як у Скайрімі: просто лежить у тіні, нічого не грає)
    {
      const wy = KEYWAY_BOT - 6;
      ctx.save();
      ctx.globalAlpha = 0.55;
      const wgrad = ctx.createLinearGradient(0, wy - 5, 0, wy + 5);
      wgrad.addColorStop(0, '#3a3d45');
      wgrad.addColorStop(0.5, '#23252b');
      wgrad.addColorStop(1, '#101114');
      ctx.fillStyle = wgrad;
      rr(ctx, -20, wy - 5, HOUSE.x + 96, 10, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-20, wy - 4, HOUSE.x + 80, 1);
      ctx.restore();
    }

    // ── Відмичка: жорсткий інструмент незмінної форми, ковзає ПАРАЛЕЛЬНО ──
    // Кут і довжина фіксовані (нічого не розтягується), хвіст завжди йде за
    // лівий край екрана — всередину повністю не заходить ніколи.
    const noseRest = SHEAR_Y - 1 + PIN_PROTRUDE;
    const cx0 = tipX;                             // точка контакту (вершина гака)
    const cy0 = noseRest + 4 - lift + tipBob;
    const ANG = 0.10;                             // фіксований нахил стрижня

    ctx.save();
    ctx.translate(cx0, cy0);
    ctx.rotate(ANG);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Локальні координати: (0,0) — вершина гака; вісь стрижня на y=AX
    const AX = 36;                                // висота гака над віссю стрижня
                                                  // (обмежена дном каналу: ніс піна ~219, дно 246)
    const T2 = 3;                                 // половина товщини стрижня

    // Суцільний профіль: стрижень + великий гак одним контуром
    const bodyG = ctx.createLinearGradient(0, AX - T2 - 1, 0, AX + T2 + 1);
    bodyG.addColorStop(0, MAT.steel.hi);
    bodyG.addColorStop(0.45, MAT.steel.mid);
    bodyG.addColorStop(1, MAT.steel.lo);
    ctx.beginPath();
    ctx.moveTo(1.9, 1.5);                          // тупа вершина гака
    ctx.quadraticCurveTo(8.4, 17, 2.4, AX + T2 - 0.6);  // передня кромка гака
    ctx.lineTo(-600, AX + T2);                     // нижня кромка стрижня (за екран)
    ctx.lineTo(-600, AX - T2);                     // задній торець за екраном
    ctx.lineTo(-42, AX - T2);                      // верхня кромка стрижня
    ctx.quadraticCurveTo(-22, AX - T2 - 0.5, -10.0, 15.5); // задня кромка гака вгору
    ctx.quadraticCurveTo(-6.4, 3.4, -2.4, 0);
    ctx.closePath();
    ctx.fillStyle = bodyG;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Фактура: спекуляр по верхній кромці, темний низ, шліфовані лінії
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(-600, AX - T2 + 0.6, 583, 1);            // верхній відблиск
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(-600, AX + T2 - 1.4, 599, 0.9);          // нижня тінь
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(-600, AX - 0.4, 590, 0.8);               // шліфована середина
    // блік на зовнішній кромці гака
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9.0, 15.8);
    ctx.quadraticCurveTo(-6.1, 4.2, -2.3, 0.7);
    ctx.stroke();

    ctx.restore();

    // Світіння контакту, коли гак реально тисне на пін
    if (lift > 0.5) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,235,170,0.9)';
      ctx.shadowBlur = 6 + lift;
      ctx.fillStyle = 'rgba(255,240,190,0.95)';
      ctx.beginPath(); ctx.arc(cx0, cy0, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  // ── Лінія зрізу ───────────────────────────────────────────────────────
  // Єдине правило замка: щойно ВСІ піни піднялися вище цієї лінії, плаг
  // вільний. Тому вона мусить читатись однозначно, а не бути ще одним швом.


  /**
   * Гравіювання по металу: текст утоплений у поверхню — темний відбиток
   * зі світлою нижньою фаскою, як штамп на латуні. Так підпис належить
   * корпусу, а не лежить поверх нього окремим шаром інтерфейсу.
   */
  _engrave(ctx, text, x, y, { align = 'left', size = 9, tint = null } = {}) {
    ctx.save();
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';            // врізана тінь
    ctx.fillText(text, x, y + 0.9);
    ctx.fillStyle = tint ?? 'rgba(214,196,152,0.62)';
    ctx.fillText(text, x, y);
    ctx.fillStyle = 'rgba(255,240,200,0.13)';      // світлий край фаски
    ctx.fillText(text, x, y - 0.7);
    ctx.restore();
  }

  // ── Прив'язка механізму до шкали ──────────────────────────────────────
  // Кожен пін з'єднаний тонкою лінією зі своєю зоною на шкалі, а позиція
  // відмички — вертикальним «схилом». Без цього око мусить стрибати між
  // верхом (де видно результат) і низом (де ти цілишся).

  _drawGuides(ctx, state) {
    const { pins, pickX, zone } = state;
    const top = PLUG_BOT + 5;
    const bot = SCALE.y - 5;
    if (bot <= top) return;

    // Наступна ціль — найлівіший невідкритий пін
    let target = null;
    for (const p of pins) if (!p.set && (!target || p.x < target.x)) target = p;

    ctx.save();
    ctx.lineWidth = 1;
    for (const pin of pins) {
      const x = TRACK_X + pin.x + 0.5;
      const isTarget = target && pin.index === target.index;
      if (pin.set) {
        ctx.strokeStyle = 'rgba(210,170,80,0.20)';       // виконано — тьмяне золото
        ctx.setLineDash(DASH_GUIDE);
      } else if (isTarget) {
        const pulse = 0.5 + 0.5 * Math.sin(this._t * 4);
        ctx.strokeStyle = `rgba(140,255,170,${0.28 + 0.22 * pulse})`;
        ctx.setLineDash(DASH_NONE);
      } else {
        ctx.strokeStyle = 'rgba(150,255,180,0.13)';
        ctx.setLineDash(DASH_GUIDE);
      }
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bot);
      ctx.stroke();
    }
    ctx.setLineDash(DASH_NONE);

    // Живий «схил» від маркера вгору до кінчика відмички
    const mx = TRACK_X + pickX + 0.5;
    const col = zone === 'red'   ? 'rgba(255,120,95,0.55)'
              : zone === 'green' ? 'rgba(150,255,180,0.65)'
              :                    'rgba(235,232,220,0.30)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx, KEYWAY_CY + 6);
    ctx.lineTo(mx, bot);
    ctx.stroke();
    ctx.restore();
  }

  // ── Нижня шкала ───────────────────────────────────────────────────────
  // Зелені зони — цілі під невідкритими пінами; за кожною зеленою червона.
  // Маркер їде по шкалі разом з pickX.

  /**
   * Static part of the gauge (label, frame, colour bands, dividers, gloss, rim).
   * Rebuilt only when a pin's set-state changes — not 60×/s.
   */
  _buildScaleSprite(pins) {
    const y = SCALE.y, h = SCALE.h;
    const x0 = SCALE_X0, w = SCALE_X1 - SCALE_X0;
    const sx = gx => SCALE_X0 + gx;
    const half = HIT_ZONE / 2;
    const rad = h / 2;

    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const ctx = c.getContext('2d');

    // Підпис шкали — гравіювання на латуні, як клеймо виробника на корпусі.
    // Ліворуч призначення приладу, праворуч — легенда кольорів дрібним кеглем,
    // щоб інструкція не важила більше за саму шкалу.
    this._engrave(ctx, 'T E N S I O N   G A U G E', x0 + 1, y - 10, { size: 9 });

    // Легенда: сам колір і є поясненням, тож зразок + одне слово.
    ctx.font = '700 8px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    let lx = SCALE_X1 - 1 - (ctx.measureText('RELEASE').width + ctx.measureText('AVOID').width + 32);
    for (const [label, col] of [['RELEASE', COL.green], ['AVOID', COL.red]]) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(lx, y - 16, 7, 7);
      ctx.fillStyle = col;
      ctx.fillRect(lx + 0.5, y - 15.5, 6, 6);
      this._engrave(ctx, label, lx + 11, y - 10, { size: 8 });
      lx += 11 + ctx.measureText(label).width + 10;
    }

    // Frame around the strip
    rr(ctx, x0 - 3, y - 3, w + 6, h + 6, rad + 3);
    const frameG = ctx.createLinearGradient(0, y - 3, 0, y + h + 3);
    frameG.addColorStop(0, COL.brassHi);
    frameG.addColorStop(0.5, COL.brass);
    frameG.addColorStop(1, COL.brassLo);
    ctx.fillStyle = frameG;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Reusable glossy band gradients (top-lit)
    const greenG = ctx.createLinearGradient(0, y, 0, y + h);
    greenG.addColorStop(0, COL.greenHi); greenG.addColorStop(0.45, COL.green); greenG.addColorStop(1, COL.greenLo);
    const redG = ctx.createLinearGradient(0, y, 0, y + h);
    redG.addColorStop(0, COL.redHi); redG.addColorStop(0.45, COL.red); redG.addColorStop(1, COL.redLo);

    ctx.save();
    rr(ctx, x0, y, w, h, rad);
    ctx.clip();

    // Neutral base
    const base = ctx.createLinearGradient(0, y, 0, y + h);
    base.addColorStop(0, '#292520');
    base.addColorStop(0.5, '#1b1812');
    base.addColorStop(1, '#0e0c08');
    ctx.fillStyle = base;
    ctx.fillRect(x0, y, w, h);

    // Colour bands. Red flanks the green on both sides.
    for (const pin of pins) {
      const cxp = sx(pin.x);
      if (pin.set) {
        // done — dim gold, filled solid so it reads as "already cleared"
        ctx.fillStyle = 'rgba(190,155,80,0.40)';
        ctx.fillRect(cxp - half, y, HIT_ZONE, h);
        continue;
      }
      ctx.fillStyle = redG;
      ctx.fillRect(cxp - half - RED_W, y, RED_W, h);
      ctx.fillRect(cxp + half, y, RED_W, h);
      ctx.fillStyle = greenG;
      ctx.fillRect(cxp - half, y, HIT_ZONE, h);
      // bright centre guide on the target (release exactly here)
      ctx.fillStyle = 'rgba(220,255,225,0.55)';
      ctx.fillRect(cxp - 0.6, y + 3, 1.2, h - 6);
    }

    // Crisp dividers between green and the flanking reds
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    for (const pin of pins) {
      if (pin.set) continue;
      const cxp = sx(pin.x);
      for (const dx of [-half, half]) {
        ctx.beginPath();
        ctx.moveTo(cxp + dx, y);
        ctx.lineTo(cxp + dx, y + h);
        ctx.stroke();
      }
    }

    // Unified top gloss + bottom shade
    const sheen = ctx.createLinearGradient(0, y, 0, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.20)');
    sheen.addColorStop(0.42, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(0.5, 'rgba(0,0,0,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0, y, w, h);

    ctx.restore(); // clip

    // Rim
    rr(ctx, x0, y, w, h, rad);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    rr(ctx, x0 + 1, y + 1, w - 2, h - 2, rad - 1);
    ctx.strokeStyle = 'rgba(255,235,175,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    this._scaleSprite = c;
  }

  _drawScale(ctx, state) {
    const { pins, pickX, zone } = state;
    const y = SCALE.y, h = SCALE.h;
    const sx = gx => SCALE_X0 + gx;
    const half = HIT_ZONE / 2;

    // Rebuild the static strip only when the set-state actually changed.
    // Bitmask instead of map()+join(): the old key allocated an array and a
    // string every frame purely to detect a change that happens ~7 times a game.
    let key = 0;
    for (let i = 0; i < pins.length; i++) if (pins[i].set) key |= (1 << i);
    if (!this._scaleSprite || key !== this._scaleKey) {
      this._buildScaleSprite(pins);
      this._scaleKey = key;
    }
    ctx.drawImage(this._scaleSprite, 0, 0);

    // Gentle shimmer on the next target (leftmost unset) to guide the eye
    let target = null;
    for (const p of pins) if (!p.set && (!target || p.x < target.x)) target = p;
    if (target) {
      const c = sx(target.x);
      const pulse = 0.5 + 0.5 * Math.sin(this._t * 4);
      ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.10 * pulse})`;
      ctx.fillRect(c - half, y, HIT_ZONE, h);
    }

    // ── Marker ── (layered translucent strokes for a soft glow, no shadowBlur)
    const mx = sx(pickX);
    const inGreen = zone === 'green';
    const inRed = zone === 'red';
    const col  = inRed ? '#ff7a63' : inGreen ? '#9dffb6' : '#f4f2ea';
    const glow = inRed ? 'rgba(255,90,70,0.4)' : inGreen ? 'rgba(120,255,150,0.4)' : 'rgba(240,240,230,0.28)';

    ctx.lineCap = 'round';
    ctx.strokeStyle = glow;
    ctx.lineWidth = inGreen || inRed ? 9 : 6;
    ctx.beginPath(); ctx.moveTo(mx, y - 5); ctx.lineTo(mx, y + h + 5); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(mx, y - 5); ctx.lineTo(mx, y + h + 5); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, y - 5); ctx.lineTo(mx, y + h + 5); ctx.stroke();

    // Diamond heads top & bottom
    ctx.fillStyle = col;
    for (const [cy2, dir] of [[y - 6, -1], [y + h + 6, 1]]) {
      ctx.beginPath();
      ctx.moveTo(mx, cy2);
      ctx.lineTo(mx - 5, cy2 + dir * 7);
      ctx.lineTo(mx, cy2 + dir * 13);
      ctx.lineTo(mx + 5, cy2 + dir * 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  // ── Фінальний оверлей ─────────────────────────────────────────────────

  drawEndOverlay(success) {
    const ctx = this.ctx;
    const cx = this.W / 2, cy = this.H / 2;

    // Vignette wash toward the result colour
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, this.W * 0.7);
    g.addColorStop(0, success ? 'rgba(12,26,12,0.86)' : 'rgba(26,10,8,0.86)');
    g.addColorStop(1, success ? 'rgba(4,10,4,0.95)' : 'rgba(10,3,2,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    const font = getComputedStyle(document.body).fontFamily || 'serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.save();
    ctx.shadowColor = success ? 'rgba(120,255,140,0.55)' : 'rgba(255,80,60,0.55)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = success ? '#84e690' : '#e6584a';
    ctx.font = `700 36px ${font}`;
    ctx.fillText(success ? 'Lock Picked' : 'Pick Broken', cx, cy - 12);
    ctx.restore();

    // Divider
    ctx.strokeStyle = success ? 'rgba(120,220,140,0.4)' : 'rgba(220,90,70,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 80, cy + 12); ctx.lineTo(cx + 80, cy + 12);
    ctx.stroke();

    // Subtitle
    ctx.fillStyle = 'rgba(224,214,186,0.6)';
    ctx.font = `500 13px ${font}`;
    ctx.fillText(success ? 'The mechanism gives way' : 'The broken tip jams the lock', cx, cy + 30);
  }
}
