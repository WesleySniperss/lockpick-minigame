/**
 * WardApp.mjs — "Unweave the Ward": concentric rune rings cut into dark stone.
 *
 * Goal, written on the board: lead the light from the core to every crystal on
 * the rim. Each ring has a channel with a gate on its inner edge and a gate on
 * its outer edge. The light runs as far as the gates line up; where it stops,
 * the waiting light glows and the gate of the ring that has to meet it pulses
 * amber. Drag a ring to turn it (click turns it clockwise, right-click back);
 * turning is free. A golden link means turning one ring turns another too;
 * hovering a ring outlines every ring that will move with it. Meanwhile the
 * ward knits itself back together: a violet seam creeps around the rim, and
 * when it closes the circle the ward holds.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateWard, WardGame, SECTORS, nextGate } from './ward-logic.mjs';
import { ARC, TAU, layer, blit, backdrop, drawRune, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 440, CX = 260, CY = 222;
const CORE_R = 24, RINGS_IN = 34, RINGS_OUT = 172, RIM_IN = 180, RIM_OUT = 204;
const STEP = TAU / SECTORS;
const AMBER = '#f0b45a';
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
    const n = this.ward.rings.length;
    const band = (RINGS_OUT - RINGS_IN) / n;
    this.geo = this.ward.rings.map((_, i) => {
      const r0 = RINGS_IN + i * band + 2.5, r1 = RINGS_IN + (i + 1) * band - 2.5;
      return { r0, r1, rm: (r0 + r1) / 2 };
    });
    this.disp = this.game.rot.slice();          // displayed rotation (sectors, float)
    this.tgt  = this.game.rot.slice();          // where it is heading (unwrapped)
    this.hover = -1;
    this.hoverAt = null;
    this.drag = null;                           // { k, a, acc, done, moved, x, y }
    this.queue = [];
    this.flash = { link: new Map() };           // binding index → glow left after it fired
    this.endDelay = 1.2;
  }

  meterHTML() {
    return barHTML('Re-forms in', this.game.timeLeft, this.ward.params.time, {
      text: `${Math.ceil(this.game.timeLeft)} s`,
      tip: 'The ward knits itself back together. When the seam closes around the rim, it holds.',
    });
  }

  hintHTML() {
    return '<strong title="Click turns it clockwise, right-click back">Drag</strong> a ring to turn it'
      + ' &middot; bring its <span class="lpm-hint-amber">gate</span> to the <span class="lpm-hint-cyan">light</span>'
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
      this.hoverAt = p;
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
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = -1; this.hoverAt = null; } });
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
    d.acc += (((a - d.a + Math.PI) % TAU + TAU) % TAU - Math.PI) / STEP;
    d.a = a;
    const want = Math.round(d.acc);
    while (d.done !== want && this.game.state === 'playing' && !this._over) {
      const dir = want > d.done ? 1 : -1;
      this.turn(d.k, dir);
      d.done += dir;
    }
  }

  animating() { return this.disp.some((d, i) => Math.abs(d - this.tgt[i]) > 0.04); }

  requestTurn(k, d) {
    if (this._over || this.game.state !== 'playing') return;
    if (this.animating()) { if (this.queue.length < 2) this.queue.push([k, d]); return; }
    this.turn(k, d);
  }

  turn(k, d) {
    const r = this.game.turn(k, d);
    if (!r.ok) return;
    this.tgt[k] += d;
    for (const i of r.fired) { const b = this.ward.bindings[i]; this.tgt[b.to] += d * b.dir; this.flash.link.set(i, 1); }
    Sfx.ringTurn();
    r.newlyPowered.forEach((i, n) => this.later(() => Sfx.channel(i), 140 + n * 110));
    if (r.won) this.later(() => { Sfx.unweave(); this._end(true); }, 380);
  }

  // ── sync ──────────────────────────────────────────────────────────────

  syncState() { return this.game.snapshot(); }

  applySync(s) {
    if (!s) return;
    s.rot.forEach((v, i) => { this.tgt[i] += shortest(v - this.game.rot[i]); });
    this.game.apply(s);
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    const ease = 1 - Math.pow(0.0008, dt);
    const held = this.drag?.moved ? this.drag : null;
    // Land exactly on the target, so a ring at rest goes back into the cached board.
    this.disp = this.disp.map((v, i) => {
      if (held && i === held.k) return this.tgt[i] + Math.max(-0.5, Math.min(0.5, held.acc - held.done));
      const n = v + (this.tgt[i] - v) * ease;
      return Math.abs(this.tgt[i] - n) < 0.002 ? this.tgt[i] : n;
    });
    if (!this.drag && !this.animating() && this.queue.length && !this._over) this.turn(...this.queue.shift());
    for (const [i, v] of this.flash.link) { if (v <= 0) this.flash.link.delete(i); else this.flash.link.set(i, v - dt * 1.8); }
    // The clock: the player's decides; spectators count down between syncs.
    let out = null;
    if (this._over) return null;
    if (this._spectator) this.game.timeLeft = Math.max(0, this.game.timeLeft - dt);
    else if (this.game.state === 'playing') out = this.game.update(dt);
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

    // Resting rings, their light and their channels are one cached layer, rebuilt
    // only when a ring starts or stops turning or the flow changes; each frame
    // redraws just the rings in motion (a software canvas stays at 60 fps).
    const moving = this.disp.map((v, i) => v !== this.tgt[i]);
    const key = moving.map((mv, i) => mv ? 'm' : `${((this.tgt[i] % SECTORS) + SECTORS) % SECTORS}${f.powered[i] ? 'p' : ''}`).join();
    if (key !== this._boardKey) { this._board = this.buildBoard(moving, this._board); this._boardKey = key; }
    blit(ctx, this._board);

    // Rings in motion
    this.geo.forEach((g, i) => { if (moving[i]) this.drawRing(ctx, i, this.disp[i] * STEP); });

    // Hovered or dragged ring, and every ring a link will turn with it
    const focusRing = this.drag?.k ?? this.hover;
    if (focusRing >= 0 && !this._over) this.drawHover(ctx, focusRing);

    // Core and its beam
    const ca = sectorAngle(this.ward.core);
    glow(ctx, () => { const a = polar(CORE_R, ca), b = polar(this.geo[0].r0, ca); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }, { width: 3.2, intensity: pulse });
    spark(ctx, CX, CY, CORE_R * 1.9, ARC.energy, 0.55 * pulse);
    const core = ctx.createRadialGradient(CX - 6, CY - 7, 2, CX, CY, CORE_R - 4);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, '#bff6ff'); core.addColorStop(1, '#1f6fb0');
    ctx.beginPath(); ctx.arc(CX, CY, CORE_R - 5, 0, TAU); ctx.fillStyle = core; ctx.fill();

    // Channels of the rings in motion (the resting ones are in the board)
    this.geo.forEach((g, i) => { if (moving[i]) this.channelGlow(ctx, i, this.disp[i] * STEP, f.powered[i]); });

    // Light flowing inside powered rings, and the jump into the next one
    const dash = -t * 70;
    this.geo.forEach((g, i) => {
      if (!f.powered[i]) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.setLineDash([5, 11]); ctx.lineDashOffset = dash;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; this.channelPath(ctx, i, this.disp[i] * STEP); ctx.stroke();
      ctx.restore();
      const next = this.geo[i + 1];
      if (!next || !f.powered[i + 1]) return;
      for (const o of this.ward.rings[i].outlets) {
        const inA = this.ward.rings[i + 1].inlet + this.disp[i + 1], oA = o + this.disp[i];
        if (Math.abs(shortest(oA - inA)) < 0.2) { const p = polar(g.r1 + 2.5, sectorAngle(oA)); spark(ctx, p.x, p.y, 9, ARC.energy, 0.9); }
      }
    });

    // Where the light stops: it waits at the next ring's inner edge, whose gate pulses amber
    if (f.blockedAt >= 0 && !this._over) this.drawWaiting(ctx, f, t);

    // The ward knitting itself back together: a seam creeping around the rim
    this.drawSeam(ctx, t);

    // Rim: anchor crystals, and light spilled where there is none
    const rimR = (RIM_IN + RIM_OUT) / 2;
    for (const s of this.ward.anchors) {
      const a = sectorAngle(s), p = polar(rimR, a);
      const lit = f.fed.includes(s);
      if (lit) {
        glow(ctx, () => { const q = polar(RINGS_OUT, a); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); }, { width: 3, intensity: 0.9 });
        spark(ctx, p.x, p.y, 22, ARC.energy, 0.8 * pulse + 0.2);
      }
      this.drawCrystal(ctx, p.x, p.y, a, lit);
    }
    for (const s of f.fed) {
      if (this.ward.anchors.includes(s)) continue;
      const p = polar(RINGS_OUT + 6, sectorAngle(s));
      spark(ctx, p.x, p.y, 10, ARC.energy, 0.5);
    }

    // Golden links
    this.ward.bindings.forEach((b, i) => this.drawBinding(ctx, b, i, this.flash.link.get(i) ?? 0));

    // The goal, written in the corner
    this.drawGoal(ctx, f);
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

  /** Top-left: what to do, by when, and how many crystals the light reaches. */
  drawGoal(ctx, f) {
    const lit = this.ward.anchors.filter(s => f.fed.includes(s)).length, all = this.ward.anchors.length;
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    ctx.fillStyle = 'rgba(200,212,240,0.78)';
    ctx.fillText('LEAD THE LIGHT', 14, 22);
    ctx.fillText(all > 1 ? 'TO EVERY CRYSTAL' : 'TO THE CRYSTAL', 14, 36);
    ctx.fillStyle = 'rgba(185,162,255,0.8)';
    ctx.fillText('BEFORE THE RIM CLOSES', 14, 50);
    ctx.font = '700 12px "Signika", sans-serif';
    ctx.fillStyle = lit ? hexA(ARC.energy, 0.95) : 'rgba(200,212,240,0.85)';
    ctx.fillText(`${lit} / ${all} LIT`, 14, 70);
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
    const r = (RIM_IN + RIM_OUT) / 2, a0 = -Math.PI / 2, a1 = a0 + TAU * done;
    const late = left / total < 0.25;
    const col = late ? '#ff6a8a' : ARC.violet;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = hexA(col, late ? 0.55 : 0.4); ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(CX, CY, r, a0, a1); ctx.stroke();
    ctx.strokeStyle = hexA(col, 0.9); ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);                          // the stitches
    ctx.beginPath(); ctx.arc(CX, CY, r, a0, a1); ctx.stroke();
    ctx.restore();
    const needle = polar(r, a1);
    spark(ctx, needle.x, needle.y, late ? 13 + 5 * Math.abs(Math.sin(t * 7)) : 11, col, 0.95);
  }

  /** The light waiting at ring i's inner edge, the gate that must meet it, and (insight) which way. */
  drawWaiting(ctx, f, t) {
    const i = f.blockedAt, g = this.geo[i];
    const beat = 0.5 + 0.5 * Math.sin(t * 5);
    for (const s of f.boundary[i]) {
      const p = polar(g.r0 - 1, sectorAngle(s));
      spark(ctx, p.x, p.y, 10 + 4 * beat, ARC.energy, 0.75 + 0.25 * beat);
    }
    const inA = sectorAngle(this.ward.rings[i].inlet + this.disp[i]);
    const a0 = polar(g.r0 - 1, inA), a1 = polar(g.r0 + 7, inA);
    glow(ctx, () => { ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); }, { color: AMBER, width: 4.5, intensity: 0.6 + 0.4 * beat });
    if (!this.ward.params.insight || this.drag) return;
    const hint = nextGate(this.ward, this.game.rot, f, i);
    if (!hint || !hint.steps) return;
    // A dotted trace along the gap, from the gate to the light, with an arrowhead.
    const r = g.r0 - 2, from = inA, to = inA + hint.steps * STEP;
    ctx.save();
    ctx.setLineDash([2, 5]); ctx.lineCap = 'round';
    ctx.strokeStyle = hexA(AMBER, 0.55 + 0.3 * beat); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(CX, CY, r, from, to, hint.steps < 0); ctx.stroke();
    ctx.setLineDash([]);
    const tip = polar(r, to - Math.sign(hint.steps) * 0.06), dir = to + Math.sign(hint.steps) * Math.PI / 2;
    ctx.translate(tip.x, tip.y); ctx.rotate(dir);
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-3, 3.5); ctx.closePath();
    ctx.fillStyle = hexA(AMBER, 0.85); ctx.fill();
    ctx.restore();
  }

  /**
   * Highlight ring k, arrows along it at the pointer, and outline the rings
   * linked to it. Plain strokes: a glow around whole rings costs ~3 ms a frame
   * on a software canvas, and the pointer is over a ring all through play.
   */
  drawHover(ctx, k) {
    const g = this.geo[k];
    const outline = (h, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(CX, CY, h.r1 + 0.5, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(CX, CY, h.r0 - 0.5, 0, TAU); ctx.stroke();
    };
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, g.r1, 0, TAU); ctx.arc(CX, CY, g.r0, 0, TAU, true);
    ctx.fillStyle = 'rgba(134,236,255,0.07)'; ctx.fill();
    outline(g, 'rgba(134,236,255,0.55)');
    ctx.restore();
    const at = this.hoverAt ? Math.atan2(this.hoverAt.y - CY, this.hoverAt.x - CX) : -Math.PI / 2;
    // turn arrows either side of the pointer
    if (this.hoverAt && !this.drag) for (const side of [1, -1]) this.drawArrow(ctx, g.rm, at + side * 0.32, side, 'rgba(200,240,255,0.85)');
    // linked rings: gold outline and the way they will turn
    this.ward.bindings.forEach(b => {
      if (b.from !== k) return;
      const h = this.geo[b.to];
      ctx.save(); outline(h, hexA(ARC.gold, 0.7)); ctx.restore();
      this.drawArrow(ctx, h.rm, at + 0.32, b.dir, hexA(ARC.gold, 0.9));
      this.drawArrow(ctx, h.rm, at - 0.32, -b.dir, hexA(ARC.gold, 0.9));
    });
  }

  /** A small arrowhead on the circle of radius r at angle a, pointing clockwise (dir 1) or back. */
  drawArrow(ctx, r, a, dir, color) {
    const p = polar(r, a);
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(a + dir * Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, -4.5); ctx.lineTo(-1.5, 0); ctx.lineTo(-3.5, 4.5); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  // ── drawing helpers ───────────────────────────────────────────────────

  /** Path of ring i's carved channel at rotation `ang` (radians), in board coordinates. */
  channelPath(ctx, i, ang) {
    const r = this.ward.rings[i], g = this.geo[i];
    const ai = sectorAngle(r.inlet) + ang;
    ctx.beginPath();
    for (const o of r.outlets) {
      const ao = sectorAngle(o) + ang;
      const d = shortest(o - r.inlet) * STEP;
      const a = polar(g.r0, ai), b = polar(g.rm, ai), c = polar(g.r1, ao);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.arc(CX, CY, g.rm, ai, ai + d, d < 0);
      ctx.lineTo(c.x, c.y);
    }
  }

  /** Ring i's gates: short bars across its inner edge (inlet) and outer edge (outlets). */
  gatesPath(ctx, i, ang) {
    const r = this.ward.rings[i], g = this.geo[i];
    ctx.beginPath();
    const bar = (s, ra, rb) => { const a = sectorAngle(s) + ang, p = polar(ra, a), q = polar(rb, a); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); };
    bar(r.inlet, g.r0 - 1.5, g.r0 + 5);
    for (const o of r.outlets) bar(o, g.r1 - 5, g.r1 + 1.5);
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
    const spr = this.ringSprite(i), g = this.geo[i];
    const w = spr.width / spr._dpr, h = spr.height / spr._dpr;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(ang);
    blit(ctx, spr, -w / 2, -h / 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = ringLight(ctx); ctx.lineWidth = g.r1 - g.r0;
    ctx.beginPath(); ctx.arc(CX, CY, g.rm, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  /** Ring i turned to rest position `steps` and lit (one cached copy per ring). */
  restingRing(i, steps) {
    const k = ((steps % SECTORS) + SECTORS) % SECTORS;
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

  /**
   * Ring i's channel and gates: bright cyan when it carries light; otherwise a
   * clear violet route, so the way through can be read before it is lit.
   */
  channelGlow(ctx, i, ang, powered) {
    const path = () => this.channelPath(ctx, i, ang);
    const gates = () => this.gatesPath(ctx, i, ang);
    if (powered) {
      glow(ctx, path, { width: 3.4, intensity: 0.95 });
      glow(ctx, gates, { width: 4.2, intensity: 0.95 });
    } else {
      glow(ctx, path, { color: ARC.violet, width: 2.2, intensity: 0.6, core: false });
      glow(ctx, gates, { color: ARC.violet, width: 4, intensity: 0.85 });
    }
  }

  /** The static layer plus every resting ring and its channel. */
  buildBoard(moving, c = layer(W, H, this._dpr)) {
    const ctx = c.getContext('2d');
    blit(ctx, this._static);                      // opaque: covers the previous board
    this.geo.forEach((g, i) => { if (!moving[i]) this.drawRing(ctx, i, 0, this.tgt[i]); });
    this.geo.forEach((g, i) => { if (!moving[i]) this.channelGlow(ctx, i, this.tgt[i] * STEP, this.game.flow.powered[i]); });
    return c;
  }

  /** Stone ring i with runes and its carved (unlit) channel, at rotation 0. Built once. */
  ringSprite(i) {
    this._sprites ??= [];
    if (this._sprites[i]) return this._sprites[i];
    const g = this.geo[i], r = this.ward.rings[i];
    const size = Math.ceil(g.r1 * 2 + 6);
    const c = layer(size, size, this._dpr);
    const ctx = c.getContext('2d');
    const ox = size / 2, oy = size / 2;
    ctx.translate(ox - CX, oy - CY);               // draw in board coordinates around the centre

    // stone annulus
    const annulus = () => { ctx.beginPath(); ctx.arc(CX, CY, g.r1, 0, TAU); ctx.arc(CX, CY, g.r0, 0, TAU, true); };
    const stone = ctx.createRadialGradient(CX, CY, g.r0, CX, CY, g.r1);
    stone.addColorStop(0, '#262a35'); stone.addColorStop(0.5, '#2e3340'); stone.addColorStop(1, '#22262f');
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

    // which sectors the channel runs through (no runes there)
    const covered = new Set([r.inlet]);
    for (const o of r.outlets) {
      const d = shortest(o - r.inlet), sgn = Math.sign(d) || 1;
      for (let k = 0; k <= Math.abs(d); k++) covered.add(((r.inlet + sgn * k) % SECTORS + SECTORS) % SECTORS);
    }
    // sector ticks and faint runes
    for (let s = 0; s < SECTORS; s++) {
      const b = sectorAngle(s) + STEP / 2;
      engrave(ctx, () => { const p = polar(g.r0 + 2, b), q = polar(g.r1 - 2, b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }, 1, 0.7);
      if (covered.has(s)) continue;
      const p = polar(g.rm, sectorAngle(s));
      const size2 = Math.min(12, (g.r1 - g.r0) * 0.55);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; drawRune(ctx, s * 3 + i * 5, p.x, p.y, size2, sectorAngle(s) + Math.PI / 2);
    }
    // carved channel: dark groove, inner depth, faint lit lip
    ctx.save();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    this.channelPath(ctx, i, 0); ctx.strokeStyle = '#06070a'; ctx.lineWidth = 7.5; ctx.stroke();
    this.channelPath(ctx, i, 0); ctx.strokeStyle = '#121620'; ctx.lineWidth = 4; ctx.stroke();
    ctx.translate(0.6, 0.9);
    this.channelPath(ctx, i, 0); ctx.strokeStyle = 'rgba(190,210,245,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    this._sprites[i] = c;
    return c;
  }

  /** Backdrop, rim band with the crystals' sockets, core socket — never moves. */
  buildStatic() {
    const c = layer(W, H, this._dpr);
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: CX, cy: CY, r: 214 }));
    // rim band
    const rim = () => { ctx.beginPath(); ctx.arc(CX, CY, RIM_OUT, 0, TAU); ctx.arc(CX, CY, RIM_IN, 0, TAU, true); };
    const rg = ctx.createRadialGradient(CX, CY, RIM_IN, CX, CY, RIM_OUT);
    rg.addColorStop(0, '#1b1e27'); rg.addColorStop(1, '#14161d');
    rim(); ctx.fillStyle = rg; ctx.fill();
    for (const rr of [RIM_IN, RIM_OUT]) engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, rr, 0, TAU); }, 1.3, 0.9);
    for (let s = 0; s < SECTORS; s++) {
      const b = sectorAngle(s) + STEP / 2;
      engrave(ctx, () => { const p = polar(RIM_IN + 3, b), q = polar(RIM_OUT - 3, b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }, 1, 0.8);
    }
    // the gap the rings sit in
    ctx.beginPath(); ctx.arc(CX, CY, RINGS_OUT + 3, 0, TAU); ctx.arc(CX, CY, RINGS_IN - 3, 0, TAU, true);
    ctx.fillStyle = '#07080b'; ctx.fill();
    // where the light has to leave the rings: a socket under every crystal
    ctx.save();
    ctx.setLineDash([2, 4]); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(185,162,255,0.45)'; ctx.lineWidth = 1.4;
    for (const s of this.ward.anchors) {
      const a = sectorAngle(s), p = polar(RINGS_OUT + 2, a), q = polar(RIM_IN + 2, a);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    ctx.restore();
    // core socket
    const sock = ctx.createRadialGradient(CX, CY, CORE_R - 6, CX, CY, CORE_R + 4);
    sock.addColorStop(0, '#0a0b0f'); sock.addColorStop(1, '#262a35');
    ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 3, 0, TAU); ctx.fillStyle = sock; ctx.fill();
    engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 3, 0, TAU); }, 1.2, 1);
    return c;
  }

  /** Anchor crystal in a brass socket on the rim. */
  drawCrystal(ctx, x, y, a, lit) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    const ring = ctx.createLinearGradient(-11, -11, 11, 11);
    ring.addColorStop(0, '#f2d68e'); ring.addColorStop(0.5, '#a07a36'); ring.addColorStop(1, '#4e3a17');
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, TAU); ctx.fillStyle = '#0c0e14'; ctx.fill();
    const gem = ctx.createLinearGradient(0, -8, 0, 8);
    if (lit) { gem.addColorStop(0, '#ffffff'); gem.addColorStop(0.5, ARC.energy); gem.addColorStop(1, ARC.energyLo); }
    else     { gem.addColorStop(0, '#b9a2ff'); gem.addColorStop(1, '#3a2c66'); }
    ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(5.5, 0); ctx.lineTo(0, 7.5); ctx.lineTo(-5.5, 0); ctx.closePath();
    ctx.fillStyle = gem; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();
  }

  /** Golden link from ring `from` (knot) to ring `to` (arrow); crossed when it turns it the other way. */
  drawBinding(ctx, b, i, flashV) {
    const k = [1, 4, 6, 2, 5][i % 5];
    const a = sectorAngle(k) + STEP / 2;
    const g1 = this.geo[b.from], g2 = this.geo[b.to];
    const p1 = polar(g1.rm, a), p2 = polar(g2.rm, a);
    const nx = -Math.sin(a), ny = Math.cos(a);                 // across the link
    const col = ARC.gold;
    const intensity = 0.75 + 0.6 * flashV;
    const strand = (side) => () => {
      ctx.beginPath();
      if (b.dir > 0) {
        ctx.moveTo(p1.x + nx * 2.2 * side, p1.y + ny * 2.2 * side);
        ctx.lineTo(p2.x + nx * 2.2 * side, p2.y + ny * 2.2 * side);
      } else {                                                 // crossed strands
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        ctx.moveTo(p1.x + nx * 3 * side, p1.y + ny * 3 * side);
        ctx.quadraticCurveTo(mx, my, p2.x - nx * 3 * side, p2.y - ny * 3 * side);
      }
    };
    glow(ctx, strand(1), { color: col, width: 1.3, intensity, core: false });
    glow(ctx, strand(-1), { color: col, width: 1.3, intensity, core: false });
    // knot at the driving ring, arrow at the driven ring
    spark(ctx, p1.x, p1.y, 7 + 6 * flashV, col, 0.9);
    ctx.save();
    ctx.translate(p2.x, p2.y);
    ctx.rotate(Math.atan2(p2.y - p1.y, p2.x - p1.x));
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-4, -4); ctx.lineTo(-2, 0); ctx.lineTo(-4, 4); ctx.closePath();
    ctx.fillStyle = hexA(col, 0.95); ctx.fill();
    ctx.restore();
    if (flashV > 0) spark(ctx, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 24 * flashV, col, flashV);
  }
}
