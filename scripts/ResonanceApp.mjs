/**
 * ResonanceApp.mjs — "Attune the Resonance": match an arcane hum and hold it.
 *
 * The violet wave is the working's hum; the cyan wave is yours, shaped by
 * three dials. Each dial has a light that turns green when that dial matches
 * the hum (amber when close), so the player always knows which one is off.
 * With all three green the waves turn gold and the attunement bar fills;
 * hold it there before concentration runs out. Two quiet tones follow the
 * waves and fall into harmony as they meet.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateResonance, ResonanceGame, RANGES, DIALS, waveAt } from './resonance-logic.mjs';
import { ARC, TAU, layer, blit, backdrop, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 300;
const SCOPE = { x: 22, y: 20, w: 476, h: 196 };
const METER = { x: 22, y: 246, w: 476, h: 16 };
const DIAL = {
  freq : { label: 'Frequency', step: 0.01,         fmt: v => v.toFixed(2) },
  amp  : { label: 'Amplitude', step: 0.01,         fmt: v => `${Math.round(v * 100)}%` },
  phase: { label: 'Phase',     step: Math.PI / 180, fmt: v => `${Math.round(v / TAU * 360)}°` },
};
const STATUS = { ok: 'Matches the hum', near: 'Close', off: 'Off' };
const toHz = f => 220 * Math.pow(2, (f - RANGES.freq[0]) / 1.85);

export class ResonanceApp extends MiniGameApp {
  static KIND   = 'resonance';
  static TITLE  = 'Attune the Resonance';
  static CANVAS = { w: W, h: H };

  buildGame(init) {
    this.res = generateResonance(init);
    this.game = new ResonanceGame(this.res);
    this.endDelay = 1.2;
    this.audio = null;
  }

  controlsHTML() {
    return `<div class="lpm-arcana-controls lpm-res-controls">${DIALS.map(key => {
      const d = DIAL[key], [lo, hi] = RANGES[key];
      return `<label class="lpm-dial" data-dial="${key}">
        <span class="lpm-dial__label">
          <span class="lpm-dial__name"><i class="lpm-dial__light" title="${STATUS.off}"></i>${d.label}</span>
          <b class="lpm-dial__value"></b>
        </span>
        <span class="lpm-dial__track">
          <input type="range" min="${lo}" max="${hi}" step="${d.step}" value="${this.game.player[key]}"
                 ${this._spectator ? 'disabled' : ''} aria-label="${d.label}">
          <i class="lpm-dial__ghost"></i>
        </span>
      </label>`;
    }).join('')}</div>`;
  }

  meterHTML() {
    return barHTML('Concentration', this.game.timeLeft, this.res.params.time, {
      text: `${Math.ceil(this.game.timeLeft)} s`, tip: 'When your concentration runs out the resonance slips away.',
    });
  }

  hintHTML() {
    return 'Turn each dial until its light is <span class="lpm-hint-green">green</span>'
      + ' &middot; <strong>hold</strong> <span class="lpm-hint-cyan">your wave</span> on <span class="lpm-hint-violet">the hum</span>';
  }

  bindInput(canvas, root) {
    for (const el of root.querySelectorAll('.lpm-dial')) {
      const key = el.dataset.dial, input = el.querySelector('input');
      const set = v => { this.game.setDial(key, v); this.startTones(); this.refreshDials(); };
      input.addEventListener('input', () => set(input.value));
      input.addEventListener('keydown', e => e.stopPropagation());       // arrows must not pan the canvas
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const [lo, hi] = RANGES[key];
        const step = (hi - lo) / (e.shiftKey ? 600 : 160);
        set(Number(input.value) + (e.deltaY < 0 ? step : -step));
        input.value = this.game.player[key];
      }, { passive: false });
    }
    this.refreshDials();
  }

  /** Values, the per-dial lights and the insight marks. */
  refreshDials() {
    const root = this.root;
    if (!root) return;
    const t = this.game.target(), m = this.game.match;
    for (const key of DIALS) {
      const el = root.querySelector(`.lpm-dial[data-dial="${key}"]`);
      if (!el) continue;
      const v = this.game.player[key];
      el.querySelector('.lpm-dial__value').textContent = DIAL[key].fmt(v);
      if (this._spectator) el.querySelector('input').value = v;
      const state = m[key].ok ? 'ok' : m[key].near ? 'near' : 'off';
      el.classList.toggle('is-ok', state === 'ok');
      el.classList.toggle('is-near', state === 'near');
      el.querySelector('.lpm-dial__light').title = STATUS[state];
      // Insight: a mark where the true value lies
      const ghost = el.querySelector('.lpm-dial__ghost');
      const show = this.res.params.ghost === 'all' || (this.res.params.ghost === 'freq' && key === 'freq');
      ghost.classList.toggle('is-on', show && !this._over);
      if (show) {
        const [lo, hi] = RANGES[key];
        ghost.style.left = `${((t[key] - lo) / (hi - lo)) * 100}%`;
      }
    }
  }

  // ── sound: two quiet tones that meet in harmony ────────────────────────

  startTones() {
    if (this.audio || this._spectator) return;
    const io = Sfx.audio();
    if (!io) return;
    const { ac, out } = io;
    const mk = (type, gain) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; g.gain.value = 0; o.connect(g); g.connect(out); o.start();
      g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.6);
      return { o, g, gain };
    };
    this.audio = { ac, hum: mk('sine', 0.035), you: mk('triangle', 0.022), fifth: mk('sine', 0) };
  }

  updateTones() {
    const a = this.audio;
    if (!a) return;
    const now = a.ac.currentTime, t = this.game.target();
    a.hum.o.frequency.setTargetAtTime(toHz(t.freq), now, 0.08);
    a.you.o.frequency.setTargetAtTime(toHz(this.game.player.freq), now, 0.05);
    a.fifth.o.frequency.setTargetAtTime(toHz(t.freq) * 1.5, now, 0.08);
    a.fifth.g.gain.setTargetAtTime(0.03 * this.game.meter, now, 0.15);
  }

  teardown() {
    const a = this.audio;
    if (!a) return;
    this.audio = null;
    const now = a.ac.currentTime;
    for (const n of [a.hum, a.you, a.fifth]) {
      try { n.g.gain.setTargetAtTime(0, now, 0.08); n.o.stop(now + 0.5); } catch (e) {}
    }
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    if (this._over) return null;
    const wasInTune = this.game.match.inTune;
    const out = this._spectator ? null : this.game.update(dt);
    if (this._spectator) this.game.advance(dt);         // keep the hum moving between syncs
    if (!this._spectator && this.game.match.inTune && !wasInTune) Sfx.channel(2);
    this.updateTones();
    this._meterAcc = (this._meterAcc ?? 0) + dt;
    if (this._meterAcc > 0.2) { this._meterAcc = 0; this.refreshMeter(); this.refreshDials(); }
    if (out === 'won') Sfx.unweave();
    if (out === 'lost') Sfx.fail();
    return out;
  }

  syncState() { return this.game.snapshot(); }
  applySync(s) { this.game.apply(s); this.refreshDials(); }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    blit(ctx, this._static);
    const g = this.game, t = g.target(), m = g.match;
    const S = SCOPE, midY = S.y + S.h / 2, amp = S.h * 0.42;
    const px = i => S.x + 6 + i * (S.w - 12) / 120;
    const wavePath = w => () => {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const y = midY - waveAt(w, i / 120) * amp;
        i ? ctx.lineTo(px(i), y) : ctx.moveTo(px(i), y);
      }
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(S.x + 2, S.y + 2, S.w - 4, S.h - 4); ctx.clip();
    // In tune: both waves turn gold and the glass glows.
    const hum = m.inTune ? ARC.gold : ARC.violet, you = m.inTune ? ARC.gold : ARC.energy;
    glow(ctx, wavePath(t), { color: hum, width: 2.4, intensity: 0.85, core: m.inTune });
    glow(ctx, wavePath(g.player), { color: you, width: 2.2, intensity: 0.95 });
    if (m.inTune) {
      const pulse = 0.5 + 0.5 * Math.sin(this._t * 9);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const bloom = ctx.createLinearGradient(0, S.y, 0, S.y + S.h);
      bloom.addColorStop(0, 'rgba(242,214,142,0)'); bloom.addColorStop(0.5, `rgba(242,214,142,${0.10 + 0.06 * pulse})`); bloom.addColorStop(1, 'rgba(242,214,142,0)');
      ctx.fillStyle = bloom; ctx.fillRect(S.x, S.y, S.w, S.h);
      ctx.restore();
    }
    ctx.restore();

    // legend in the glass, top-left
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    const key = (x, col, label) => {
      ctx.fillStyle = hexA(col, 0.95); ctx.fillRect(x, S.y + 12, 14, 3);
      ctx.fillStyle = 'rgba(200,210,235,0.75)'; ctx.fillText(label, x + 20, S.y + 17);
    };
    key(S.x + 10, ARC.violet, 'THE HUM');
    key(S.x + 96, ARC.energy, 'YOUR WAVE');
    ctx.restore();

    // status, engraved under the glass
    const okCount = DIALS.filter(k => m[k].ok).length;
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.textAlign = 'right';
    ctx.fillStyle = m.inTune ? hexA(ARC.gold, 0.95) : 'rgba(170,185,220,0.7)';
    ctx.fillText(m.inTune ? 'IN TUNE — HOLD IT' : `DIALS MATCHED ${okCount} / 3`, S.x + S.w - 8, S.y + S.h + 17);
    ctx.restore();

    // attunement bar
    const M = METER, fillW = (M.w - 4) * g.meter;
    ctx.fillStyle = '#0a0b10'; ctx.fillRect(M.x, M.y, M.w, M.h);
    if (fillW > 0) {
      const mg = ctx.createLinearGradient(0, M.y, 0, M.y + M.h);
      mg.addColorStop(0, '#fff3cf'); mg.addColorStop(0.5, ARC.gold); mg.addColorStop(1, '#8a6424');
      ctx.fillStyle = mg; ctx.fillRect(M.x + 2, M.y + 2, fillW, M.h - 4);
      spark(ctx, M.x + 2 + fillW, M.y + M.h / 2, 14, ARC.gold, 0.6 + 0.4 * g.meter);
    }
    for (let i = 1; i < 10; i++) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(M.x + i * M.w / 10, M.y + 2, 1, M.h - 4); }
    ctx.save();
    ctx.font = '700 9px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(170,185,220,0.6)';
    ctx.fillText('ATTUNEMENT', M.x, M.y + M.h + 13);
    ctx.restore();
  }

  renderEnding(ctx, t, success) {
    const k = Math.min(1, t / this.endDelay);
    const S = SCOPE;
    if (success) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(W / 2, S.y + S.h / 2, 10, W / 2, S.y + S.h / 2, 320);
      g.addColorStop(0, `rgba(255,240,200,${0.6 * Math.sin(k * Math.PI)})`); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = `rgba(40,6,4,${0.55 * k})`; ctx.fillRect(0, 0, W, H);
    }
  }

  endScreen(success) {
    return success
      ? { title: 'Resonance Attuned', sub: 'The hum falls silent — it answers to you', icon: (c, x, y, tone) => ARCANE_ICONS.wave(c, x, y, tone, true) }
      : { title: 'The Resonance Slips', sub: 'The note climbs out of reach', icon: (c, x, y, tone) => ARCANE_ICONS.wave(c, x, y, tone, false) };
  }

  buildStatic() {
    const c = layer(W, H, this._dpr);
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: W / 2, cy: H / 2, r: 380 }));
    const S = SCOPE;
    // dark glass with an etched grid
    const glass = ctx.createLinearGradient(0, S.y, 0, S.y + S.h);
    glass.addColorStop(0, '#0d1220'); glass.addColorStop(1, '#070a12');
    ctx.fillStyle = glass; ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.strokeStyle = 'rgba(120,150,210,0.10)'; ctx.lineWidth = 1;
    for (let i = 1; i < 12; i++) { const x = S.x + i * S.w / 12 + 0.5; ctx.beginPath(); ctx.moveTo(x, S.y); ctx.lineTo(x, S.y + S.h); ctx.stroke(); }
    for (let i = 1; i < 6; i++) { const y = S.y + i * S.h / 6 + 0.5; ctx.beginPath(); ctx.moveTo(S.x, y); ctx.lineTo(S.x + S.w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(150,180,240,0.22)';
    ctx.beginPath(); ctx.moveTo(S.x, S.y + S.h / 2 + 0.5); ctx.lineTo(S.x + S.w, S.y + S.h / 2 + 0.5); ctx.stroke();
    // the middle line the phase is read at
    ctx.strokeStyle = 'rgba(150,180,240,0.16)'; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(S.x + S.w / 2 + 0.5, S.y); ctx.lineTo(S.x + S.w / 2 + 0.5, S.y + S.h); ctx.stroke();
    ctx.setLineDash([]);
    // glass sheen
    const sheen = ctx.createLinearGradient(S.x, S.y, S.x + S.w * 0.6, S.y + S.h);
    sheen.addColorStop(0, 'rgba(200,220,255,0.07)'); sheen.addColorStop(0.4, 'rgba(200,220,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(S.x, S.y, S.w, S.h);
    // brass bezel
    const bz = ctx.createLinearGradient(S.x, S.y, S.x + S.w, S.y + S.h);
    bz.addColorStop(0, '#d9b66a'); bz.addColorStop(0.5, '#8a6a32'); bz.addColorStop(1, '#4a3716');
    ctx.strokeStyle = bz; ctx.lineWidth = 3; ctx.strokeRect(S.x - 1.5, S.y - 1.5, S.w + 3, S.h + 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);
    engrave(ctx, () => { ctx.beginPath(); ctx.rect(METER.x - 1, METER.y - 1, METER.w + 2, METER.h + 2); }, 1.2, 1);
    return c;
  }
}
