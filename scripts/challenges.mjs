/**
 * challenges.mjs — the mini-games a GM can request, and the words each one
 * uses on cards, buttons and results. Data only.
 */

export const CHALLENGES = {
  lock: {
    group: "Thieves' Tools", title: 'Pick the Lock', icon: 'fa-key',
    ask: 'is asked to pick', on: 'the lock on', none: 'a lock',
    button: 'Roll &amp; pick the lock', busy: 'is picking the lock…', done: 'Picked by', failed: 'The lock held',
    blurb: 'Thieves’ Tools check, then the lockpicking game.',
    placeholder: 'e.g. Iron-bound chest',
  },
  ward: {
    group: 'Arcana', title: 'Unweave the Ward', icon: 'fa-circle-nodes',
    ask: 'is asked to unweave', on: 'the ward on', none: 'a ward',
    button: 'Roll Arcana &amp; unweave', busy: 'is unweaving the ward…', done: 'Unwoven by', failed: 'The ward held',
    blurb: 'Turn concentric rune rings until the light runs from the core to every anchor.',
    placeholder: 'e.g. Sealed vault door',
    win : { title: 'Ward Unwoven', body: '{who} reads the weave and turns the last ring — the ward comes apart in a sigh of light.' },
    lose: { title: 'The Ward Holds', body: '{who} loses the thread; the rings lock and the ward flares back to full strength.' },
  },
  resonance: {
    group: 'Arcana', title: 'Attune the Resonance', icon: 'fa-wave-square',
    ask: 'is asked to attune to', on: 'the resonance of', none: 'a resonance',
    button: 'Roll Arcana &amp; attune', busy: 'is attuning…', done: 'Attuned by', failed: 'The resonance slipped',
    blurb: 'Match a drifting arcane hum with three dials and hold it.',
    placeholder: 'e.g. Humming crystal',
    win : { title: 'Resonance Attuned', body: '{who} matches the hum until it falls silent. The working answers to them now.' },
    lose: { title: 'The Resonance Slips', body: '{who} can’t hold the note — the hum climbs out of reach.' },
  },
  sigil: {
    group: 'Arcana', title: 'Trace the Sigil', icon: 'fa-star',
    ask: 'is asked to trace', on: 'the sigil on', none: 'a sigil',
    button: 'Roll Arcana &amp; trace', busy: 'is tracing the sigil…', done: 'Traced by', failed: 'The sigil faded',
    blurb: 'Memorise a sigil as it flares, then draw it again star by star.',
    placeholder: 'e.g. Sealed tome',
    win : { title: 'Sigil Traced', body: '{who} retraces the sigil stroke for stroke; it flares and seals.' },
    lose: { title: 'The Sigil Fades', body: '{who}’s line cracks and the sigil gutters out.' },
  },
};

export const ARCANA_KINDS = ['ward', 'resonance', 'sigil'];
export const isChallenge = kind => Object.prototype.hasOwnProperty.call(CHALLENGES, kind);
