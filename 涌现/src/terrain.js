// The land: an eroded fbm (value noise with analytic derivatives), identical in GLSL and JS,
// so camera paths can be checked against the ground on the CPU.
export const TSCALE = 1 / 420;   // world units -> noise units
export const TAMP = 300;         // height range
export const TOFF = 15;          // about a third of the land lies under water

export const TERRAIN_GLSL = /* glsl */ `
const float TSCALE = ${TSCALE.toFixed(8)};
const float TAMP = ${TAMP.toFixed(2)};
const float TOFF = ${TOFF.toFixed(2)};
vec3 noised(vec2 x) {
  vec2 fl = floor(x), f = x - fl;
  ivec2 i = ivec2(fl);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hashi(i), b = hashi(i + ivec2(1, 0)), c = hashi(i + ivec2(0, 1)), d = hashi(i + ivec2(1, 1));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * (vec2(k1, k2) + k4 * u.yx));
}
float terrainN(vec2 p, int oct) {
  float a = 0.0, b = 0.5; vec2 d = vec2(0.0);
  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    vec3 n = noised(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5; p = m * p * 2.0;
  }
  return a;
}
// world xz -> height of the uplifted land
float landH(vec2 x, int oct) {
  float n = terrainN(x * TSCALE + vec2(-5.228571, -15.228571), oct);
  return TAMP * n + TOFF + 220.0 * max(n - 0.12, 0.0) * max(n - 0.12, 0.0);
}
`;

// --- JS twin -----------------------------------------------------------------------------
const imul = Math.imul;
function pcg(v) {
  const s = (imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = imul(((s >>> (((s >>> 28) + 4) >>> 0)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
const hashi = (x, y) => ((pcg(((x | 0) >>> 0) + pcg((y | 0) >>> 0)) >>> 0) * (2 / 4294967295)) - 1;
function noised(x, y) {
  const fx = Math.floor(x), fy = Math.floor(y), u0 = x - fx, v0 = y - fy;
  const u = u0 * u0 * u0 * (u0 * (u0 * 6 - 15) + 10), v = v0 * v0 * v0 * (v0 * (v0 * 6 - 15) + 10);
  const du = 30 * u0 * u0 * (u0 * (u0 - 2) + 1), dv = 30 * v0 * v0 * (v0 * (v0 - 2) + 1);
  const a = hashi(fx, fy), b = hashi(fx + 1, fy), c = hashi(fx, fy + 1), d = hashi(fx + 1, fy + 1);
  const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return [a + k1 * u + k2 * v + k4 * u * v, du * (k1 + k4 * v), dv * (k2 + k4 * u)];
}
export function terrainN(px, py, oct = 6) {
  let a = 0, b = 0.5, dx = 0, dy = 0;
  for (let i = 0; i < oct; i++) {
    const n = noised(px, py);
    dx += n[1]; dy += n[2];
    a += (b * n[0]) / (1 + dx * dx + dy * dy);
    b *= 0.5;
    // GLSL mat2(0.8,-0.6,0.6,0.8) * p : column-major -> (0.8x + 0.6y, -0.6x + 0.8y)
    const nx = (0.8 * px + 0.6 * py) * 2, ny = (-0.6 * px + 0.8 * py) * 2;
    px = nx; py = ny;
  }
  return a;
}
export function landH(x, z, oct = 6) {
  const n = terrainN(x * TSCALE - 5.228571, z * TSCALE - 15.228571, oct);
  const k = Math.max(n - 0.12, 0);
  return TAMP * n + TOFF + 220 * k * k;
}
