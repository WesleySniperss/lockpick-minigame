/**
 * LockController.mjs — чиста логіка замка: піни, зони шкали, спроби, швидкість.
 * Жодного рендерингу чи DOM — тільки стан і правила.
 *
 * Scale model:
 *   Each UNSET pin has a green zone (target) of width HIT_ZONE, flanked by a
 *   red zone of width RED_W on BOTH sides (forbidden). Everything else is neutral.
 *   Player holds → marker slides right. The outcome is decided ON RELEASE:
 *     - released on green   → pin is set
 *     - released on red     → fail (−1 durability)
 *     - released on neutral → nothing, marker just slides back
 */

/** Довжина доріжки маркера (px, ігрові координати 0..TRACK_W) */
export const TRACK_W = 360;

/** Пінів на механізмі завжди 7 — змінюється лише скільки з них уже відкриті */
export const TOTAL_PINS = 7;

/** Green zone width (px) — fixed, independent of the roll.
 *  Pin spacing is TRACK_W/(7+1)=45, so HIT_ZONE + 2*RED_W must be ≤45 (no overlap). */
export const HIT_ZONE = 26;

/** Red zone width on EACH side of the green (px) */
export const RED_W = 9;

/** DC → скільки пінів треба відкрити САМОМУ (решта вже відкриті на старті) */
const PICK_TIERS = [
  [30, 7],
  [25, 6],
  [20, 5],
  [17, 4],
  [15, 3],
  [10, 2],
];

function pinsToPickForDC(dc) {
  for (const [threshold, count] of PICK_TIERS) {
    if (dc >= threshold) return count;
  }
  return 2;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class LockController {
  constructor(dc, rollResult) {
    this.dc = dc;
    this.rollResult = rollResult ?? { total: 10, d20: 10, dc, margin: 10 - dc };

    this.pinsToPick = pinsToPickForDC(dc);
    this.hitZone = HIT_ZONE;
    this.redW = RED_W;
    this.resistRadius = 30;   // радіус "відчуття" піна (звук+деформація кінчика)

    this.pins = [];          // [{ x, set, index }] — завжди TOTAL_PINS штук
    this.attemptsLeft = 3;
    this.dead = false;       // зламана відмичка

    this.pickX = 0;          // позиція маркера (0..TRACK_W)

    this._buildSpeed();
    this.generatePins();
  }

  _buildSpeed() {
    const { margin, d20 } = this.rollResult;

    // Навичка 0..1 (1 = чудовий кидок). Крити — за межами діапазону.
    let skill;
    if      (d20 === 20) skill = 1.25;
    else if (d20 === 1)  skill = -0.25;
    else                 skill = clamp((margin + 10) / 25, 0, 1);

    // Складність замка від DC (10..30 → 0..1)
    const dcDiff = clamp((this.dc - 10) / 20, 0, 1);

    // Базова швидкість px/сек: майстер веде помітно швидше й контрольовано,
    // невдаха — маркер ганяє ще швидше й важко спіймати зелену між червоними.
    const fast = clamp((1 - skill) + dcDiff * 0.6, 0, 1.6);
    this.speed = 200 + fast * 240;           // ~200..580 px/сек

    // Скачки швидкості: 0 = плавно, 1 = різкі ривки.
    this.speedJitter = clamp((1 - skill) * 0.75 + dcDiff * 0.45, 0, 1);
  }

  /**
   * Завжди TOTAL_PINS пінів; (TOTAL_PINS − pinsToPick) з них уже відкриті.
   *
   * BUGFIX: раніше кожен пін отримував власний джиттер ±4.95px. Крок між
   * пінами — 45px, а зони одного піна займають HIT_ZONE + 2*RED_W = 44px,
   * тож будь-який індивідуальний зсув звужував проміжок до ~34px і зони
   * СУСІДНІХ пінів перекривались. zoneAt() повертає перший збіг, тому
   * червона зона лівого піна затуляла зелену правого — пін ставав
   * невзятним. Тепер зсув СПІЛЬНИЙ для всіх пінів: розкладка не однакова
   * щогри, але проміжки лишаються рівно 45px, тож перекриття неможливе.
   */
  generatePins() {
    const n = TOTAL_PINS;
    const spacing = TRACK_W / (n + 1);
    const span = this.hitZone + this.redW * 2;          // ширина зон одного піна
    const slack = Math.max(0, spacing - span - 1);      // −1 на округлення
    const phase = (Math.random() - 0.5) * slack;        // спільний зсув усієї гребінки

    this.pins = [];
    for (let i = 0; i < n; i++) {
      this.pins.push({
        x: Math.round(spacing * (i + 1) + phase),
        set: false,
        index: i,
      });
    }

    const preOpen = Math.max(0, n - this.pinsToPick);
    const order = [...Array(n).keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let k = 0; k < preOpen; k++) this.pins[order[k]].set = true;
  }

  /** Which zone contains x: {type:'green'|'red'|'neutral', pin}. Red flanks green on both sides. */
  zoneAt(x) {
    const half = this.hitZone / 2;
    for (const p of this.pins) {
      if (p.set) continue;
      const gl = p.x - half, gr = p.x + half;
      if (x >= gl && x <= gr) return { type: 'green', pin: p };
      if ((x >= gl - this.redW && x < gl) ||
          (x > gr && x <= gr + this.redW)) return { type: 'red', pin: p };
    }
    return { type: 'neutral', pin: null };
  }

  /** Release the marker at x. Returns the zone hit ({type, pin}); sets the pin if green. */
  release(x) {
    if (this.dead) return null;
    const z = this.zoneAt(x);
    if (z.type === 'green') z.pin.set = true;
    return z;
  }

  /** Released on red → fail. Returns {pin, broke}. */
  strikeRed(pin) {
    this.attemptsLeft--;
    if (this.attemptsLeft <= 0) this.dead = true;
    return { pin, broke: this.dead };
  }

  isComplete() {
    return this.pins.every(p => p.set);
  }

  /** Найближчий невідкритий пін до позиції x */
  nearestUnsetPin(x) {
    let best = null, bestDist = Infinity;
    for (const p of this.pins) {
      if (p.set) continue;
      const d = Math.abs(x - p.x);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  /** Сила "відчуття" піна 0..1 на позиції x (плавно зростає при наближенні) */
  resistanceAt(x) {
    const pin = this.nearestUnsetPin(x);
    if (!pin) return 0;
    const d = Math.abs(x - pin.x);
    if (d >= this.resistRadius) return 0;
    const t = 1 - d / this.resistRadius;
    return t * t * (3 - 2 * t);   // smoothstep
  }
}
