/**
 * WardApp.mjs — "Unweave the Ward": concentric rune rings cut into dark stone.
 *
 * Turn the rings so the ley light runs from the core through every ring's
 * carved channel to the anchors on the rim. Where the flow stops, the last
 * lit ring's outlets sputter — that is the ring to look at. Golden threads are
 * bindings: turning the ring at the knot drags the ring at the arrow; a crossed
 * thread turns it the opposite way. Spilling light into a red rune costs focus.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateWard, WardGame, SECTORS } from './ward-logic.mjs';
import { ARC, TAU, layer, blit, backdrop, drawRune, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 440, CX = 260, CY = 222;
const CORE_R = 24, RINGS_IN = 34, RINGS_OUT = 172, RIM_IN = 180, RIM_OUT = 204;
const STEP = TAU / SECTORS;
const sectorAngle = s => -Math.PI / 2 + s * STEP;
const shortest = d => ((d % SECTORS) + SECTORS + SECTORS / 2) % SECTORS - SECTORS / 2;

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
    this.queue = [];
    this.flash = { trap: 0, reveal: new Map() };
    this.shake = 0;
    this.endDelay = 1.2;
  }

  meterHTML() {
    return barHTML('Focus', this.game.focus, this.ward.focus, {
      tip: 'Every turn costs 1 focus. Spilling light into a red rune costs 2 more.',
    });
  }

  hintHTML() {
    return '<strong>Click</strong> a ring to turn it &middot; <strong>right-click</strong> turns it back'
      + ' &middot; guide the light to every <span class="lpm-hint-green">anchor</span>';
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
    canvas.addEventListener('pointermove', ev => { const p = pos(ev); this.hover = this.ringAt(p.x, p.y); canvas.style.cursor = this.hover >= 0 ? 'pointer' : 'default'; });
    canvas.addEventListener('pointerleave', () => { this.hover = -1; });
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    canvas.addEventListener('mousedown', ev => {
      const p = pos(ev); const k = this.ringAt(p.x, p.y);
      if (k < 0 || (ev.button !== 0 && ev.button !== 2)) return;
      ev.preventDefault();
      this.requestTurn(k, ev.button === 2 ? -1 : 1);
    });
    canvas.addEventListener('wheel', ev => {
      const p = pos(ev); const k = this.ringAt(p.x, p.y);
      if (k < 0) return;
      ev.preventDefault();
      this.requestTurn(k, ev.deltaY > 0 ? 1 : -1);
    }, { passive: false });
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
    for (const i of r.fired) { const b = this.ward.bindings[i]; this.tgt[b.to] += d * b.dir; }
    Sfx.ringTurn();
    r.revealed.forEach(i => { this.flash.reveal.set(i, 1); Sfx.reveal(); });
    r.newlyPowered.forEach((i, n) => this.later(() => Sfx.channel(i), 140 + n * 110));
    if (r.trap) { this.flash.trap = 1; this.shake = 7; this.later(() => Sfx.backlash(), 120); }
    this.refreshMeter();
    if (r.won) this.later(() => { Sfx.unweave(); this._end(true); }, 380);
    else if (r.lost) this.later(() => { Sfx.fail(); this._end(false); }, 420);
  }

  // ── sync ──────────────────────────────────────────────────────────────

  syncState() { return this.game.snapshot(); }

  applySync(s) {
    if (!s) return;
    s.rot.forEach((v, i) => { this.tgt[i] += shortest(v - this.game.rot[i]); });
    const had = new Set(this.game.revealed);
    this.game.apply(s);
    for (const i of this.game.revealed) if (!had.has(i)) this.flash.reveal.set(i, 1);
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    const ease = 1 - Math.pow(0.0008, dt);
    // Land exactly on the target, so a ring at rest goes back into the cached board.
    this.disp = this.disp.map((v, i) => {
      const n = v + (this.tgt[i] - v) * ease;
      return Math.abs(this.tgt[i] - n) < 0.002 ? this.tgt[i] : n;
    });
    if (!this.animating() && this.queue.length && !this._over) this.turn(...this.queue.shift());
    this.flash.trap = Math.max(0, this.flash.trap - dt * 1.6);
    for (const [i, v] of this.flash.reveal) { if (v <= 0) this.flash.reveal.delete(i); else this.flash.reveal.set(i, v - dt * 0.9); }
    this.shake = Math.max(0, this.shake - dt * 30);
    return null;
  }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    const f = this.game.flow;
    const t = this._t;

    // Resting rings, their light and their channels are one cached layer, rebuilt
    // only when a ring starts or stops turning or the flow changes; each frame
    // redraws just the rings in motion (a software canvas stays at 60 fps).
    const moving = this.disp.map((v, i) => v !== this.tgt[i]);
    const key = moving.map((mv, i) => mv ? 'm' : `${((this.tgt[i] % SECTORS) + SECTORS) % SECTORS}${f.powered[i] ? 'p' : ''}`).join();
    if (key !== this._boardKey) { this._board = this.buildBoard(moving, this._board); this._boardKey = key; }

    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    if (sx || sy) { ctx.fillStyle = '#090a0e'; ctx.fillRect(0, 0, W, H); }
    ctx.save();
    ctx.translate(sx, sy);
    blit(ctx, this._board);

    // Rings in motion
    this.geo.forEach((g, i) => { if (moving[i]) this.drawRing(ctx, i, this.disp[i] * STEP); });

    // Hovered ring
    if (this.hover >= 0 && !this._over) {
      const g = this.geo[this.hover];
      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, g.r1, 0, TAU); ctx.arc(CX, CY, g.r0, 0, TAU, true);
      ctx.fillStyle = 'rgba(134,236,255,0.06)'; ctx.fill();
      ctx.restore();
      glow(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, g.r1 + 0.5, 0, TAU); }, { color: ARC.energyLo, width: 0.8, intensity: 0.5, core: false });
    }

    // Core and its beam
    const pulse = 0.75 + 0.25 * Math.sin(t * 3.1);
    const ca = sectorAngle(this.ward.core);
    glow(ctx, () => { ctx.beginPath(); ctx.moveTo(CX + Math.cos(ca) * CORE_R, CY + Math.sin(ca) * CORE_R); ctx.lineTo(CX + Math.cos(ca) * this.geo[0].r0, CY + Math.sin(ca) * this.geo[0].r0); }, { width: 3.2, intensity: pulse });
    spark(ctx, CX, CY, CORE_R * 1.9, ARC.energy, 0.55 * pulse);
    const core = ctx.createRadialGradient(CX - 6, CY - 7, 2, CX, CY, CORE_R - 4);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, '#bff6ff'); core.addColorStop(1, '#1f6fb0');
    ctx.beginPath(); ctx.arc(CX, CY, CORE_R - 5, 0, TAU); ctx.fillStyle = core; ctx.fill();

    // Channels of the rings in motion (the resting ones are in the board)
    this.geo.forEach((g, i) => { if (moving[i]) this.channelGlow(ctx, i, this.disp[i] * STEP, f.powered[i]); });

    // Light flowing inside powered rings
    const dash = -t * 70;
    this.geo.forEach((g, i) => {
      if (!f.powered[i]) return;
      const ang = this.disp[i] * STEP;
      const path = () => this.channelPath(ctx, i, ang);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.setLineDash([5, 11]); ctx.lineDashOffset = dash;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; path(); ctx.stroke();
      ctx.restore();
      // the jump into the next ring
      const outs = this.ward.rings[i].outlets.map(o => o + this.disp[i]);
      const next = this.geo[i + 1];
      for (const o of outs) {
        const a = -Math.PI / 2 + o * STEP;
        const x = CX + Math.cos(a) * (g.r1 + 2.5), y = CY + Math.sin(a) * (g.r1 + 2.5);
        if (next && f.powered[i + 1]) {
          const inA = this.ward.rings[i + 1].inlet + this.disp[i + 1];
          if (Math.abs(shortest(o - inA)) < 0.2) spark(ctx, x, y, 9, ARC.energy, 0.9);
        } else if (next) {
          const flick = 0.35 + 0.65 * Math.abs(Math.sin(t * 17 + o * 3.7));
          spark(ctx, x, y, 7 + flick * 5, ARC.violet, flick);       // light looking for a way on
        }
      }
    });

    // Rim: anchors and traps, fed or not
    const fed = f.fed;
    const rimR = (RIM_IN + RIM_OUT) / 2;
    for (const s of this.ward.anchors) {
      const a = sectorAngle(s), x = CX + Math.cos(a) * rimR, y = CY + Math.sin(a) * rimR;
      const lit = fed.includes(s);
      if (lit) {
        glow(ctx, () => { ctx.beginPath(); ctx.moveTo(CX + Math.cos(a) * RINGS_OUT, CY + Math.sin(a) * RINGS_OUT); ctx.lineTo(x, y); }, { width: 3, intensity: 0.9 });
        spark(ctx, x, y, 22, ARC.energy, 0.8 * pulse + 0.2);
      }
      this.drawCrystal(ctx, x, y, a, lit);
    }
    for (const s of this.ward.traps) {
      const a = sectorAngle(s), x = CX + Math.cos(a) * rimR, y = CY + Math.sin(a) * rimR;
      const hot = fed.includes(s) ? 1 : this.flash.trap;
      ctx.save();
      ctx.strokeStyle = hexA(ARC.danger, 0.55 + 0.45 * hot); ctx.lineWidth = 1.8;
      drawRune(ctx, 21, x, y, 13, a + Math.PI / 2);
      ctx.restore();
      if (hot > 0.05) spark(ctx, x, y, 18 + 10 * hot, ARC.danger, hot);
    }
    // Spilled light: the rim was reached but not at an anchor or trap
    for (const s of fed) {
      if (this.ward.anchors.includes(s) || this.ward.traps.includes(s)) continue;
      const a = sectorAngle(s);
      spark(ctx, CX + Math.cos(a) * (RINGS_OUT + 6), CY + Math.sin(a) * (RINGS_OUT + 6), 10, ARC.energy, 0.5);
    }

    // Bindings (golden threads)
    this.ward.bindings.forEach((b, i) => {
      const flashV = this.flash.reveal.get(i) ?? 0;
      if (!this.game.revealed.has(i) && flashV <= 0) return;
      this.drawBinding(ctx, b, i, flashV);
    });

    // Trap backlash wash
    if (this.flash.trap > 0) {
      const g = ctx.createRadialGradient(CX, CY, 40, CX, CY, W * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(170,30,15,${0.45 * this.flash.trap})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
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
      : { title: 'The Ward Holds', sub: 'The rings lock and the ward flares back', icon: (c, x, y, tone) => ARCANE_ICONS.ward(c, x, y, tone, false) };
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
      ctx.moveTo(CX + Math.cos(ai) * g.r0, CY + Math.sin(ai) * g.r0);
      ctx.lineTo(CX + Math.cos(ai) * g.rm, CY + Math.sin(ai) * g.rm);
      ctx.arc(CX, CY, g.rm, ai, ai + d, d < 0);
      ctx.lineTo(CX + Math.cos(ao) * g.r1, CY + Math.sin(ao) * g.r1);
    }
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
   * Ring i's channel: bright when it carries light; otherwise a faint violet
   * ley line, so the routes can be read before they carry anything.
   */
  channelGlow(ctx, i, ang, powered) {
    const path = () => this.channelPath(ctx, i, ang);
    if (powered) glow(ctx, path, { width: 3.4, intensity: 0.95 });
    else glow(ctx, path, { color: ARC.violet, width: 1.6, intensity: 0.38, core: false });
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
    // sector ticks and runes
    for (let s = 0; s < SECTORS; s++) {
      const b = sectorAngle(s) + STEP / 2;
      engrave(ctx, () => { ctx.beginPath(); ctx.moveTo(CX + Math.cos(b) * (g.r0 + 2), CY + Math.sin(b) * (g.r0 + 2)); ctx.lineTo(CX + Math.cos(b) * (g.r1 - 2), CY + Math.sin(b) * (g.r1 - 2)); }, 1, 0.7);
      if (covered.has(s)) continue;
      const a = sectorAngle(s), x = CX + Math.cos(a) * g.rm, y = CY + Math.sin(a) * g.rm;
      const size2 = Math.min(13, (g.r1 - g.r0) * 0.62);
      ctx.save(); ctx.translate(0, 0.8); ctx.strokeStyle = 'rgba(200,215,245,0.10)'; ctx.lineWidth = 1.3; drawRune(ctx, s * 3 + i * 5, x, y, size2, a + Math.PI / 2); ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.3; drawRune(ctx, s * 3 + i * 5, x, y, size2, a + Math.PI / 2);
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

  /** Backdrop, rim band, core socket — never moves. */
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
      engrave(ctx, () => { ctx.beginPath(); ctx.moveTo(CX + Math.cos(b) * (RIM_IN + 3), CY + Math.sin(b) * (RIM_IN + 3)); ctx.lineTo(CX + Math.cos(b) * (RIM_OUT - 3), CY + Math.sin(b) * (RIM_OUT - 3)); }, 1, 0.8);
    }
    // the gap the rings sit in
    ctx.beginPath(); ctx.arc(CX, CY, RINGS_OUT + 3, 0, TAU); ctx.arc(CX, CY, RINGS_IN - 3, 0, TAU, true);
    ctx.fillStyle = '#07080b'; ctx.fill();
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
    const ring = ctx.createLinearGradient(-9, -9, 9, 9);
    ring.addColorStop(0, '#f2d68e'); ring.addColorStop(0.5, '#a07a36'); ring.addColorStop(1, '#4e3a17');
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, TAU); ctx.fillStyle = '#0c0e14'; ctx.fill();
    const gem = ctx.createLinearGradient(0, -6, 0, 6);
    if (lit) { gem.addColorStop(0, '#ffffff'); gem.addColorStop(0.5, ARC.energy); gem.addColorStop(1, ARC.energyLo); }
    else     { gem.addColorStop(0, '#9f86d8'); gem.addColorStop(1, '#3a2c66'); }
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-4.5, 0); ctx.closePath();
    ctx.fillStyle = gem; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();
  }

  /** Binding thread from ring `from` (knot) to ring `to` (arrow); crossed when it reverses. */
  drawBinding(ctx, b, i, flashV) {
    const k = [1, 4, 6, 2, 5][i % 5];
    const a = sectorAngle(k) + STEP / 2;
    const g1 = this.geo[b.from], g2 = this.geo[b.to];
    const p1 = { x: CX + Math.cos(a) * g1.rm, y: CY + Math.sin(a) * g1.rm };
    const p2 = { x: CX + Math.cos(a) * g2.rm, y: CY + Math.sin(a) * g2.rm };
    const nx = -Math.sin(a), ny = Math.cos(a);                 // across the thread
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
    if (flashV > 0) spark(ctx, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 30 * flashV, col, flashV);
  }
}
