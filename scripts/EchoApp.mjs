/**
 * EchoApp.mjs — "Echo the Hum": sing a working's hum back to it.
 *
 * Between two singing stones runs the hum, a violet ribbon of light that
 * sways, swells and now and then changes note (it trembles and flickers white
 * first, then slides). Your ribbon is cyan: hold the mouse on the stave and its crest comes
 * to rest under the pointer; scroll, or pick under the board, for how many
 * crests it has. Where the two lie together your ribbon turns gold, and while
 * enough of it is gold the runes under the stave wake one by one. Wake all of
 * them before concentration runs out. Two quiet tones follow the ribbons and
 * fall into tune as they meet.
 */

import { MiniGameApp, barHTML } from './MiniGameApp.mjs';
import { generateEcho, EchoGame, shiftAt, waveAt, NOTES, RUNE_COUNT, SAMPLES, ASPECT } from './echo-logic.mjs';
import { ARC, TAU, RUNES, layer, blit, backdrop, drawRune, engrave, glow, spark, hexA } from './arcane-art.mjs';
import { ARCANE_ICONS } from './overlay.mjs';
import { rng } from './ward-logic.mjs';
import { Sfx } from './Sfx.mjs';

const W = 520, H = 420;
const X0 = 40, X1 = 480, SW = X1 - X0, CY = 194, A = SW / ASPECT;   // the stave; A: its half height
const CH = { x: 22, y: CY - 116, w: 476, h: 232 };                    // the channel the ribbons run in
const RUNE_Y = 350, runeX = i => W / 2 + (i - (RUNE_COUNT - 1) / 2) * 56;
const SHIMMER = '#f4eeff';                                         // the hum flickering before a change of note
const RATIO = { 2: 1, 3: 9 / 8, 4: 5 / 4, 5: 3 / 2, 6: 5 / 3 };     // the notes, as a pentatonic scale
const px = x => X0 + x * SW, py = y => CY - y * A;

export class EchoApp extends MiniGameApp {
  static KIND   = 'echo';
  static TITLE  = 'Echo the Hum';
  static CANVAS = { w: W, h: H };

  buildGame(init) {
    this.echo = generateEcho(init);
    this.game = new EchoGame(this.echo);
    this.endDelay = 1.3;
    this.audio = null;
    this.holding = false;
    this.wheel = 0;
    this.woke = 0;                          // runes already announced with a chime
    this.shiftSeen = 0;                     // changes of note already announced
    this.runeIds = Array.from({ length: RUNE_COUNT }, (_, i) => (this.echo.seed + i * 5) % 22);
  }

  controlsHTML() {
    const off = this._spectator ? 'disabled' : '', on = this._noteShown = this.game.aim.crests;
    return `<div class="lpm-arcana-controls lpm-echo-controls">
      <span class="lpm-echo-label">Crests</span>
      <span class="lpm-echo-notes">${NOTES.map(n =>
        `<button type="button" class="lpm-echo-note${n === on ? ' is-on' : ''}" data-n="${n}" ${off}>${n}</button>`).join('')}</span>
      <span class="lpm-echo-tip">${this._spectator ? '' : 'or scroll on the board'}</span>
    </div>`;
  }

  meterHTML() {
    return barHTML('Concentration', this.game.timeLeft, this.echo.params.time, {
      text: `${Math.ceil(this.game.timeLeft)} s`, tip: 'When your concentration runs out the hum slips away.',
    });
  }

  hintHTML() {
    return '<strong>Hold</strong> on the stave to move <span class="lpm-hint-cyan">your crest</span>'
      + ' &middot; <strong>scroll</strong> to change crests &middot; keep it <span class="lpm-hint-amber">gold</span>';
  }

  // ── input ─────────────────────────────────────────────────────────────

  bindInput(canvas, root) {
    const at = ev => {
      const b = canvas.getBoundingClientRect();
      return { x: (ev.clientX - b.left) * (W / b.width), y: (ev.clientY - b.top) * (H / b.height) };
    };
    const inStave = p => p.x >= CH.x && p.x <= CH.x + CH.w && p.y >= CH.y && p.y <= CH.y + CH.h;
    const hold = p => this.game.holdAt((p.x - X0) / SW, (CY - p.y) / A);
    const cursor = p => { canvas.style.cursor = this._over ? 'default' : this.holding ? 'grabbing' : inStave(p) ? 'grab' : 'default'; };
    canvas.addEventListener('pointerdown', ev => {
      const p = at(ev);
      if (this._over || ev.button !== 0 || !inStave(p)) return;
      ev.preventDefault();
      try { canvas.setPointerCapture?.(ev.pointerId); } catch (e) {}    // keep hold when the pointer leaves the canvas
      this.holding = true;
      hold(p);
      this.startTones();
      cursor(p);
    });
    canvas.addEventListener('pointermove', ev => {
      const p = at(ev);
      if (this.holding && !this._over) hold(p);
      cursor(p);
    });
    const end = ev => { this.holding = false; cursor(at(ev)); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // A wheel notch is one note; a touchpad's small steps add up to one.
    canvas.addEventListener('wheel', ev => {
      if (this._over) return;
      ev.preventDefault();
      this.wheel += ev.deltaY;
      if (Math.abs(this.wheel) < 50) return;
      const d = this.wheel < 0 ? 1 : -1;
      this.wheel = 0;
      if (this.game.stepNote(d)) this.refreshNotes();
      this.startTones();
    }, { passive: false });
    root.querySelectorAll('.lpm-echo-note').forEach(b => b.addEventListener('click', () => {
      if (this._over) return;
      if (this.game.setNote(Number(b.dataset.n))) this.refreshNotes();
      this.startTones();
    }));
    this.refreshNotes();
  }

  /** Light the button of the note your ribbon is on. */
  refreshNotes() {
    const n = this.game.aim.crests;
    if (n === this._noteShown) return;
    this._noteShown = n;
    this.element?.querySelectorAll('.lpm-echo-note').forEach(b => b.classList.toggle('is-on', Number(b.dataset.n) === n));
  }

  // ── sound: the hum, and your voice that falls into tune with it ────────

  pitch(crests) {
    const lo = Math.floor(crests), hi = Math.ceil(crests), r = RATIO[lo] ?? 1, r2 = RATIO[hi] ?? r;
    return this.echo.tone * (r + (r2 - r) * (crests - lo));
  }

  startTones() {
    if (this.audio || this._spectator) return;
    const io = Sfx.audio();
    if (!io) return;
    const { ac, out } = io;
    const mk = (type, gain) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; g.gain.value = 0; o.connect(g); g.connect(out); o.start();
      g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.6);
      return { o, g };
    };
    this.audio = { ac, hum: mk('sine', 0.03), voice: mk('triangle', 0.016), fifth: mk('sine', 0) };
  }

  updateTones() {
    const a = this.audio;
    if (!a) return;
    const now = a.ac.currentTime, g = this.game, hz = this.pitch(g.hum().crests);
    a.hum.o.frequency.setTargetAtTime(hz, now, 0.05);
    // Off the hum, your voice beats against it; in tune, the beat slows and stops.
    a.voice.o.frequency.setTargetAtTime(this.pitch(g.you.crests) * (1 + 0.03 * (1 - g.share)), now, 0.05);
    a.fifth.o.frequency.setTargetAtTime(hz * 1.5, now, 0.05);
    a.fifth.g.gain.setTargetAtTime(g.inTune ? 0.012 + 0.02 * g.attune : 0, now, 0.15);
  }

  teardown() {
    const a = this.audio;
    if (!a) return;
    this.audio = null;
    const now = a.ac.currentTime;
    for (const n of [a.hum, a.voice, a.fifth]) {
      try { n.g.gain.setTargetAtTime(0, now, 0.08); n.o.stop(now + 0.5); } catch (e) {}
    }
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(dt) {
    if (this._over) return null;
    const out = this._spectator ? null : this.game.update(dt);
    if (this._spectator) this.game.advance(dt);
    const runes = this.game.runes();
    if (runes > this.woke) { this.woke = runes; if (!this._spectator) Sfx.node(runes); }
    else if (runes < this.woke) this.woke = runes;
    const shift = shiftAt(this.echo, this.game.t).n;
    if (shift !== this.shiftSeen) { this.shiftSeen = shift; if (!this._spectator) Sfx.reveal(); }
    this.updateTones();
    this._meterAcc = (this._meterAcc ?? 0) + dt;
    if (this._meterAcc > 0.25) { this._meterAcc = 0; this.refreshMeter(); }
    if (out === 'won') Sfx.unweave();
    if (out === 'lost') Sfx.fail();
    return out;
  }

  syncState() { return this.game.snapshot(); }

  /** Only the hand needs sending at once: the hum comes from the seed, the clock runs on its own. */
  syncKey() {
    const a = this.game.aim;
    return `${a.crests}|${a.amp.toFixed(3)}|${a.phase.toFixed(3)}|${this.game.state}`;
  }

  applySync(s) { this.game.apply(s); this.refreshNotes(); }

  /**
   * Add the ribbon from x0 to x1 (0…1 along the stave) to the path: about 18
   * points a crest, enough for the sharpest of them and no more (every point of
   * a wide stroke costs the browser triangles).
   */
  trace(ctx, w, x0, x1) {
    const n = Math.max(2, Math.ceil((x1 - x0) * (w.crests * 18 + 12)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, X = px(x), Y = py(waveAt(w, x));
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
  }

  ribbon(ctx, w) { ctx.beginPath(); this.trace(ctx, w, 0, 1); }

  /** The stretches of a ribbon that are (or are not) in tune, as one path. */
  stretches(ctx, w, runs, inTune) {
    ctx.beginPath();
    for (const [a, b, gold] of runs) if (gold === inTune) this.trace(ctx, w, a, b);
  }

  /** Stroke the path again and again, wide and faint to thin and bright, adding the light up. */
  shine(ctx, path, passes) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'bevel';
    for (const [color, width, alpha] of passes) {
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
      path(); ctx.stroke();
    }
    ctx.restore();
  }

  /** A rune lit up, as a sprite. */
  runeLit(i) {
    this._runeLit ??= [];
    if (this._runeLit[i]) return this._runeLit[i];
    const s = layer(44, 44, this._dpr), g = s.getContext('2d');
    glow(g, () => runePath(g, this.runeIds[i], 22, 22, 15), { color: ARC.gold, width: 1.8, intensity: 1 });
    return (this._runeLit[i] = s);
  }

  draw(ctx) {
    if (!this._static) this._static = this.buildStatic();
    blit(ctx, this._static);
    const g = this.game, t = this._t, hum = g.hum(), you = g.you;
    const warn = this._over ? 0 : g.shiftWarning(), tuned = g.inTune;

    // motes drifting along the hum
    for (let i = 0; i < 6; i++) {
      const x = ((t * (0.05 + i * 0.011) + i / 6) % 1 + 1) % 1;
      spark(ctx, px(x), py(waveAt(hum, x)), 5 + (i % 3), ARC.violet, 0.55);
    }
    // the hum: violet; before it changes note (and while it slides) it trembles and flickers white
    const shown = warn > 0 ? { ...hum, amp: hum.amp * (1 + 0.05 * Math.sin(t * 31)) } : hum;
    const white = warn > 0 && Math.sin(t * 26) > 0;
    this.shine(ctx, () => this.ribbon(ctx, shown), [[white ? SHIMMER : ARC.violet, 8, 0.2], [white ? '#ffffff' : '#e4d6ff', 1.6, 0.9]]);
    // your ribbon: cyan, and gold wherever it lies on the hum (one path for each colour)
    const runs = runsOf(g.marks);
    if (runs.some(r => !r[2])) this.shine(ctx, () => this.stretches(ctx, you, runs, false), [[ARC.energy, 6, 0.15], [ARC.energy, 2, 0.85]]);
    if (runs.some(r => r[2])) {
      this.shine(ctx, () => this.stretches(ctx, you, runs, true), [[ARC.gold, 8, tuned ? 0.4 : 0.3]]);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'bevel';
      ctx.strokeStyle = ARC.gold; ctx.lineWidth = 2.6;       // drawn over, not added: gold, whatever lies under it
      this.stretches(ctx, you, runs, true); ctx.stroke();
      ctx.restore();
    }
    // where the hand holds it
    if (this.holding && !this._over) {
      const x = g.anchor;
      spark(ctx, px(x), py(waveAt(you, x)), 12, tuned ? ARC.gold : ARC.energy, 0.9);
      spark(ctx, px(x), py(waveAt(you, x)), 4, '#ffffff', 1);
    }
    // the singing stones answer: violet while the hum is alone, gold as it is echoed
    for (const x of [CH.x, CH.x + CH.w]) this.drawStone(ctx, x, CY, tuned, g.attune, t);

    // runes: awake ones glow gold, the one waking flickers in
    const awake = g.runes(), frac = g.attune * RUNE_COUNT - awake;
    for (let i = 0; i < RUNE_COUNT; i++) {
      const lit = i < awake ? 1 : i === awake ? frac * (0.6 + 0.4 * Math.sin(t * 12)) : 0;
      if (lit <= 0.02) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + 0.6 * lit;
      blit(ctx, this.runeLit(i), runeX(i) - 22, RUNE_Y - 22);
      ctx.restore();
    }
    this.drawNotes(ctx, awake);
  }

  /** A singing stone at the end of the stave: a crystal in a brass socket. */
  drawStone(ctx, x, y, tuned, attune, t) {
    const col = tuned ? ARC.gold : ARC.violet;
    spark(ctx, x, y, 22 + 8 * attune, col, (tuned ? 0.55 : 0.35) + 0.1 * Math.sin(t * 3));
    const gem = ctx.createLinearGradient(x, y - 9, x, y + 9);
    if (tuned) { gem.addColorStop(0, '#fffbe8'); gem.addColorStop(0.5, ARC.gold); gem.addColorStop(1, '#8a6424'); }
    else       { gem.addColorStop(0, '#d9c8ff'); gem.addColorStop(1, '#3a2c66'); }
    ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 6, y); ctx.closePath();
    ctx.fillStyle = gem; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
  }

  /** What never changes: the goal top-left, what the hum does bottom-left. Part of the static layer. */
  drawFixedNotes(ctx) {
    ctx.save();
    ctx.font = '700 10px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    ctx.fillStyle = 'rgba(200,212,240,0.78)';
    ctx.fillText('LAY YOUR LIGHT ON THE HUM', 14, 22);
    ctx.fillText('AND KEEP IT GOLD', 14, 36);
    ctx.textAlign = 'right';
    ctx.fillText('YOUR CRESTS', W - 14, 22);
    ctx.textAlign = 'left';
    ctx.font = '700 9px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(200,212,240,0.72)';
    ctx.fillText('THE HUM DRIFTS AND SWELLS', 14, 393);
    ctx.fillStyle = hexA(SHIMMER, 0.95);
    ctx.fillText('A FLICKER: IT CHANGES NOTE', 14, 406);
    ctx.restore();
  }

  /** How many runes are awake, and how many crests your ribbon has. */
  drawNotes(ctx, awake) {
    ctx.save();
    ctx.font = '700 12px "Signika", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    ctx.fillStyle = awake ? hexA(ARC.gold, 0.95) : 'rgba(200,212,240,0.85)';
    ctx.fillText(`${awake} / ${RUNE_COUNT} RUNES AWAKE`, 14, 56);
    ctx.textAlign = 'right';
    ctx.font = '700 18px "Signika", sans-serif';
    ctx.fillStyle = 'rgba(225,232,250,0.92)';
    ctx.fillText(String(this.game.you.crests), W - 14, 44);
    ctx.restore();
  }

  renderEnding(ctx, t, success) {
    const k = Math.min(1, t / this.endDelay);
    if (success) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(W / 2, CY, 10, W / 2, CY, 300);
      g.addColorStop(0, `rgba(255,236,190,${0.6 * Math.sin(k * Math.PI)})`); g.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      // the hum sinks out of hearing
      ctx.fillStyle = `rgba(2,3,10,${0.6 * k})`; ctx.fillRect(CH.x, CH.y, CH.w, CH.h);
      ctx.fillStyle = `rgba(40,6,4,${0.35 * k})`; ctx.fillRect(0, 0, W, H);
    }
  }

  endScreen(success) {
    return success
      ? { title: 'Hum Echoed', sub: 'The working falls quiet — it answers to you', icon: (c, x, y, tone) => ARCANE_ICONS.wave(c, x, y, tone, true) }
      : { title: 'The Hum Fades', sub: 'The note slips out of reach', icon: (c, x, y, tone) => ARCANE_ICONS.wave(c, x, y, tone, false) };
  }

  /** Backdrop, the channel of night the ribbons run in, the stones' sockets and the rune sockets. */
  buildStatic() {
    const c = layer(W, H, this._dpr, { opaque: true });
    const ctx = c.getContext('2d');
    blit(ctx, backdrop(W, H, this._dpr, { cx: W / 2, cy: CY, r: 300, ring: false }));
    const { x, y, w, h } = CH, r = 18;
    const channel = () => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
    // a raised stone lip round the channel
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x - 8, y - 8, w + 16, h + 16, r + 8);
    const lip = ctx.createLinearGradient(0, y - 8, 0, y + h + 8);
    lip.addColorStop(0, '#323745'); lip.addColorStop(1, '#1f222b');
    ctx.fillStyle = lip; ctx.fill();
    ctx.restore();
    engrave(ctx, () => { ctx.beginPath(); ctx.roundRect(x - 8, y - 8, w + 16, h + 16, r + 8); }, 1.4, 1);
    // the night inside, with a drift of stars and two faint clouds
    const night = ctx.createLinearGradient(0, y, 0, y + h);
    night.addColorStop(0, '#0b0e22'); night.addColorStop(0.5, '#121736'); night.addColorStop(1, '#070812');
    channel(); ctx.fillStyle = night; ctx.fill();
    ctx.save();
    channel(); ctx.clip();
    const R = rng(this.echo.seed + 77);
    for (const [col, n] of [['rgba(150,110,255,', 2], ['rgba(90,200,255,', 2]]) {
      for (let i = 0; i < n; i++) {
        const cx = x + R() * w, cy = y + R() * h, rr = 60 + R() * 80;
        const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        cloud.addColorStop(0, col + '0.09)'); cloud.addColorStop(1, col + '0)');
        ctx.fillStyle = cloud; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      }
    }
    for (let i = 0; i < 120; i++) {
      const s = R();
      ctx.fillStyle = `rgba(220,230,255,${0.12 + 0.45 * s * s})`;
      ctx.fillRect(x + R() * w, y + R() * h, s > 0.92 ? 1.6 : 1, s > 0.92 ? 1.6 : 1);
    }
    // the edges sink into shadow
    const shade = ctx.createLinearGradient(0, y, 0, y + h);
    shade.addColorStop(0, 'rgba(0,0,0,0.45)'); shade.addColorStop(0.18, 'rgba(0,0,0,0)');
    shade.addColorStop(0.82, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = shade; ctx.fillRect(x, y, w, h);
    ctx.restore();
    engrave(ctx, channel, 1.2, 1);
    // the stones' sockets, set into the lip at either end
    for (const sx of [x, x + w]) {
      const ring = ctx.createLinearGradient(sx - 13, CY - 13, sx + 13, CY + 13);
      ring.addColorStop(0, '#f2d68e'); ring.addColorStop(0.5, '#a07a36'); ring.addColorStop(1, '#4e3a17');
      ctx.beginPath(); ctx.arc(sx, CY, 13, 0, TAU); ctx.fillStyle = ring; ctx.fill();
      ctx.beginPath(); ctx.arc(sx, CY, 10.5, 0, TAU); ctx.fillStyle = '#0c0e14'; ctx.fill();
    }
    // rune sockets, carved and dark until they wake
    for (let i = 0; i < RUNE_COUNT; i++) {
      const rx = runeX(i);
      ctx.beginPath(); ctx.arc(rx, RUNE_Y, 15, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
      engrave(ctx, () => { ctx.beginPath(); ctx.arc(rx, RUNE_Y, 15, 0, TAU); }, 1, 0.8);
      ctx.save(); ctx.translate(0, 0.7); ctx.strokeStyle = 'rgba(190,205,240,0.10)'; ctx.lineWidth = 1.5; drawRune(ctx, this.runeIds[i], rx, RUNE_Y, 15); ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.5; drawRune(ctx, this.runeIds[i], rx, RUNE_Y, 15);
    }
    this.drawFixedNotes(ctx);
    return c;
  }
}

/**
 * The stave cut into stretches of in-tune and out-of-tune points, [x0, x1,
 * inTune] each, meeting halfway between the points and covering 0…1.
 */
function runsOf(marks) {
  const runs = [], step = 0.94 / (SAMPLES - 1), xAt = i => 0.03 + step * i;
  for (let i = 0; i < SAMPLES; i++) {
    let j = i;
    while (j + 1 < SAMPLES && marks[j + 1] === marks[i]) j++;
    runs.push([i ? xAt(i) - step / 2 : 0, j < SAMPLES - 1 ? xAt(j) + step / 2 : 1, marks[i]]);
    i = j;
  }
  return runs;
}

/** A rune as a path only, for glow() to stroke in passes. */
function runePath(ctx, idx, x, y, size) {
  const segs = RUNES[((idx % RUNES.length) + RUNES.length) % RUNES.length];
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x + x1 * size, y + y1 * size); ctx.lineTo(x + x2 * size, y + y2 * size); }
}
