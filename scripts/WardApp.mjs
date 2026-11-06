/**
 * WardApp.mjs — "Unweave the Ward": concentric stone rings cut into dark stone.
 *
 * The core shoots a straight beam at the crystal on the rim. Every ring is a
 * wall with one gap in it, and the beam stops at the first ring whose gap is
 * off the line; that gap pulses amber. Drag a ring to turn it (a click turns it
 * clockwise, a right-click back); turning is free. Line up every gap and the
 * light reaches the crystal. Links are not drawn on the board: pointing at a
 * ring outlines every ring that turns with it, gold the same way, red the other
 * way, and a ring a link has just turned flashes in that colour. Meanwhile the
 * ward knits itself back together: a violet seam creeps around the rim, and
 * when it closes the circle the ward holds. From DC 13 it also turns its
 * outermost open ring back every few seconds; that ring glows violet first.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateWard, WardGame, SECTORS, mod } from './ward-logic.mjs';
import { ARC, TAU, layer, blit, ringCells, blitCells, backdrop, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 440, CX = 260, CY = 222;
const CORE_R = 24, RINGS_IN = 34, RINGS_OUT = 172, RIM_IN = 180, RIM_OUT = 204, RIM_R = (RIM_IN + RIM_OUT) / 2;
const SLOT = 20;                 // width of a ring's gap, in pixels: the same on every ring
const STEP = TAU / SECTORS;
const AMBER = '#f0b45a';
const AGAINST = '#ff7a6b';       // a link that turns its ring the other way
const sectorAngle = s => -Math.PI / 2 + s * STEP;
const shortest = d => ((d % SECTORS) + SECTORS + SECTORS / 2) % SECTORS - SECTORS / 2;
const polar = (r, a) => ({ x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r });

/** The fixed light falling on the rings from the top-left. */
function ringLight(ctx) {
  const g = ctx.createLinearGradient(CX - RINGS_OUT, CY - RINGS_OUT, CX + RINGS_OUT, CY + RINGS_OUT);
  g.addColorStop(0, 'rgba(210,225,255,0.10)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
  return g;
}

export class WardApp extends MiniGameApp {
  static KIND   = 'ward';
  static TITLE  = 'Unweave the Ward';
  static CANVAS = { w: W, h: H };

  buildGame(init) {
    this.ward = generateWard(init);
    this.game = new WardGame(this.ward);
    this.beamA = sectorAngle(this.ward.beam);
    const n = this.ward.rings.length;
    const band = (RINGS_OUT - RINGS_IN) / n;
    this.geo = this.ward.rings.map((_, i) => {
      const r0 = RINGS_IN + i * band + 2.5, r1 = RINGS_IN + (i + 1) * band - 2.5;
      return { r0, r1, rm: (r0 + r1) / 2 };
    });
    this.disp = this.game.rot.slice();          // displayed rotation (sectors, float)
    this.tgt  = this.game.rot.slice();          // where it is heading (unwrapped)
    this.hover = -1;
    this.drag = null;                          // { k, a, acc, done, moved, x, y }
    this.flash = new Map();                     // ring → { v, color }: a link or the ward has just turned it
    this.endDelay = 1.2;
  }

  meterHTML() {
    return barHTML('Rim closes in', this.game.timeLeft, this.ward.params.time, {
      text: `${Math.ceil(this.game.timeLeft)} s`,
      tip: 'The ward knits itself back together. When the seam closes around the rim, it holds.',
    });
  }

  hintHTML() {
    return '<strong title="Click turns it clockwise, right-click back">Drag</strong> a ring to turn it'
      + ' &middot; line its <span class="lpm-hint-amber">gap</span> up with the <span class="lpm-hint-cyan">beam</span>'
      + ' &middot; before the <span class="lpm-hint-violet">rim</span> closes';
  }

  // ── input ─────────────────────────────────────────────────────────────

  ringAt(x, y) {
    const r = Math.hypot(x - CX, y - CY);
    return this.geo.findIndex(g => r >= g.r0 - 2.5 && r <= g.r1 + 2.5);
  }

  bindInput(canvas) {
    const pos = ev => {
      const b = canvas.getBoundingClientRect();
      return { x: (ev.clientX - b.left) * (W / b.width), y: (ev.clientY - b.top) * (H / b.height) };
    };
    const cursor = () => {
      canvas.style.cursor = this.drag ? 'grabbing' : this.hover >= 0 && !this._over ? 'grab' : 'default';
    };
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    canvas.addEventListener('pointerdown', ev => {
      const p = pos(ev), k = this.ringAt(p.x, p.y);
      if (k < 0 || this._over) return;
      ev.preventDefault();
      if (ev.button === 2) { this.requestTurn(k, -1); return; }
      if (ev.button !== 0) return;
      try { canvas.setPointerCapture?.(ev.pointerId); } catch (e) {}    // keep the drag when the pointer leaves the canvas
      this.drag = { k, a: Math.atan2(p.y - CY, p.x - CX), acc: 0, done: 0, moved: false, x: p.x, y: p.y };
      cursor();
    });
    canvas.addEventListener('pointermove', ev => {
      const p = pos(ev);
      if (this.drag) this.dragTo(p);
      else this.hover = this.ringAt(p.x, p.y);
      cursor();
    });
    const end = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!d.moved) this.requestTurn(d.k, 1);          // a plain click turns clockwise
      cursor();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (!this.drag) this.hover = -1; });
    canvas.addEventListener('wheel', ev => {
      const p = pos(ev), k = this.ringAt(p.x, p.y);
      if (k < 0) return;
      ev.preventDefault();
      this.requestTurn(k, ev.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }

  /** The dragged ring follows the pointer; every sector it passes is a turn. */
  dragTo(p) {
    const d = this.drag;
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 5) return;
    d.moved = true;
    const a = Math.atan2(p.y - CY, p.x - CX);
    // Right by the centre the angle swings wildly with the smallest move: skip that stretch.
    if (Math.hypot(p.x - CX, p.y - CY) < 16) { d.a = null; return; }
    if (d.a !== null) d.acc += (((a - d.a + Math.PI) % TAU + TAU) % TAU - Math.PI) / STEP;
    d.a = a;
    const want = Math.round(d.acc);
    while (d.done !== want && this.game.state === 'playing' && !this._over) {
      const dir = want > d.done ? 1 : -1;
      this.turn(d.k, dir);
      d.done += dir;
    }
  }

  animating() { return this.disp.some((d, i) => Math.abs(d - this.tgt[i]) > 0.04); }

  /** A click or a wheel notch: never waits for the last turn to finish, so no click is lost. */
  requestTurn(k, d) {
    if (this._over || this.game.state !== 'playing') return;
    this.turn(k, d);
  }

  turn(k, d) {
    const r = this.game.turn(k, d);
    if (!r.ok) return;
    this.moved(k, d, r.fired);
    Sfx.ringTurn();
    r.newlyPowered.forEach((i, n) => this.later(() => Sfx.channel(i), 140 + n * 110));
    if (r.won) {
      this.drag = null;                         // the ring settles on the line
      this.later(() => { Sfx.unweave(); this._end(true); }, 380);
    }
  }

  /**
   * Ring k has turned by d (the player's turn or the ward's), and the rings its
   * links turned with it: they all head for their new places, and the linked
   * ones' gaps flash in the colour of their link. `color`: flash all of ring k.
   */
  moved(k, d, fired, color = null) {
    this.tgt[k] += d;
    if (color) this.flash.set(k, { v: 1, color, whole: true });
    for (const i of fired) {
      const b = this.ward.bindings[i];
      this.tgt[b.to] += d * b.dir;
      this.flash.set(b.to, { v: 1, color: b.dir > 0 ? ARC.gold : AGAINST });
    }
  }

  // ── sync ──────────────────────────────────────────────────────────────

  syncState() { return this.game.snapshot(); }

  /** Only a turn needs sending at once: spectators run the clock themselves. */
  syncKey() { return `${this.game.rot}|${this.game.state}`; }

  applySync(s) {
    if (!s) return;
    const twisted = (s.twists ?? 0) > this.game.twists ? this.game.twistTarget() : -1;
    s.rot.forEach((v, i) => { this.tgt[i] += shortest(v - this.game.rot[i]); });
    this.game.apply(s);
    if (twisted >= 0) this.flash.set(twisted, { v: 1, color: ARC.violet, whole: true });
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    const ease = 1 - Math.pow(0.0002, dt);
    const held = this.drag?.moved ? this.drag : null;
    // Land on the target as soon as the last of the move is under a pixel, so a
    // ring at rest goes back into the cached board: a moving ring is the dearest
    // part of a frame, and the links now move several at once.
    this.disp = this.disp.map((v, i) => {
      if (held && i === held.k) return this.tgt[i] + Math.max(-0.5, Math.min(0.5, held.acc - held.done));
      const n = v + (this.tgt[i] - v) * ease;
      return Math.abs(this.tgt[i] - n) < 0.008 ? this.tgt[i] : n;
    });
    for (const [i, f] of this.flash) { f.v -= dt * 1.6; if (f.v <= 0) this.flash.delete(i); }
    // The clock and the ward's turns back: the player's game decides; spectators count down between syncs.
    let out = null;
    if (this._over) return null;
    if (this._spectator) this.game.timeLeft = Math.max(0, this.game.timeLeft - dt);
    else if (this.game.state === 'playing') out = this.game.update(dt);
    if (out === 'twist') {
      const tw = this.game.lastTwist;
      this.moved(tw.k, tw.d, tw.fired, ARC.violet);
      Sfx.backlash();
      out = null;
    }
    this._meterAcc = (this._meterAcc ?? 0) + dt;
    if (this._meterAcc > 0.25) { this._meterAcc = 0; this.refreshMeter(); }
    if (out === 'lost') Sfx.fail();
    return out;
  }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    const f = this.game.flow;
    const t = this._t;
    const pulse = 0.75 + 0.25 * Math.sin(t * 3.1);

    // Resting rings, their light and their gaps are one cached layer, rebuilt only
    // when a ring starts or stops turning or the flow changes; each frame redraws
    // just the rings in motion (a software canvas stays at 60 fps).
    const moving = this.disp.map((v, i) => v !== this.tgt[i]);
    const key = moving.map((mv, i) => mv ? 'm' : `${mod(this.tgt[i])}${f.powered[i] ? 'p' : ''}`).join();
    if (key !== this._boardKey) { this._board = this.buildBoard(moving, this._board); this._boardKey = key; }
    blit(ctx, this._board);

    // Rings in motion
    this.geo.forEach((g, i) => {
      if (!moving[i]) return;
      this.drawRing(ctx, i, this.disp[i] * STEP);
      this.gapGlow(ctx, i, this.disp[i] * STEP, f.powered[i]);
    });

    // Hovered or dragged ring, and every ring a link will turn with it
    const focusRing = this.drag?.k ?? this.hover;
    if (focusRing >= 0 && !this._over) this.drawHover(ctx, focusRing);
    // Rings a link or the ward has just turned, and the ring the ward is about to turn back
    this.drawFlashes(ctx, t);

    // The line the gaps have to meet, from where the light stops to the crystal
    const reach = this.beamReach();
    const start = polar(reach.r, this.beamA), crystal = polar(RIM_R, this.beamA);
    if (!reach.home) {
      ctx.save();
      ctx.setLineDash([2, 7]); ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(205,235,255,0.34)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(crystal.x, crystal.y); ctx.stroke();
      ctx.restore();
    }

    // The beam
    const from = polar(CORE_R, this.beamA);
    const beam = () => { ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(start.x, start.y); };
    glow(ctx, beam, { width: 4.2, intensity: pulse });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([6, 14]); ctx.lineDashOffset = -t * 90;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.8; beam(); ctx.stroke();
    ctx.restore();

    // The core
    spark(ctx, CX, CY, CORE_R * 1.9, ARC.energy, 0.55 * pulse);
    const core = ctx.createRadialGradient(CX - 6, CY - 7, 2, CX, CY, CORE_R - 4);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, '#bff6ff'); core.addColorStop(1, '#1f6fb0');
    ctx.beginPath(); ctx.arc(CX, CY, CORE_R - 5, 0, TAU); ctx.fillStyle = core; ctx.fill();

    // Where the light stops: it breaks on the wall, and that ring's gap pulses amber
    if (!reach.home) {
      const beat = 0.5 + 0.5 * Math.sin(t * 5);
      spark(ctx, start.x, start.y, 13 + 5 * beat, ARC.energy, 0.75 + 0.25 * beat);
      if (f.blockedAt >= 0 && !this._over) this.drawNextGap(ctx, f.blockedAt, beat);
    }

    // The ward knitting itself back together: a seam creeping around the rim
    this.drawSeam(ctx, t);

    // The crystal
    if (reach.home) spark(ctx, crystal.x, crystal.y, 24, ARC.energy, 0.8 * pulse + 0.2);
    this.drawCrystal(ctx, crystal.x, crystal.y, this.beamA, reach.home);

    // The goal, the clock and the links, written in the corners
    this.drawNotes(ctx, f);
  }

  renderEnding(ctx, t, success) {
    const k = Math.min(1, t / this.endDelay);
    if (success) {
      // A ring of light rushes out from the core as the weave comes apart.
      const r = 30 + k * 260;
      glow(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, r, 0, TAU); }, { width: 4 * (1 - k) + 1, intensity: 1 - k * 0.6 });
      const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 300);
      g.addColorStop(0, `rgba(220,250,255,${0.55 * Math.sin(k * Math.PI)})`); g.addColorStop(1, 'rgba(220,250,255,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      const g = ctx.createRadialGradient(CX, CY, 20, CX, CY, W * 0.7);
      g.addColorStop(0, `rgba(120,20,10,${0.25 * k})`); g.addColorStop(1, `rgba(60,5,0,${0.65 * k})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  endScreen(success) {
    return success
      ? { title: 'Ward Unwoven', sub: 'The weave comes apart in a sigh of light', icon: (c, x, y, tone) => ARCANE_ICONS.ward(c, x, y, tone, true) }
      : { title: 'The Ward Holds', sub: 'The rim closes and the ward knits itself whole', icon: (c, x, y, tone) => ARCANE_ICONS.ward(c, x, y, tone, false) };
  }

  // ── overlays ──────────────────────────────────────────────────────────

  /**
   * How far the light gets as drawn: a ring only lets it through once its gap
   * has really arrived on the line, not as soon as it is past halfway.
   */
  beamReach() {
    const f = this.game.flow;
    for (let i = 0; i < this.geo.length; i++) {
      if (!f.powered[i] || Math.abs(this.disp[i] - this.tgt[i]) > 0.12) return { r: this.geo[i].r0, home: false };
    }
    return { r: RIM_R, home: true };
  }

  /**
   * What never changes: the goal top-left; bottom-left, what the outlines mean
   * (only the kinds of link this ward has); bottom-right, how often the ward
   * turns a ring back. Part of the static layer.
   */
  drawFixedNotes(ctx) {
    const letters = px => { if ('letterSpacing' in ctx) ctx.letterSpacing = px; };
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    letters('1.6px');
    ctx.fillStyle = 'rgba(200,212,240,0.8)';
    ctx.fillText('LINE UP THE GAPS', 14, 22);
    ctx.fillText('TO LIGHT THE CRYSTAL', 14, 36);
    ctx.font = '700 9px "Signika", sans-serif';
    letters('1px');
    const links = this.ward.bindings;
    if (links.length) {
      let y = 424;
      if (links.some(b => b.dir < 0)) { ctx.fillStyle = hexA(AGAINST, 0.95); ctx.fillText('RED TURNS AGAINST IT', 14, y); y -= 13; }
      if (links.some(b => b.dir > 0)) { ctx.fillStyle = hexA(ARC.gold, 0.95); ctx.fillText('GOLD TURNS WITH IT', 14, y); y -= 13; }
      ctx.fillStyle = 'rgba(200,212,240,0.72)';
      ctx.fillText('POINT AT A RING:', 14, y);
    }
    const every = this.ward.params.twistEvery;
    if (every) {
      ctx.textAlign = 'right';
      ctx.fillStyle = hexA(ARC.violet, 0.95);
      ctx.fillText('THE WARD TURNS AN OPEN', W - 14, 411);
      ctx.fillText(`RING BACK EVERY ${Math.round(every)} s`, W - 14, 424);
    }
    ctx.restore();
  }

  /** What changes: how many rings are open, and the clock top-right. */
  drawNotes(ctx, f) {
    const open = f.powered.filter(Boolean).length, all = this.ward.rings.length;
    const left = this.game.timeLeft, late = left / this.ward.params.time < 0.25;
    const letters = px => { if ('letterSpacing' in ctx) ctx.letterSpacing = px; };
    ctx.save();
    letters('1.6px');
    ctx.font = '700 12px "Signika", sans-serif';
    ctx.fillStyle = open ? hexA(ARC.energy, 0.95) : 'rgba(200,212,240,0.85)';
    ctx.fillText(`${open} / ${all} RINGS OPEN`, 14, 55);

    ctx.textAlign = 'right';
    ctx.font = '700 10px "Signika", sans-serif';
    ctx.fillStyle = hexA(late ? '#ff6a8a' : ARC.violet, 0.85);
    ctx.fillText('RIM CLOSES IN', W - 14, 22);
    ctx.font = '700 18px "Signika", sans-serif';
    ctx.fillStyle = late ? '#ff8aa2' : 'rgba(225,232,250,0.92)';
    ctx.fillText(`${Math.ceil(left)} s`, W - 14, 42);
    ctx.restore();
  }

  /**
   * The ward's clock, on the board: a violet seam that stitches itself around
   * the rim from the top, clockwise. When it closes the circle, the ward holds.
   * In the last quarter it turns red and the needle pulses.
   */
  drawSeam(ctx, t) {
    const total = this.ward.params.time, left = this.game.timeLeft;
    const done = Math.max(0, Math.min(1, 1 - left / total));
    if (done <= 0) return;
    const a0 = -Math.PI / 2, a1 = a0 + TAU * done;
    const late = left / total < 0.25;
    const col = late ? '#ff6a8a' : ARC.violet;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = hexA(col, late ? 0.55 : 0.4); ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(CX, CY, RIM_R, a0, a1); ctx.stroke();
    ctx.strokeStyle = hexA(col, 0.9); ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);                          // the stitches
    ctx.beginPath(); ctx.arc(CX, CY, RIM_R, a0, a1); ctx.stroke();
    ctx.restore();
    const needle = polar(RIM_R, a1);
    spark(ctx, needle.x, needle.y, late ? 13 + 5 * Math.abs(Math.sin(t * 7)) : 11, col, 0.95);
  }

  /** The gap that has to come next pulses amber. */
  drawNextGap(ctx, i, beat) {
    const ang = this.disp[i] * STEP;
    this.slotFill(ctx, i, ang, AMBER, 0.14 + 0.2 * beat);
    glow(ctx, () => this.slotSides(ctx, i, ang), { color: AMBER, width: 2.2, intensity: 0.6 + 0.4 * beat, core: false });
  }

  /**
   * Ring i outlined (and tinted, for the ring under the pointer), once per ring
   * and colour: the pointer is over a ring all through play, and even plain
   * strokes around whole rings cost over a millisecond a frame without a GPU.
   */
  ringOutline(i, color, tint = null) {
    const key = `${i}|${color}|${tint}`;
    this._outlines ??= new Map();
    let o = this._outlines.get(key);
    if (o) return o;
    const g = this.geo[i], size = Math.ceil(g.r1 * 2 + 6);
    const c = layer(size, size, this._dpr), ctx = c.getContext('2d'), m = c.width / this._dpr / 2;
    if (tint) {
      ctx.beginPath(); ctx.arc(m, m, g.r1, 0, TAU); ctx.arc(m, m, g.r0, 0, TAU, true);
      ctx.fillStyle = tint; ctx.fill();
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(m, m, g.r1 + 0.5, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(m, m, g.r0 - 0.5, 0, TAU); ctx.stroke();
    o = { c, cells: ringCells(c, g.r0 - 2, g.r1 + 2) };
    this._outlines.set(key, o);
    return o;
  }

  /** Highlight ring k, and outline the rings that turn with it: gold the same way, red the other way. */
  drawHover(ctx, k) {
    const self = this.ringOutline(k, 'rgba(134,236,255,0.55)', 'rgba(134,236,255,0.07)');
    blitCells(ctx, self.c, self.cells, CX, CY);
    this.ward.bindings.forEach(b => {
      if (b.from !== k) return;
      const other = this.tinted(b.to, b.dir > 0 ? ARC.gold : AGAINST);
      blitCells(ctx, other.c, other.cells, CX, CY);
    });
  }

  /** Ring i outlined and tinted in a link's or the ward's colour: one cached layer per ring and colour. */
  tinted(i, color) { return this.ringOutline(i, hexA(color, 0.9), hexA(color, 0.13)); }

  /**
   * A ring a link has just turned: its gap flashes gold or red. The ring the
   * ward is about to turn back glows violet, brighter and brighter until it
   * turns, and flashes violet once it has. (A whole tinted ring costs about
   * 2.5 ms a frame without a GPU, so only the ward's rare turns get one.)
   */
  drawFlashes(ctx, t) {
    const whole = (i, color, a) => {
      const o = this.tinted(i, color);
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      blitCells(ctx, o.c, o.cells, CX, CY);
      ctx.globalAlpha = 1;
    };
    for (const [i, f] of this.flash) {
      if (f.whole) whole(i, f.color, f.v);
      else this.slotFill(ctx, i, this.disp[i] * STEP, f.color, 0.6 * Math.min(1, f.v));
    }
    const warn = this._over ? 0 : this.game.twistWarning();
    if (warn > 0) whole(this.game.twistTarget(), ARC.violet, warn * (0.65 + 0.35 * Math.sin(t * 16)));
  }

  // ── drawing helpers ───────────────────────────────────────────────────

  /** The two sides of ring i's gap at rotation `ang` (radians): parallel lines from edge to edge. */
  slotSides(ctx, i, ang) {
    const g = this.geo[i], a = this.beamA + ang, c = Math.cos(a), s = Math.sin(a), hw = SLOT / 2;
    const near = Math.sqrt(g.r0 * g.r0 - hw * hw), far = Math.sqrt(g.r1 * g.r1 - hw * hw);
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(CX + c * near - s * side * hw, CY + s * near + c * side * hw);
      ctx.lineTo(CX + c * far - s * side * hw, CY + s * far + c * side * hw);
    }
  }

  /** The inside of ring i's gap, as one window of colour. */
  slotFill(ctx, i, ang, color, alpha) {
    const g = this.geo[i], a = this.beamA + ang, c = Math.cos(a), s = Math.sin(a), hw = SLOT / 2;
    const near = Math.sqrt(g.r0 * g.r0 - hw * hw), far = Math.sqrt(g.r1 * g.r1 - hw * hw);
    ctx.beginPath();
    ctx.moveTo(CX + c * near + s * hw, CY + s * near - c * hw);
    ctx.lineTo(CX + c * far + s * hw, CY + s * far - c * hw);
    ctx.lineTo(CX + c * far - s * hw, CY + s * far + c * hw);
    ctx.lineTo(CX + c * near - s * hw, CY + s * near + c * hw);
    ctx.closePath();
    ctx.fillStyle = hexA(color, alpha);
    ctx.fill();
  }

  /** Ring i's gap: a window, lit when the light runs through it. */
  gapGlow(ctx, i, ang, powered) {
    this.slotFill(ctx, i, ang, powered ? ARC.energy : ARC.violet, powered ? 0.32 : 0.2);
    if (powered) { glow(ctx, () => this.slotSides(ctx, i, ang), { width: 1.6, intensity: 0.8, core: false }); return; }
    this.slotSides(ctx, i, ang);
    ctx.strokeStyle = hexA(ARC.violet, 0.8); ctx.lineWidth = 1.2; ctx.stroke();
  }

  /**
   * Ring i's stone, lit from the top-left whichever way it turns: at rotation
   * `ang` (radians) while it moves, or a copy already turned to its rest
   * position (`rest`, in sectors) and lit — rotating big sprites by 45° and
   * stroking the light are the costly parts of a frame on a software canvas,
   * so a ring pays for them once per stop.
   */
  drawRing(ctx, i, ang, rest = null) {
    if (rest !== null) {
      const c = this.restingRing(i, rest);
      blit(ctx, c, CX - c.width / c._dpr / 2, CY - c.height / c._dpr / 2);
      return;
    }
    // One rotated image: cut into small rects the ring costs twice as much without a GPU.
    const spr = this.ringSprite(i), lit = this.ringLit(i);
    const w = spr.width / spr._dpr, h = spr.height / spr._dpr;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(ang);
    blit(ctx, spr, -w / 2, -h / 2);
    ctx.restore();
    // The light, though, is copied pixel for pixel: a quarter of the cost of stroking it.
    blitCells(ctx, lit.c, lit.cells, CX, CY);
  }

  /** The fixed light on ring i as a layer. Built once. */
  ringLit(i) {
    this._lit ??= [];
    if (this._lit[i]) return this._lit[i];
    const g = this.geo[i], spr = this.ringSprite(i);
    const c = layer(spr.width / spr._dpr, spr.height / spr._dpr, this._dpr), ctx = c.getContext('2d');
    const m = c.width / this._dpr / 2;
    ctx.translate(m - CX, m - CY);                     // board coordinates, so the light falls as on a resting ring
    ctx.fillStyle = ringLight(ctx);
    ctx.beginPath(); ctx.arc(CX, CY, g.r1, 0, TAU); ctx.arc(CX, CY, g.r0, 0, TAU, true); ctx.fill();
    return (this._lit[i] = { c, cells: ringCells(c, g.r0, g.r1) });
  }

  /** Ring i turned to rest position `steps` and lit (one cached copy per ring). */
  restingRing(i, steps) {
    const k = mod(steps);
    this._rest ??= [];
    const hit = this._rest[i];
    if (hit?.k === k) return hit.c;
    const spr = this.ringSprite(i);
    const w = spr.width / spr._dpr, h = spr.height / spr._dpr;
    const c = hit?.c ?? layer(w, h, this._dpr);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(k * STEP);
    blit(ctx, spr, -w / 2, -h / 2);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';     // the light lands on the stone only
    ctx.translate(w / 2 - CX, h / 2 - CY);            // board coordinates, so it matches a moving ring's
    ctx.fillStyle = ringLight(ctx);
    ctx.fillRect(CX - w / 2, CY - h / 2, w, h);
    ctx.restore();
    this._rest[i] = { k, c };
    return c;
  }

  /** The static layer plus every resting ring and its gap. */
  buildBoard(moving, c = layer(W, H, this._dpr, { opaque: true })) {
    const ctx = c.getContext('2d');
    blit(ctx, this._static);                      // opaque: covers the previous board
    this.geo.forEach((g, i) => { if (!moving[i]) this.drawRing(ctx, i, 0, this.tgt[i]); });
    this.geo.forEach((g, i) => { if (!moving[i]) this.gapGlow(ctx, i, this.tgt[i] * STEP, this.game.flow.powered[i]); });
    return c;
  }

  /** Stone ring i with the gap cut through it, at rotation 0. Built once. */
  ringSprite(i) {
    this._sprites ??= [];
    if (this._sprites[i]) return this._sprites[i];
    const g = this.geo[i];
    const size = Math.ceil(g.r1 * 2 + 6);
    const c = layer(size, size, this._dpr);
    const ctx = c.getContext('2d');
    const ox = size / 2, oy = size / 2;
    ctx.translate(ox - CX, oy - CY);               // draw in board coordinates around the centre

    // stone annulus
    const annulus = () => { ctx.beginPath(); ctx.arc(CX, CY, g.r1, 0, TAU); ctx.arc(CX, CY, g.r0, 0, TAU, true); };
    const stone = ctx.createRadialGradient(CX, CY, g.r0, CX, CY, g.r1);
    stone.addColorStop(0, '#2b303c'); stone.addColorStop(0.5, '#343a48'); stone.addColorStop(1, '#272b35');
    annulus(); ctx.fillStyle = stone; ctx.fill();
    ctx.save(); annulus(); ctx.clip();
    for (let k = 0; k < Math.round(g.r1 * 6); k++) {
      const a = Math.random() * TAU, rr = g.r0 + Math.random() * (g.r1 - g.r0);
      ctx.fillStyle = Math.random() < 0.3 ? 'rgba(200,210,240,0.07)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, 1.2, 1.2);
    }
    ctx.restore();
    // edges
    for (const [rad, a] of [[g.r1, 0.65], [g.r0, 0.65]]) {
      ctx.beginPath(); ctx.arc(CX, CY, rad, 0, TAU); ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(CX, CY, g.r1 - 1.5, 0, TAU); ctx.strokeStyle = 'rgba(200,215,245,0.07)'; ctx.lineWidth = 1; ctx.stroke();

    // the gap, cut clean through the stone
    const a = this.beamA, cos = Math.cos(a), sin = Math.sin(a), hw = SLOT / 2;
    const P = (r, side) => [CX + cos * r - sin * side * hw, CY + sin * r + cos * side * hw];
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.moveTo(...P(g.r0 - 4, -1)); ctx.lineTo(...P(g.r1 + 4, -1)); ctx.lineTo(...P(g.r1 + 4, 1)); ctx.lineTo(...P(g.r0 - 4, 1)); ctx.closePath();
    ctx.fill();
    ctx.restore();

    this._sprites[i] = c;
    return c;
  }

  /** Backdrop, rim band, core socket — never moves. */
  buildStatic() {
    const c = layer(W, H, this._dpr, { opaque: true });
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: CX, cy: CY, r: 214 }));
    // rim band
    const rim = () => { ctx.beginPath(); ctx.arc(CX, CY, RIM_OUT, 0, TAU); ctx.arc(CX, CY, RIM_IN, 0, TAU, true); };
    const rg = ctx.createRadialGradient(CX, CY, RIM_IN, CX, CY, RIM_OUT);
    rg.addColorStop(0, '#1b1e27'); rg.addColorStop(1, '#14161d');
    rim(); ctx.fillStyle = rg; ctx.fill();
    for (const rr of [RIM_IN, RIM_OUT]) engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, rr, 0, TAU); }, 1.3, 0.9);
    // the gap the rings sit in
    ctx.beginPath(); ctx.arc(CX, CY, RINGS_OUT + 3, 0, TAU); ctx.arc(CX, CY, RINGS_IN - 3, 0, TAU, true);
    ctx.fillStyle = '#07080b'; ctx.fill();
    // core socket
    const sock = ctx.createRadialGradient(CX, CY, CORE_R - 6, CX, CY, CORE_R + 4);
    sock.addColorStop(0, '#0a0b0f'); sock.addColorStop(1, '#262a35');
    ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 3, 0, TAU); ctx.fillStyle = sock; ctx.fill();
    engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 3, 0, TAU); }, 1.2, 1);
    this.drawFixedNotes(ctx);
    return c;
  }

  /** The crystal in a brass socket on the rim. */
  drawCrystal(ctx, x, y, a, lit) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    const ring = ctx.createLinearGradient(-12, -12, 12, 12);
    ring.addColorStop(0, '#f2d68e'); ring.addColorStop(0.5, '#a07a36'); ring.addColorStop(1, '#4e3a17');
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, TAU); ctx.fillStyle = '#0c0e14'; ctx.fill();
    const gem = ctx.createLinearGradient(0, -8, 0, 8);
    if (lit) { gem.addColorStop(0, '#ffffff'); gem.addColorStop(0.5, ARC.energy); gem.addColorStop(1, ARC.energyLo); }
    else     { gem.addColorStop(0, '#b9a2ff'); gem.addColorStop(1, '#3a2c66'); }
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.lineTo(-6, 0); ctx.closePath();
    ctx.fillStyle = gem; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();
  }
}
