// Shared environment state: clock, weather, wind and the sea's height function.
export const env = {
  t: 0,            // simulation seconds
  clock: 6.5 * 60, // game minutes since midnight
  wind: 4,         // m/s
  windDir: 0.6,    // radians (direction the wind blows toward, in x-z)
  swell: 1,
  weather: 'breeze',
  rain: 0,
  level: 0,        // current mean water level (tide)
  slow: false,
};

const SW = [
  { L: 19, A: 0.16, d: 0.0, w: 0.9, p: 0.0 },
  { L: 12, A: 0.1, d: 0.5, w: 1.25, p: 1.7 },
  { L: 7.5, A: 0.055, d: -0.6, w: 1.7, p: 3.1 },
  { L: 4.2, A: 0.03, d: 1.1, w: 2.4, p: 4.6 },
  { L: 2.3, A: 0.014, d: -1.3, w: 3.4, p: 2.2 },
];

export function tide() {
  // a slow semi-diurnal tide (period 12.4 game hours)
  return 0.35 * Math.sin((env.clock / 60 / 12.4) * Math.PI * 2 + 1.0);
}

/** Water surface height at (x, z). Everything floating uses this. */
export function seaHeight(x, z, t = env.t) {
  let h = env.level;
  const s = env.swell;
  for (let i = 0; i < SW.length; i++) {
    const w = SW[i];
    const a = env.windDir + w.d;
    const k = (Math.PI * 2) / w.L;
    const amp = w.A * (i < 3 ? s : 0.4 + s * 0.6);
    h += amp * Math.sin(k * (Math.cos(a) * x + Math.sin(a) * z) - w.w * t + w.p);
  }
  return h;
}

/** Surface normal (from the analytic slope). */
export function seaNormal(x, z, t = env.t, out = [0, 1, 0]) {
  let dx = 0, dz = 0;
  const s = env.swell;
  for (let i = 0; i < SW.length; i++) {
    const w = SW[i];
    const a = env.windDir + w.d;
    const k = (Math.PI * 2) / w.L;
    const amp = w.A * (i < 3 ? s : 0.4 + s * 0.6);
    const c = amp * k * Math.cos(k * (Math.cos(a) * x + Math.sin(a) * z) - w.w * t + w.p);
    dx += c * Math.cos(a); dz += c * Math.sin(a);
  }
  const l = Math.hypot(dx, 1, dz);
  out[0] = -dx / l; out[1] = 1 / l; out[2] = -dz / l;
  return out;
}

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const angleLerp = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };
export function fmtClock(min) {
  const m = ((Math.floor(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
