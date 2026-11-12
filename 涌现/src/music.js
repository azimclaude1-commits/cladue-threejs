// The score as data: one sorted list of note events, shared by the audio engine and the visuals.
import { BEAT, BAR, bar, DURATION } from './timeline.js';

const S16 = BEAT / 4;
const N = { C: 0, 'C#': 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, Ab: 8, A: 9, Bb: 10, B: 11 };
export const midi = (name, oct) => 12 * (oct + 1) + N[name];
export const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chord tones (root position, octave 3) and bass root
const CH = {
  Dm: ['D', 'F', 'A'], Bb: ['Bb', 'D', 'F'], Gm: ['G', 'Bb', 'D'], A: ['A', 'C#', 'E'], C: ['C', 'E', 'G'],
  F: ['F', 'A', 'C'], Asus: ['A', 'D', 'E'], Dm9: ['D', 'F', 'A', 'E'],
};
const tones = (c, oct = 3) => { let prev = -1, o = oct; return CH[c].map((n) => { let m = midi(n, o); while (m <= prev) m += 12; prev = m; return m; }); };

// progression: chord per bar
export const PROG = [
  'Dm', 'Dm', 'Dm',                                            // 0-2   intro
  'Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A', 'Dm', 'A',     // 3-12  chaos
  'Dm', 'Dm', 'C', 'C', 'Bb', 'Bb', 'C', 'C',                  // 13-20 rules
  'Dm', 'F', 'C', 'Bb', 'Gm', 'Dm', 'Bb', 'C', 'A',            // 21-29 world
  'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C', 'A',                   // 30-37 life
  'Dm', 'Bb', 'F', 'C', 'Gm', 'Bb', 'A', 'A',                  // 38-45 mind
  'Dm9', 'Dm9', 'Dm9', 'Dm9',                                  // 46-49 coda
];
export const chordAt = (t) => PROG[Math.max(0, Math.min(49, Math.floor(t / BAR)))];

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function build() {
  const ev = [];
  const add = (t, type, o = {}) => ev.push({ t, type, ...o });
  // ---- prologue: a heartbeat and a low drone, a riser into the burst
  for (let b = 0; b < 12; b += 2) { add(b * BEAT, 'heart', { v: 0.55 + b * 0.04 }); add(b * BEAT + 0.2, 'heart', { v: 0.35 + b * 0.03 }); }
  add(0, 'drone', { m: midi('D', 1), d: bar(3) + 1.5, v: 0.5 });
  add(bar(2), 'riser', { d: BAR, v: 0.5 });
  add(bar(3), 'impact', { v: 1 });
  // ---- I chaos
  for (let b = 3; b <= 12; b++) {
    const c = tones(PROG[b], 3), c2 = [...c, ...c.map((m) => m + 12), c[0] + 24];
    const up = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5];
    for (let s = 0; s < 16; s++) {
      if (b === 12 && s >= 12) break;
      const k = (b - 3) / 10;
      add(bar(b) + s * S16, 'arp', { m: c2[up[s] % c2.length] + 12, v: (s % 4 === 0 ? 0.9 : 0.6) * (0.55 + 0.45 * k), cut: 600 + 3200 * k + (s % 4 === 0 ? 400 : 0), d: S16 * 1.6 });
    }
    if (b >= 4) for (let e = 0; e < 8; e++) { if (b === 12 && e >= 6) break; add(bar(b) + e * BEAT / 2, 'bass', { m: tones(PROG[b], 1)[0] + (e % 2 ? 12 : 0), v: 0.8, d: BEAT / 2 * 0.9 }); }
    if (b >= 5) for (let q = 0; q < 4; q++) { if (b === 12 && q >= 3) break; add(bar(b) + q * BEAT, 'kick', { v: 1 }); }
    if (b >= 6) for (let q = 0; q < 4; q++) { if (b === 12 && q >= 3) break; add(bar(b) + q * BEAT + BEAT / 2, 'hat', { v: 0.5 }); }
    if (b >= 7) for (const q of [1, 3]) { if (b === 12 && q === 3) break; add(bar(b) + q * BEAT, 'clap', { v: 0.7 }); }
    add(bar(b), 'pad', { ms: tones(PROG[b], 3), d: BAR * 1.05, v: 0.22 + 0.1 * (b - 3) / 9, cut: 900 });
  }
  for (const b of [6, 9, 11]) add(bar(b), 'crash', { v: 0.6 });
  add(bar(12) + BEAT * 3, 'down', { d: BEAT * 2, v: 0.6 });
  // ---- II rules: a rhythm grown by cellular automaton (rule 90)
  const pent = [midi('D', 4), midi('F', 4), midi('G', 4), midi('A', 4), midi('C', 5), midi('D', 5), midi('F', 5), midi('G', 5), midi('A', 5), midi('C', 6)];
  let row = new Array(16).fill(0); row[7] = 1;
  for (let b = 13; b <= 20; b++) {
    for (let s = 0; s < 16; s++) if (row[s]) add(bar(b) + s * S16, 'marimba', { m: pent[(s * 3 + b) % pent.length] - (s % 2 ? 0 : 12), v: 0.55 });
    const nx = row.map((_, i) => row[(i + 15) % 16] ^ row[(i + 1) % 16]);
    row = nx.some(Boolean) ? nx : row;
    if (b % 2 === 1) add(bar(b), 'sub', { m: tones(PROG[b], 1)[0], d: BAR * 2, v: 0.6 });
    add(bar(b), 'pad', { ms: tones(PROG[b], 3), d: BAR * 1.05, v: 0.12 + (b >= 19 ? 0.12 * (b - 18) : 0), cut: 700 + (b >= 19 ? 900 : 0) });
    if (b >= 15) for (const q of [0, 2]) add(bar(b) + q * BEAT, 'kick', { v: 0.55 });
    if (b >= 16) for (let s = 0; s < 16; s++) add(bar(b) + s * S16, 'shaker', { v: s % 4 === 2 ? 0.35 : 0.18 });
  }
  add(bar(19), 'riser', { d: BAR * 2, v: 0.45 });
  // ---- III world: wide pads and a slow melody
  const melody = [
    [['A', 4, 2], ['D', 5, 2]], [['C', 5, 3], ['A', 4, 1]], [['G', 4, 2], ['E', 4, 2]], [['F', 4, 4]],
    [['G', 4, 2], ['Bb', 4, 2]], [['A', 4, 3], ['F', 4, 1]], [['D', 5, 2], ['C', 5, 2]], [['E', 5, 4]], [['C#', 5, 4]],
  ];
  for (let b = 21; b <= 29; b++) {
    add(bar(b), 'pad', { ms: [tones(PROG[b], 2)[0], ...tones(PROG[b], 3)], d: BAR * 1.1, v: 0.42, cut: 1500 });
    if (b === 21) add(bar(b), 'impact', { v: 0.8 });
    add(bar(b), 'kick', { v: 0.6 });
    add(bar(b) + 2 * BEAT, 'kick', { v: 0.3 });
    if (b >= 23) for (let q = 0; q < 8; q++) add(bar(b) + q * BEAT / 2, 'hat', { v: 0.18 });
    let beat = 0;
    for (const [n, o, len] of melody[b - 21]) { add(bar(b) + beat * BEAT, 'lead', { m: midi(n, o), d: len * BEAT, v: 0.45 }); beat += len; }
  }
  // ---- IV life: a shimmering arpeggio, the drums come back
  for (let b = 30; b <= 37; b++) {
    const c = tones(PROG[b], 4), c2 = [...c, ...c.map((m) => m + 12)];
    for (let s = 0; s < 16; s++) add(bar(b) + s * S16, 'shimmer', { m: c2[(s * 5 + b) % c2.length], v: 0.4 + 0.2 * ((b - 30) / 7) });
    add(bar(b), 'pad', { ms: [tones(PROG[b], 2)[0], ...tones(PROG[b], 3)], d: BAR * 1.1, v: 0.38, cut: 1800 });
    add(bar(b), 'sub', { m: tones(PROG[b], 1)[0], d: BAR, v: 0.5 });
    if (b >= 32) for (let q = 0; q < 4; q++) add(bar(b) + q * BEAT, 'kick', { v: 0.85 });
    if (b >= 34) for (const q of [1, 3]) add(bar(b) + q * BEAT, 'clap', { v: 0.6 });
    if (b >= 33) for (let s = 0; s < 16; s++) add(bar(b) + s * S16, 'hat', { v: s % 2 ? 0.28 : 0.14 });
  }
  add(bar(33), 'crash', { v: 0.5 }); add(bar(36), 'crash', { v: 0.7 });
  add(bar(37) + BEAT * 2, 'down', { d: BEAT * 2, v: 0.5 });
  // ---- V mind: each neuron's firing is a bell
  for (let b = 38; b <= 45; b++) {
    add(bar(b), 'pad', { ms: tones(PROG[b], 3), d: BAR * 1.1, v: 0.26, cut: 1100 });
    add(bar(b), 'sub', { m: tones(PROG[b], 1)[0], d: BAR, v: 0.45 });
    if (b >= 40) {
      const c = tones(PROG[b], 4), n = b < 42 ? 2 : b < 44 ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const s = Math.floor((k / n) * 16 + rnd() * 2) % 16;
        add(bar(b) + s * S16, 'bell', { m: c[Math.floor(rnd() * 3)] + (rnd() < 0.3 ? 12 : 0), v: 0.5, neuron: Math.floor(rnd() * 1e6) });
      }
    }
    if (b >= 42) for (const q of [0, 2]) add(bar(b) + q * BEAT, 'heart', { v: 0.45 });
  }
  add(bar(45), 'riser', { d: BAR, v: 0.35 });
  // ---- coda: the word, then the fall back into a single point
  add(bar(46), 'impact', { v: 0.7 });
  add(bar(46), 'pad', { ms: [midi('D', 2), ...tones('Dm9', 3)], d: BAR * 3.2, v: 0.5, cut: 2200 });
  for (const [i, m] of [midi('A', 5), midi('D', 6), midi('E', 6), midi('F', 6), midi('A', 6)].entries()) add(bar(46) + i * BEAT * 1.5, 'bell', { m, v: 0.4, neuron: -1 });
  add(bar(48.5), 'suck', { d: BAR * 1.25, v: 0.6 });
  add(DURATION - 0.18, 'thud', { v: 0.8 });
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

export const EVENTS = build();
const KICKS = EVENTS.filter((e) => e.type === 'kick' || e.type === 'impact' || e.type === 'heart').map((e) => [e.t, e.v]);
export const BELLS = EVENTS.filter((e) => e.type === 'bell' && e.neuron >= 0);

/** Envelope of the most recent kick-like hit: 1 at the hit, decaying. */
export function kickEnv(t, rate = 7) {
  let lo = 0, hi = KICKS.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (KICKS[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return 0;
  return KICKS[k][1] * Math.exp(-(t - KICKS[k][0]) * rate);
}
/** Bells (neuron firings) in the window (t - span, t] */
export function recentBells(t, span = 4, max = 16) {
  const out = [];
  for (let i = BELLS.length - 1; i >= 0 && out.length < max; i--) { const e = BELLS[i]; if (e.t <= t && e.t > t - span) out.push(e); }
  return out;
}
export { DURATION };
