/**
 * LockpickApp.mjs — горизонтальне відмикання наосліп.
 *
 * Управління:
 *   - затиснув ліву кнопку миші → відмичка повзе вправо (швидкість залежить від рола та DC)
 *   - біля прихованого піна кінчик піднімається і звук міняє тон — це підказка
 *   - відпустив кнопку → спроба зафіксувати пін у поточній точці
 *   - влучив → пін стає золотим; промазав → −1 спроба; 3 промахи → відмичка ламається
 */

import { AppV1 } from './compat.mjs';
import { LockController, TRACK_W } from './LockController.mjs';
import { LockRenderer, CANVAS_W, CANVAS_H, TRACK_X, KEYWAY_CY, SHEAR_Y } from './LockRenderer.mjs';

const LPM_ID = 'lockpick-minigame';
const WITHDRAW_SPEED = 900;   // px/сек — швидке повернення після фіксації/провалу
const DRIFT_START    = 55;    // px/сек — початкова швидкість дрейфу назад
const DRIFT_ACCEL    = 720;   // px/сек² — прискорення дрейфу (набирає хід)
const DRIFT_MAX      = 620;   // px/сек — стеля швидкості дрейфу

export class LockpickApp extends AppV1 {

  constructor(wall, opts = {}) {
    const spectator = opts.spectator ?? false;
    super(spectator
      ? { id: `lpm-spectate-${wall.id}`, title: `👁 ${opts.playerName ?? 'Player'} — Picking the Lock` }
      : {}
    );

    this._spectator  = spectator;
    this._playerName = opts.playerName ?? '';

    this.wall        = wall;
    this.dc          = opts.dc          ?? 15;
    this.rollResult  = opts.rollResult  ?? { total: 10, d20: 10, dc: 15, margin: -5 };
    this.onSuccess   = opts.onSuccess   ?? (() => {});
    this.onFailure   = opts.onFailure   ?? (() => {});
    this.onClose     = opts.onClose     ?? (() => {});
    this.consumePick = opts.consumePick ?? (() => Promise.resolve());

    this.controller = new LockController(this.dc, this.rollResult);
    // Спектатор бачить ту саму розкладку пінів, що й гравець
    if (Array.isArray(opts.pins) && opts.pins.length) {
      this.controller.pins = opts.pins.map((p, i) => ({ x: p.x, set: !!p.set, index: i }));
    }

    this.renderer = null;

    // Стан гри
    this._dead        = false;
    this._held        = false;
    this._pickIn      = false;   // відмичка в щілині
    this._withdrawing = false;   // швидке повернення після фіксації/провалу
    this._drifting    = false;   // повільний дрейф назад після відпускання
    this._driftVel    = 0;       // поточна швидкість дрейфу (з прискоренням)
    this._lastT       = 0;
    this._raf         = null;

    // Скачки швидкості відмички (миттєвий множник до базової швидкості)
    this._speedMul    = 1;
    this._speedTarget = 1;
    this._speedTimer  = 0;
    this._zone        = 'neutral';  // де зараз маркер: green|red|neutral

    // Ефекти
    this._particles   = [];
    this._shake       = 0;
    this._missFlash   = 0;
    this._hitFlash    = null;    // {x, t}
    this._breakPiece  = null;    // {x, y, vx, vy, rot, vr, life}
    this._successAnim = 0;
    this._resistance  = 0;
    this._press       = null;    // {pinIndex, hit, t} — анімація удару по піну
    this._attemptPending = false; // пауза між ударом і вийманням
    this._lastTickPin = null;    // для одноразового "тук" при вході в зону опору

    // Аудіо
    this._ac = null;
    this._master = null;
    this._scrapeNode = null;
    this._scrapeGain = null;
    this._scrapeFilter = null;

    // Трансляція глядачам: хто грає — шле стан, спостерігачі його застосовують.
    this._broadcast = opts.broadcast ?? false;
    this._syncAcc = 0;
    this._syncHandler = null;

    this._boundWindowUp = this._onWindowUp.bind(this);

    /** Pending timeouts, cleared on close so nothing fires on a dead app. */
    this._timers = [];
  }

  /** setTimeout that is tracked and auto-cancelled when the app closes. */
  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter(t => t !== id);
      if (!this._dead) fn();
    }, ms);
    this._timers.push(id);
    return id;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id       : 'lockpick-minigame-app',
      title    : 'Pick the Lock',
      width    : CANVAS_W,
      height   : 'auto',
      classes  : ['lockpick-minigame'],
      resizable: false,
    });
  }

  async _renderInner() {
    const banner = this._spectator
      ? `<div class="lpm-spectator-banner">👁 Spectating — ${this._playerName}</div>`
      : '';
    return $(`<div class="lpm-root">
      ${banner}
      <canvas class="lpm-canvas" width="${CANVAS_W}" height="${CANVAS_H}" ${this._spectator ? 'style="pointer-events:none;"' : ''}></canvas>
      <div class="lpm-footer">
        <div class="lpm-footer-top">
          <div class="lpm-roll-result" id="lpm-roll-display"></div>
          <div class="lpm-attempts" id="lpm-attempts-display"></div>
        </div>
        <div class="lpm-footer-bottom">
          <div class="lpm-hint"><strong>Hold</strong> to slide &middot; <strong>release on <span class="lpm-hint-green">green</span></strong> &middot; avoid <span class="lpm-hint-red">red</span></div>
          <button id="lpm-leave-btn" class="lpm-leave-btn">Leave</button>
        </div>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const canvas = html.find('.lpm-canvas')[0];
    this.renderer    = new LockRenderer(canvas);
    this._attemptsEl = html.find('#lpm-attempts-display')[0];

    if (!this._spectator) {
      canvas.addEventListener('mousedown', this._onDown.bind(this));
      window.addEventListener('mouseup', this._boundWindowUp);
    }

    this._showRollResult();
    this._refreshAttempts();

    // Спостерігач слухає стан того, хто зламує
    if (this._spectator) {
      this._syncHandler = (d) => {
        if (d?.action !== 'lockpickSync' || d.wallId !== this.wall?.id) return;
        const c = this.controller;
        c.pickX = d.pickX;
        c.attemptsLeft = d.attemptsLeft;
        c.dead = d.dead;
        if (Array.isArray(d.set)) c.pins.forEach((p, i) => { p.set = !!d.set[i]; });
        this._zone = d.zone ?? 'neutral';
        this._pickIn = d.pickIn;
        this._refreshAttempts();
        if (d.ended !== undefined && !this._dead) this._end(!!d.ended);
      };
      game.socket.on('module.' + LPM_ID, this._syncHandler);
    }

    html.find('#lpm-leave-btn').on('click', () => this.close());

    this._lastT = performance.now();
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  // ── Ввід ──────────────────────────────────────────────────────────────

  _onDown(e) {
    if (e.button !== 0) return;
    // Committed return / break animations block input; drifting does NOT.
    if (this._dead || this.controller.dead || this._withdrawing || this._attemptPending || this._successAnim > 0) return;
    e.preventDefault();
    this._held = true;
    this._drifting = false;          // grabbing again cancels the backward drift
    this._pickIn = true;
    this._lastTickPin = null;
    // Resume forward from the CURRENT position (no reset to 0), at full speed
    this._speedMul = 1;
    this._speedTarget = 1;
    this._speedTimer = 0;
  }

  _onWindowUp(e) {
    if (e.button !== 0 || !this._held) return;
    this._held = false;
    this._stopScrape();
    if (this._dead || this.controller.dead) return;

    // Outcome decided on release: green = set pin, red = fail.
    // Neutral = no commit → the marker just drifts back (re-press to continue forward).
    const z = this.controller.release(this.controller.pickX);
    if (!z) return;
    if (z.type === 'green')    this._setPin(z.pin);
    else if (z.type === 'red') this._hitRed(z.pin);
    else { this._drifting = true; this._driftVel = DRIFT_START; }
  }

  /** Гравець відпустив над зеленою — пін стає */
  _setPin(pin) {
    this._press = { pinIndex: pin.index, hit: true, t: 0 };
    this._attemptPending = true;
    this._stopScrape();

    this._soundPinSet();

    this._hitFlash = { x: TRACK_X + pin.x, t: 1 };
    this._spawnSparks(TRACK_X + pin.x, SHEAR_Y, '#ffd87a');

    if (this.controller.isComplete()) {
      this._attemptPending = false;
      this._beginSuccess();
      return;
    }
    this._later(() => this._startWithdraw(), 240);
  }

  /** Маркер в'їхав у червону зону — провал */
  _hitRed(pin) {
    const { broke } = this.controller.strikeRed(pin);
    this._held = false;
    this._stopScrape();
    this._soundMiss();
    this._shake = 9;
    this._missFlash = 1;
    this._refreshAttempts();

    // Пін підскакує і падає назад (анімація промаху)
    if (pin) this._press = { pinIndex: pin.index, hit: false, t: 0 };

    if (broke) {
      this._attemptPending = false;
      this._beginBreak(TRACK_X + this.controller.pickX);
    } else {
      this._attemptPending = true;
      this._later(() => this._startWithdraw(), 260);
    }
  }

  _startWithdraw() {
    this._withdrawing = true;
    this._drifting = false;
    this._attemptPending = false;
    this._stopScrape();
  }

  // ── Цикл гри ──────────────────────────────────────────────────────────

  _tick(t) {
    if (this._dead) return;
    const dt = Math.min(0.05, (t - this._lastT) / 1000 || 0.016);
    this._lastT = t;

    this._update(dt);
    this._draw();

    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  _update(dt) {
    const c = this.controller;

    // Рух відмички
    if (this._withdrawing) {
      c.pickX -= WITHDRAW_SPEED * dt;
      if (c.pickX <= 0) {
        c.pickX = 0;
        this._withdrawing = false;
        this._pickIn = this._held;
      }
    } else if (this._held && !c.dead && !this._attemptPending && this._successAnim === 0) {
      // Скачки швидкості: періодично беремо нову ціль-множник і їдемо до неї.
      // Чим більший speedJitter — тим частіші й різкіші ривки.
      const j = c.speedJitter;
      this._speedTimer -= dt;
      if (this._speedTimer <= 0) {
        this._speedTarget = Math.max(0.3, 1 + (Math.random() * 2 - 1) * j * 1.25);
        this._speedTimer = 0.16 + Math.random() * (0.55 - j * 0.4);
      }
      // Різкість переходу теж росте з jitter (плавно при майстерності, ривком при ні)
      const ease = 1 - Math.pow(0.0015, dt * (3.5 + j * 14));
      this._speedMul += (this._speedTarget - this._speedMul) * ease;

      c.pickX += c.speed * this._speedMul * dt;

      if (c.pickX >= TRACK_W) {
        // Reached the end — dull thud, then drift back (no penalty)
        c.pickX = TRACK_W;
        this._held = false;
        this._soundThud();
        this._drifting = true;
        this._driftVel = DRIFT_START;
      }
    } else if (this._drifting && !c.dead) {
      // Released in neutral — drift back with acceleration (gains speed as it returns)
      this._driftVel = Math.min(DRIFT_MAX, this._driftVel + DRIFT_ACCEL * dt);
      c.pickX -= this._driftVel * dt;
      if (c.pickX <= 0) {
        c.pickX = 0;
        this._drifting = false;
        this._pickIn = false;
      }
    }

    // Поточна зона маркера (для кольору маркера в рендері)
    this._zone = (this._pickIn && !this._withdrawing && !c.dead)
      ? c.zoneAt(c.pickX).type : 'neutral';

    // Опір біля прихованого піна
    if (this._pickIn && !this._withdrawing && !c.dead) {
      this._resistance = c.resistanceAt(c.pickX);

      const near = c.nearestUnsetPin(c.pickX);
      if (this._held && near && Math.abs(c.pickX - near.x) < c.resistRadius) {
        if (this._lastTickPin !== near.index) {
          this._lastTickPin = near.index;
          this._soundContactTick();    // одноразовий "тук" — намацав щось
        }
      } else if (near && Math.abs(c.pickX - near.x) >= c.resistRadius) {
        this._lastTickPin = null;
      }

      // Шкрябання поки тягнеш; тон росте з опором
      if (this._held) this._updateScrape(this._resistance);
    } else {
      this._resistance = 0;
    }

    // Анімація удару по піну
    if (this._press && this._press.t < 1) {
      this._press.t = Math.min(1, this._press.t + dt / 0.32);
    }

    // Згасання ефектів
    if (this._shake > 0)     this._shake = Math.max(0, this._shake - 30 * dt);
    if (this._missFlash > 0) this._missFlash = Math.max(0, this._missFlash - 2.2 * dt);
    if (this._hitFlash) {
      this._hitFlash.t -= 2.5 * dt;
      if (this._hitFlash.t <= 0) this._hitFlash = null;
    }
    if (this._successAnim > 0 && this._successAnim < 1) {
      this._successAnim = Math.min(1, this._successAnim + 1.2 * dt);
    }

    // Уламок відмички
    if (this._breakPiece) {
      const p = this._breakPiece;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 800 * dt;
      p.rot += p.vr * dt;
      p.life -= 0.8 * dt;
      if (p.life <= 0) this._breakPiece = null;
    }

    // Трансляція глядачам ~12 разів на секунду
    if (this._broadcast) {
      this._syncAcc += dt;
      if (this._syncAcc >= 0.08) { this._syncAcc = 0; this._emitSync(); }
    }

    // Частинки
    for (const p of this._particles) {
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vy += 0.12 * dt * 60;
      p.life -= 2.2 * dt;
    }
    this._particles = this._particles.filter(p => p.life > 0);
  }

  /** Стан для глядачів. Тротлінг: 60 emit/с забив би сокет. */
  _emitSync(force = false, ended = undefined) {
    if (!this._broadcast) return;
    game.socket.emit('module.' + LPM_ID, {
      action: 'lockpickSync',
      wallId: this.wall?.id,
      pickX: this.controller.pickX,
      zone: this._zone,
      pickIn: this._pickIn || this._withdrawing,
      attemptsLeft: this.controller.attemptsLeft,
      dead: this.controller.dead,
      set: this.controller.pins.map(p => p.set),
      ended,
    });
  }

  _draw() {

    this.renderer.draw(
      {
        pins        : this.controller.pins,
        pickX       : this.controller.pickX,
        pickIn      : this._pickIn || this._withdrawing,
        zone        : this._zone,
        attemptsLeft: this.controller.attemptsLeft,
      },
      {
        deflect   : this._resistance,
        vibrate   : this._held ? this._resistance : 0,
        shake     : this._shake,
        particles : this._particles,
        breakPiece: this._breakPiece,
        hitFlash  : this._hitFlash,
        missFlash : this._missFlash,
        success   : this._successAnim,
        press     : this._press,
      }
    );
  }

  // ── Фінали ────────────────────────────────────────────────────────────

  _beginSuccess() {
    this._successAnim = 0.01;

    this._stopScrape();
    this._soundUnlock();
    this._later(() => this._end(true), 1500);
  }

  _beginBreak(tipCanvasX) {
    this._stopScrape();
    this._soundBreak();
    this._shake = 12;
    this._missFlash = 1;
    this._breakPiece = {
      x: tipCanvasX, y: KEYWAY_CY,
      vx: 60 + Math.random() * 60, vy: -160,
      rot: 0, vr: 9, life: 1.2,
    };
    this._spawnSparks(tipCanvasX, KEYWAY_CY, '#d8d8e2');
    this.consumePick().catch(console.error);
    this._later(() => this._end(false), 1100);
  }

  _end(success) {
    if (this._dead) return;
    this._dead = true;
    this._pendingOutcome = success;   // locked in; applied exactly once
    this._emitSync(true, success);       // фінал глядачам одразу
    this._stopScrape();
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this.renderer?.drawEndOverlay(success);

    // Tracked directly (not via _later) because _dead is already true. If the
    // player closes early, close() fires the outcome immediately instead.
    const id = setTimeout(async () => {
      this._timers = this._timers.filter(t => t !== id);
      await this.close();             // close() applies the pending outcome
    }, 1600);
    this._timers.push(id);
  }

  /** Apply the resolved outcome exactly once (win/lose callback). */
  async _fireOutcome() {
    if (this._pendingOutcome === undefined || this._outcomeFired) return;
    this._outcomeFired = true;
    const success = this._pendingOutcome;
    try {
      success ? await this.onSuccess() : await this.onFailure();
    } catch (e) { console.error(e); }
  }

  // ── Ефекти ────────────────────────────────────────────────────────────

  _spawnSparks(cx, cy, color) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this._particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1,
        life: 0.7 + Math.random() * 0.5,
        r: 1 + Math.random() * 2,
        color,
      });
    }
  }

  // ── Аудіо (WebAudio, без зовнішніх файлів) ───────────────────────────

  /**
   * AudioContext + master gain. BUGFIX: previously every node connected straight
   * to ac.destination, so the mini-game ignored Foundry's Interface Volume and
   * played at full blast even with the slider at zero.
   */
  _audio() {
    if (!this._ac) {
      try {
        this._ac = new (window.AudioContext || window.webkitAudioContext)();
        this._master = this._ac.createGain();
        this._master.connect(this._ac.destination);
      } catch (e) { return null; }
    }
    if (this._ac.state === 'suspended') this._ac.resume().catch(() => {});
    if (this._master) {
      let v = 0.5;
      try {
        const s = game.settings.get('core', 'globalInterfaceVolume');
        if (typeof s === 'number') v = s;
      } catch (e) {}
      this._master.gain.value = v;
    }
    return this._ac;
  }

  /** Output node every cue must connect to (never ac.destination directly). */
  _out() { return this._master ?? this._ac?.destination; }

  _updateScrape(resistance) {
    const ac = this._audio();
    if (!ac) return;

    if (!this._scrapeNode) {
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2.2;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0, ac.currentTime);
      src.connect(bp); bp.connect(gn); gn.connect(this._out());
      src.start();
      this._scrapeNode = src; this._scrapeGain = gn; this._scrapeFilter = bp;
    }

    // Тон і гучність ростуть з опором — це звукова підказка
    const freq = 2200 + resistance * 2400;
    const vol  = 0.05 + resistance * 0.14;
    this._scrapeFilter.frequency.setTargetAtTime(freq, this._ac.currentTime, 0.04);
    this._scrapeGain.gain.setTargetAtTime(vol, this._ac.currentTime, 0.03);
  }

  _stopScrape() {
    const ac = this._ac;
    if (!ac || !this._scrapeGain) return;
    this._scrapeGain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
    const n = this._scrapeNode;
    setTimeout(() => { try { n?.stop(); } catch (e) {} }, 300);
    this._scrapeNode = null; this._scrapeGain = null; this._scrapeFilter = null;
  }

  _noiseClick(ac, when, freq, gain, attack, Q) {
    const dur = 0.04 + 80 / freq;
    const len = Math.ceil(ac.sampleRate * (dur + 0.02));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ac.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * (30 + freq * 0.01));
    }
    const src = ac.createBufferSource(); src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = Q;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0, when);
    gn.gain.linearRampToValueAtTime(gain, when + attack);
    gn.gain.exponentialRampToValueAtTime(0.001, when + attack + dur);
    src.connect(bp); bp.connect(gn); gn.connect(this._out());
    src.start(when);
  }

  _toneBody(ac, when, freq, gain, attack, decay) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, when + decay);
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0, when);
    gn.gain.linearRampToValueAtTime(gain, when + attack);
    gn.gain.exponentialRampToValueAtTime(0.001, when + attack + decay);
    osc.connect(gn); gn.connect(this._out());
    osc.start(when); osc.stop(when + attack + decay + 0.05);
  }

  _soundContactTick() {
    const ac = this._audio(); if (!ac) return;
    this._noiseClick(ac, ac.currentTime, 1600, 0.18, 0.001, 3);
  }

  _soundPinSet() {
    const ac = this._audio(); if (!ac) return;
    const now = ac.currentTime;
    this._noiseClick(ac, now, 3400, 0.4, 0.001, 2.4);
    this._toneBody(ac, now + 0.004, 880, 0.16, 0.002, 0.12);
    this._toneBody(ac, now + 0.01, 1320, 0.08, 0.002, 0.18);
  }

  _soundMiss() {
    const ac = this._audio(); if (!ac) return;
    const now = ac.currentTime;
    this._noiseClick(ac, now, 480, 0.5, 0.004, 1.1);
    this._toneBody(ac, now + 0.004, 140, 0.42, 0.004, 0.16);
  }

  _soundThud() {
    const ac = this._audio(); if (!ac) return;
    const now = ac.currentTime;
    this._noiseClick(ac, now, 300, 0.3, 0.006, 0.9);
    this._toneBody(ac, now, 90, 0.3, 0.005, 0.12);
  }

  _soundBreak() {
    const ac = this._audio(); if (!ac) return;
    const now = ac.currentTime;
    this._noiseClick(ac, now, 5200, 0.7, 0.0004, 1.4);
    this._toneBody(ac, now, 110, 0.55, 0.002, 0.3);
    this._noiseClick(ac, now + 0.03, 2600, 0.22, 0.002, 0.7);
    this._toneBody(ac, now + 0.05, 70, 0.3, 0.01, 0.4);
  }

  _soundUnlock() {
    const ac = this._audio(); if (!ac) return;
    const now = ac.currentTime;
    // Серія клацань — піни стають на місце
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.07;
      this._noiseClick(ac, t, 2800 - i * 200, 0.2, 0.001, 2.2);
    }
    // Глибокий поворот механізму
    this._noiseClick(ac, now + 0.35, 220, 0.5, 0.006, 0.7);
    this._toneBody(ac, now + 0.35, 75, 0.6, 0.005, 0.5);
    this._toneBody(ac, now + 0.6, 55, 0.5, 0.004, 0.6);
  }

  // ── UI ────────────────────────────────────────────────────────────────

  _showRollResult() {
    const el = this.element?.[0]?.querySelector('#lpm-roll-display');
    if (!el) return;
    const { total, d20, dc, margin } = this.rollResult;
    const beat = margin >= 0;
    const crit = d20 === 20 ? ' — Critical!' : d20 === 1 ? ' — Critical fail!' : '';
    const color =
      d20 === 20 ? '#d4a030' :
      d20 === 1  ? '#c04040' :
      beat       ? '#4a8a4a' : '#a06020';
    const sign = margin >= 0 ? '+' : '';
    el.innerHTML = `<span class="lpm-roll-label">Roll</span>
      <span class="lpm-roll-d20" style="color:${color}">${total}</span>
      <span class="lpm-roll-vs">vs DC ${dc}</span>
      <span class="lpm-roll-margin" style="color:${color}">(${sign}${margin})${crit}</span>`;
  }

  _refreshAttempts() {
    if (!this._attemptsEl) return;
    const left = this.controller.attemptsLeft;
    const pips = Array.from({ length: 3 }, (_, i) =>
      `<span class="lpm-attempt-pip${i < left ? '' : ' used'}">◆</span>`).join('');
    this._attemptsEl.innerHTML = `<span class="lpm-attempts-label">Pick:</span> ${pips}`;
  }

  async close(opts = {}) {
    this._dead = true;
    this._stopScrape();
    cancelAnimationFrame(this._raf);
    this._raf = null;
    window.removeEventListener('mouseup', this._boundWindowUp);
    if (this._syncHandler) { game.socket.off('module.' + LPM_ID, this._syncHandler); this._syncHandler = null; }
    for (const t of this._timers) clearTimeout(t);
    this._timers.length = 0;
    try { await this._ac?.close(); } catch (e) {}
    this._ac = null;
    this._master = null;
    // Free the cached offscreen layers so repeated openings don't accumulate.
    this.renderer?.dispose?.();
    this.renderer = null;
    // A resolved outcome still applies even if the window is closed early.
    await this._fireOutcome();
    try { this.onClose(); } catch (e) { console.error(e); }
    return super.close(opts);
  }
}
