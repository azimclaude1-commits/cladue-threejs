// The synthesizer: every instrument is built from oscillators and noise, scheduled from the event list.
import { EVENTS, hz } from './music.js';
import { DURATION } from './timeline.js';

function noiseBuf(ctx, sec = 2) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  let s = 22222; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  return b;
}
function impulse(ctx, sec = 3.4) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = 999;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const x = i / n; d[i] = (s / 1073741823.5 - 1) * Math.pow(1 - x, 2.8) * (i < 0.012 * ctx.sampleRate ? i / (0.012 * ctx.sampleRate) : 1); } }
  return b;
}

export class Synth {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.nodes = [];
    const c = ctx;
    this.master = c.createGain(); this.master.gain.value = 0.62;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(this.master); this.master.connect(dest);
    this.dry = c.createGain(); this.dry.connect(comp);
    this.rev = c.createGain(); const conv = c.createConvolver(); conv.buffer = impulse(c); const rg = c.createGain(); rg.gain.value = 0.5; this.rev.connect(conv).connect(rg).connect(comp);
    // ping-pong delay, three sixteenths
    this.del = c.createGain();
    const dl = c.createDelay(2), dr = c.createDelay(2), fb = c.createGain(), lp = c.createBiquadFilter(), mer = c.createChannelMerger(2), dg = c.createGain();
    dl.delayTime.value = 0.45; dr.delayTime.value = 0.45; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 3500; dg.gain.value = 0.45;
    this.del.connect(dl); dl.connect(dr); dr.connect(lp).connect(fb).connect(dl);
    dl.connect(mer, 0, 0); dr.connect(mer, 0, 1); mer.connect(dg).connect(comp);
    this.noise = noiseBuf(c);
  }
  _out(node, dry = 1, rev = 0, del = 0, pan = 0) {
    let n = node;
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); n = p; }
    if (dry) { const g = this.ctx.createGain(); g.gain.value = dry; n.connect(g).connect(this.dry); }
    if (rev) { const g = this.ctx.createGain(); g.gain.value = rev; n.connect(g).connect(this.rev); }
    if (del) { const g = this.ctx.createGain(); g.gain.value = del; n.connect(g).connect(this.del); }
  }
  _src(node, t0, t1, offset) { if (offset != null) node.start(t0, offset); else node.start(t0); node.stop(t1); this.nodes.push(node); return node; }
  osc(type, f, t0, t1) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return this._src(o, t0, t1); }
  nz(t0, t1) { const n = this.ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; this._k = ((this._k || 0) + 1) % 997; return this._src(n, t0, t1, (this._k * 0.377) % 1.5); }
  env(t0, a, peak, dec, sustainTo = 0.0001) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(Math.max(sustainTo, 0.0001), t0 + a + dec); return g; }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  play(e, t, off = 0) {
    const c = this.ctx, v = e.v ?? 1;
    switch (e.type) {
      case 'kick': case 'heart': case 'thud': {
        const deep = e.type !== 'kick';
        const o = this.osc('sine', deep ? 95 : 155, t, t + 0.8);
        o.frequency.exponentialRampToValueAtTime(deep ? 38 : 44, t + (deep ? 0.16 : 0.11));
        const g = this.env(t, 0.003, v * (deep ? 0.9 : 1.0), deep ? 0.42 : 0.5);
        o.connect(g); this._out(g, 1, deep ? 0.15 : 0.05);
        if (!deep) { const n = this.nz(t, t + 0.03), hp = this.filt('highpass', 3000), ng = this.env(t, 0.001, v * 0.18, 0.02); n.connect(hp).connect(ng); this._out(ng, 1); }
        break;
      }
      case 'clap': {
        const n = this.nz(t, t + 0.35), bp = this.filt('bandpass', 1300, 0.9), g = c.createGain();
        g.gain.setValueAtTime(0, t);
        for (const k of [0, 0.011, 0.022]) { g.gain.setValueAtTime(v * 0.5, t + k); g.gain.exponentialRampToValueAtTime(0.02, t + k + 0.01); }
        g.gain.setValueAtTime(v * 0.45, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        n.connect(bp).connect(g); this._out(g, 1, 0.35);
        break;
      }
      case 'hat': case 'shaker': {
        const n = this.nz(t, t + 0.12), f = e.type === 'hat' ? this.filt('highpass', 8000) : this.filt('bandpass', 6500, 2);
        const g = this.env(t, 0.001, v * (e.type === 'hat' ? 0.28 : 0.2), e.type === 'hat' ? 0.045 : 0.07);
        n.connect(f).connect(g); this._out(g, 1, 0.05, 0, (Math.sin(t * 13) * 0.4));
        break;
      }
      case 'crash': {
        const n = this.nz(t, t + 2.2), f = this.filt('highpass', 3800), g = this.env(t, 0.002, v * 0.35, 1.9);
        n.connect(f).connect(g); this._out(g, 1, 0.5);
        break;
      }
      case 'bass': {
        const f = hz(e.m + 12), lp = this.filt('lowpass', 900, 4), g = this.env(t, 0.004, v * 0.3, e.d * 1.2);
        lp.frequency.setValueAtTime(1100, t); lp.frequency.exponentialRampToValueAtTime(220, t + 0.16);
        for (const [type, d, a] of [['sawtooth', -6, 1], ['square', 6, 0.5]]) { const o = this.osc(type, f, t, t + e.d * 1.3 + 0.05); o.detune.value = d; const og = c.createGain(); og.gain.value = a; o.connect(og).connect(lp); }
        lp.connect(g); this._out(g, 1, 0.05);
        break;
      }
      case 'sub': {
        const dur = e.d - off, o = this.osc('sine', hz(e.m + 12), t, t + dur + 0.5), g = c.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.45, t + 0.15); g.gain.setValueAtTime(v * 0.45, t + Math.max(0.2, dur - 0.3)); g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
        o.connect(g); this._out(g, 1);
        break;
      }
      case 'drone': {
        const dur = e.d - off, g = c.createGain(), lp = this.filt('lowpass', 200);
        lp.frequency.setValueAtTime(140, t); lp.frequency.linearRampToValueAtTime(900, t + dur);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.4, t + Math.min(2, dur * 0.3)); g.gain.setValueAtTime(v * 0.4, t + dur - 1.2); g.gain.linearRampToValueAtTime(0, t + dur);
        for (const [type, mul, a] of [['sine', 1, 1], ['sine', 1.5, 0.5], ['sawtooth', 1, 0.15], ['sawtooth', 2.003, 0.08]]) { const o = this.osc(type, hz(e.m) * mul, t, t + dur + 0.1); const og = c.createGain(); og.gain.value = a; o.connect(og).connect(lp); }
        lp.connect(g); this._out(g, 1, 0.4);
        break;
      }
      case 'arp': {
        const f = hz(e.m), lp = this.filt('lowpass', e.cut, 7), g = this.env(t, 0.003, v * 0.12, e.d * 2.2);
        lp.frequency.setValueAtTime(e.cut * 2.2, t); lp.frequency.exponentialRampToValueAtTime(Math.max(200, e.cut * 0.5), t + 0.14);
        for (const d of [-8, 8]) { const o = this.osc('sawtooth', f, t, t + e.d * 2.6); o.detune.value = d; o.connect(lp); }
        lp.connect(g); this._out(g, 1, 0.2, 0.32, Math.sin(t * 2.1) * 0.5);
        break;
      }
      case 'pad': {
        const dur = e.d - off, lp = this.filt('lowpass', e.cut, 0.6), g = c.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.07, t + Math.min(0.6, dur * 0.4)); g.gain.setValueAtTime(v * 0.07, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 1.0);
        for (const m of e.ms) for (const [type, d] of [['sawtooth', -10], ['sawtooth', 10], ['triangle', 0]]) { const o = this.osc(type, hz(m), t, t + dur + 1.1); o.detune.value = d; o.connect(lp); }
        lp.connect(g); this._out(g, 0.8, 0.6);
        break;
      }
      case 'lead': {
        const f = hz(e.m), lp = this.filt('lowpass', 2600, 1), g = c.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.16, t + 0.09); g.gain.setValueAtTime(v * 0.14, t + e.d * 0.8); g.gain.linearRampToValueAtTime(0, t + e.d + 0.35);
        const lfo = this.osc('sine', 5.2, t, t + e.d + 0.4), lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + 0.5); lfo.connect(lg);
        for (const [type, a] of [['triangle', 1], ['sawtooth', 0.25]]) { const o = this.osc(type, f, t, t + e.d + 0.4); lg.connect(o.frequency); const og = c.createGain(); og.gain.value = a; o.connect(og).connect(lp); }
        lp.connect(g); this._out(g, 0.9, 0.45, 0.3);
        break;
      }
      case 'marimba': {
        const f = hz(e.m), g = this.env(t, 0.002, v * 0.3, 0.55);
        for (const [mul, a, dec] of [[1, 1, 0.55], [3.98, 0.25, 0.08], [10.1, 0.08, 0.02]]) { const o = this.osc('sine', f * mul, t, t + 0.6); const og = this.env(t, 0.001, a, dec); o.connect(og).connect(g); }
        this._out(g, 1, 0.3, 0.15, ((e.m % 7) / 7 - 0.5) * 0.8);
        break;
      }
      case 'shimmer': {
        const f = hz(e.m), g = this.env(t, 0.002, v * 0.1, 0.32);
        const o = this.osc('triangle', f, t, t + 0.4), o2 = this.osc('sine', f * 2, t, t + 0.4), g2 = c.createGain(); g2.gain.value = 0.3;
        o.connect(g); o2.connect(g2).connect(g);
        this._out(g, 1, 0.35, 0.45, Math.sin(e.m * 1.7) * 0.7);
        break;
      }
      case 'bell': {
        const f = hz(e.m), dec = 3.2;
        const car = this.osc('sine', f, t, t + dec + 0.1), mod = this.osc('sine', f * 3.5, t, t + dec + 0.1), mg = c.createGain();
        mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.4);
        mod.connect(mg).connect(car.frequency);
        const g = this.env(t, 0.002, v * 0.16, dec);
        car.connect(g); this._out(g, 1, 0.55, 0.35, Math.sin(e.m * 2.3) * 0.6);
        break;
      }
      case 'riser': case 'suck': case 'down': {
        const dur = e.d - off, n = this.nz(t, t + dur + 0.1), bp = this.filt('bandpass', 300, 2.5), g = c.createGain();
        const up = e.type !== 'down';
        bp.frequency.setValueAtTime(up ? 250 : 5000, t); bp.frequency.exponentialRampToValueAtTime(up ? 6000 : 250, t + dur);
        g.gain.setValueAtTime(up ? 0.0001 : v * 0.3, t); g.gain.exponentialRampToValueAtTime(up ? v * 0.35 : 0.0001, t + dur);
        if (e.type === 'suck') g.gain.setValueAtTime(0, t + dur);
        n.connect(bp).connect(g); this._out(g, 1, 0.4);
        break;
      }
      case 'impact': {
        const o = this.osc('sine', 75, t, t + 2.2); o.frequency.exponentialRampToValueAtTime(27, t + 1.4);
        const g = this.env(t, 0.004, v * 1.0, 1.9); o.connect(g); this._out(g, 1, 0.3);
        const n = this.nz(t, t + 1.4), lp = this.filt('lowpass', 1400), ng = this.env(t, 0.002, v * 0.45, 1.1); n.connect(lp).connect(ng); this._out(ng, 0.8, 0.7);
        break;
      }
      default: break;
    }
  }
  stop() {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now); this.master.gain.setValueAtTime(this.master.gain.value, now); this.master.gain.linearRampToValueAtTime(0, now + 0.08);
    const nodes = this.nodes; this.nodes = [];
    setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch (e) { /* done */ } } try { this.master.disconnect(); } catch (e) { /* done */ } }, 150);
  }
}

/** Live playback: a look-ahead scheduler that plays the film from time `from`. */
export class Player {
  constructor(ctx) { this.ctx = ctx; this.synth = null; this.timer = 0; }
  start(from) {
    this.stop();
    const ctx = this.ctx, syn = new Synth(ctx, ctx.destination);
    this.synth = syn;
    const base = ctx.currentTime + 0.08 - from;
    this.base = base;
    // things already sounding when we join
    for (const e of EVENTS) if (e.t < from && e.d && e.t + e.d > from + 0.2) syn.play(e, base + from, from - e.t);
    let i = EVENTS.findIndex((e) => e.t >= from); if (i < 0) i = EVENTS.length;
    const tick = () => {
      const horizon = ctx.currentTime - base + 0.35;
      while (i < EVENTS.length && EVENTS[i].t <= horizon) { const e = EVENTS[i++]; syn.play(e, Math.max(ctx.currentTime, base + e.t)); }
      // forget finished nodes now and then
      if (syn.nodes.length > 600) syn.nodes = syn.nodes.slice(-300);
    };
    tick();
    this.timer = setInterval(tick, 60);
  }
  stop() { clearInterval(this.timer); if (this.synth) { this.synth.stop(); this.synth = null; } }
}

/** The whole score, rendered offline (for export). */
export async function renderScore(sr = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * DURATION), sr);
  const syn = new Synth(ctx, ctx.destination);
  for (const e of EVENTS) syn.play(e, e.t);
  return ctx.startRendering();
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
