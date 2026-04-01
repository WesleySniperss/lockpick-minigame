/**
 * LockpickApp.mjs
 * Skyrim-style lockpicking:
 *   - Pick rotates only in the TOP semicircle (following the mouse)
 *   - Click applies tension: cylinder rotates briefly, snaps back if wrong
 *   - If pick is in sweet spot, cylinder rotates open
 *   - Pins react in real-time to pick position (proximity feedback)
 * Visuals based on a brass/bronze ornate pin-tumbler lock cross-section.
 */

const TAU  = Math.PI * 2;
const PI   = Math.PI;

// Pick is constrained to top semicircle: -PI (left) to 0 (right), through top
const PICK_MIN = -PI;
const PICK_MAX = 0;

export class LockpickApp extends Application {

  constructor(wall, opts = {}) {
    super();
    this.wall        = wall;
    this.dc          = opts.dc          ?? 15;
    this.rollResult  = opts.rollResult  ?? { total:10, d20:10, dc:15, margin:-5 };
    this.onSuccess   = opts.onSuccess   ?? (() => {});
    this.onFailure   = opts.onFailure   ?? (() => {});
    this.consumePick = opts.consumePick ?? (() => Promise.resolve());
    this._invPickQty = opts.pickQty     ?? 1;

    this._raf           = null;
    this._canvas        = null;
    this._ctx           = null;
    this._dead          = false;

    // Pick angle (top semicircle only)
    this._pickAngle     = -PI / 2;   // starts at top
    this._prevAngle     = -PI / 2;

    // Cylinder/plug rotation (Skyrim: rotates on attempt, springs back on fail)
    this._cylRot        = 0;
    this._cylTarget     = 0;         // target rotation
    this._cylSpring     = false;     // springing back
    this._cylSuccess    = false;     // rotating to open

    // Tension wrench angle (follows cylinder)
    this._wrenchAngle   = 0;

    // Screen shake
    this._shakeFrames   = 0;

    // Pick break
    this._pickBroken    = false;
    this._pickBreakAng  = 0;
    this._pickBreakAmt  = 0;

    // Particles
    this._particles     = [];

    // Fail flash
    this._failFlash     = 0;

    // Durability
    this._attemptsLeft  = 3;

    // Audio
    this._ac            = null;
    this._scrapeNode    = null;
    this._scrapeGain    = null;
    this._scrapeTimer   = null;

    this._buildState();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id       : 'lockpick-minigame-app',
      title    : 'Pick the Lock',
      width    : 580,
      height   : 620,
      classes  : ['lockpick-minigame'],
      resizable: false,
    });
  }

  _buildState() {
    const { d20, margin } = this.rollResult;
    let sweetSize;
    if      (d20 === 20) sweetSize = TAU;    // instant open
    else if (d20 === 1 ) sweetSize = 0;     // instant snap
    else if (margin >= 0) sweetSize = PI * 0.10;  // beat DC = 10% of semicircle
    else                  sweetSize = PI * 0.01;  // fail DC = 1% of semicircle

    // Sweet spot within the top semicircle
    const range = PI - sweetSize;
    this.sweetCenter   = -PI + sweetSize/2 + Math.random() * range;
    this.sweetSize     = sweetSize;
    this._nat20        = (d20 === 20);
    this._nat1         = (d20 === 1);
  }

  async _renderInner() {
    return $(`<div class="lpm-root">
      <canvas class="lpm-canvas" width="540" height="500"></canvas>
      <div class="lpm-footer">
        <div class="lpm-roll-result" id="lpm-roll-display"></div>
        <div class="lpm-attempts"    id="lpm-attempts-display"></div>
        <div class="lpm-footer-row">
          <div class="lpm-hint">Move mouse to position pick &mdash; <strong>Click</strong> to apply tension</div>
          <button id="lpm-leave-btn" class="lpm-leave-btn">Leave</button>
        </div>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._canvas     = html.find('.lpm-canvas')[0];
    this._ctx        = this._canvas.getContext('2d');
    this._attemptsEl = html.find('#lpm-attempts-display')[0];

    this._canvas.addEventListener('mousemove', this._onMove.bind(this));
    this._canvas.addEventListener('click',     this._onAttempt.bind(this));

    this._refreshAttempts();
    this._showRollResult();

    html.find('#lpm-leave-btn').on('click', () => {
      if (!this._dead) { this._dead = true; this._stopScrape(); cancelAnimationFrame(this._raf); }
      this.close();
    });

    if (this._nat20) {
      this._cylSuccess = true;
      setTimeout(() => this._end(true), 1200);
    } else if (this._nat1) {
      setTimeout(() => {
        this._pickBroken   = true;
        this._pickBreakAng = this._pickAngle;
        this._shakeFrames  = 35;
        this._failFlash    = 30;
        this._spawnParticles(this._pickAngle);
        this._soundSnap();
        this.consumePick().catch(console.error);
        setTimeout(() => this._end(false), 1200);
      }, 400);
    }

    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  _onMove(e) {
    if (this._dead || this._cylSuccess || this._pickBroken) return;
    this._prevAngle = this._pickAngle;
    const r  = this._canvas.getBoundingClientRect();
    const cx = this._canvas.width  / 2;
    const cy = this._canvas.height / 2 + 20;
    const mx = (e.clientX - r.left) * (this._canvas.width  / r.width);
    const my = (e.clientY - r.top)  * (this._canvas.height / r.height);

    // Raw angle
    let a = Math.atan2(my - cy, mx - cx);

    // Clamp to top semicircle: -PI to 0
    if (a > 0) a = 0;
    if (a < -PI) a = -PI;
    this._pickAngle = a;

    // Scrape sound on movement
    let delta = Math.abs(this._pickAngle - this._prevAngle);
    if (delta > 0.003) this._startScrape(delta);
  }

  _onAttempt() {
    if (this._dead || this._cylSuccess || this._pickBroken) return;
    if (this._cylSpring || this._cylRot > 0.05) return; // mid-animation

    // Zone check within top semicircle
    const a    = this._pickAngle;
    const sMin = this.sweetCenter - this.sweetSize / 2;
    const sMax = this.sweetCenter + this.sweetSize / 2;
    const inZone = (a >= sMin && a <= sMax);

    this._wrenchAngle = 0;

    if (inZone) {
      this._stopScrape();
      this._soundSuccess();
      this._cylSuccess = true;
      this._cylTarget  = PI * 0.6;
      setTimeout(() => this._end(true), 1300);
    } else {
      // Miss — cylinder tries to turn, then springs back
      const dist = Math.min(Math.abs(a - this.sweetCenter) / PI, 1);
      this._soundMiss(dist);
      this._cylTarget  = 0.22 - dist * 0.14;   // closer = more rotation attempt
      this._cylSpring  = false;

      for (let i = 0; i < 5; i++) {
        this._pinBounce[i] = -12 - (1-dist)*8 + (Math.random()-0.5)*4;
      }
      this._pinBounce = this._pinBounce ?? [0,0,0,0,0];
      // Store proximity for pin colour feedback (shown until next attempt)
      this._lastProximity = 1 - dist;

      this._shakeFrames = Math.round(8 + dist * 14);
      this._failFlash   = 12;

      this._attemptsLeft--;
      this._refreshAttempts();

      if (this._attemptsLeft <= 0) {
        setTimeout(() => {
          this._stopScrape();
          this._soundSnap();
          this._pickBroken   = true;
          this._pickBreakAng = this._pickAngle;
          this._pickBreakAmt = 0;
          this._shakeFrames  = 30;
          this._failFlash    = 26;
          this._spawnParticles(this._pickAngle);
          this.consumePick().catch(console.error);
          setTimeout(() => this._end(false), 1000);
        }, 350);
      }
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────────

  _tick() {
    if (this._dead) return;
    this._update();
    this._draw();
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  _update() {
    // Cylinder spring animation
    if (this._cylSuccess) {
      this._cylRot = Math.min(this._cylRot + 0.07, PI * 0.6);
    } else if (!this._cylSpring) {
      // Rotating toward target (attempt)
      if (this._cylRot < this._cylTarget) {
        this._cylRot += 0.04;
        if (this._cylRot >= this._cylTarget) { this._cylSpring = true; }
      }
    } else {
      // Springing back
      this._cylRot = Math.max(0, this._cylRot - 0.025);
      if (this._cylRot <= 0) { this._cylSpring = false; this._cylTarget = 0; }
    }

    // Wrench follows cylinder
    this._wrenchAngle = this._cylRot;

    // Pin bounce decay
    if (!this._pinBounce) this._pinBounce = [0,0,0,0,0];
    for (let i = 0; i < 5; i++) {
      if (this._pinBounce[i] < 0) this._pinBounce[i] = Math.min(0, this._pinBounce[i] + 0.55);
    }

    // Shake
    if (this._shakeFrames > 0) this._shakeFrames--;
    if (this._failFlash   > 0) this._failFlash--;

    // Pick break droop
    if (this._pickBroken) this._pickBreakAmt = Math.min(this._pickBreakAmt + 0.05, 0.5);

    // Particles
    for (const p of this._particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= 0.038;
    }
    this._particles = this._particles.filter(p => p.life > 0);
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────

  _draw() {
    const ctx = this._ctx;
    const W = this._canvas.width, H = this._canvas.height;
    const cx = W / 2, cy = H / 2 + 20;

    ctx.clearRect(0, 0, W, H);

    // Background — dark plate
    const bgG = ctx.createRadialGradient(cx*0.6, cy*0.5, 30, cx, cy, W*0.8);
    bgG.addColorStop(0, '#1e1a14'); bgG.addColorStop(1, '#0a0806');
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

    // Vignette
    const vig = ctx.createRadialGradient(cx, cy, W*0.2, cx, cy, W*0.75);
    vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,0.8)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

    // Fail flash
    if (this._failFlash > 0) {
      ctx.fillStyle = `rgba(120,15,0,${(this._failFlash/24)*0.22})`;
      ctx.fillRect(0,0,W,H);
    }

    const sx = this._shakeFrames > 0 ? (Math.random()-0.5)*6 : 0;
    const sy = this._shakeFrames > 0 ? (Math.random()-0.5)*6 : 0;

    ctx.save();
    ctx.translate(cx + sx, cy + sy);

    this._drawLockPlate(ctx);
    this._drawPins(ctx);
    this._drawCylinder(ctx);
    this._drawWrench(ctx);
    if (!this._dead) this._drawPick(ctx);

    ctx.restore();

    // Particles
    for (const p of this._particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath(); ctx.arc(p.x+sx, p.y+sy, p.r*p.life, 0, TAU);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this._pickBroken && !this._dead) {
      ctx.font = '600 12px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
      ctx.fillStyle = 'var(--color-level-error, #cc4444)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Pick snapped!', cx, cy + 105);
    }
  }

  _drawLockPlate(ctx) {
    const PW = 220, PH = 160, PR = 22;
    const px = -PW/2, py = -70;

    // Main brass plate
    const plateG = ctx.createLinearGradient(px, py, px+PW, py+PH);
    plateG.addColorStop(0,   '#6b5830');
    plateG.addColorStop(0.25,'#8a7040');
    plateG.addColorStop(0.5, '#7a6035');
    plateG.addColorStop(0.75,'#5e4c28');
    plateG.addColorStop(1,   '#4a3a1e');

    ctx.beginPath();
    ctx.roundRect?.(px, py, PW, PH, PR) ?? ctx.rect(px, py, PW, PH);
    ctx.fillStyle = plateG; ctx.fill();
    ctx.strokeStyle = '#3a2e18'; ctx.lineWidth = 2; ctx.stroke();

    // Embossed border inset
    ctx.beginPath();
    ctx.roundRect?.(px+8, py+8, PW-16, PH-16, PR-4) ?? ctx.rect(px+8, py+8, PW-16, PH-16);
    ctx.strokeStyle = 'rgba(200,170,80,0.25)'; ctx.lineWidth = 1; ctx.stroke();

    // Top highlight edge
    ctx.strokeStyle = 'rgba(255,220,100,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px+PR, py+1); ctx.lineTo(px+PW-PR, py+1); ctx.stroke();

    // Corner rivets
    const rivets = [[px+18,py+18],[px+PW-18,py+18],[px+18,py+PH-18],[px+PW-18,py+PH-18]];
    for (const [rx,ry] of rivets) {
      const rg = ctx.createRadialGradient(rx-1,ry-1,1,rx,ry,7);
      rg.addColorStop(0,'#c8a050'); rg.addColorStop(0.5,'#8a6828'); rg.addColorStop(1,'#3a2a10');
      ctx.beginPath(); ctx.arc(rx, ry, 7, 0, TAU);
      ctx.fillStyle = rg; ctx.fill();
      ctx.strokeStyle = '#2a1e08'; ctx.lineWidth = 0.8; ctx.stroke();
      // Rivet cross
      ctx.strokeStyle = 'rgba(60,40,10,0.6)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(rx-3,ry); ctx.lineTo(rx+3,ry); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx,ry-3); ctx.lineTo(rx,ry+3); ctx.stroke();
    }

    // Decorative engraved lines on plate
    ctx.save(); ctx.globalAlpha = 0.12; ctx.strokeStyle = '#c8a050'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(px+22+i*35, py+16); ctx.lineTo(px+14+i*35, py+PH-16); ctx.stroke();
    }
    ctx.restore();

    // Bore recess
    const boreR = 48;
    const boreG = ctx.createRadialGradient(-6, 6, 5, 0, 0, boreR);
    boreG.addColorStop(0,'#1a1410'); boreG.addColorStop(1,'#0c0a06');
    ctx.beginPath(); ctx.arc(0, 0, boreR, 0, TAU);
    ctx.fillStyle = boreG; ctx.fill();
    ctx.strokeStyle = '#2a2010'; ctx.lineWidth = 3; ctx.stroke();

    // Inner bore ring (engraved)
    ctx.beginPath(); ctx.arc(0, 0, boreR-5, 0, TAU);
    ctx.strokeStyle = 'rgba(80,60,20,0.6)'; ctx.lineWidth = 1; ctx.stroke();

    // Pin housing recess (top of bore)
    const hW = 120, hH = 52, hR = 6;
    const hx = -hW/2, hy = -boreR - hH + 8;
    const housingG = ctx.createLinearGradient(hx, hy, hx, hy+hH);
    housingG.addColorStop(0, '#1c1610'); housingG.addColorStop(1, '#100e08');
    ctx.beginPath();
    ctx.roundRect?.(hx, hy, hW, hH, hR) ?? ctx.rect(hx, hy, hW, hH);
    ctx.fillStyle = housingG; ctx.fill();
    ctx.strokeStyle = '#3a2e18'; ctx.lineWidth = 1.5; ctx.stroke();

    // Housing top highlight
    ctx.strokeStyle = 'rgba(160,120,40,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx+hR, hy+1); ctx.lineTo(hx+hW-hR, hy+1); ctx.stroke();

    // Housing bottom rim (bezel where pins exit into bore)
    ctx.fillStyle = '#2a2210';
    ctx.fillRect(hx, hy+hH-6, hW, 6);
    ctx.strokeStyle = '#4a3820'; ctx.lineWidth = 1; ctx.stroke();
  }

  _drawPins(ctx) {
    const COUNT   = 5;
    const PIN_W   = 12;
    const SPACING = 24;
    const SHEAR_Y = -48;          // top of cylinder bore
    const CH_TOP  = -SHEAR_Y - 52 + SHEAR_Y - 52; // will recalc
    const hH      = 52;
    const boreR   = 48;
    const housingTop = -boreR - hH + 8;
    const KEY_H   = 20;
    const DRIVER_H = 20;

    // Proximity shown via _lastProximity — set on attempt, not real-time
    const proximity = this._lastProximity ?? 0;

    if (!this._pinBounce) this._pinBounce = [0,0,0,0,0];

    for (let i = 0; i < COUNT; i++) {
      const cx2 = (i - 2) * SPACING;
      const bx  = cx2 - PIN_W/2;
      const bounce = this._pinBounce[i] ?? 0;

      // Shear line relative to cylinder rotation
      const shearY = SHEAR_Y + this._cylRot * 18;

      // Key pin lift from proximity (real-time feedback)
      const lift = proximity * (10 + Math.sin(i * 1.4 + Date.now() * 0.001) * 2);

      const channelTop = housingTop + 4;
      const channelH   = shearY - channelTop;

      // Channel
      ctx.fillStyle = '#08060e';
      ctx.fillRect(bx-1, channelTop, PIN_W+2, channelH);
      const wG = ctx.createLinearGradient(bx-1, 0, bx+PIN_W+1, 0);
      wG.addColorStop(0,'rgba(0,0,0,0.7)'); wG.addColorStop(0.25,'rgba(0,0,0,0)');
      wG.addColorStop(0.75,'rgba(0,0,0,0)'); wG.addColorStop(1,'rgba(0,0,0,0.7)');
      ctx.fillStyle = wG; ctx.fillRect(bx-1, channelTop, PIN_W+2, channelH);
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(bx, channelTop+2, 1.5, channelH-4);

      // Spring top position
      const springNatLen = 18;
      const driverTop    = channelTop + springNatLen + bounce;
      const springLen    = driverTop - channelTop - 2;

      // Spring (zigzag)
      if (springLen > 3) {
        const coils = 5, amp = PIN_W * 0.32;
        ctx.save();
        ctx.strokeStyle = '#b0a080';
        ctx.lineWidth   = 1.3;
        ctx.shadowBlur  = 3;
        ctx.shadowColor = 'rgba(180,160,80,0.4)';
        ctx.beginPath();
        for (let s = 0; s <= coils*2; s++) {
          const y = channelTop + 2 + (s/(coils*2))*springLen;
          const x = cx2 + (s%2===0 ? -amp : amp);
          s===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.stroke();
        // End caps
        ctx.shadowBlur = 0; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx2-amp, channelTop+2); ctx.lineTo(cx2+amp, channelTop+2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx2-amp, driverTop-1);  ctx.lineTo(cx2+amp, driverTop-1);  ctx.stroke();
        ctx.restore();
      }

      // Driver pin — silver/steel, rounded top
      const dG = ctx.createLinearGradient(bx, 0, bx+PIN_W, 0);
      dG.addColorStop(0,   '#303040');
      dG.addColorStop(0.2, '#606080');
      dG.addColorStop(0.5, '#9090a8');
      dG.addColorStop(0.8, '#606080');
      dG.addColorStop(1,   '#303040');
      ctx.fillStyle = dG;
      ctx.beginPath();
      ctx.roundRect?.(bx, driverTop, PIN_W, DRIVER_H, 3) ?? ctx.rect(bx, driverTop, PIN_W, DRIVER_H);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
      // Dome
      ctx.fillStyle = '#707090';
      ctx.beginPath(); ctx.ellipse(cx2, driverTop, PIN_W/2, 4, 0, PI, 0); ctx.fill();
      // Shine
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(bx+2, driverTop+3, 2.5, DRIVER_H-6);

      // Key pin — brass/gold, lifts with proximity
      const keyTop    = shearY - KEY_H + bounce - lift;
      const driverBot = driverTop + DRIVER_H;
      const gapH      = keyTop - driverBot;

      if (gapH > 0) {
        ctx.fillStyle = '#060408';
        ctx.fillRect(bx, driverBot, PIN_W, gapH);
        // Shear-line glow when near correct position
        if (gapH < 10 && !this._cylSuccess) {
          const a2 = Math.max(0, 0.6 - gapH * 0.06);
          ctx.fillStyle = `rgba(200,150,40,${a2})`;
          ctx.fillRect(bx, driverBot, PIN_W, 1.5);
          ctx.fillRect(bx, keyTop-1.5, PIN_W, 1.5);
        }
      }

      const success = this._cylSuccess;
      const bright  = 0.4 + proximity * 0.6;
      const kG = ctx.createLinearGradient(bx, 0, bx+PIN_W, 0);
      if (success) {
        kG.addColorStop(0,'#5a4010'); kG.addColorStop(0.5,'#d4a030'); kG.addColorStop(1,'#5a4010');
      } else {
        const r = Math.round(120 + bright*100), g = Math.round(90 + bright*70), b = Math.round(20);
        kG.addColorStop(0,   `rgb(${Math.round(r*0.5)},${Math.round(g*0.5)},${b})`);
        kG.addColorStop(0.5, `rgb(${r},${g},${b})`);
        kG.addColorStop(1,   `rgb(${Math.round(r*0.5)},${Math.round(g*0.5)},${b})`);
      }
      ctx.fillStyle = kG;
      ctx.beginPath();
      ctx.roundRect?.(bx, keyTop, PIN_W, KEY_H, 3) ?? ctx.rect(bx, keyTop, PIN_W, KEY_H);
      ctx.fill();
      ctx.strokeStyle = success ? 'rgba(200,150,40,0.6)' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.8; ctx.stroke();
      // Key pin bottom dome
      ctx.fillStyle = success ? '#a07820' : `rgb(${Math.round(80+bright*60)},${Math.round(60+bright*40)},10)`;
      ctx.beginPath(); ctx.ellipse(cx2, keyTop+KEY_H, PIN_W/2, 4, 0, 0, PI); ctx.fill();
      // Shine
      ctx.fillStyle = `rgba(255,230,100,${0.1+proximity*0.25})`;
      ctx.fillRect(bx+2, keyTop+3, 2.5, KEY_H-6);

      if (success) {
        ctx.save();
        ctx.shadowBlur=14; ctx.shadowColor='#d4a030';
        ctx.strokeStyle='rgba(220,170,40,0.5)'; ctx.lineWidth=2;
        ctx.beginPath();
        ctx.roundRect?.(bx-1, keyTop-1, PIN_W+2, KEY_H+2, 3) ?? ctx.rect(bx-1, keyTop-1, PIN_W+2, KEY_H+2);
        ctx.stroke(); ctx.restore();
      }
    }
  }

  _drawCylinder(ctx) {
    // Rotates with wrench on attempt
    ctx.save();
    ctx.rotate(this._cylRot);

    const R = 46;
    // Brass/bronze cylinder face
    const cG = ctx.createRadialGradient(-R*0.3, -R*0.3, 5, 0, 0, R);
    cG.addColorStop(0,   '#a07838');
    cG.addColorStop(0.3, '#7a5a28');
    cG.addColorStop(0.65,'#5a4018');
    cG.addColorStop(1,   '#3a2808');
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
    ctx.fillStyle = cG; ctx.fill();
    ctx.strokeStyle = '#2a1e08'; ctx.lineWidth = 2.5; ctx.stroke();

    // Concentric rings (engraved)
    for (const [r, a] of [[R-10, 0.18],[R-22, 0.12],[R-34, 0.08]]) {
      ctx.beginPath(); ctx.arc(0,0,r,0,TAU);
      ctx.strokeStyle = `rgba(200,160,60,${a})`; ctx.lineWidth = 0.8; ctx.stroke();
    }

    // Radial score marks
    for (let i = 0; i < 24; i++) {
      const a  = (TAU/24)*i;
      const r0 = R-3, r1 = i%4===0 ? R-14 : R-8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
      ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1);
      ctx.strokeStyle = `rgba(100,80,30,${i%4===0?0.5:0.25})`;
      ctx.lineWidth = i%4===0 ? 1.2 : 0.7; ctx.stroke();
    }

    // Specular highlight
    const hlG = ctx.createLinearGradient(-R*0.5,-R*0.5, 0,0);
    hlG.addColorStop(0,'rgba(255,220,100,0.22)'); hlG.addColorStop(1,'rgba(255,220,100,0)');
    ctx.beginPath(); ctx.arc(0,0,R-1,PI*0.85,PI*1.75);
    ctx.arc(0,0,R-24,PI*1.75,PI*0.85,true); ctx.closePath();
    ctx.fillStyle=hlG; ctx.fill();

    // Keyhole
    ctx.fillStyle = '#0a0806';
    ctx.beginPath(); ctx.arc(0, -10, 11, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-7,-10); ctx.bezierCurveTo(-7,0,-5,14,-3.5,22);
    ctx.lineTo(3.5,22); ctx.bezierCurveTo(5,14,7,0,7,-10);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0,22,3.5,0,TAU); ctx.fill();

    // Keyhole inner sheen
    ctx.fillStyle='rgba(80,60,20,0.3)'; ctx.beginPath(); ctx.arc(-3,-13,3.5,0,TAU); ctx.fill();

    ctx.restore();

    // Success reveal arc
    if (this._cylSuccess) {
      const sMin = this.sweetCenter - this.sweetSize/2;
      const sMax = this.sweetCenter + this.sweetSize/2;
      ctx.save();
      ctx.shadowBlur=18; ctx.shadowColor='#d4a030';
      ctx.beginPath(); ctx.arc(0,0,R-3,sMin,sMax);
      ctx.strokeStyle='rgba(220,170,60,0.8)'; ctx.lineWidth=5; ctx.stroke();
      ctx.restore();
    }
  }

  _drawWrench(ctx) {
    // Wrench enters keyway from bottom-right, rotates with cylinder
    ctx.save();
    ctx.rotate(Math.PI/2 + 0.3 + this._wrenchAngle);

    const thick = 8;
    const legL  = 38;   // leg inside keyway
    const barL  = 85;   // handle bar

    const brasG = (x0,y0,x1,y1) => {
      const g = ctx.createLinearGradient(x0,y0,x1,y1);
      g.addColorStop(0,   '#3a3020');
      g.addColorStop(0.3, '#706040');
      g.addColorStop(0.55,'#907850');
      g.addColorStop(0.8, '#584838');
      g.addColorStop(1,   '#2a2018');
      return g;
    };

    // Vertical leg
    const legY = 12;
    ctx.beginPath();
    ctx.roundRect?.(-thick/2, legY, thick, legL, 3) ?? ctx.rect(-thick/2, legY, thick, legL);
    ctx.fillStyle = brasG(-thick/2,0,thick/2,0); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=0.8; ctx.stroke();

    // Tip
    ctx.beginPath(); ctx.arc(0, legY+legL, thick/2, 0, PI); ctx.fillStyle='#404030'; ctx.fill();

    // Bar
    const barY = legY + legL - thick;
    const barX = -barL - thick/2;
    ctx.beginPath();
    ctx.roundRect?.(barX, barY, barL, thick, 3) ?? ctx.rect(barX, barY, barL, thick);
    ctx.fillStyle = brasG(0,barY,0,barY+thick); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=0.8; ctx.stroke();

    // Bar left cap
    ctx.beginPath(); ctx.arc(barX, barY+thick/2, thick/2, PI/2, PI*1.5);
    ctx.fillStyle='#404030'; ctx.fill();

    // Leather grip texture on bar
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#1a1008'; ctx.lineWidth = 1.5;
    for (let x = barX+10; x < barX+barL-10; x+=5) {
      ctx.beginPath(); ctx.moveTo(x, barY+1); ctx.lineTo(x, barY+thick-1); ctx.stroke();
    }
    ctx.restore();

    // Shines
    ctx.fillStyle = 'rgba(255,220,100,0.15)';
    ctx.fillRect(-thick/2+2, legY+4, 2.5, legL-8);
    ctx.fillRect(barX+10, barY+1.5, barL-24, 2);

    ctx.restore();
  }

  _drawPick(ctx) {
    // Pick rotates only in top semicircle
    const angle = this._pickBroken
      ? this._pickBreakAng + this._pickBreakAmt
      : this._pickAngle;

    ctx.save(); ctx.rotate(angle);

    const tipR  = 50;  // tip reaches edge of plug bore
    const baseR = 18;

    if (this._pickBroken) ctx.globalAlpha = Math.max(0.1, 0.85 - this._pickBreakAmt*1.6);

    // Handle
    const hG = ctx.createLinearGradient(-5,0,5,0);
    hG.addColorStop(0,'#3a2810'); hG.addColorStop(0.4,'#806030'); hG.addColorStop(0.6,'#907040'); hG.addColorStop(1,'#2a1c08');
    ctx.beginPath(); ctx.rect(0,-4,baseR,8); ctx.fillStyle=hG; ctx.fill();
    // Grip
    ctx.strokeStyle='rgba(0,0,0,0.45)'; ctx.lineWidth=1;
    for (let x=4; x<baseR-1; x+=4) { ctx.beginPath(); ctx.moveTo(x,-4); ctx.lineTo(x,4); ctx.stroke(); }

    // Shaft
    const pickColor = this._pickBroken ? '#7a5530' : '#c0a060';
    const pickDark  = this._pickBroken ? '#3a2010' : '#806030';
    const sG = ctx.createLinearGradient(0,-2,0,2);
    sG.addColorStop(0,pickColor); sG.addColorStop(1,pickDark);
    ctx.strokeStyle=sG; ctx.lineWidth=2.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(baseR,0); ctx.lineTo(tipR-6,0); ctx.stroke();

    if (!this._pickBroken) {
      // Hook tip
      ctx.strokeStyle='#d4b070'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(tipR-6,0); ctx.quadraticCurveTo(tipR+2,0,tipR+2,-8); ctx.stroke();
      ctx.beginPath(); ctx.arc(tipR+2,-8,2,0,TAU);
      ctx.fillStyle='#f0d080'; ctx.fill();
      // Shine
      ctx.beginPath(); ctx.moveTo(baseR+2,-0.7); ctx.lineTo(tipR-8,-0.7);
      ctx.strokeStyle='rgba(255,230,130,0.22)'; ctx.lineWidth=0.8; ctx.stroke();
    }

    ctx.globalAlpha=1; ctx.restore();
  }

  // ── Particles ────────────────────────────────────────────────────────────────

  _spawnParticles(angle) {
    const R=52, cx=this._canvas.width/2, cy=this._canvas.height/2+20;
    const ox=cx+Math.cos(angle)*R, oy=cy+Math.sin(angle)*R;
    for (let i=0;i<16;i++){
      const a=Math.random()*TAU, s=0.8+Math.random()*4;
      this._particles.push({x:ox,y:oy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
        life:1,r:1+Math.random()*2.5,
        color:['#c8a050','#a07830','#806020','#604810'][Math.floor(Math.random()*4)]});
    }
  }

  // ── Audio ─────────────────────────────────────────────────────────────────────

  _ac2() {
    if (!this._ac) { try { this._ac = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    return this._ac;
  }

  _startScrape(speed) {
    const ac=this._ac2(); if(!ac)return;
    clearTimeout(this._scrapeTimer);
    if (!this._scrapeNode) {
      const len=ac.sampleRate*2, buf=ac.createBuffer(1,len,ac.sampleRate);
      const d=buf.getChannelData(0); for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
      const src=ac.createBufferSource(); src.buffer=buf; src.loop=true;
      const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=2800; bp.Q.value=1.8;
      const gn=ac.createGain(); gn.gain.setValueAtTime(0,ac.currentTime);
      src.connect(bp); bp.connect(gn); gn.connect(ac.destination); src.start();
      this._scrapeNode=src; this._scrapeGain=gn;
    }
    const vol=Math.min(0.2,speed*4);
    this._scrapeGain.gain.cancelScheduledValues(ac.currentTime);
    this._scrapeGain.gain.setTargetAtTime(vol,ac.currentTime,0.008);
    this._scrapeTimer=setTimeout(()=>this._stopScrape(),90);
  }

  _stopScrape() {
    const ac=this._ac2(); if(!ac||!this._scrapeGain)return;
    this._scrapeGain.gain.setTargetAtTime(0,ac.currentTime,0.06);
    const n=this._scrapeNode;
    setTimeout(()=>{try{n?.stop();}catch(e){}},300);
    this._scrapeNode=null; this._scrapeGain=null;
  }

  _noiseClick(ac,when,freq,gain,attack,Q) {
    const dur=0.04+80/freq;
    const len=Math.ceil(ac.sampleRate*(dur+0.02));
    const buf=ac.createBuffer(1,len,ac.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<len;i++){const t=i/ac.sampleRate;data[i]=(Math.random()*2-1)*Math.exp(-t*(30+freq*0.01));}
    const src=ac.createBufferSource(); src.buffer=buf;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq; bp.Q.value=Q;
    const gn=ac.createGain();
    gn.gain.setValueAtTime(0,when); gn.gain.linearRampToValueAtTime(gain,when+attack);
    gn.gain.exponentialRampToValueAtTime(0.001,when+attack+dur);
    src.connect(bp); bp.connect(gn); gn.connect(ac.destination); src.start(when);
  }

  _toneBody(ac,when,freq,gain,attack,decay) {
    const osc=ac.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(freq,when);
    osc.frequency.exponentialRampToValueAtTime(freq*0.85,when+decay);
    const gn=ac.createGain();
    gn.gain.setValueAtTime(0,when); gn.gain.linearRampToValueAtTime(gain,when+attack);
    gn.gain.exponentialRampToValueAtTime(0.001,when+attack+decay);
    osc.connect(gn); gn.connect(ac.destination);
    osc.start(when); osc.stop(when+attack+decay+0.05);
  }

  _soundMiss(dist) {
    const ac=this._ac2(); if(!ac)return;
    const now=ac.currentTime;
    if      (dist<0.20){ this._noiseClick(ac,now,3800,0.35,0.001,2.5); this._toneBody(ac,now+0.002,1800,0.20,0.001,0.12); }
    else if (dist<0.50){ const t=(dist-0.2)/0.3; this._noiseClick(ac,now,2200-t*1000,0.45+t*0.15,0.002,2.0-t*0.5); this._toneBody(ac,now+0.003,500-t*200,0.30+t*0.1,0.002,0.10+t*0.08); }
    else if (dist<0.80){ this._noiseClick(ac,now,900,0.60,0.004,1.2); this._toneBody(ac,now+0.003,200,0.50,0.003,0.20); this._noiseClick(ac,now+0.015,600,0.25,0.015,0.8); }
    else               { this._noiseClick(ac,now,400,0.70,0.005,0.9); this._toneBody(ac,now+0.003,80,0.80,0.004,0.35); }
  }

  _soundSuccess() {
    const ac=this._ac2(); if(!ac)return; const now=ac.currentTime;
    for(let i=0;i<5;i++){const t=now+i*0.055; this._noiseClick(ac,t,2800-i*180,0.22,0.001,2.2); this._toneBody(ac,t+0.002,420-i*20,0.14,0.001,0.055);}
    this._noiseClick(ac,now+0.32,180,0.55,0.005,0.6); this._toneBody(ac,now+0.32,70,0.65,0.004,0.45);
    this._noiseClick(ac,now+0.58,320,0.60,0.003,0.5); this._toneBody(ac,now+0.58,55,0.80,0.003,0.55);
  }

  _soundSnap() {
    const ac=this._ac2(); if(!ac)return; const now=ac.currentTime;
    this._noiseClick(ac,now,4500,0.70,0.0004,1.6);
    this._toneBody(ac,now,90,0.60,0.002,0.30);
    this._noiseClick(ac,now+0.015,2200,0.15,0.001,0.55);
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  _showRollResult() {
    const el = this.element?.[0]?.querySelector('#lpm-roll-display');
    if (!el) return;
    const { total, d20, dc, margin } = this.rollResult;
    const beat  = margin >= 0;
    const isCrit= d20 === 20 ? ' — Critical Success!' : d20 === 1 ? ' — Critical Failure!' : '';
    const color = d20 === 20 ? 'var(--color-warm-1,#d4a030)' : d20 === 1 ? 'var(--color-level-error,#c04040)' : beat ? 'var(--color-level-success,#4a8a4a)' : 'var(--color-level-warning,#a06020)';
    const sign  = margin >= 0 ? '+' : '';
    el.innerHTML = `<span class="lpm-roll-label">Roll:</span>
      <span class="lpm-roll-d20" style="color:${color}">${total}</span>
      <span class="lpm-roll-vs">vs DC ${dc}</span>
      <span class="lpm-roll-margin" style="color:${color}">(${sign}${margin})${isCrit}</span>`;
  }

  _refreshAttempts() {
    if (!this._attemptsEl) return;
    const pips = Array.from({length:3},(_,i)=>
      `<span class="lpm-attempt-pip${i<this._attemptsLeft?'':' used'}">◆</span>`).join('');
    this._attemptsEl.innerHTML = `<span class="lpm-attempts-label">Durability:</span> ${pips}`;
  }

  // ── End ───────────────────────────────────────────────────────────────────────

  _end(success) {
    if (this._dead) return;
    this._dead = true;
    this._stopScrape();
    cancelAnimationFrame(this._raf);
    const ctx=this._ctx, W=this._canvas.width, H=this._canvas.height;
    ctx.fillStyle=success?'rgba(10,18,8,0.92)':'rgba(18,8,8,0.92)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle=success?'var(--color-level-success,#4a8a4a)':'var(--color-level-error,#c04040)';
    ctx.font='700 36px '+(getComputedStyle(document.body).fontFamily||'sans-serif');
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(success?'Lock Picked!':'Picks Broken!', W/2, H/2);
    setTimeout(async()=>{await this.close(); success?await this.onSuccess():await this.onFailure();},1500);
  }

  _refreshPicks() {}  // picks display removed

  async close(opts={}) {
    this._dead=true; this._stopScrape(); cancelAnimationFrame(this._raf);
    return super.close(opts);
  }
}
