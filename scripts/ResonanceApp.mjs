/**
 * ResonanceApp.mjs — "Attune the Resonance": hold your focus on a wandering
 * light in a scrying pool.
 *
 * The working's resonance is a wisp drifting through a dark pool ringed with
 * runes. The caster's focus is a ring of light that glides after the pointer.
 * While the wisp is inside it, the focus turns gold, the runes around the pool
 * wake one by one and a quiet fifth sounds over the hum; outside it the
 * attunement slowly fades. Wake every rune before concentration runs out.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateResonance, ResonanceGame, RUNE_COUNT } from './resonance-logic.mjs';
import { ARC, TAU, RUNES, layer, blit, backdrop, drawRune, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { rng } from './ward-logic.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 440, CX = 260, CY = 218;
const POOL = 158, RIM_IN = 160, RIM_OUT = 200, RUNE_R = 180;
const TRAIL = 22;
const runeAngle = i => -Math.PI / 2 + i * TAU / RUNE_COUNT;

/** A rune as a path only (glow() strokes it in several passes). */
function runePath(ctx, idx, x, y, size, rot) {
  const segs = RUNES[((idx % RUNES.length) + RUNES.length) % RUNES.length];
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, v) => [x + (u * c - v * s) * size, y + (u * s + v * c) * size];
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(...P(x1, y1)); ctx.lineTo(...P(x2, y2)); }
}

export class ResonanceApp extends MiniGameApp {
  static KIND   = 'resonance';
  static TITLE  = 'Attune the Resonance';
  static CANVAS = { w: W, h: H };

  buildGame(init) {
    this.res = generateResonance(init);
    this.game = new ResonanceGame(this.res);
    this.endDelay = 1.3;
    this.audio = null;
    this.trail = [];
    this.runeIds = Array.from({ length: RUNE_COUNT }, (_, i) => (this.res.seed + i * 7) % RUNES.length);
    this.woke = 0;                         // runes already announced with a chime
  }

  meterHTML() {
    return barHTML('Concentration', this.game.timeLeft, this.res.params.time, {
      text: `${Math.ceil(this.game.timeLeft)} s`, tip: 'When your concentration runs out the resonance slips away.',
    });
  }

  hintHTML() {
    return 'Move your <span class="lpm-hint-cyan">focus</span> with the mouse'
      + ' &middot; keep the <span class="lpm-hint-violet">wandering light</span> inside it'
      + ' &middot; wake every <span class="lpm-hint-amber">rune</span>';
  }

  // ── input ─────────────────────────────────────────────────────────────

  bindInput(canvas) {
    const aim = ev => {
      const b = canvas.getBoundingClientRect();
      const x = (ev.clientX - b.left) * (W / b.width), y = (ev.clientY - b.top) * (H / b.height);
      const inPool = Math.hypot(x - CX, y - CY) <= POOL;
      canvas.style.cursor = inPool && !this._over ? 'none' : 'default';
      if (this._over) return;
      this.game.aimAt((x - CX) / POOL, (y - CY) / POOL);
      this.startTones();
    };
    canvas.addEventListener('pointermove', aim);
    canvas.addEventListener('pointerdown', aim);
  }

  // ── sound: the hum, and your fifth that falls into tune over it ────────

  startTones() {
    if (this.audio || this._spectator) return;
    const io = Sfx.audio();
    if (!io) return;
    const { ac, out } = io;
    const mk = (type, freq, gain) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = 0; o.connect(g); g.connect(out); o.start();
      g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.8);
      return { o, g, gain };
    };
    const f = this.res.tone;
    this.audio = { ac, hum: mk('sine', f, 0.03), voice: mk('triangle', f * 1.5, 0.016), shimmer: mk('sine', f * 2, 0) };
  }

  updateTones() {
    const a = this.audio;
    if (!a) return;
    const now = a.ac.currentTime, f = this.res.tone, g = this.game;
    const w = g.wisp(), d = Math.hypot(w.x - g.focus.x, w.y - g.focus.y) / this.res.params.focus;
    // In the ring: a clean fifth. Further out: it drifts sharp and beats against the hum.
    a.voice.o.frequency.setTargetAtTime(f * 1.5 * (g.inside ? 1 : 1 + 0.025 * Math.min(3, d)), now, 0.08);
    a.shimmer.g.gain.setTargetAtTime(g.inside ? 0.012 + 0.02 * g.attune : 0, now, 0.2);
  }

  teardown() {
    const a = this.audio;
    if (!a) return;
    this.audio = null;
    const now = a.ac.currentTime;
    for (const n of [a.hum, a.voice, a.shimmer]) {
      try { n.g.gain.setTargetAtTime(0, now, 0.08); n.o.stop(now + 0.5); } catch (e) {}
    }
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    if (this._over) return null;
    const out = this._spectator ? null : this.game.update(dt);
    if (this._spectator) this.game.advance(dt);            // the wisp moves on between syncs
    const w = this.game.wisp();
    this.trail.push({ x: CX + w.x * POOL, y: CY + w.y * POOL });
    if (this.trail.length > TRAIL) this.trail.shift();
    const runes = this.game.runes();
    if (runes > this.woke) { this.woke = runes; if (!this._spectator) Sfx.node(runes); }
    else if (runes < this.woke) this.woke = runes;
    this.updateTones();
    this._meterAcc = (this._meterAcc ?? 0) + dt;
    if (this._meterAcc > 0.25) { this._meterAcc = 0; this.refreshMeter(); }
    if (out === 'won') Sfx.unweave();
    if (out === 'lost') Sfx.fail();
    return out;
  }

  syncState() { return this.game.snapshot(); }
  applySync(s) { this.game.apply(s); }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    blit(ctx, this._static);
    const g = this.game, t = this._t, p = this.res.params;
    const w = g.wisp(), wx = CX + w.x * POOL, wy = CY + w.y * POOL;
    const fx = CX + g.focus.x * POOL, fy = CY + g.focus.y * POOL, fr = p.focus * POOL;

    // the wisp lights the water around it
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, POOL, 0, TAU); ctx.clip();
    spark(ctx, wx, wy, 110, g.inside ? ARC.gold : ARC.violet, 0.22);
    // its trail, fading
    ctx.globalCompositeOperation = 'lighter';
    this.trail.forEach((q, i) => {
      const k = (i + 1) / this.trail.length;
      ctx.fillStyle = hexA(g.inside ? ARC.gold : '#c9b3ff', 0.22 * k);
      ctx.beginPath(); ctx.arc(q.x, q.y, 1.5 + 4 * k, 0, TAU); ctx.fill();
    });
    ctx.restore();

    // runes: awake ones glow gold, the one waking flickers in
    const awake = g.runes(), frac = g.attune * RUNE_COUNT - awake;
    for (let i = 0; i < RUNE_COUNT; i++) {
      const lit = i < awake ? 1 : i === awake ? frac * (0.6 + 0.4 * Math.sin(t * 12)) : 0;
      if (lit <= 0.02) continue;
      const a = runeAngle(i), x = CX + Math.cos(a) * RUNE_R, y = CY + Math.sin(a) * RUNE_R;
      glow(ctx, () => runePath(ctx, this.runeIds[i], x, y, 15, a + Math.PI / 2), { color: ARC.gold, width: 1.8, intensity: 0.4 + 0.6 * lit });
    }
    // the attunement, also as an arc round the pool's edge
    if (g.attune > 0) glow(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, POOL + 1, -Math.PI / 2, -Math.PI / 2 + TAU * g.attune); },
      { color: ARC.gold, width: 1.6, intensity: 0.8, core: false });

    // the wisp
    spark(ctx, wx, wy, 20, g.inside ? ARC.gold : ARC.violet, 0.95);
    spark(ctx, wx, wy, 7, '#ffffff', 1);

    // your focus: a ring of light with three motes running round it
    if (!this._over) {
      const col = g.inside ? ARC.gold : ARC.energy;
      if (g.inside) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hexA(ARC.gold, 0.07); ctx.beginPath(); ctx.arc(fx, fy, fr, 0, TAU); ctx.fill();
        ctx.restore();
      }
      glow(ctx, () => { ctx.beginPath(); ctx.arc(fx, fy, fr, 0, TAU); }, { color: col, width: g.inside ? 1.8 : 1.2, intensity: g.inside ? 0.95 : 0.6, core: g.inside });
      for (let k = 0; k < 3; k++) {
        const a = t * (g.inside ? 2.4 : 1.2) + k * TAU / 3;
        spark(ctx, fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, 6, col, 0.9);
      }
    }

    this.drawGoal(ctx, awake);
  }

  /** Top-left: what to do, and how many runes are awake. */
  drawGoal(ctx, awake) {
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    ctx.fillStyle = 'rgba(200,212,240,0.78)';
    ctx.fillText('KEEP THE LIGHT', 14, 22);
    ctx.fillText('IN YOUR FOCUS', 14, 36);
    ctx.font = '700 12px "Signika", sans-serif';
    ctx.fillStyle = awake ? hexA(ARC.gold, 0.95) : 'rgba(200,212,240,0.85)';
    ctx.fillText(`${awake} / ${RUNE_COUNT} RUNES AWAKE`, 14, 56);
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
      // the light sinks into the deep
      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, POOL, 0, TAU); ctx.clip();
      ctx.fillStyle = `rgba(2,3,10,${0.7 * k})`; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = `rgba(40,6,4,${0.35 * k})`; ctx.fillRect(0, 0, W, H);
    }
  }

  endScreen(success) {
    return success
      ? { title: 'Resonance Attuned', sub: 'The hum falls silent — it answers to you', icon: (c, x, y, tone) => ARCANE_ICONS.wisp(c, x, y, tone, true) }
      : { title: 'The Resonance Slips', sub: 'The light sinks back into the deep', icon: (c, x, y, tone) => ARCANE_ICONS.wisp(c, x, y, tone, false) };
  }

  /** Backdrop, the stone basin with its rune sockets, the dark water and its stars. */
  buildStatic() {
    const c = layer(W, H, this._dpr);
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: CX, cy: CY, r: 212 }));
    // stone basin
    const rim = () => { ctx.beginPath(); ctx.arc(CX, CY, RIM_OUT, 0, TAU); ctx.arc(CX, CY, RIM_IN, 0, TAU, true); };
    const stone = ctx.createRadialGradient(CX, CY, RIM_IN, CX, CY, RIM_OUT);
    stone.addColorStop(0, '#2b2f3b'); stone.addColorStop(0.5, '#323745'); stone.addColorStop(1, '#22252f');
    rim(); ctx.fillStyle = stone; ctx.fill();
    const light = ctx.createLinearGradient(CX - RIM_OUT, CY - RIM_OUT, CX + RIM_OUT, CY + RIM_OUT);
    light.addColorStop(0, 'rgba(210,225,255,0.10)'); light.addColorStop(0.5, 'rgba(0,0,0,0)'); light.addColorStop(1, 'rgba(0,0,0,0.3)');
    rim(); ctx.fillStyle = light; ctx.fill();
    for (const rr of [RIM_OUT, RIM_IN]) engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, rr, 0, TAU); }, 1.4, 1);
    // rune sockets, carved and dark until they wake
    for (let i = 0; i < RUNE_COUNT; i++) {
      const a = runeAngle(i), x = CX + Math.cos(a) * RUNE_R, y = CY + Math.sin(a) * RUNE_R;
      ctx.beginPath(); ctx.arc(x, y, 13, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
      engrave(ctx, () => { ctx.beginPath(); ctx.arc(x, y, 13, 0, TAU); }, 1, 0.8);
      ctx.save(); ctx.translate(0, 0.7); ctx.strokeStyle = 'rgba(190,205,240,0.10)'; ctx.lineWidth = 1.5; drawRune(ctx, this.runeIds[i], x, y, 15, a + Math.PI / 2); ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.5; drawRune(ctx, this.runeIds[i], x, y, 15, a + Math.PI / 2);
    }
    // the water: deep, with a drift of stars and two faint clouds
    const water = ctx.createRadialGradient(CX - 30, CY - 40, 10, CX, CY, POOL);
    water.addColorStop(0, '#141a3a'); water.addColorStop(0.6, '#0a0d22'); water.addColorStop(1, '#04050c');
    ctx.beginPath(); ctx.arc(CX, CY, POOL, 0, TAU); ctx.fillStyle = water; ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, POOL, 0, TAU); ctx.clip();
    const R = rng(this.res.seed + 99);
    for (const [col, n] of [['rgba(150,110,255,', 2], ['rgba(90,200,255,', 2]]) {
      for (let i = 0; i < n; i++) {
        const x = CX + (R() - 0.5) * POOL * 1.4, y = CY + (R() - 0.5) * POOL * 1.4, r = 50 + R() * 70;
        const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
        cloud.addColorStop(0, col + '0.10)'); cloud.addColorStop(1, col + '0)');
        ctx.fillStyle = cloud; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 140; i++) {
      const a = R() * TAU, rr = Math.sqrt(R()) * POOL, s = R();
      ctx.fillStyle = `rgba(220,230,255,${0.15 + 0.5 * s * s})`;
      ctx.fillRect(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, s > 0.92 ? 1.6 : 1, s > 0.92 ? 1.6 : 1);
    }
    // the edge of the water sinks into shadow
    const edge = ctx.createRadialGradient(CX, CY, POOL * 0.7, CX, CY, POOL);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = edge; ctx.fillRect(CX - POOL, CY - POOL, POOL * 2, POOL * 2);
    ctx.restore();
    return c;
  }
}
