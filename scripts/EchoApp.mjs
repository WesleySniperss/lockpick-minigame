/**
 * EchoApp.mjs — "Sound the Weave": find a hidden weave by its echo.
 *
 * A black mirror in a stone rim, misted over: somewhere in it a weave of light
 * is hidden. Click to call into the dark: a pale ring spreads from the spot,
 * and every thread it reaches glints, then stays faintly seen. Threads grow
 * thicker and brighter towards their knot, so each glimpse says which way to
 * go; a knot shows itself (three loops of light) when a call comes close.
 * Click a knot to undo it: it flares gold and its threads unravel. Every call
 * costs one; undo every knot before they run out. From DC 13 an undone knot
 * ties itself again: a violet seam closes round it, and when it meets, the
 * knot is back.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateWeave, WeaveGame, SAMPLES, RING_TIME, GLINT } from './echo-logic.mjs';
import { ARC, TAU, layer, blit, backdrop, engrave, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { rng } from './ward-logic.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 440, CX = 260, CY = 222;
const FR = 172, RIM_OUT = 200;                     // the mirror's radius, and the rim round it
const THREAD = '#c9b6ff', CALL = '#bfefff';
const BANDS = 6;                                   // a thread drawn in six widths, thick at its knot
const UNRAVEL = 1.2;                               // seconds an undone knot's threads take to fall away
const fx = x => CX + x * FR, fy = y => CY + y * FR;
const band = i => Math.min(BANDS - 1, Math.floor(i * BANDS / SAMPLES));
const bandW = b => 0.9 + 3.8 * Math.pow(1 - (b + 0.5) / BANDS, 1.5);     // width of band b, px
const bandA = b => 0.5 + 0.5 * (1 - (b + 0.5) / BANDS);                  // and how bright

export class EchoApp extends MiniGameApp {
  static KIND   = 'echo';
  static TITLE  = 'Sound the Weave';
  static CANVAS = { w: W, h: H };

  buildGame(init) {
    this.weave = generateWeave(init);
    this.game = new WeaveGame(this.weave);
    this.endDelay = 1.4;
    this.pointer = null;                // where the mouse is over the mirror (field units), for the reach preview
    this.lastCall = -1;
    this.shown = this.weave.knots.map(() => false);        // knots already announced
    this.retied = this.weave.knots.map(() => -1);          // when each knot last tied itself again
    this.syncEvery = 0.1;
  }

  meterHTML() {
    const p = this.weave.params;
    return barHTML('Calls', this.game.left, p.calls, {
      text: `${this.game.left} / ${p.calls}`, tip: 'Every call into the dark costs one. When none are left, the weave holds.',
    });
  }

  hintHTML() {
    return '<strong>Click</strong> to call into the dark'
      + ' &middot; <span class="lpm-hint-violet">threads</span> thicken toward their <span class="lpm-hint-amber">knot</span>'
      + ' &middot; click the knot to undo it';
  }

  // ── input ─────────────────────────────────────────────────────────────

  bindInput(canvas) {
    const at = ev => {
      const b = canvas.getBoundingClientRect();
      const x = ((ev.clientX - b.left) * (W / b.width) - CX) / FR, y = ((ev.clientY - b.top) * (H / b.height) - CY) / FR;
      return { x, y, inside: Math.hypot(x, y) <= 1 };
    };
    canvas.addEventListener('pointermove', ev => {
      const p = at(ev);
      this.pointer = p.inside ? p : null;
      canvas.style.cursor = p.inside && !this._over ? 'crosshair' : 'default';
    });
    canvas.addEventListener('pointerleave', () => { this.pointer = null; });
    canvas.addEventListener('pointerdown', ev => {
      const p = at(ev);
      if (ev.button !== 0 || !p.inside || this._over) return;
      ev.preventDefault();
      this.callAt(p.x, p.y);
    });
  }

  /** A call into the dark at (x, y), field units. A second click within a quarter second is a slip, not a call. */
  callAt(x, y) {
    if (this.game.state !== 'playing' || this.game.t - this.lastCall < 0.25) return;
    this.lastCall = this.game.t;
    const r = this.game.call(x, y);
    if (!r.ok) return;
    Sfx.call();
    if (r.undid >= 0) this.later(() => Sfx.channel(this.game.undoneCount() - 1), 120);
    if (r.won) this.later(() => { Sfx.unweave(); this._end(true); }, 700);
    else if (r.lost) this.later(() => { Sfx.fail(); this._end(false); }, 900);
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    if (this._over) return null;
    const out = this._spectator ? (this.game.advance(dt), null) : this.game.update(dt);
    if (out === 'retie') { this.retied[this.game.lastRetie] = this.game.t; Sfx.backlash(); }
    // a knot showing itself for the first time
    this.game.knotSeen.forEach((t, k) => {
      if (!this.shown[k] && t <= this.game.t) { this.shown[k] = true; if (!this._spectator) Sfx.reveal(); }
    });
    this._meterAcc = (this._meterAcc ?? 0) + dt;
    if (this._meterAcc > 0.25) { this._meterAcc = 0; this.refreshMeter(); }
    return null;                      // the end comes from callAt, after the last ring has spread
  }

  syncState() { return this.game.snapshot(); }

  /** Calls and knots need sending at once; the clock runs on its own in between. */
  syncKey() { return `${this.game.calls.length}|${this.game.undone.map(u => (u === null ? 0 : 1)).join('')}|${this.game.state}`; }

  applySync(s) {
    const before = this.game.undone.slice();
    this.game.apply(s);
    // a knot the player's game has tied again
    before.forEach((u, k) => { if (u !== null && this.game.undone[k] === null) this.retied[k] = this.game.t; });
  }

  /** Has the call that first showed this segment finished glinting? Then it is part of the cached traces. */
  settled(n) { const c = this.game.calls[n]; return !!c && this.game.t >= c.t + RING_TIME + GLINT; }

  /**
   * The thread segments seen so far whose glint is over, in the six widths, as
   * a layer: rebuilt only when a call settles or a knot comes undone or ties
   * again. Calls already made stay marked with a faint ring.
   */
  traces() {
    const g = this.game;
    const done = g.calls.filter((c, n) => this.settled(n)).length;
    const key = `${done}|${g.undone.map(u => (u === null ? 0 : 1)).join('')}`;
    if (key === this._traceKey) return this._traces;
    this._traceKey = key;
    const lay = this._traces ??= layer(W, H, this._dpr);
    const ctx = lay.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const bands = Array.from({ length: BANDS }, () => []);
    this.weave.knots.forEach((k, ki) => {
      if (g.undone[ki] !== null) return;
      k.threads.forEach((th, ti) => {
        const by = g.seenBy[ki][ti];
        for (let i = 0; i < th.length - 1; i++) if (by[i] >= 0 && this.settled(by[i])) bands[band(i)].push(th[i], th[i + 1]);
      });
    });
    ctx.lineCap = 'round';
    bands.forEach((segs, b) => {
      if (!segs.length) return;
      const path = () => { ctx.beginPath(); for (let j = 0; j < segs.length; j += 2) { ctx.moveTo(fx(segs[j].x), fy(segs[j].y)); ctx.lineTo(fx(segs[j + 1].x), fy(segs[j + 1].y)); } };
      ctx.strokeStyle = hexA(ARC.violet, 0.17 * bandA(b)); ctx.lineWidth = bandW(b) * 3.4; path(); ctx.stroke();
      ctx.strokeStyle = hexA(THREAD, 0.75 * bandA(b)); ctx.lineWidth = bandW(b); path(); ctx.stroke();
    });
    // where you have called
    ctx.strokeStyle = hexA(CALL, 0.3); ctx.lineWidth = 1;
    g.calls.forEach((q, n) => { if (this.settled(n)) { ctx.beginPath(); ctx.arc(fx(q.x), fy(q.y), 2.5, 0, TAU); ctx.stroke(); } });
    return lay;
  }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    blit(ctx, this._static);
    blit(ctx, this.traces());
    const g = this.game, t = g.t, p = this.weave.params;

    // threads still glinting from a recent call: white-hot as the ring reaches them, settling to a trace
    const live = Array.from({ length: BANDS }, () => []);
    this.weave.knots.forEach((k, ki) => {
      const gone = g.undone[ki] !== null;
      k.threads.forEach((th, ti) => {
        const seen = g.seen[ki][ti], by = g.seenBy[ki][ti];
        for (let i = 0; i < th.length - 1; i++) {
          if (by[i] < 0 || t < seen[i] || this.settled(by[i]) || gone) continue;
          live[band(i)].push(th[i], th[i + 1], Math.max(0, 1 - (t - seen[i]) / GLINT));
        }
      });
    });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    live.forEach((segs, b) => {
      if (!segs.length) return;
      // two groups: still glinting, and settled to a trace (drawn like the cached ones until their call settles)
      for (const hot of [false, true]) {
        ctx.beginPath();
        let any = false;
        for (let j = 0; j < segs.length; j += 3) {
          if ((segs[j + 2] > 0.05) !== hot) continue;
          any = true;
          ctx.moveTo(fx(segs[j].x), fy(segs[j].y)); ctx.lineTo(fx(segs[j + 1].x), fy(segs[j + 1].y));
        }
        if (!any) continue;
        if (hot) {
          ctx.strokeStyle = hexA(ARC.violet, 0.4 * bandA(b)); ctx.lineWidth = bandW(b) * 4; ctx.stroke();
          ctx.strokeStyle = hexA('#ffffff', 0.95 * bandA(b)); ctx.lineWidth = bandW(b) * 0.9; ctx.stroke();
        } else {
          ctx.strokeStyle = hexA(ARC.violet, 0.17 * bandA(b)); ctx.lineWidth = bandW(b) * 3.4; ctx.stroke();
          ctx.strokeStyle = hexA(THREAD, 0.75 * bandA(b)); ctx.lineWidth = bandW(b); ctx.stroke();
        }
      }
    });
    ctx.restore();

    // motes of light run along the threads you have seen, toward their knot
    this.weave.knots.forEach((k, ki) => {
      if (g.undone[ki] !== null) return;
      k.threads.forEach((th, ti) => {
        const seen = g.seen[ki][ti];
        let lo = -1, hi = -1;
        for (let i = 0; i < seen.length; i++) if (seen[i] <= t) { if (lo < 0) lo = i; hi = i; }
        if (lo < 0 || hi - lo < 2) return;
        for (const off of [0, 0.5]) {
          const f = hi + 1 - (((t * 5) / (hi + 1 - lo) + off + ti * 0.37) % 1) * (hi + 1 - lo), i = Math.floor(f);
          if (i < 0 || i >= seen.length || seen[i] > t) continue;           // never across a stretch still dark
          const a = th[i], b = th[i + 1], u = f - i;
          spark(ctx, fx(a.x + (b.x - a.x) * u), fy(a.y + (b.y - a.y) * u), 3 + 4 * (1 - i / SAMPLES), THREAD, 0.85);
        }
      });
    });

    // an undone knot's threads unravel in gold and fall away
    this.weave.knots.forEach((k, ki) => {
      const u = g.undone[ki];
      if (u === null || t - u > UNRAVEL) return;
      const a = 1 - (t - u) / UNRAVEL;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = hexA(ARC.gold, 0.7 * a); ctx.lineWidth = 1.6;
      ctx.beginPath();
      k.threads.forEach((th, ti) => {
        const seen = g.seen[ki][ti], end = Math.round((1 - a) * SAMPLES);       // unravelling from the knot outwards
        for (let i = end; i < th.length - 1; i++) if (seen[i] <= t) { ctx.moveTo(fx(th[i].x), fy(th[i].y)); ctx.lineTo(fx(th[i + 1].x), fy(th[i + 1].y)); }
      });
      ctx.stroke();
      ctx.restore();
    });

    // the calls' rings
    for (const c of g.calls) {
      const age = t - c.t;
      if (age < 0 || age > RING_TIME + 0.5) continue;
      const r = p.reach * FR * Math.min(1, age / RING_TIME), a = 1 - age / (RING_TIME + 0.5);     // at the pace threads light up
      ctx.strokeStyle = hexA(CALL, 0.16 * a); ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(fx(c.x), fy(c.y), Math.max(1, r), 0, TAU); ctx.stroke();
      ctx.strokeStyle = hexA(CALL, 0.75 * a); ctx.lineWidth = 1.4; ctx.stroke();
      spark(ctx, fx(c.x), fy(c.y), 16, CALL, 0.8 * a);
    }

    // the knots: in view, undone (with the seam that ties it again), or just tied again
    this.weave.knots.forEach((k, ki) => this.drawKnot(ctx, ki, k, t));

    // how far a call would reach, round the pointer
    if (this.pointer && !this._over && g.state === 'playing') {
      ctx.save();
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = hexA(CALL, 0.28); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(fx(this.pointer.x), fy(this.pointer.y), p.reach * FR, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    this.drawNotes(ctx);
  }

  /** A knot as three loops of light, slowly turning; undone, the loops part and turn gold. */
  drawKnot(ctx, ki, k, t) {
    const g = this.game, x = fx(k.x), y = fy(k.y), u = g.undone[ki];
    const size = Math.max(11, this.weave.params.hit * FR);
    const loops = (spread, color, alpha, width) => {
      ctx.strokeStyle = hexA(color, alpha); ctx.lineWidth = width;
      for (let i = 0; i < 3; i++) {
        const a = t * 0.5 + i * TAU / 3 - Math.PI / 2;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * size * spread, y + Math.sin(a) * size * spread, size * 0.55, 0, TAU); ctx.stroke();
      }
    };
    if (u !== null) {
      // undone: a burst, then the loops lie apart in gold while a violet seam closes round them
      const since = t - u;
      if (since < 0.8) spark(ctx, x, y, 40 * (1 - since / 0.8) + 14, ARC.gold, 1 - since / 0.8);
      spark(ctx, x, y, size * 2.4, ARC.gold, 0.35);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      loops(1.0, ARC.gold, 0.35, 4);
      loops(1.0, '#ffe7a8', 0.95, 1.6);
      ctx.restore();
      const share = g.retieShare(ki);
      if (share > 0) {
        const late = share > 0.75, beat = late ? 0.6 + 0.4 * Math.sin(t * 12) : 1;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = hexA(ARC.violet, 0.25 * beat); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, y, size * 1.9, -Math.PI / 2, -Math.PI / 2 + TAU * share); ctx.stroke();
        ctx.strokeStyle = hexA(late ? '#e0b8ff' : ARC.violet, 0.9 * beat); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
      return;
    }
    if (g.knotSeen[ki] > t) return;
    // in view: a soft glow, a dark bed that hides the threads' ends, the loops on it and a bright heart;
    // a flash as it shows itself or ties again
    const fresh = Math.max(0, 1 - (t - Math.max(g.knotSeen[ki], this.retied[ki])) / 0.9);
    const breathe = 0.8 + 0.2 * Math.sin(t * 2.4 + ki);
    spark(ctx, x, y, size * 2.6 + 18 * fresh, this.retied[ki] >= 0 && fresh > 0 ? ARC.violet : THREAD, 0.45 * breathe + 0.5 * fresh);
    const bed = ctx.createRadialGradient(x, y, size * 0.5, x, y, size * 1.25);
    bed.addColorStop(0, 'rgba(6,5,16,0.92)'); bed.addColorStop(1, 'rgba(6,5,16,0)');
    ctx.fillStyle = bed; ctx.beginPath(); ctx.arc(x, y, size * 1.25, 0, TAU); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    loops(0.42, ARC.violet, 0.7, 4.5);
    loops(0.42, '#f2ecff', 0.95 * breathe, 1.7);
    ctx.restore();
    spark(ctx, x, y, 6, '#ffffff', 1);
  }

  /**
   * What never changes: the goal top-left; bottom-left, what the threads say;
   * bottom-right, how soon an undone knot ties again. Part of the static layer.
   */
  drawFixedNotes(ctx) {
    const letters = px => { if ('letterSpacing' in ctx) ctx.letterSpacing = px; };
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    letters('1.6px');
    ctx.fillStyle = 'rgba(200,212,240,0.8)';
    ctx.fillText('CALL INTO THE DARK', 14, 22);
    ctx.fillText('AND UNDO EVERY KNOT', 14, 36);
    ctx.textAlign = 'right';
    ctx.fillStyle = hexA(CALL, 0.85);
    ctx.fillText('CALLS LEFT', W - 14, 22);
    ctx.textAlign = 'left';
    ctx.font = '700 9px "Signika", sans-serif';
    letters('1px');
    ctx.fillStyle = hexA(THREAD, 0.9);
    ctx.fillText('THREADS THICKEN', 14, 411);
    ctx.fillText('TOWARD THEIR KNOT', 14, 424);
    const every = this.weave.params.retie;
    if (every) {
      ctx.textAlign = 'right';
      ctx.fillStyle = hexA(ARC.violet, 0.95);
      ctx.fillText('AN UNDONE KNOT TIES', W - 14, 411);
      ctx.fillText(`AGAIN AFTER ${Math.round(every)} s`, W - 14, 424);
    }
    ctx.restore();
  }

  /** How many knots are undone, and how many calls are left. */
  drawNotes(ctx) {
    const g = this.game, done = g.undoneCount(), all = this.weave.knots.length;
    ctx.save();
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    ctx.font = '700 12px "Signika", sans-serif';
    ctx.fillStyle = done ? hexA(ARC.gold, 0.95) : 'rgba(200,212,240,0.85)';
    ctx.fillText(`${done} / ${all} ${all === 1 ? 'KNOT' : 'KNOTS'} UNDONE`, 14, 56);
    ctx.textAlign = 'right';
    ctx.font = '700 18px "Signika", sans-serif';
    ctx.fillStyle = g.left <= 1 ? '#ff8aa2' : 'rgba(225,232,250,0.92)';
    ctx.fillText(String(g.left), W - 14, 42);
    ctx.restore();
  }

  renderEnding(ctx, t, success) {
    const k = Math.min(1, t / this.endDelay);
    if (success) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(CX, CY, 10, CX, CY, 260);
      g.addColorStop(0, `rgba(255,236,190,${0.6 * Math.sin(k * Math.PI)})`); g.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      // the dark closes over the mirror
      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, FR, 0, TAU); ctx.clip();
      ctx.fillStyle = `rgba(2,3,8,${0.75 * k})`; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = `rgba(40,6,4,${0.35 * k})`; ctx.fillRect(0, 0, W, H);
    }
  }

  endScreen(success) {
    return success
      ? { title: 'Weave Undone', sub: 'The last knot slips — the working falls apart', icon: (c, x, y, tone) => ARCANE_ICONS.knot(c, x, y, tone, true) }
      : { title: 'The Weave Holds', sub: 'Your voice gives out in the dark', icon: (c, x, y, tone) => ARCANE_ICONS.knot(c, x, y, tone, false) };
  }

  /** Backdrop, the stone rim and the black mirror with its mist. */
  buildStatic() {
    const c = layer(W, H, this._dpr, { opaque: true });
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: CX, cy: CY, r: 214 }));
    // the rim
    const rim = () => { ctx.beginPath(); ctx.arc(CX, CY, RIM_OUT, 0, TAU); ctx.arc(CX, CY, FR, 0, TAU, true); };
    const stone = ctx.createRadialGradient(CX, CY, FR, CX, CY, RIM_OUT);
    stone.addColorStop(0, '#2a2e3a'); stone.addColorStop(0.5, '#323745'); stone.addColorStop(1, '#22252f');
    rim(); ctx.fillStyle = stone; ctx.fill();
    const light = ctx.createLinearGradient(CX - RIM_OUT, CY - RIM_OUT, CX + RIM_OUT, CY + RIM_OUT);
    light.addColorStop(0, 'rgba(210,225,255,0.10)'); light.addColorStop(0.5, 'rgba(0,0,0,0)'); light.addColorStop(1, 'rgba(0,0,0,0.3)');
    rim(); ctx.fillStyle = light; ctx.fill();
    for (const rr of [RIM_OUT, FR + 1, (FR + RIM_OUT) / 2]) engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, rr, 0, TAU); }, rr === (FR + RIM_OUT) / 2 ? 0.8 : 1.4, rr === (FR + RIM_OUT) / 2 ? 0.6 : 1);
    // the black mirror
    const glass = ctx.createRadialGradient(CX - 40, CY - 50, 10, CX, CY, FR);
    glass.addColorStop(0, '#11142a'); glass.addColorStop(0.6, '#080a16'); glass.addColorStop(1, '#030409');
    ctx.beginPath(); ctx.arc(CX, CY, FR, 0, TAU); ctx.fillStyle = glass; ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, FR, 0, TAU); ctx.clip();
    // mist drifting over it, and a little dust catching the light
    const R = rng(this.weave.seed + 51);
    for (let i = 0; i < 6; i++) {
      const x = CX + (R() - 0.5) * FR * 1.6, y = CY + (R() - 0.5) * FR * 1.6, r = 50 + R() * 90;
      const col = i % 3 === 0 ? '120,200,255' : '160,130,255';
      const m = ctx.createRadialGradient(x, y, 0, x, y, r);
      m.addColorStop(0, `rgba(${col},0.1)`); m.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = m; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 70; i++) {
      const a = R() * TAU, rr = Math.sqrt(R()) * FR, s = R();
      ctx.fillStyle = `rgba(210,220,255,${0.08 + 0.25 * s * s})`;
      ctx.fillRect(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, 1, 1);
    }
    // a sheen across the glass, and its edge sinking into shadow
    const sheen = ctx.createLinearGradient(CX - FR, CY - FR, CX + FR * 0.2, CY + FR * 0.4);
    sheen.addColorStop(0, 'rgba(200,215,255,0.06)'); sheen.addColorStop(0.5, 'rgba(200,215,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(CX - FR, CY - FR, FR * 2, FR * 2);
    const edge = ctx.createRadialGradient(CX, CY, FR * 0.72, CX, CY, FR);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = edge; ctx.fillRect(CX - FR, CY - FR, FR * 2, FR * 2);
    ctx.restore();
    this.drawFixedNotes(ctx);
    return c;
  }
}
