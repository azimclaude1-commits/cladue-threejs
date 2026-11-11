// The score, written as a function of film time. The same code drives live playback and the offline render.
import { T, CAPTIONS, DURATION, smooth } from './timeline.js';
import { flapTimes } from './peng.js';

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// D gong mode (宫调): D E F# A B
const SCALE = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74, 76, 78, 81];

function noiseBuffer(ctx, sec = 4) {
  const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
  let s = 12345;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } }
  return b;
}
function impulse(ctx, sec = 4.5, decay = 2.6) {
  const n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = 99;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5 - 1) * Math.pow(1 - i / n, decay); } }
  return b;
}

/**
 * Schedule the score on ctx from film time `from`. Film time t plays at ctx time base + t.
 * Returns stop() which silences everything.
 */
export function score(ctx, dest, from = 0) {
  const base = ctx.currentTime + (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext ? 0 : 0.06) - from;
  const at = (t) => Math.max(ctx.currentTime, base + t);
  const sources = [];
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(dest);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(master);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx); const verbOut = ctx.createGain(); verbOut.gain.value = 0.55; verb.connect(verbOut).connect(comp);
  const dry = ctx.createGain(); dry.connect(comp);
  const send = (node, wet = 0.5, d = 1) => { const g = ctx.createGain(); g.gain.value = wet; node.connect(g).connect(verb); const g2 = ctx.createGain(); g2.gain.value = d; node.connect(g2).connect(dry); };
  const NB = noiseBuffer(ctx);

  // automate an AudioParam from a function of film time
  const curve = (param, fn, step = 0.25) => {
    param.setValueAtTime(fn(from), at(from));
    for (let t = Math.ceil(from / step) * step; t <= DURATION + 0.01; t += step) param.linearRampToValueAtTime(fn(t), base + t);
  };
  // every source starts as it is made (at film time t0, or now) and may stop at t1
  const run = (s, t0, t1) => { s.start(t0 == null ? at(from) : at(t0)); if (t1 != null) s.stop(Math.max(at(t1), at(t0 ?? from) + 0.01)); sources.push(s); return s; };
  const osc = (type, f, t0, t1) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return run(o, t0, t1); };

  // ---- drone of the deep: low fifths, opening up when the bird is born
  const deepEnv = (t) => smooth(4.4, 9, t) * (1 - 0.6 * smooth(37, 40, t)) * (1 - smooth(76, 84, t));
  {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    curve(lp.frequency, (t) => 140 + 500 * smooth(28, 38, t) + 900 * smooth(44, 60, t));
    const g = ctx.createGain(); curve(g.gain, (t) => 0.21 * deepEnv(t) + 0.12 * smooth(44, 52, t) * (1 - smooth(76, 84, t)));
    lp.connect(g); send(g, 0.35, 0.9);
    for (const [m, det, type] of [[38, -4, 'sine'], [45, 3, 'sine'], [50, 0, 'triangle'], [38, 6, 'sawtooth']]) {
      const o = osc(type, hz(m)); o.detune.value = det; const og = ctx.createGain(); og.gain.value = type === 'sawtooth' ? 0.12 : 0.5; o.connect(og).connect(lp);
    }
  }
  // ---- pad: a slow chord that brightens from the transformation to the south
  {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    curve(lp.frequency, (t) => 400 + 1800 * smooth(44, 66, t));
    const g = ctx.createGain();
    curve(g.gain, (t) => (0.05 * smooth(12, 20, t) * (1 - smooth(30, 38, t)) + 0.11 * smooth(42, 50, t)) * (1 - smooth(78, 85, t)));
    lp.connect(g); send(g, 0.8, 0.5);
    const chord = [[50, 57, 62, 66], [50, 57, 64, 69, 71]];
    for (const [ci, notes] of chord.entries()) {
      const cg = ctx.createGain(); cg.connect(lp);
      curve(cg.gain, (t) => (ci === 0 ? 1 - smooth(60, 66, t) : smooth(60, 66, t)));
      for (const m of notes) for (const d of [-7, 7]) { const o = osc('sawtooth', hz(m)); o.detune.value = d; const og = ctx.createGain(); og.gain.value = 0.06; o.connect(og).connect(cg); }
    }
  }
  // ---- water: rumble in the deep, the roar of the breach
  {
    const n = ctx.createBufferSource(); n.buffer = NB; n.loop = true; run(n);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; curve(lp.frequency, (t) => 180 + 2600 * smooth(36.6, 37.9, t) * (1 - 0.8 * smooth(39, 44, t)));
    const g = ctx.createGain();
    curve(g.gain, (t) => 0.1 * smooth(4.6, 8, t) * (1 - smooth(36.4, 37, t)) + 0.55 * smooth(37.5, 37.9, t) * (1 - smooth(38.2, 43, t)) + 0.05 * smooth(37, 38, t) * (1 - smooth(48, 52, t)), 0.05);
    n.connect(lp).connect(g); send(g, 0.3, 1);
  }
  // ---- wind: rises with the wings, roars in the whirlwind, softens in the high air
  {
    const n = ctx.createBufferSource(); n.buffer = NB; n.loop = true; n.playbackRate.value = 0.7; run(n);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    curve(bp.frequency, (t) => 300 + 900 * smooth(48, 58, t) * (0.8 + 0.2 * Math.sin(t * 1.7)) - 300 * smooth(62, 68, t));
    const g = ctx.createGain();
    curve(g.gain, (t) => (0.06 * smooth(37.5, 42, t) + 0.3 * smooth(49, 54, t) * (0.75 + 0.25 * Math.sin(t * 2.3)) * (1 - smooth(60, 65, t)) + 0.08 * smooth(60, 65, t)) * (1 - smooth(78, 84, t)), 0.1);
    n.connect(bp).connect(g); send(g, 0.4, 1);
  }
  // ---- whale song: long sliding calls in the dark
  const call = (t0, f0, f1, f2, dur, amp = 0.16) => {
    if (t0 + dur < from) return;
    const o = osc('sine', f0, t0, t0 + dur + 0.2), o2 = osc('triangle', f0 / 2, t0, t0 + dur + 0.2);
    const lfo = osc('sine', 5.2, t0, t0 + dur + 0.2), lg = ctx.createGain(); lg.gain.value = f0 * 0.012; lfo.connect(lg); lg.connect(o.frequency);
    for (const [x, k] of [[o, 1], [o2, 0.5]]) {
      x.frequency.setValueAtTime(f0 * k, at(t0)); x.frequency.linearRampToValueAtTime(f1 * k, at(t0 + dur * 0.45)); x.frequency.exponentialRampToValueAtTime(f2 * k, at(t0 + dur));
    }
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, at(t0)); g.gain.linearRampToValueAtTime(amp, at(t0 + dur * 0.25)); g.gain.linearRampToValueAtTime(amp * 0.7, at(t0 + dur * 0.75)); g.gain.linearRampToValueAtTime(0, at(t0 + dur));
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    o.connect(bp); o2.connect(g2).connect(bp); bp.connect(g); send(g, 1.2, 0.35);
  };
  call(8.5, 170, 300, 210, 4.2); call(13.2, 120, 95, 140, 3.4, 0.12); call(18.6, 230, 380, 260, 4.6, 0.2); call(25, 140, 220, 90, 4.0, 0.15); call(32.5, 260, 420, 300, 3.6, 0.17);
  // the last cry of the fish becomes the bird's: rising, airborne
  call(40.8, 300, 620, 880, 3.2, 0.12);

  // ---- guqin: a plucked phrase as each line of text appears
  const pluck = (t0, m, amp = 0.2, slide = 0) => {
    if (t0 < from - 0.01) return;
    const f = hz(m), g = ctx.createGain();
    g.gain.setValueAtTime(0, at(t0)); g.gain.linearRampToValueAtTime(amp, at(t0) + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, at(t0) + 3.2);
    for (const [k, a] of [[1, 1], [2, 0.45], [3, 0.22], [4, 0.12], [5.02, 0.06]]) {
      const o = osc('sine', f * k, t0, t0 + 3.5), og = ctx.createGain(); og.gain.value = a;
      if (slide) { o.frequency.setValueAtTime(f * k, at(t0) + 0.25); o.frequency.linearRampToValueAtTime(f * k * Math.pow(2, slide / 12), at(t0) + 0.9); }
      // 吟: a slow vibrato on the fundamental
      if (k === 1) { const l = osc('sine', 4.5, t0, t0 + 3.5), lg = ctx.createGain(); lg.gain.value = f * 0.006; l.connect(lg).connect(o.frequency); }
      o.connect(og).connect(g);
    }
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; g.connect(hp); send(hp, 0.55, 0.8);
  };
  const phrases = [[62, 66, 69], [57, 62], [69, 66, 64, 62], [64, 62, 57], [66, 69], [74, 71, 69], [69, 74], [71, 69, 66], [74, 76, 78], [78, 76, 74, 69], [69, 71, 74], [74, 69, 66, 62], [62, 57, 50]];
  CAPTIONS.forEach(([t0], i) => {
    const ph = phrases[i % phrases.length];
    ph.forEach((m, k) => pluck(t0 + 0.2 + k * (i === 0 || i === 12 ? 0.9 : 0.55), m - (t0 < 30 ? 12 : 0), 0.16, k === ph.length - 1 ? -2 : 0));
  });
  // ---- bells (磬): the ink drop, the bird complete, the end
  const bell = (t0, m, amp = 0.22) => {
    if (t0 < from - 0.01) return;
    const f = hz(m), g = ctx.createGain();
    g.gain.setValueAtTime(0, at(t0)); g.gain.linearRampToValueAtTime(amp, at(t0) + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, at(t0) + 7);
    for (const [k, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]]) { const o = osc('sine', f * k, t0, t0 + 7.5), og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(g); }
    send(g, 0.9, 0.6);
  };
  bell(T.inkDrop, 50, 0.26); bell(T.formed, 62, 0.18); bell(T.clouds, 69, 0.14); bell(79, 50, 0.24); bell(79.02, 57, 0.12);
  // ---- wing-beats: deep soft thumps on each downstroke
  for (const ft of flapTimes()) {
    if (ft < from) continue;
    const n = ctx.createBufferSource(); n.buffer = NB;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, at(ft)); g.gain.linearRampToValueAtTime(0.5, at(ft) + 0.08); g.gain.exponentialRampToValueAtTime(0.001, at(ft) + 0.9);
    n.connect(lp).connect(g); send(g, 0.4, 1);
    run(n, ft, ft + 1);
  }
  return {
    master,
    stop() {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(0, now + 0.12);
      setTimeout(() => { for (const s of sources) { try { s.stop(); } catch (e) { /* not started */ } } master.disconnect(); }, 200);
    },
  };
}

export function wav(buffer) {
  const ch = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const W = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  W(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); W(8, 'WAVE'); W(12, 'fmt '); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  W(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}
