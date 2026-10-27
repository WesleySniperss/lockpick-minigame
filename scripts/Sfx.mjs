/**
 * Sfx.mjs — tiny WebAudio cue engine shared by the puzzles.
 *
 * Everything is synthesised, so the module ships no audio assets and nothing
 * can 404. The context is created lazily on the first cue (browsers block
 * AudioContext until a user gesture) and every cue is scaled by the player's
 * core "Interface Volume" setting so the module behaves like the rest of Foundry.
 */

let _ac = null;
let _master = null;

/** Player's interface volume (0..1); falls back to 0.5 if the setting is absent. */
function _interfaceVolume() {
  try {
    const v = game.settings.get('core', 'globalInterfaceVolume');
    return typeof v === 'number' ? v : 0.5;
  } catch (e) { return 0.5; }
}

function ctx() {
  if (_ac === null) {
    try {
      _ac = new (window.AudioContext || window.webkitAudioContext)();
      _master = _ac.createGain();
      _master.connect(_ac.destination);
    } catch (e) { _ac = false; }        // false = unavailable, don't retry
  }
  if (_ac && _ac.state === 'suspended') _ac.resume().catch(() => {});
  if (_master) _master.gain.value = _interfaceVolume();
  return _ac || null;
}

/** A shaped sine/triangle tone. */
function tone(freq, {
  dur = 0.18, gain = 0.18, type = 'sine', when = 0, attack = 0.008,
  glideTo = null, detune = 0,
} = {}) {
  const ac = ctx(); if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g); g.connect(_master);
  osc.start(t0); osc.stop(t0 + dur + 0.04);
}

/** A filtered noise burst — clicks, thunks, scrapes. */
function noise(freq, {
  dur = 0.07, gain = 0.25, q = 1.2, when = 0, type = 'bandpass',
} = {}) {
  const ac = ctx(); if (!ac) return;
  const t0 = ac.currentTime + when;
  const len = Math.max(1, Math.ceil(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);   // decaying
  }
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(_master);
  src.start(t0);
}

// ── Named cues ───────────────────────────────────────────────────────────────

/** Simon runes: a consonant pentatonic set, so any order sounds musical. */
const SIMON_HZ = [415.30, 523.25, 622.25, 830.61];   // G#4 · C5 · D#5 · G#5

export const Sfx = {
  /** Kick the context alive from a click handler (avoids autoplay blocking). */
  unlock() { ctx(); },

  /** Simon rune tone — index 0..3. */
  simonRune(i, dur = 0.42) {
    const f = SIMON_HZ[i % SIMON_HZ.length];
    tone(f, { dur, gain: 0.22, type: 'triangle' });
    tone(f * 2, { dur: dur * 0.6, gain: 0.05, type: 'sine' });   // shimmer
  },

  /** Simon: whole sequence completed. */
  simonWin() {
    SIMON_HZ.forEach((f, i) => tone(f, { when: i * 0.11, dur: 0.5, gain: 0.2, type: 'triangle' }));
    tone(SIMON_HZ[0] * 2, { when: 0.44, dur: 0.9, gain: 0.16, type: 'sine' });
  },

  /** Wrong rune / wrong answer — a dissonant descending buzz. */
  fail() {
    tone(220, { dur: 0.5, gain: 0.22, type: 'sawtooth', glideTo: 92 });
    tone(233, { dur: 0.5, gain: 0.12, type: 'sawtooth', glideTo: 98 });  // beating
    noise(300, { dur: 0.22, gain: 0.16, q: 0.8 });
  },

  /** Sudoku: a digit placed. */
  place() {
    noise(2600, { dur: 0.03, gain: 0.16, q: 2.2 });
    tone(880, { dur: 0.07, gain: 0.10, type: 'sine' });
  },

  /** Sudoku: digit contradicts the solution. */
  wrong() {
    noise(420, { dur: 0.09, gain: 0.20, q: 1.0 });
    tone(180, { dur: 0.16, gain: 0.18, type: 'triangle', glideTo: 130 });
  },

  /** Cell / tile selection blip. */
  select() {
    noise(3200, { dur: 0.02, gain: 0.09, q: 2.5 });
  },

  /** Sliding puzzle: stone tile sliding into place. */
  slide() {
    noise(1100, { dur: 0.14, gain: 0.16, q: 0.7 });
    tone(150, { dur: 0.12, gain: 0.09, type: 'triangle', glideTo: 110 });
  },

  /** Generic solved fanfare (sudoku / sliding / cipher). */
  solved() {
    const notes = [523.25, 659.25, 783.99, 1046.50];   // C5 E5 G5 C6
    notes.forEach((f, i) => tone(f, { when: i * 0.09, dur: 0.55, gain: 0.19, type: 'triangle' }));
    noise(5200, { when: 0.05, dur: 0.3, gain: 0.05, q: 0.6, type: 'highpass' });
  },

  /** Cipher: a keystroke into the answer field. */
  key() {
    noise(1800, { dur: 0.022, gain: 0.07, q: 1.8 });
  },

  // ── Arcana mini-games ──────────────────────────────────────────────────

  /** A stone rune ring grinds one step round. */
  ringTurn() {
    noise(700, { dur: 0.16, gain: 0.13, q: 0.6 });
    tone(196, { dur: 0.14, gain: 0.06, type: 'triangle', glideTo: 174 });
  },

  /** Energy reaches ring `i`: a rising arcane chord, one note per ring. */
  channel(i = 0) {
    const f = [261.63, 329.63, 392.0, 493.88, 587.33, 659.25][i % 6];
    tone(f, { dur: 0.9, gain: 0.13, type: 'sine', attack: 0.03 });
    tone(f * 2, { dur: 0.6, gain: 0.04, type: 'triangle', attack: 0.02, detune: 6 });
  },

  /** A ward trap bites back. */
  backlash() {
    noise(180, { dur: 0.35, gain: 0.28, q: 0.7, type: 'lowpass' });
    tone(110, { dur: 0.45, gain: 0.2, type: 'sawtooth', glideTo: 55 });
    noise(4200, { when: 0.02, dur: 0.12, gain: 0.08, q: 1.5 });
  },

  /** A hidden binding between two rings shows itself. */
  reveal() {
    tone(880, { dur: 0.35, gain: 0.06, type: 'sine', glideTo: 1320 });
    tone(1320, { when: 0.08, dur: 0.4, gain: 0.04, type: 'sine' });
  },

  /** The working comes apart (ward unwoven, resonance attuned, sigil sealed). */
  unweave() {
    [392.0, 493.88, 587.33, 783.99, 987.77].forEach((f, i) =>
      tone(f, { when: i * 0.07, dur: 1.1, gain: 0.12, type: 'sine', attack: 0.02 }));
    noise(6000, { when: 0.1, dur: 0.8, gain: 0.04, q: 0.5, type: 'highpass' });
  },

  /** Sigil: a star node touched — pitch rises with progress. */
  node(i = 0) {
    tone(440 * Math.pow(2, (i % 12) / 12), { dur: 0.32, gain: 0.12, type: 'triangle' });
    tone(1760, { dur: 0.12, gain: 0.025, type: 'sine' });
  },

  /** Sigil: a wrong stroke cracks the line. */
  crack() {
    noise(900, { dur: 0.18, gain: 0.22, q: 0.9 });
    tone(150, { dur: 0.22, gain: 0.12, type: 'square', glideTo: 90 });
  },

  /** Low-level access for continuous synthesis (the resonance tones). */
  audio() {
    const ac = ctx();
    return ac ? { ac, out: _master } : null;
  },
};
