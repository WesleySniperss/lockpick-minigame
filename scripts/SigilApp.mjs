/**
 * SigilApp.mjs — "Trace the Sigil": memorise a sigil, then draw it again.
 *
 * The sigil draws itself stroke by stroke across a ring of star nodes, holds,
 * and fades. Then trace it from memory — click the stars in order, or drag
 * through them. A wrong star cracks the line; three cracks and the working
 * fails. Mana drains around the circle while you trace; a good Arcana roll
 * gives a longer look, more mana, a marked first star and recalls.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateSigil, SigilGame, NODES } from './sigil-logic.mjs';
import { ARC, TAU, layer, blit, backdrop, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 440, CX = 260, CY = 222, SCALE = 168;
const NODE_HIT = 17;
const STROKE_TIME = 0.42;          // seconds per stroke while the sigil draws itself
const FADE = 0.7;
const P = i => ({ x: CX + NODES[i].x * SCALE, y: CY + NODES[i].y * SCALE });

export class SigilApp extends MiniGameApp {
  static KIND   = 'sigil';
  static TITLE  = 'Trace the Sigil';
  static CANVAS = { w: W, h: H };

  buildGame(init) {
    this.sigil = generateSigil(init);
    this.game = new SigilGame(this.sigil);
    this.show = { t: 0, hold: this.sigil.params.showTime, recall: false };   // memorise animation clock
    this.hover = -1;
    this.drag = null;              // pointer position while dragging
    this.cracks = [];              // { from, to, t } wrong strokes fading out
    this.pulses = [];              // { node, t } right-node flashes
    this.endDelay = 1.3;
  }

  get drawTime() { return this.sigil.params.strokes * STROKE_TIME; }

  controlsHTML() {
    if (this._spectator || !this.sigil.params.recalls) return '';
    return `<div class="lpm-arcana-controls lpm-sigil-controls">
      <button type="button" class="lpm-arcana-btn lpm-recall"><i class="fa-solid fa-eye"></i> Recall the sigil</button>
      <span class="lpm-recall-note"></span>
    </div>`;
  }

  meterHTML() {
    const g = this.game, p = this.sigil.params;
    const pins = Array.from({ length: p.cracks }, (_, i) =>
      `<span class="lpm-pip${i < p.cracks - g.cracks ? '' : ' used'}"></span>`).join('');
    return barHTML('Mana', g.mana, p.traceTime, { text: `${Math.ceil(g.mana)} s`, tip: 'Mana drains while you trace.' })
      + `<span class="lpm-attempts-label" title="A wrong star cracks the line">Steady</span><span class="lpm-pips">${pins}</span>`;
  }

  hintHTML() {
    return '<strong>Watch</strong> the sigil, then <strong>trace it</strong> star by star'
      + ' &middot; click or drag &middot; a wrong star <span class="lpm-hint-red">cracks</span> the line';
  }

  // ── input ─────────────────────────────────────────────────────────────

  nodeAt(x, y) {
    let best = -1, bd = NODE_HIT;
    NODES.forEach((_, i) => { const p = P(i), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  bindInput(canvas, root) {
    const pos = ev => {
      const b = canvas.getBoundingClientRect();
      return { x: (ev.clientX - b.left) * (W / b.width), y: (ev.clientY - b.top) * (H / b.height) };
    };
    canvas.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const p = pos(ev); this.drag = p;
      canvas.setPointerCapture?.(ev.pointerId);
      const n = this.nodeAt(p.x, p.y);
      if (n >= 0) this.touch(n);
    });
    canvas.addEventListener('pointermove', ev => {
      const p = pos(ev);
      this.hover = this.nodeAt(p.x, p.y);
      canvas.style.cursor = this.hover >= 0 && this.game.phase === 'trace' && !this.show.recall ? 'pointer' : 'default';
      if (!this.drag) return;
      this.drag = p;
      if (this.hover >= 0 && this.hover !== this._lastTouched) this.touch(this.hover);
    });
    const up = () => { this.drag = null; this._lastTouched = -1; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { this.hover = -1; });
    root.querySelector('.lpm-recall')?.addEventListener('click', () => {
      if (!this.game.recall()) return;
      Sfx.reveal();
      this.show = { t: this.drawTime * 0.55, hold: 0.9, recall: true };    // a quicker replay
      this.refreshMeter(); this.refreshRecall();
    });
    this.refreshRecall();
  }

  refreshRecall() {
    const btn = this.root?.querySelector('.lpm-recall');
    if (!btn) return;
    btn.disabled = this.game.recalls <= 0 || this.game.phase !== 'trace' || this._over;
    const note = this.root.querySelector('.lpm-recall-note');
    if (note) note.textContent = `${this.game.recalls} left · costs 4 s of mana`;
  }

  touch(n) {
    if (this._over || this.show.recall) return;          // no tracing over the replay
    this._lastTouched = n;
    const prev = this.game.progress > 0 ? this.path[this.game.progress - 1] : -1;
    const r = this.game.touch(n);
    if (!r || r === 'same') return;
    if (r === 'right' || r === 'won') { this.pulses.push({ node: n, t: 0 }); Sfx.node(this.game.progress); }
    if (r === 'wrong' || r === 'lost') { this.cracks.push({ from: prev, to: n, t: 0 }); Sfx.crack(); }
    this.refreshMeter();
    if (r === 'won') this.later(() => { Sfx.unweave(); this._end(true); }, 250);
    if (r === 'lost') this.later(() => { Sfx.fail(); this._end(false); }, 300);
  }

  get path() { return this.sigil.path; }

  // ── sync ──────────────────────────────────────────────────────────────

  syncState() { return { ...this.game.snapshot(), recallAt: this.show.recall ? this.show.t : null }; }

  applySync(s) {
    if (!s) return;
    const before = this.game.progress, cracks = this.game.cracks;
    const wasRecalls = this.game.recalls;
    this.game.apply(s);
    if (this.game.progress > before) this.pulses.push({ node: this.path[this.game.progress - 1], t: 0 });
    if (this.game.cracks > cracks && s.wrong !== null) this.cracks.push({ from: this.path[Math.max(0, this.game.progress - 1)], to: s.wrong, t: 0 });
    if (this.game.recalls < wasRecalls) this.show = { t: this.drawTime * 0.55, hold: 0.9, recall: true };
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    const g = this.game;
    // memorise / recall animation clock
    if (g.phase === 'memorize' || this.show.recall) {
      this.show.t += dt;
      if (this.show.t >= this.drawTime + this.show.hold + FADE) {
        if (this.show.recall) this.show.recall = false;
        else if (!this._spectator) { g.startTracing(); this.refreshRecall(); }
      }
    }
    for (const c of this.cracks) c.t += dt;
    this.cracks = this.cracks.filter(c => c.t < 0.9);
    for (const p of this.pulses) p.t += dt;
    this.pulses = this.pulses.filter(p => p.t < 0.6);
    // A recall costs exactly its 4 s: mana holds while the replay is on screen.
    if (this._spectator || this._over || this.show.recall) return null;
    const out = g.update(dt);
    this._acc = (this._acc ?? 0) + dt;
    if (this._acc > 0.25) { this._acc = 0; this.refreshMeter(); }
    if (out === 'lost') { Sfx.fail(); return 'lost'; }
    return null;
  }

  /** How much of the sigil is visible during the memorise / recall animation (0..1 strokes drawn, alpha). */
  showState() {
    const t = Math.max(0, this.show.t), dT = this.drawTime;
    if (t < dT) return { strokes: t / STROKE_TIME, alpha: 1 };
    if (t < dT + this.show.hold) return { strokes: this.sigil.params.strokes, alpha: 1 };
    return { strokes: this.sigil.params.strokes, alpha: Math.max(0, 1 - (t - dT - this.show.hold) / FADE) };
  }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    blit(ctx, this._static);
    const g = this.game, t = this._t;

    // Mana ring round the field
    if (g.phase === 'trace') {
      const f = g.mana / this.sigil.params.traceTime;
      const low = f < 0.25;
      glow(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, SCALE + 26, -Math.PI / 2, -Math.PI / 2 + TAU * f); },
        { color: low ? ARC.danger : ARC.violet, width: 2.4, intensity: low ? 0.7 + 0.3 * Math.sin(t * 10) : 0.8, core: false });
    }

    // The sigil drawing itself (memorise, recall)
    const showing = g.phase === 'memorize' || this.show.recall;
    if (showing) {
      const { strokes, alpha } = this.showState();
      const full = Math.floor(strokes), part = strokes - full;
      const path = () => {
        ctx.beginPath();
        const a = P(this.path[0]); ctx.moveTo(a.x, a.y);
        for (let i = 1; i <= Math.min(full, this.path.length - 1); i++) { const p = P(this.path[i]); ctx.lineTo(p.x, p.y); }
        if (full < this.path.length - 1 && part > 0) {
          const p0 = P(this.path[full]), p1 = P(this.path[full + 1]);
          ctx.lineTo(p0.x + (p1.x - p0.x) * part, p0.y + (p1.y - p0.y) * part);
        }
      };
      glow(ctx, path, { color: ARC.violet, width: 3.6, intensity: alpha });
      glow(ctx, path, { color: ARC.gold, width: 1.4, intensity: 0.8 * alpha, core: false });
      for (let i = 0; i <= Math.min(full, this.path.length - 1); i++) { const p = P(this.path[i]); spark(ctx, p.x, p.y, 16, ARC.gold, 0.8 * alpha); }
    }

    // The trace so far
    if (g.progress > 0) {
      const traced = () => {
        ctx.beginPath();
        const a = P(this.path[0]); ctx.moveTo(a.x, a.y);
        for (let i = 1; i < g.progress; i++) { const p = P(this.path[i]); ctx.lineTo(p.x, p.y); }
      };
      if (g.progress > 1) glow(ctx, traced, { color: ARC.gold, width: 3.2, intensity: 1 });
      // rubber band from the last star to the pointer while dragging
      if (this.drag && !this._over) {
        const a = P(this.path[g.progress - 1]);
        ctx.save(); ctx.setLineDash([4, 6]);
        glow(ctx, () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(this.drag.x, this.drag.y); }, { color: ARC.gold, width: 1.2, intensity: 0.45, core: false });
        ctx.restore();
      }
    }

    // Cracks: wrong strokes flash red and fall away
    for (const c of this.cracks) {
      const k = 1 - c.t / 0.9;
      const b = P(c.to);
      if (c.from >= 0) {
        const a = P(c.from);
        glow(ctx, () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo((a.x + b.x) / 2 + 6 * Math.sin(c.t * 40), (a.y + b.y) / 2); ctx.lineTo(b.x, b.y); }, { color: ARC.danger, width: 2.6, intensity: k });
      }
      spark(ctx, b.x, b.y, 26 * k + 6, ARC.danger, k);
    }

    // Stars
    NODES.forEach((_, i) => {
      const p = P(i);
      const tracedIdx = this.path.indexOf(i);
      const done = tracedIdx >= 0 && tracedIdx < g.progress;
      const isStartMark = g.phase === 'trace' && g.progress === 0 && this.sigil.params.markStart && i === this.path[0];
      const hov = i === this.hover && g.phase === 'trace' && !this._over;
      const tw = 0.6 + 0.4 * Math.sin(t * 2.3 + i * 1.7);
      spark(ctx, p.x, p.y, done ? 16 : hov ? 15 : 9, done ? ARC.gold : ARC.energy, done ? 0.9 : (hov ? 0.9 : 0.35 * tw + 0.2));
      ctx.beginPath(); ctx.arc(p.x, p.y, done ? 4 : 3, 0, TAU);
      ctx.fillStyle = done ? '#fff6d8' : '#dff8ff'; ctx.fill();
      if (isStartMark) {
        const r = 11 + 3 * Math.sin(t * 4);
        glow(ctx, () => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); }, { color: ARC.gold, width: 1.2, intensity: 0.8, core: false });
      }
    });
    for (const pl of this.pulses) {
      const p = P(pl.node), k = 1 - pl.t / 0.6;
      glow(ctx, () => { ctx.beginPath(); ctx.arc(p.x, p.y, 8 + pl.t * 40, 0, TAU); }, { color: ARC.gold, width: 1.6, intensity: k, core: false });
    }

    // Phase caption, engraved under the circle
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(190,200,235,0.7)';
    const cap = g.phase === 'memorize' ? 'MEMORISE THE SIGIL' : this.show.recall ? 'RECALLING' : `TRACE IT — ${g.progress} / ${this.path.length}`;
    ctx.fillText(cap, CX, H - 10);
    ctx.restore();
  }

  renderEnding(ctx, t, success) {
    const k = Math.min(1, t / this.endDelay);
    if (success) {
      // the finished sigil flares, then folds into a seal at the centre
      const s = 1 - 0.85 * k * k;
      const path = () => {
        ctx.beginPath();
        this.path.forEach((n, i) => {
          const p = P(n), x = CX + (p.x - CX) * s, y = CY + (p.y - CY) * s;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
      };
      glow(ctx, path, { color: ARC.gold, width: 3.6 + 3 * Math.sin(k * Math.PI), intensity: 1 });
      spark(ctx, CX, CY, 40 + 120 * k, ARC.gold, Math.sin(k * Math.PI));
    } else {
      ctx.fillStyle = `rgba(45,6,4,${0.6 * k})`; ctx.fillRect(0, 0, W, H);
    }
  }

  endScreen(success) {
    return success
      ? { title: 'Sigil Traced', sub: 'Stroke for stroke — it flares and seals', icon: (c, x, y, tone) => ARCANE_ICONS.sigil(c, x, y, tone, false) }
      : { title: 'The Sigil Fades', sub: 'The line cracks and the sigil gutters out', icon: (c, x, y, tone) => ARCANE_ICONS.sigil(c, x, y, tone, true) };
  }

  buildStatic() {
    const c = layer(W, H, this._dpr);
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: CX, cy: CY, r: SCALE + 38 }));
    // faint web of every legal stroke, so the stars read as one star chart
    ctx.strokeStyle = 'rgba(140,170,230,0.05)'; ctx.lineWidth = 1;
    for (let a = 0; a < NODES.length; a++) for (let b = a + 1; b < NODES.length; b++) {
      const p = P(a), q = P(b);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    for (const r of [0.44, 0.92]) engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, r * SCALE, 0, TAU); }, 1.1, 0.7);
    // mana channel
    engrave(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, SCALE + 26, 0, TAU); }, 4, 0.8);
    return c;
  }
}
