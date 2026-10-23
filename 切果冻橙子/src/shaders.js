// WGSL for every pass. Shared chunks are concatenated per pipeline.
import { POLAR, EQUATOR, SEAT_Y, SEAT_K, ZEST, PITH, SEGMENTS, PIP_COUNT, PIP_HALF } from './orange.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const COMMON = /* wgsl */ `
const PI = 3.14159265;
const TAU = 6.2831853;
const POLAR = ${f(POLAR)};
const EQUATOR = ${f(EQUATOR)};
const SEAT_Y = ${f(SEAT_Y)};
const SEAT_K = ${f(SEAT_K)};
const ZEST = ${f(ZEST)};
const PITH = ${f(PITH)};
const NSEG = ${SEGMENTS};
const SEGW = ${f((2 * Math.PI) / SEGMENTS)};
const NPIP = ${PIP_COUNT};
const PIP_L = ${f(PIP_HALF[0])};
const PIP_T = ${f(PIP_HALF[1])};
const PIP_W = ${f(PIP_HALF[2])};

struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  lightVP: mat4x4f,
  heightVP: mat4x4f,
  camPos: vec4f,     // xyz, time
  lightDir: vec4f,   // xyz toward light, intensity
  res: vec4f,        // w, h, 1/w, 1/h
  misc: vec4f,       // showMesh, frame, light depth range, shadow map size
  zestAbs: vec4f,
  pithAbs: vec4f,
  memAbs: vec4f,
  fleshAbs: vec4f,
  fleshAbs2: vec4f,
  glow: vec4f,
  stem: vec4f,
  blush: vec4f,
  shadowTint: vec4f,
  walls: array<vec4f, ${SEGMENTS}>,
  pips: array<vec4f, ${PIP_COUNT * 2}>,
  bubbles: array<vec4f, 8>,
};

struct Vtx {
  rest: vec3f, slot: f32,
  nrm: vec3f, pad: f32,
  tet: vec4u,
  bary: vec4f,
  m0: vec4f, m1: vec4f, m2: vec4f,
};

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> verts: array<Vtx>;
@group(0) @binding(2) var<storage, read> nodes: array<vec4f>;

fn inv3(m: mat3x3f) -> mat3x3f {
  let a = m[0]; let b = m[1]; let c = m[2];
  let r0 = cross(b, c); let r1 = cross(c, a); let r2 = cross(a, b);
  let det = dot(a, r0);
  if (abs(det) < 1e-9) { return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)); }
  return transpose(mat3x3f(r0, r1, r2)) * (1.0 / det);
}

struct Skin { pos: vec3f, finv: mat3x3f, nrm: vec3f, rest: vec3f, slot: f32 };
fn skin(vi: u32) -> Skin {
  let v = verts[vi];
  let x0 = nodes[v.tet.x].xyz; let x1 = nodes[v.tet.y].xyz;
  let x2 = nodes[v.tet.z].xyz; let x3 = nodes[v.tet.w].xyz;
  var s: Skin;
  s.pos = v.bary.x * x0 + v.bary.y * x1 + v.bary.z * x2 + v.bary.w * x3;
  let Ds = mat3x3f(x1 - x0, x2 - x0, x3 - x0);
  let Dmi = transpose(mat3x3f(v.m0.xyz, v.m1.xyz, v.m2.xyz));
  let Fm = Ds * Dmi;
  s.finv = inv3(Fm);
  s.nrm = normalize(transpose(s.finv) * v.nrm);
  s.rest = v.rest;
  s.slot = v.slot;
  return s;
}

fn hash11(p: f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453); }
fn hash33(p0: vec3f) -> vec3f {
  var p = fract(p0 * vec3f(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let fr = fract(p);
  let u = fr * fr * (3.0 - 2.0 * fr);
  let n000 = hash33(i).x; let n100 = hash33(i + vec3f(1.0, 0.0, 0.0)).x;
  let n010 = hash33(i + vec3f(0.0, 1.0, 0.0)).x; let n110 = hash33(i + vec3f(1.0, 1.0, 0.0)).x;
  let n001 = hash33(i + vec3f(0.0, 0.0, 1.0)).x; let n101 = hash33(i + vec3f(1.0, 0.0, 1.0)).x;
  let n011 = hash33(i + vec3f(0.0, 1.0, 1.0)).x; let n111 = hash33(i + vec3f(1.0, 1.0, 1.0)).x;
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
`;

// ---------------------------------------------------------------- anatomy --
export const ANATOMY = /* wgsl */ `
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}
fn ellSdf(p: vec3f) -> f32 {
  let r = vec3f(POLAR, EQUATOR, EQUATOR);
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
fn orangeSdf(p: vec3f) -> f32 { return smax(ellSdf(p), SEAT_Y - p.y, SEAT_K); }
fn wrapPi(a: f32) -> f32 { return a - TAU * floor((a + PI) / TAU); }

struct Seg { mem: f32, frac: f32, id: f32, width: f32 };
fn segInfo(p: vec3f) -> Seg {
  let r = length(p.yz);
  var th = atan2(p.z, p.y);
  if (th < 0.0) { th += TAU; }
  let base = i32(floor(th / SEGW - 0.5));
  var dPos = 10.0; var dNeg = 10.0; var leftId = 0.0;
  for (var j = -1; j <= 2; j++) {
    let k = (base + j + 2 * NSEG) % NSEG;
    let w = F.walls[k];
    let ang = w.x + w.y * sin(PI * clamp((r - 0.1) / 1.05, 0.0, 1.0)) + w.z * sin(2.2 * p.x + w.w);
    let d = wrapPi(th - ang);
    if (d >= 0.0 && d < dPos) { dPos = d; leftId = f32(k); }
    if (d < 0.0 && -d < dNeg) { dNeg = -d; }
  }
  var s: Seg;
  s.mem = min(dPos, dNeg) * r;
  s.frac = dPos / max(dPos + dNeg, 1e-4);
  s.id = leftId;
  s.width = (dPos + dNeg) * r;
  return s;
}

fn coreRadius(x: f32) -> f32 { let t = x / POLAR; return 0.1 * (1.0 - 0.35 * t * t) + 0.012 * sin(x * 7.0); }

// x = vesicle wall amount, y = per-sac tone
fn vesicle(p: vec3f, r: f32, coreR: f32, depth: f32, sg: Seg) -> vec2f {
  let fleshT = max(depth - PITH, 0.0);
  let u = clamp((r - coreR) / max(r - coreR + fleshT, 1e-3), 0.0, 1.0);
  let ur = u * 3.3;
  let row = floor(ur);
  let tc = sg.frac * sg.width / 0.08 + row * 0.5 + sg.id * 3.7;
  let ax = p.x / 0.085 + row * 0.37;
  let h = hash33(vec3f(row, floor(tc), floor(ax)) + sg.id * 17.0);
  let lx = fract(ur) - 0.5;
  let ly = fract(tc) - 0.5 + (h.x - 0.5) * 0.14;
  let lz = fract(ax) - 0.5 + (h.y - 0.5) * 0.14;
  let tt = clamp(lx + 0.5, 0.0, 1.0);
  let w = 0.47 * (0.28 + 0.72 * sqrt(tt));
  let rho = max(length(vec2f(ly, lz)) / w, abs(lx) * 2.05);
  return vec2f(smoothstep(0.74, 1.0, rho), h.z);
}

// returns how deep inside pip i the point is (<1 inside), 99 if not this piece
fn pipField(p: vec3f, slot: f32) -> vec2f {
  var best = 99.0; var idx = -1.0;
  for (var i = 0; i < NPIP; i++) {
    let pp = F.pips[i * 2];
    if (abs(pp.w - slot) > 0.5) { continue; }
    let q = p - pp.xyz;
    if (dot(q, q) > 0.0144) { continue; }
    let d = F.pips[i * 2 + 1].xyz;
    let a = dot(q, d);
    let t = vec3f(0.0, -d.z, d.y);
    let b = dot(q, t);
    let taper = mix(1.0, 0.32, smoothstep(-PIP_L, PIP_L, a));
    let v = (a / PIP_L) * (a / PIP_L) + (b / (PIP_T * taper)) * (b / (PIP_T * taper)) + (q.x / (PIP_W * taper)) * (q.x / (PIP_W * taper));
    if (v < best) { best = v; idx = f32(i); }
  }
  return vec2f(best, idx);
}

struct Mat { a: vec3f, s: f32, kind: i32 };
// kind: 0 flesh, 1 zest, 2 pith, 3 membrane, 4 core, 5 pip, 6 bubble
fn material(p: vec3f, slot: f32) -> Mat {
  var m: Mat;
  let depth = -orangeSdf(p);
  if (depth < ZEST) {
    let mott = noise3(p * 6.0) * 0.6 + noise3(p * 23.0) * 0.4;
    m.a = F.zestAbs.xyz * (0.7 + 0.6 * mott) + F.blush.xyz * smoothstep(0.5, 0.85, noise3(p * 2.2 + 3.1));
    m.s = 0.7; m.kind = 1; return m;
  }
  if (depth < PITH) { m.a = F.pithAbs.xyz; m.s = 1.8; m.kind = 2; return m; }
  let r = length(p.yz);
  let cr = coreRadius(p.x);
  if (r < cr) { m.a = F.memAbs.xyz * 1.3; m.s = 5.0; m.kind = 4; return m; }
  let pf = pipField(p, slot);
  if (pf.x < 1.0) { m.a = vec3f(0.35, 0.5, 1.1); m.s = 30.0; m.kind = 5; return m; }
  for (var i = 0; i < 8; i++) {
    let b = F.bubbles[i];
    if (b.w <= 0.0) { continue; }
    let d = length(p - b.xyz);
    if (d < b.w) { m.a = vec3f(0.0); m.s = select(0.0, 18.0, d > b.w * 0.75); m.kind = 6; return m; }
  }
  let sg = segInfo(p);
  let memW = 0.009 + 0.006 * (r / 1.2);
  if (sg.mem < memW) { m.a = F.memAbs.xyz; m.s = 6.0; m.kind = 3; return m; }
  let ves = vesicle(p, r, cr, depth, sg);
  m.a = mix(F.fleshAbs.xyz, F.fleshAbs2.xyz, ves.y) * (1.0 - 0.35 * ves.x);
  m.s = 0.12 + 1.1 * ves.x;
  m.kind = 0;
  return m;
}
`;

// ---------------------------------------------------------------- lighting --
export const LIGHTING = /* wgsl */ `
fn lightBasis() -> mat3x3f {
  let L = F.lightDir.xyz;
  let u = normalize(cross(vec3f(0.0, 1.0, 0.0), L));
  let v = cross(L, u);
  return mat3x3f(u, v, L);
}

// Procedural photo studio: warm paper sweep, a big key softbox, a strip light and a fill card.
fn studioEnv(d: vec3f) -> vec3f {
  var c = mix(vec3f(0.3, 0.28, 0.26), vec3f(0.58, 0.56, 0.53), smoothstep(-0.25, 0.5, d.y));
  c = mix(c, vec3f(0.45, 0.43, 0.41), smoothstep(0.6, 1.0, d.y) * 0.5);
  let B = lightBasis();
  let w = dot(d, B[2]);
  if (w > 0.0) {
    let u = dot(d, B[0]) / w; let v = dot(d, B[1]) / w;
    let box = (1.0 - smoothstep(0.28, 0.34, abs(u))) * (1.0 - smoothstep(0.2, 0.26, abs(v)));
    c += vec3f(1.0, 0.97, 0.92) * box * 7.0;
  }
  let sd = normalize(vec3f(0.85, 0.3, -0.55));
  let ws = dot(d, sd);
  if (ws > 0.0) {
    let st = normalize(cross(vec3f(0.0, 1.0, 0.0), sd));
    let u2 = dot(d, st) / ws; let v2 = d.y / ws - 0.3;
    c += vec3f(0.9, 0.95, 1.0) * (1.0 - smoothstep(0.05, 0.08, abs(u2))) * (1.0 - smoothstep(0.5, 0.6, abs(v2))) * 3.0;
  }
  let fd = normalize(vec3f(-0.4, 0.15, 0.9));
  c += vec3f(1.0, 0.95, 0.9) * smoothstep(0.86, 0.95, dot(d, fd)) * 0.8;
  return c;
}

fn spiral(i: i32, n: i32, rot: f32) -> vec2f {
  let a = f32(i) * 2.39996 + rot;
  return vec2f(cos(a), sin(a)) * sqrt((f32(i) + 0.5) / f32(n));
}

fn shadowCoord(P: vec3f) -> vec3f {
  let lp = F.lightVP * vec4f(P, 1.0);
  return vec3f(lp.xy * vec2f(0.5, -0.5) + 0.5, lp.z);
}
`;

export const SHADOW_SAMPLING = /* wgsl */ `
@group(1) @binding(0) var shadowTex: texture_depth_2d;
@group(1) @binding(1) var shadowCmp: sampler_comparison;
@group(1) @binding(2) var heightTex: texture_depth_2d;

fn shadowDepthAt(uv: vec2f) -> f32 {
  let sz = F.misc.w;
  let c = clamp(vec2i(uv * sz), vec2i(0), vec2i(i32(sz) - 1));
  return textureLoad(shadowTex, c, 0);
}

// Percentage-closer soft shadows from an area key light.
fn pcss(P: vec3f, rot: f32) -> f32 {
  let sc = shadowCoord(P);
  if (any(sc.xy < vec2f(0.0)) || any(sc.xy > vec2f(1.0))) { return 1.0; }
  let z = sc.z;
  var sum = 0.0; var cnt = 0.0;
  for (var i = 0; i < 12; i++) {
    let d = shadowDepthAt(sc.xy + spiral(i, 12, rot) * 0.02);
    if (d < z - 0.002) { sum += d; cnt += 1.0; }
  }
  if (cnt < 0.5) { return 1.0; }
  let avg = sum / cnt;
  let pen = clamp((z - avg) * F.misc.z * 0.075 / 10.0, 0.0012, 0.03);
  var vis = 0.0;
  for (var i = 0; i < 16; i++) {
    vis += textureSampleCompareLevel(shadowTex, shadowCmp, sc.xy + spiral(i, 16, rot) * pen, z - 0.0015);
  }
  return vis / 16.0;
}

fn pcfSmall(P: vec3f) -> f32 {
  let sc = shadowCoord(P);
  if (any(sc.xy < vec2f(0.0)) || any(sc.xy > vec2f(1.0))) { return 1.0; }
  var vis = 0.0;
  for (var i = 0; i < 6; i++) {
    vis += textureSampleCompareLevel(shadowTex, shadowCmp, sc.xy + spiral(i, 6, 0.0) * 0.0025, sc.z - 0.003);
  }
  return vis / 6.0;
}

fn heightAt(xz: vec2f) -> f32 {
  let hp = F.heightVP * vec4f(xz.x, 0.0, xz.y, 1.0);
  let uv = hp.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 0.0; }
  let dim = vec2f(textureDimensions(heightTex));
  let d = textureLoad(heightTex, vec2i(uv * dim), 0);
  return 6.0 - d * 6.0;
}

// Contact ambient occlusion from the top-down height map.
fn contactAO(P: vec3f) -> f32 {
  var occ = 0.0;
  for (var i = 0; i < 14; i++) {
    let o = spiral(i, 14, 0.7);
    let r = 0.06 + length(o) * 0.75;
    let h = heightAt(P.xz + o * 0.81);
    occ += clamp((h - P.y) / (r * 1.4 + 0.06), 0.0, 1.0) * (1.0 - r * 0.6);
  }
  return clamp(1.0 - occ / 14.0 * 1.35, 0.0, 1.0);
}
`;

export const FULLSCREEN_VS = /* wgsl */ `
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- passes --
export const DEPTH_PASS = /* wgsl */ `
@vertex fn vsShadow(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let s = skin(vi);
  return F.lightVP * vec4f(s.pos, 1.0);
}
@vertex fn vsHeight(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let s = skin(vi);
  return F.heightVP * vec4f(s.pos, 1.0);
}
struct BackOut { @builtin(position) pos: vec4f, @location(0) wpos: vec3f };
@vertex fn vsBack(@builtin(vertex_index) vi: u32) -> BackOut {
  let s = skin(vi);
  var o: BackOut;
  o.pos = F.viewProj * vec4f(s.pos, 1.0);
  o.wpos = s.pos;
  return o;
}
@fragment fn fsBack(vin: BackOut) -> @location(0) vec4f {
  return vec4f(length(vin.wpos - F.camPos.xyz), 0.0, 0.0, 1.0);
}
`;

export const STUDIO_PASS = /* wgsl */ `
fn backdrop(rd: vec3f, uv: vec2f) -> vec3f {
  let up = smoothstep(-0.05, 0.6, rd.y);
  var c = mix(vec3f(0.6, 0.57, 0.53), vec3f(0.45, 0.43, 0.41), up);
  let v = length((uv - vec2f(0.45, 0.42)) * vec2f(1.0, 1.25));
  c *= 1.0 - 0.28 * smoothstep(0.35, 1.0, v);
  return c;
}

@fragment fn fsStudio(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy * F.res.zw;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let a = F.invViewProj * vec4f(ndc, 0.0, 1.0);
  let b = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  let ro = a.xyz / a.w;
  let rd = normalize(b.xyz / b.w - ro);
  var col = backdrop(rd, uv);
  if (rd.y < -1e-4) {
    let t = -ro.y / rd.y;
    let P = ro + rd * t;
    let L = F.lightDir.xyz;
    let rot = hash12(fc.xy) * TAU;
    let vis = pcss(P, rot);
    let ao = contactAO(P);
    let tint = F.shadowTint.xyz;
    // light through the jelly arrives tinted; the umbra keeps a warm glow
    let keyCol = mix(tint * 0.32, vec3f(1.0), vis);
    let paper = vec3f(0.80, 0.765, 0.72) * (0.97 + 0.03 * noise3(vec3f(P.xz * 40.0, 0.0)));
    let key = F.lightDir.w * max(L.y, 0.0) * keyCol;
    let amb = vec3f(0.5, 0.49, 0.48) * ao;
    var floorC = paper * (key * 0.3 + amb * 0.32);
    let dist = length(P.xz);
    floorC = mix(floorC, col, smoothstep(7.0, 20.0, dist));
    col = floorC;
  }
  return vec4f(col, 1.0);
}
`;

export const BLIT_PASS = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@fragment fn fsBlit(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  return textureLoad(srcTex, vec2i(fc.xy), 0);
}
`;

export const POST_PASS = /* wgsl */ `
@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> post: vec4f; // exposure, srgb flag, time

// Khronos PBR Neutral tone mapping
fn pbrNeutral(c0: vec3f) -> vec3f {
  let startCompression = 0.8 - 0.04;
  let desaturation = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c0 - offset;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startCompression) { return c; }
  let d = 1.0 - startCompression;
  let newPeak = 1.0 - d * d / (peak + d - startCompression);
  c *= newPeak / peak;
  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(c, vec3f(newPeak), g);
}
fn toSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
fn h12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
@fragment fn fsPost(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  var c = textureLoad(hdrTex, vec2i(fc.xy), 0).rgb * post.x;
  c = clamp(pbrNeutral(max(c, vec3f(0.0))), vec3f(0.0), vec3f(1.0));
  if (post.y > 0.5) { c = toSrgb(c); }
  let n = (h12(fc.xy + post.z * 61.0) + h12(fc.yx * 1.31 + post.z * 17.0) - 1.0) / 255.0;
  return vec4f(c + n, 1.0);
}
`;

export const JELLY_PASS = /* wgsl */ `
@group(1) @binding(3) var sceneTex: texture_2d<f32>;
@group(1) @binding(4) var backTex: texture_2d<f32>;
@group(1) @binding(5) var linSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) rest: vec3f,
  @location(2) nrm: vec3f,
  @location(3) f0: vec3f,
  @location(4) f1: vec3f,
  @location(5) f2: vec3f,
  @location(6) @interpolate(flat) slot: f32,
};

@vertex fn vsJelly(@builtin(vertex_index) vi: u32) -> VOut {
  let s = skin(vi);
  var o: VOut;
  o.pos = F.viewProj * vec4f(s.pos, 1.0);
  o.wpos = s.pos;
  o.rest = s.rest;
  o.nrm = s.nrm;
  o.f0 = s.finv[0]; o.f1 = s.finv[1]; o.f2 = s.finv[2];
  o.slot = s.slot;
  return o;
}

fn ggx(N: vec3f, V: vec3f, L: vec3f, rough: f32) -> f32 {
  let H = normalize(V + L);
  let nh = max(dot(N, H), 0.0);
  let a2 = rough * rough * rough * rough;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * d * d);
  let nl = max(dot(N, L), 0.0); let nv = max(dot(N, V), 1e-3);
  let k = rough * rough * 0.5;
  let G = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  return D * G / (4.0 * nv + 1e-4);
}

// pores: a cellular field of oil glands on the zest (value ~1 in a gland)
fn pores(p: vec3f) -> f32 {
  let q = p * 30.0;
  let i = floor(q);
  var best = 9.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = i + vec3f(f32(x), f32(y), f32(z));
    let o = c + hash33(c) * 0.85 + 0.075;
    let d = q - o;
    best = min(best, dot(d, d));
  } } }
  return 1.0 - smoothstep(0.0, 0.22, best);
}

struct Surf { col: vec3f, alpha: f32, rough: f32 };

// What a fresh cut face shows at rest point p: pith ring, zest rim, membrane star, core, pips.
fn cutSurface(p: vec3f, slot: f32) -> Surf {
  var s: Surf;
  s.rough = 0.12;
  let depth = -orangeSdf(p);
  let flesh = exp(-F.fleshAbs.xyz * 1.1);
  s.col = flesh; s.alpha = 0.0;
  if (depth < ZEST) {
    let zc = exp(-F.zestAbs.xyz * 0.12);
    s.col = zc; s.alpha = 0.9; s.rough = 0.3;
    return s;
  }
  let pithCol = vec3f(0.97, 0.94, 0.86);
  let pithA = 1.0 - smoothstep(PITH - 0.012, PITH + 0.004, depth);
  let r = length(p.yz);
  let cr = coreRadius(p.x);
  let coreA = 1.0 - smoothstep(cr - 0.01, cr + 0.006, r);
  let sg = segInfo(p);
  let memW = 0.009 + 0.006 * (r / 1.2);
  let memA = (1.0 - smoothstep(memW * 0.55, memW * 1.35, sg.mem)) * smoothstep(PITH - 0.02, PITH + 0.03, depth);
  let ves = vesicle(p, r, cr, depth, sg);
  var a = 0.05 + 0.2 * ves.x;
  var c = mix(flesh, flesh * 0.6 + vec3f(0.4, 0.3, 0.2), ves.x * 0.6);
  c = mix(c, pithCol, memA); a = max(a, memA * 0.8);
  c = mix(c, pithCol, coreA); a = max(a, coreA * 0.75);
  c = mix(c, pithCol, pithA); a = max(a, pithA * 0.88);
  let pf = pipField(p, slot);
  if (pf.x < 1.0) { c = vec3f(0.95, 0.9, 0.74); a = 0.95; }
  s.col = c; s.alpha = a;
  s.rough = mix(0.08, 0.35, max(pithA, coreA));
  return s;
}

@fragment fn fsJelly(vin: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let P = vin.wpos;
  let camP = F.camPos.xyz;
  let V = normalize(camP - P);
  var N = normalize(vin.nrm);
  if (!ff) { N = -N; }
  let Finv = mat3x3f(vin.f0, vin.f1, vin.f2);
  let R = vin.rest;
  let slot = vin.slot;
  let L = F.lightDir.xyz;
  let keyI = F.lightDir.w;
  let depth0 = -orangeSdf(R);
  let isCut = depth0 > 0.012;

  // ---- outer skin details: oil-gland pores, stem button, navel
  var skinCol = vec3f(0.0);
  var skinA = 0.0;
  var rough = 0.07;
  if (!isCut) {
    let e = 0.004;
    let p0 = pores(R);
    let gx = pores(R + vec3f(e, 0.0, 0.0)) - p0;
    let gy = pores(R + vec3f(0.0, e, 0.0)) - p0;
    let gz = pores(R + vec3f(0.0, 0.0, e)) - p0;
    let gW = transpose(Finv) * (vec3f(gx, gy, gz) / e);
    N = normalize(N + (gW - N * dot(gW, N)) * 0.0025);
    rough = 0.07 + p0 * 0.12;
    // stem button (+x pole) and navel (-x pole)
    let rr = length(R.yz);
    let ang = atan2(R.z, R.y);
    let star = 0.085 + 0.025 * cos(ang * 5.0);
    if (R.x > 0.0) {
      let st = 1.0 - smoothstep(star - 0.012, star + 0.006, rr);
      let ring = (1.0 - smoothstep(0.0, 0.03, abs(rr - 0.14))) * 0.35;
      skinCol = mix(vec3f(0.55, 0.36, 0.12), F.stem.xyz, st);
      skinA = max(st * 0.97, ring * 0.6);
    } else {
      let nv = 1.0 - smoothstep(0.05, 0.075, rr);
      let crease = (1.0 - smoothstep(0.0, 0.012, abs(rr - 0.06))) ;
      skinCol = vec3f(0.6, 0.28, 0.06);
      skinA = max(nv * 0.55, crease * 0.6);
      N = normalize(N + (transpose(Finv) * vec3f(0.0, R.y, R.z)) * nv * 2.0);
    }
  }

  // ---- thickness from the back-face pass
  let pix = vec2i(vin.pos.xy);
  let fragDist = length(P - camP);
  let backDist = textureLoad(backTex, pix, 0).r;
  var thick = backDist - fragDist;
  if (thick <= 0.0 || thick > 6.0) { thick = 0.25; }

  // ---- refracted ray, carried into rest space by the inverse deformation gradient
  let ior = 1.36;
  var rdW = refract(-V, N, 1.0 / ior);
  if (dot(rdW, rdW) < 1e-4) { rdW = -V; }
  let rdR = Finv * rdW;
  let restLen = clamp(length(rdR) * thick, 0.0, 3.4);
  let dirR = rdR / max(length(rdR), 1e-5);

  // ---- light visibility at the surface
  let keyVis = pcfSmall(P + N * 0.03 + L * 0.02);

  // ---- volumetric march (Beer-Lambert, grey scattering)
  let NSTEP = 40;
  var T = vec3f(1.0);
  var Ls = vec3f(0.0);
  let jit = hash12(vin.pos.xy + F.camPos.w * 13.0);
  var tPrev = 0.0;
  for (var i = 0; i < NSTEP; i++) {
    let u = (f32(i) + 1.0) / f32(NSTEP);
    let tNext = restLen * (0.5 - 0.5 * cos(PI * u));
    let ds = tNext - tPrev;
    let p = R + dirR * (tPrev + ds * jit);
    tPrev = tNext;
    let m = material(p, slot);
    let st = m.a + vec3f(m.s);
    let dIn = clamp(-orangeSdf(p), 0.0, 1.2);
    // light reaching the sample is coloured only by what it was absorbed by on the way in
    let att = exp(-F.fleshAbs.xyz * dIn * 0.55 - F.zestAbs.xyz * min(dIn, ZEST) * 0.35 * select(1.0, 0.25, isCut));
    let Li = (vec3f(0.42) + keyI * 0.32 * keyVis * vec3f(1.0)) * att;
    let tr = exp(-st * ds);
    Ls += T * (m.s * Li) * (vec3f(1.0) - tr) / max(st, vec3f(1e-4));
    T *= tr;
    if (max(T.r, max(T.g, T.b)) < 0.004) { break; }
  }

  // ---- refraction of the studio behind, each tap dimmed by its own path length
  let exitW = P + rdW * thick;
  let ec = F.viewProj * vec4f(exitW, 1.0);
  let euv = vec2f(ec.x / ec.w * 0.5 + 0.5, 0.5 - ec.y / ec.w * 0.5);
  let sig = (F.fleshAbs.x + F.fleshAbs.y + F.fleshAbs.z) / 3.0 * 0.6;
  var refr = vec3f(0.0);
  let blur = 0.004 + thick * 0.004;
  for (var i = 0; i < 5; i++) {
    let o = select(spiral(i - 1, 4, 0.6) * blur, vec2f(0.0), i == 0);
    let uv = clamp(euv + o, vec2f(0.001), vec2f(0.999));
    let bd = textureLoad(backTex, vec2i(uv * F.res.xy), 0).r;
    var path = bd - fragDist;
    if (path <= 0.0 || path > 6.0) { path = thick * 0.6; }
    let dim = exp(-sig * (path - thick));
    refr += textureSampleLevel(sceneTex, linSamp, uv, 0.0).rgb * clamp(dim, 0.0, 2.0);
  }
  refr /= 5.0;
  var col = Ls + T * refr;

  // ---- what a fresh cut face shows
  let NdL = max(dot(N, L), 0.0);
  if (isCut) {
    let s = cutSurface(R + dirR * 0.004, slot);
    let lit = s.col * (vec3f(0.5) + keyI * 0.34 * NdL * keyVis);
    col = mix(col, lit, s.alpha);
    rough = s.rough;
  } else if (skinA > 0.0) {
    let lit = skinCol * (vec3f(0.45) + keyI * 0.32 * NdL * keyVis);
    col = mix(col, lit, skinA);
    rough = mix(rough, 0.45, skinA);
  }

  // ---- back-lit glow at thin edges
  let back = max(-dot(V, L), 0.0);
  let rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  col += F.glow.xyz * keyI * (0.05 + 0.7 * back) * exp(-thick * 2.2) * (0.35 + rim) * 0.35;

  // ---- Fresnel studio reflections, GGX highlight, sugar-crystal glints
  let NdV = max(dot(N, V), 0.0);
  let fres = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
  let Rv = reflect(-V, N);
  col += studioEnv(Rv) * fres * (1.0 - rough * 1.5) * 0.9;
  col += vec3f(1.0, 0.97, 0.92) * ggx(N, V, L, max(rough, 0.05)) * keyI * keyVis * 0.06 * (0.3 + fres);
  let gcell = floor(R * 95.0);
  let gh = hash33(gcell + slot * 7.0);
  if (gh.x < select(0.025, 0.12, isCut)) {
    let gn = normalize(N + (gh - 0.5) * 0.7);
    let Hh = normalize(V + L);
    let sp = pow(max(dot(gn, Hh), 0.0), 1400.0);
    col += vec3f(1.0, 0.98, 0.93) * sp * 9.0 * keyVis * keyI;
  }

  // ---- show mesh: lattice-cell tint
  return vec4f(col, 1.0);
}
`;

export const LINES_PASS = /* wgsl */ `
@vertex fn vsLines(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = nodes[vi].xyz;
  var c = F.viewProj * vec4f(p, 1.0);
  c.z = c.z * 0.5;
  return c;
}
@fragment fn fsLines() -> @location(0) vec4f { return vec4f(0.55, 0.85, 1.0, 0.45); }
`;

export const KNIFE_PASS = /* wgsl */ `
@group(1) @binding(0) var<uniform> knife: mat4x4f;
struct KIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) mat: f32 };
struct KOut { @builtin(position) pos: vec4f, @location(0) wpos: vec3f, @location(1) nrm: vec3f, @location(2) mat: f32, @location(3) lpos: vec3f };
@vertex fn vsKnife(vin: KIn) -> KOut {
  var o: KOut;
  let w = knife * vec4f(vin.pos, 1.0);
  o.pos = F.viewProj * w;
  o.wpos = w.xyz;
  o.nrm = normalize((knife * vec4f(vin.nrm, 0.0)).xyz);
  o.mat = vin.mat;
  o.lpos = vin.pos;
  return o;
}
@fragment fn fsKnife(vin: KOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var N = normalize(vin.nrm);
  if (!ff) { N = -N; }
  let V = normalize(F.camPos.xyz - vin.wpos);
  let L = F.lightDir.xyz;
  let R = reflect(-V, N);
  let NdV = max(dot(N, V), 0.0);
  var col = vec3f(0.0);
  if (vin.mat < 0.5) {
    // brushed steel with a polished edge bevel
    let bevel = 1.0 - smoothstep(0.18, 0.24, vin.lpos.y);
    let brush = 0.92 + 0.08 * hash11(floor(vin.lpos.y * 300.0));
    let base = mix(vec3f(0.62, 0.64, 0.66), vec3f(0.85, 0.86, 0.87), bevel) * brush;
    let fres = base + (1.0 - base) * pow(1.0 - NdV, 5.0);
    col = studioEnv(R) * fres;
    let H = normalize(V + L);
    col += vec3f(1.0) * pow(max(dot(N, H), 0.0), mix(80.0, 400.0, bevel)) * F.lightDir.w * 0.6;
    // a hint of the etched maker's mark
    let mark = (1.0 - smoothstep(0.0, 0.01, abs(length(vin.lpos.xy - vec2f(1.35, 0.8)) - 0.09))) * step(0.0, vin.lpos.z);
    col *= 1.0 - mark * 0.35;
  } else if (vin.mat < 1.5) {
    let grain = 0.86 + 0.14 * sin((vin.lpos.y - 0.98) * 140.0 + vin.lpos.z * 90.0 + sin(vin.lpos.x * 3.0) * 2.5);
    let wood = vec3f(0.42, 0.26, 0.15) * grain;
    col = wood * (vec3f(0.35) + F.lightDir.w * 0.3 * max(dot(N, L), 0.0)) + studioEnv(R) * 0.04;
  } else {
    let horn = vec3f(0.08, 0.07, 0.07);
    col = horn * (vec3f(0.4) + F.lightDir.w * 0.3 * max(dot(N, L), 0.0)) + studioEnv(R) * (0.04 + 0.4 * pow(1.0 - NdV, 4.0));
  }
  return vec4f(col, 1.0);
}
`;
