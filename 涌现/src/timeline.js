// The film is 50 bars at 100 BPM: exactly 120 seconds. Everything is a function of t.
export const BPM = 100;
export const BEAT = 60 / BPM;      // 0.6 s
export const BAR = BEAT * 4;       // 2.4 s
export const DURATION = 50 * BAR;  // 120 s
export const bar = (n) => n * BAR;

export const ACTS = [
  { id: 'intro', t: 0, num: '', name: '序', en: 'PROLOGUE', desc: '' },
  { id: 'chaos', t: bar(3), num: 'I', name: '混沌', en: 'CHAOS', desc: '四组三行的微分方程，驱动 {N} 个粒子' },
  { id: 'rules', t: bar(13), num: 'II', name: '规则', en: 'RULES', desc: '每个像素只看它的邻居 —— 格雷-斯科特反应扩散' },
  { id: 'world', t: bar(21), num: 'III', name: '世界', en: 'WORLD', desc: '噪声叠加噪声：山、水、云与大气，逐像素光线步进' },
  { id: 'life', t: bar(30), num: 'IV', name: '生命', en: 'LIFE', desc: '{B} 只鸟，没有领袖' },
  { id: 'mind', t: bar(38), num: 'V', name: '心智', en: 'MIND', desc: '神经元生长、相连，信号在其间传递' },
  { id: 'coda', t: bar(46), num: '', name: '尾声', en: 'CODA', desc: '' },
];

// key moments
export const T = {
  bang: bar(3),            // 7.2   the point bursts
  aizawa: bar(6),          // 14.4
  halvorsen: bar(9),       // 21.6
  thomas: bar(11),         // 26.4
  land: bar(12.33),        // 29.6  particles fall to the plane
  seed: bar(13.25),        // 31.8  they print the first pattern
  rise: bar(18.5),         // 44.4  the pattern lifts into land
  dawn: bar(20),           // 48
  world: bar(21),          // 50.4
  dusk: bar(30),           // 72
  flyThrough: bar(33),     // 79.2, on the crash
  night: bar(37),          // 88.8
  mind: bar(38),           // 91.2
  pulses: bar(40),         // 96
  dissolve: bar(45.3),     // 108.7 the network breaks into particles
  text: bar(46),           // 110.4
  collapse: bar(49),       // 117.6
};

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export function actAt(t) { let a = ACTS[0]; for (const k of ACTS) if (t >= k.t) a = k; return a; }
