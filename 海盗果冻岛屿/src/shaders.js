// WGSL for every pass.
import { HALF, WATER, STRATA } from './world.js';
import { MAT } from './builder.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const COMMON = /* wgsl */ `
const PI = 3.14159265;
const HALF = ${f(HALF)};
const WATER = ${f(WATER)};

struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  lightVP: mat4x4f,
  block: mat4x4f,
  blockInv: mat4x4f,
  camPos: vec4f,      // xyz, time
  sunDir: vec4f,      // xyz toward the sun/moon, intensity
  sunCol: vec4f,      // rgb, night amount
  ambSky: vec4f,
  ambGround: vec4f,
  fire: vec4f,        // xyz (block-local), intensity
  fireCol: vec4f,     // rgb, flicker
  backTop: vec4f,
  backBot: vec4f,     // rgb, stars
  res: vec4f,
  jelly: vec4f,       // absorption rgb, scatter
  jellyCol: vec4f,    // scatter tint rgb, foam
  wind: vec4f,        // dir xz, strength, gust
  misc: vec4f,        // shadow size, motion scale, lantern glow, skull glow
  palms: array<vec4f, 9>,
};
@group(0) @binding(0) var<uniform> F: Frame;

fn hash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn hash33(p0: vec3f) -> vec3f { var p = fract(p0 * vec3f(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
fn noise2(p: vec2f) -> f32 {
  let i = floor(p); let fr = fract(p); let u = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm2(p0: vec2f) -> f32 { var p = p0; var s = 0.0; var a = 0.5; for (var i = 0; i < 4; i++) { s += a * noise2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s / 0.9375; }

// animated water caustics (sharp bright web)
fn caustic(p: vec2f, t: f32) -> f32 {
  var q = p * 3.2;
  var c = 0.0;
  for (var i = 0; i < 3; i++) {
    let fi = f32(i);
    let w = vec2f(sin(q.y * 1.3 + t * (0.9 + fi * 0.2) + fi), cos(q.x * 1.1 - t * (0.7 + fi * 0.15) + fi * 2.0));
    q = q + w * 0.55;
    c += 1.0 / (1.0 + 30.0 * abs(sin(q.x) * sin(q.y)));
  }
  return pow(c / 3.0, 1.6) * 1.8;
}

fn blockToWorld(p: vec3f) -> vec3f { return (F.block * vec4f(p, 1.0)).xyz; }
fn blockDirToWorld(d: vec3f) -> vec3f { return normalize((F.block * vec4f(d, 0.0)).xyz); }

fn skyEnv(d: vec3f) -> vec3f {
  let up = smoothstep(-0.1, 0.8, d.y);
  var c = mix(F.backBot.rgb, F.backTop.rgb, up);
  // a soft key in the light's direction
  let s = max(dot(d, F.sunDir.xyz), 0.0);
  c += F.sunCol.rgb * (pow(s, 40.0) * 2.0 + pow(s, 6.0) * 0.25);
  return c;
}
`;

export const SHADOW_FNS = /* wgsl */ `
@group(1) @binding(0) var shadowTex: texture_depth_2d;
@group(1) @binding(1) var shadowCmp: sampler_comparison;
@group(1) @binding(2) var etaTex: texture_2d<f32>;
@group(1) @binding(3) var groundTex: texture_2d<f32>;

fn shadowAt(P: vec3f, soft: f32) -> f32 {
  let lp = F.lightVP * vec4f(P, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0) { return 1.0; }
  var v = 0.0;
  let r = soft / F.misc.x;
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 2.39996;
    let o = vec2f(cos(a), sin(a)) * sqrt((f32(i) + 0.5) / 8.0) * r;
    v += textureSampleCompareLevel(shadowTex, shadowCmp, uv + o, lp.z - 0.0015);
  }
  return v / 8.0;
}

// block-local sampling of the wave height (bilinear) and the static ground height
fn texBilinear(t: texture_2d<f32>, p: vec2f) -> f32 {
  let dim = vec2f(textureDimensions(t));
  let uv = clamp((p + HALF) / (2.0 * HALF) * dim - 0.5, vec2f(0.0), dim - 1.001);
  let i = vec2i(floor(uv)); let fr = fract(uv);
  let a = textureLoad(t, i, 0).r; let b = textureLoad(t, i + vec2i(1, 0), 0).r;
  let c = textureLoad(t, i + vec2i(0, 1), 0).r; let d = textureLoad(t, i + vec2i(1, 1), 0).r;
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}
fn etaAt(p: vec2f) -> f32 { return texBilinear(etaTex, p); }
fn groundAt(p: vec2f) -> f32 { return texBilinear(groundTex, p); }
`;

// ---------------------------------------------------------------- main mesh --
export const MESH_PASS = /* wgsl */ `
@group(0) @binding(1) var<storage, read> objs: array<mat4x4f>;

struct VIn {
  @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) col: vec3f,
  @location(3) mat: f32, @location(4) ex: vec2f, @location(5) obj: f32,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) bpos: vec3f,
  @location(2) nrm: vec3f,
  @location(3) col: vec3f,
  @location(4) @interpolate(flat) mat: f32,
  @location(5) ex: vec2f,
};

fn animate(p0: vec3f, mat: f32, ex: vec2f) -> vec3f {
  var p = p0;
  let t = F.camPos.w;
  let m = F.misc.y;
  let wind = F.wind;
  if (mat == ${MAT.TRUNK}.0 || mat == ${MAT.FROND}.0) {
    let k = i32(ex.y + 0.5) - 1;
    if (k >= 0) {
      let pb = F.palms[k];
      let w = select(ex.x * ex.x, 1.0, mat == ${MAT.FROND}.0);
      p.x += pb.x * w; p.z += pb.y * w; p.y -= (pb.x * pb.x + pb.y * pb.y) * 0.4 * w;
    }
    if (mat == ${MAT.FROND}.0) {
      let ph = p0.x * 9.0 + p0.z * 7.0 + ex.y * 1.7;
      let fl = (sin(t * 5.5 + ph) * 0.6 + sin(t * 9.1 + ph * 1.7) * 0.4) * ex.x * ex.x * (0.012 + 0.03 * wind.z) * m;
      p.y += fl; p.x += wind.x * fl * 0.6; p.z += wind.y * fl * 0.6;
    }
  } else if (mat == ${MAT.KELP}.0) {
    let ph = ex.y * 1.3;
    p.x += sin(t * 0.9 + ph + p0.y * 3.0) * 0.05 * ex.x * m;
    p.z += cos(t * 0.7 + ph * 1.4 + p0.y * 2.0) * 0.04 * ex.x * m;
  } else if (mat == ${MAT.SAIL}.0) {
    p.x -= (sin(t * 3.1 + p0.y * 6.0 + p0.z * 4.0) * 0.006 + 0.004) * ex.x * (0.5 + wind.z) * m;
  } else if (mat == ${MAT.FLAG}.0) {
    let u = ex.x;
    p.z += sin(u * 9.0 - t * 7.0) * 0.022 * u * m;
    p.y -= u * u * 0.015 * (1.0 - wind.z * 0.5);
    p.x += sin(u * 9.0 - t * 7.0 + 1.0) * 0.006 * u * m;
  }
  return p;
}

@vertex fn vsMesh(vin: VIn) -> VOut {
  var o: VOut;
  let M = objs[u32(vin.obj + 0.5)];
  let lp = animate(vin.pos, vin.mat, vin.ex);
  let bp = (M * vec4f(lp, 1.0)).xyz;
  let wp = blockToWorld(bp);
  o.pos = F.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  o.bpos = bp;
  o.nrm = (F.block * (M * vec4f(vin.nrm, 0.0))).xyz;
  o.col = vin.col;
  o.mat = vin.mat;
  o.ex = vin.ex;
  return o;
}

@vertex fn vsMeshShadow(vin: VIn) -> @builtin(position) vec4f {
  let M = objs[u32(vin.obj + 0.5)];
  let lp = animate(vin.pos, vin.mat, vin.ex);
  return F.lightVP * vec4f(blockToWorld((M * vec4f(lp, 1.0)).xyz), 1.0);
}

struct MOut { @location(0) col: vec4f, @location(1) dist: vec4f };

fn terrainColor(bp: vec3f, n: vec3f) -> vec3f {
  let h = bp.y - WATER;
  let nz = fbm2(bp.xz * 6.0);
  let dry = mix(vec3f(0.80, 0.64, 0.38), vec3f(0.87, 0.74, 0.47), nz);
  let wet = vec3f(0.55, 0.43, 0.26);
  let under = mix(vec3f(0.78, 0.66, 0.44), vec3f(0.86, 0.76, 0.55), nz) * (0.92 + 0.08 * sin(bp.x * 40.0 + sin(bp.z * 12.0) * 3.0));
  var c = dry;
  c = mix(c, wet, 1.0 - smoothstep(0.0, 0.035, h));
  c = mix(c, under, 1.0 - smoothstep(-0.03, -0.0, h));
  // mossy jungle hump
  let moss = smoothstep(0.12, 0.22, h + (nz - 0.5) * 0.08) * smoothstep(0.55, 0.85, n.y);
  let mossC = mix(vec3f(0.16, 0.36, 0.08), vec3f(0.30, 0.52, 0.12), noise2(bp.xz * 14.0));
  c = mix(c, mossC, moss);
  return c;
}

fn strataColor(bp: vec3f) -> vec3f {
  let a = bp.x + bp.z;
  let w = 0.02 * sin(a * 3.1) + 0.012 * sin(a * 7.7 + 1.0) + (noise2(vec2f(a * 4.0, bp.y * 9.0)) - 0.5) * 0.02;
  let y = bp.y + w;
  var c = vec3f(0.17, 0.08, 0.04); // chocolate bedrock
  if (y > ${f(STRATA.choc)}) { c = mix(vec3f(0.52, 0.26, 0.08), vec3f(0.62, 0.33, 0.1), noise2(vec2f(a * 9.0, y * 30.0))); } // caramel clay
  if (y > ${f(STRATA.caramel)}) {
    // shell band: pale with pink/white flecks
    let fl = step(0.82, hash12(floor(vec2f(a, y) * 90.0)));
    c = mix(vec3f(0.86, 0.80, 0.70), vec3f(0.95, 0.72, 0.68), fl);
  }
  if (y > ${f(STRATA.shell)}) { c = mix(vec3f(0.93, 0.85, 0.62), vec3f(0.97, 0.9, 0.7), noise2(vec2f(a * 13.0, y * 40.0))); } // vanilla sand
  // chocolate chips in the bedrock
  if (y < ${f(STRATA.choc)}) { c *= 0.85 + 0.3 * step(0.86, hash12(floor(vec2f(a, y) * 40.0))); }
  return c;
}

fn skullColor(bp: vec3f, n: vec3f, ly: f32) -> vec3f {
  let nz = noise2(vec2f(ly * 12.0, bp.x * 10.0 + bp.z * 10.0));
  var c = mix(vec3f(0.55, 0.50, 0.44), vec3f(0.70, 0.65, 0.57), nz);
  c *= 0.9 + 0.12 * sin(ly * 46.0 + nz * 3.0); // rock strata
  let moss = smoothstep(0.7, 0.92, n.y) * smoothstep(0.98, 1.06, ly + (nz - 0.5) * 0.25);
  c = mix(c, mix(vec3f(0.18, 0.38, 0.09), vec3f(0.32, 0.5, 0.14), nz), moss);
  // wet band at the waterline
  let wet = 1.0 - smoothstep(0.0, 0.06, abs(bp.y - WATER - 0.01));
  c *= 1.0 - 0.45 * wet;
  return c;
}

fn fireLight(bp: vec3f, n: vec3f, wrap: f32) -> vec3f {
  let d = F.fire.xyz - bp;
  let l = length(d);
  let L = d / max(l, 1e-4);
  let ndl = max((dot(n, L) + wrap) / (1.0 + wrap), 0.0);
  return F.fireCol.rgb * F.fire.w * ndl / (1.0 + l * l * 18.0);
}

@fragment fn fsMesh(vin: VOut, @builtin(front_facing) ff: bool) -> MOut {
  let mat = vin.mat;
  let bp = vin.bpos;
  let P = vin.wpos;
  let V = normalize(F.camPos.xyz - P);
  var N = normalize(vin.nrm);
  let thin = mat == ${MAT.FROND}.0 || mat == ${MAT.SAIL}.0 || mat == ${MAT.FLAG}.0 || mat == ${MAT.KELP}.0;
  if (thin && dot(N, V) < 0.0) { N = -N; }
  let Nb = normalize((F.blockInv * vec4f(N, 0.0)).xyz);
  var base = vin.col;
  var rough = 0.8;
  var metal = 0.0;
  var emit = vec3f(0.0);
  var wrap = 0.0;
  var trans = 0.0;
  let night = F.sunCol.w;
  let t = F.camPos.w;

  if (mat == ${MAT.TERRAIN}.0) { base = terrainColor(bp, Nb); rough = 0.9; }
  else if (mat == ${MAT.WALL}.0) { base = strataColor(bp); rough = 0.7; }
  else if (mat == ${MAT.SKULL}.0) {
    base = skullColor(bp, Nb, vin.ex.y) * vin.col.r * (1.0 - 0.55 * vin.ex.x * (1.0 - F.misc.w));
    rough = 0.85;
    // candle-lit cave in the sockets at night
    let flick = 0.8 + 0.2 * sin(t * 13.0 + sin(t * 7.0) * 2.0);
    emit = vec3f(1.0, 0.55, 0.15) * vin.ex.x * F.misc.w * flick * 2.5;
  }
  else if (mat == ${MAT.FROND}.0) { wrap = 0.6; trans = 0.7; rough = 0.55; }
  else if (mat == ${MAT.TRUNK}.0) { rough = 0.6; wrap = 0.2; }
  else if (mat == ${MAT.SAIL}.0) { wrap = 0.5; trans = 0.55; rough = 0.9; }
  else if (mat == ${MAT.FLAG}.0) {
    // Jolly Roger, drawn procedurally
    let uv = vec2f(vin.ex.x, vin.ex.y);
    let q = (uv - vec2f(0.45, 0.45)) * vec2f(1.62, 1.0);
    var w = 0.0;
    w = max(w, 1.0 - smoothstep(0.18, 0.2, length((q - vec2f(0.0, -0.06)) * vec2f(1.0, 1.1))));
    w = max(w, (1.0 - smoothstep(0.1, 0.12, abs(q.y - 0.12))) * (1.0 - smoothstep(0.11, 0.13, abs(q.x))));
    let e1 = 1.0 - smoothstep(0.045, 0.06, length(q - vec2f(-0.075, -0.07)));
    let e2 = 1.0 - smoothstep(0.045, 0.06, length(q - vec2f(0.075, -0.07)));
    let nose = 1.0 - smoothstep(0.02, 0.03, length((q - vec2f(0.0, 0.03)) * vec2f(1.4, 1.0)));
    w *= 1.0 - max(max(e1, e2), nose);
    // crossed bones
    let b1 = abs(q.y - 0.3 - (q.x) * 0.55); let b2 = abs(q.y - 0.3 + (q.x) * 0.55);
    let bones = (1.0 - smoothstep(0.022, 0.032, min(b1, b2))) * (1.0 - smoothstep(0.34, 0.36, abs(q.x)));
    let knobs = 1.0 - smoothstep(0.035, 0.045, min(min(length(q - vec2f(-0.33, 0.12)), length(q - vec2f(0.33, 0.12))), min(length(q - vec2f(-0.33, 0.48)), length(q - vec2f(0.33, 0.48)))));
    w = max(w, max(bones, knobs));
    base = mix(vec3f(0.02, 0.02, 0.025), vec3f(0.92, 0.9, 0.84), w);
    wrap = 0.4; trans = 0.2;
  }
  else if (mat == ${MAT.GOLD}.0) { metal = 1.0; rough = 0.28; }
  else if (mat == ${MAT.METAL}.0) { metal = 0.6; rough = 0.45; }
  else if (mat == ${MAT.GEM}.0) { metal = 0.3; rough = 0.08; emit = base * 0.15; }
  else if (mat == ${MAT.GLASS}.0) { rough = 0.08; metal = 0.1; }
  else if (mat == ${MAT.WINDOW}.0) { emit = vec3f(1.0, 0.7, 0.32) * (0.25 + F.misc.z * 3.5); }
  else if (mat == ${MAT.LANTERN}.0) { emit = vec3f(1.0, 0.75, 0.35) * (0.3 + F.misc.z * 6.0) * (0.9 + 0.1 * sin(t * 11.0)); }
  else if (mat == ${MAT.EMBER}.0) { emit = vec3f(1.0, 0.35, 0.06) * vin.ex.x * vin.ex.x * F.fire.w * (0.35 + 0.65 * F.fireCol.w) * 0.9; }
  else if (mat == ${MAT.KELP}.0) { wrap = 0.5; trans = 0.4; }
  else if (mat == ${MAT.BUBBLE}.0) { emit = vec3f(0.5, 0.65, 0.7) * 0.4; rough = 0.05; }
  else if (mat == ${MAT.GUMMY}.0) { wrap = 0.6; trans = 0.5; rough = 0.25; }
  else if (mat == ${MAT.TEETH}.0) { rough = 0.4; }

  // ---- lighting
  let L = F.sunDir.xyz;
  let sh = shadowAt(P + N * 0.01, 1.5);
  let ndl = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
  let back = max(dot(-N, L), 0.0) * trans;
  let sun = F.sunCol.rgb * F.sunDir.w * sh;
  let amb = mix(F.ambGround.rgb, F.ambSky.rgb, N.y * 0.5 + 0.5);
  var diff = sun * (ndl + back * 0.6) + amb + fireLight(bp, Nb, wrap);
  // underwater: caustics, a little cooler
  let surf = WATER + etaAt(bp.xz);
  let depth = surf - bp.y;
  if (depth > 0.0) {
    let cst = caustic(bp.xz + Nb.xz * 0.02 - L.xz * depth * 0.6, t * 0.8);
    diff += F.sunCol.rgb * F.sunDir.w * sh * cst * 0.55 * max(Nb.y, 0.2) * exp(-depth * 1.2);
    diff *= vec3f(0.85, 0.95, 1.0);
  }
  var col = base * (1.0 - metal) * diff;
  // specular
  let H = normalize(L + V);
  let spec = pow(max(dot(N, H), 0.0), mix(8.0, 300.0, 1.0 - rough)) * (1.0 - rough);
  let f0 = mix(vec3f(0.04), base, metal);
  col += f0 * spec * sun * 2.0;
  let R = reflect(-V, N);
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += skyEnv(R) * fres * (1.0 - rough) * 0.6;
  if (metal > 0.5) { col += base * amb * 0.6 + base * fireLight(bp, Nb, 0.0) * 1.5; }
  col += emit;
  var o: MOut;
  o.col = vec4f(col, 1.0);
  o.dist = vec4f(length(P - F.camPos.xyz), 0.0, 0.0, 1.0);
  return o;
}
`;

// ---------------------------------------------------------------- studio --
export const STUDIO_PASS = /* wgsl */ `
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.999999, 1.0);
}
struct SOut { @location(0) col: vec4f, @location(1) dist: vec4f };

fn stars(d: vec3f) -> f32 {
  let p = d.xy / max(d.z + 1.6, 0.2) * 260.0 + d.yz * 90.0;
  let c = floor(p);
  let h = hash12(c);
  let o = fract(p) - 0.5 - (vec2f(hash12(c + 3.1), hash12(c + 7.7)) - 0.5) * 0.6;
  let tw = 0.6 + 0.4 * sin(F.camPos.w * (1.0 + h * 3.0) + h * 30.0);
  return step(0.982, h) * (1.0 - smoothstep(0.0, 0.14, length(o))) * tw;
}

// box intersection in block-local space (for the jelly's tinted shadow)
fn boxHit(ro: vec3f, rd: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv; let t1 = (bmax - ro) * inv;
  let tmin = min(t0, t1); let tmax = max(t0, t1);
  return vec2f(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

@fragment fn fsStudio(@builtin(position) fc: vec4f) -> SOut {
  let uv = fc.xy * F.res.zw;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let a = F.invViewProj * vec4f(ndc, 0.0, 1.0);
  let b = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  let ro = a.xyz / a.w;
  let rd = normalize(b.xyz / b.w - ro);
  // seamless paper sweep
  var col = mix(F.backBot.rgb, F.backTop.rgb, smoothstep(-0.05, 0.55, rd.y));
  col += F.backTop.rgb * stars(rd) * F.backBot.w * 3.0;
  var dist = 1e4;
  if (rd.y < -1e-4) {
    let t = -ro.y / rd.y;
    let P = ro + rd * t;
    let L = F.sunDir.xyz;
    let sh = shadowAt(P, 3.0);
    // light through the jelly block arrives tinted, with caustics
    let bl = (F.blockInv * vec4f(P, 1.0)).xyz;
    let ld = normalize((F.blockInv * vec4f(L, 0.0)).xyz);
    let hit = boxHit(bl, ld, vec3f(-HALF, 0.0, -HALF), vec3f(HALF, WATER, HALF));
    var tint = vec3f(1.0);
    if (hit.y > max(hit.x, 0.0)) {
      let path = hit.y - max(hit.x, 0.0);
      let ex = bl + ld * hit.y;
      tint = exp(-F.jelly.rgb * path * 0.55) * (0.55 + 0.75 * caustic(ex.xz, F.camPos.w * 0.8));
    }
    let paper = vec3f(0.80, 0.77, 0.72) * (0.97 + 0.03 * noise2(P.xz * 30.0));
    // contact darkening along the block base
    let edge = max(abs(bl.x), abs(bl.z)) - HALF;
    let ao = mix(0.55, 1.0, smoothstep(0.0, 0.5, edge));
    let fireD = length(P - blockToWorld(F.fire.xyz));
    let fl = F.fireCol.rgb * F.fire.w * 0.15 / (1.0 + fireD * fireD * 2.0);
    var fc2 = paper * (F.sunCol.rgb * F.sunDir.w * max(L.y, 0.0) * sh * tint * 0.55 + (F.ambSky.rgb * 0.9 + fl) * ao);
    fc2 = mix(fc2, col, smoothstep(9.0, 22.0, length(P.xz)));
    col = fc2;
    dist = length(P - F.camPos.xyz);
  }
  var o: SOut;
  o.col = vec4f(col, 1.0);
  o.dist = vec4f(dist, 0.0, 0.0, 1.0);
  return o;
}
`;

// ---------------------------------------------------------------- jelly --
export const JELLY_PASS = /* wgsl */ `
@group(2) @binding(0) var sceneTex: texture_2d<f32>;
@group(2) @binding(1) var distTex: texture_2d<f32>;
@group(2) @binding(2) var linSamp: sampler;

struct JOut {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) bpos: vec3f,
  @location(2) nrm: vec3f,
  @location(3) @interpolate(flat) kind: f32, // 0 top, 1 wall
};

const GRID = 128u;

@vertex fn vsJelly(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> JOut {
  var o: JOut;
  var bp: vec3f;
  var n: vec3f;
  if (ii == 0u) {
    // top surface: (GRID+1)^2 vertices addressed through the index buffer
    let i = vi % (GRID + 1u); let j = vi / (GRID + 1u);
    let xz = (vec2f(f32(i), f32(j)) / f32(GRID)) * 2.0 * HALF - HALF;
    let e = 2.0 * HALF / f32(GRID);
    let h = etaAt(xz);
    let hx = (etaAt(xz + vec2f(e, 0.0)) - etaAt(xz - vec2f(e, 0.0))) / (2.0 * e);
    let hz = (etaAt(xz + vec2f(0.0, e)) - etaAt(xz - vec2f(0.0, e))) / (2.0 * e);
    bp = vec3f(xz.x, WATER + h, xz.y);
    n = normalize(vec3f(-hx, 1.0, -hz));
    o.kind = 0.0;
  } else {
    // walls: 4 sides x (GRID+1) columns x 2 rows
    let side = (ii - 1u);
    let col = vi / 2u; let row = vi % 2u;
    let a = (f32(col) / f32(GRID)) * 2.0 * HALF - HALF;
    var nn = vec3f(0.0, 0.0, 1.0); var tt = vec3f(1.0, 0.0, 0.0);
    if (side == 1u) { nn = vec3f(1.0, 0.0, 0.0); tt = vec3f(0.0, 0.0, -1.0); }
    if (side == 2u) { nn = vec3f(0.0, 0.0, -1.0); tt = vec3f(-1.0, 0.0, 0.0); }
    if (side == 3u) { nn = vec3f(-1.0, 0.0, 0.0); tt = vec3f(0.0, 0.0, 1.0); }
    let xz = nn.xz * HALF + tt.xz * a;
    let inner = xz - nn.xz * 0.01;
    let top = WATER + etaAt(inner);
    let bot = groundAt(inner);
    bp = vec3f(xz.x, select(min(bot, top), top, row == 0u), xz.y);
    n = nn;
    o.kind = 1.0;
  }
  let wp = blockToWorld(bp);
  o.pos = F.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  o.bpos = bp;
  o.nrm = (F.block * vec4f(n, 0.0)).xyz;
  return o;
}

fn foamLace(p: vec2f, t: f32) -> f32 {
  let n = noise2(p * 26.0 + vec2f(t * 0.3, -t * 0.2)) * 0.6 + noise2(p * 61.0 - t * 0.4) * 0.4;
  return smoothstep(0.45, 0.62, n);
}

@fragment fn fsJelly(vin: JOut) -> @location(0) vec4f {
  let P = vin.wpos;
  let bp = vin.bpos;
  let camP = F.camPos.xyz;
  let V = normalize(camP - P);
  var N = normalize(vin.nrm);
  let t = F.camPos.w;
  let isTop = vin.kind < 0.5;
  // fine ripples on top
  if (isTop) {
    let r = vec2f(noise2(bp.xz * 18.0 + t * 0.6) - 0.5, noise2(bp.xz * 18.0 - t * 0.5 + 9.0) - 0.5);
    N = normalize(N + blockDirToWorld(vec3f(r.x, 0.0, r.y)) * 0.12);
  }
  let pix = vec2i(vin.pos.xy);
  let fragDist = length(P - camP);
  let sceneD = textureLoad(distTex, pix, 0).r;
  var path = clamp(sceneD - fragDist, 0.0, 6.0);
  // refraction offset (screen space), bigger through thicker jelly
  let rd = refract(-V, N, 1.0 / 1.34);
  let offW = (rd + V) * min(path, 1.2) * 0.9;
  let oc = F.viewProj * vec4f(P + offW, 1.0);
  var ruv = vec2f(oc.x / oc.w * 0.5 + 0.5, 0.5 - oc.y / oc.w * 0.5);
  ruv = clamp(ruv, vec2f(0.001), vec2f(0.999));
  // don't pull in things in front of the surface
  let d2 = textureLoad(distTex, vec2i(ruv * F.res.xy), 0).r;
  if (d2 < fragDist) { ruv = vin.pos.xy * F.res.zw; }
  else { path = clamp(d2 - fragDist, 0.0, 6.0); }
  let behind = textureSampleLevel(sceneTex, linSamp, ruv, 0.0).rgb;

  // Beer-Lambert through the jelly, plus soft in-scatter of the jelly's own colour
  let T = exp(-F.jelly.rgb * path);
  let L = F.sunDir.xyz;
  let amb = mix(F.ambGround.rgb, F.ambSky.rgb, 0.7);
  let lightIn = F.sunCol.rgb * F.sunDir.w * 0.45 + amb;
  var col = behind * T + F.jellyCol.rgb * lightIn * (1.0 - exp(-F.jelly.w * path)) * 0.5;

  // light shafts: march down the refracted ray and gather the caustic web
  if (isTop) {
    let rb = normalize((F.blockInv * vec4f(rd, 0.0)).xyz);
    let lb = normalize((F.blockInv * vec4f(L, 0.0)).xyz);
    var sh = 0.0;
    let steps = 7;
    let len = min(path, 1.0);
    for (var i = 0; i < steps; i++) {
      let s = (f32(i) + hash12(vin.pos.xy + f32(i))) / f32(steps) * len;
      let q = bp + rb * s;
      let up = (WATER - q.y) / max(lb.y, 0.2);
      sh += caustic(q.xz + lb.xz * up, t * 0.8) * exp(-s * 2.0);
    }
    col += F.jellyCol.rgb * F.sunCol.rgb * F.sunDir.w * sh / f32(steps) * len * 0.35;
  }

  // reflections: studio, sun / moon glint, campfire
  let R = reflect(-V, N);
  let NdV = max(dot(N, V), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  col += skyEnv(R) * fres * 0.9;
  let H = normalize(L + V);
  col += F.sunCol.rgb * F.sunDir.w * pow(max(dot(N, H), 0.0), 600.0) * 3.0;
  let fireW = blockToWorld(F.fire.xyz);
  let Lf = normalize(fireW - P);
  let Hf = normalize(Lf + V);
  col += F.fireCol.rgb * F.fire.w * pow(max(dot(N, Hf), 0.0), 220.0) * 1.2 / (1.0 + dot(fireW - P, fireW - P) * 0.6);

  if (isTop) {
    // foam lace along the shoreline
    let dep = WATER + etaAt(bp.xz) - groundAt(bp.xz);
    let fm = foamLace(bp.xz, t) * (1.0 - smoothstep(0.0, 0.07, dep)) + (1.0 - smoothstep(0.0, 0.012, dep)) * 0.6;
    col = mix(col, vec3f(0.95, 0.97, 0.98) * (amb + F.sunCol.rgb * F.sunDir.w * 0.6) * F.jellyCol.w, clamp(fm, 0.0, 1.0) * 0.85);
    // bright meniscus on the cut edges
    let edge = HALF - max(abs(bp.x), abs(bp.z));
    col += (vec3f(1.0) * 0.35 + skyEnv(R) * 0.4) * (1.0 - smoothstep(0.0, 0.03, edge));
  } else {
    let top = WATER + etaAt(bp.xz * 0.996);
    col += (vec3f(1.0) * 0.4 + skyEnv(R) * 0.3) * (1.0 - smoothstep(0.0, 0.025, top - bp.y));
  }
  return vec4f(col, 1.0);
}
`;

export const BLIT_PASS = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fsBlit(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureLoad(src, vec2i(fc.xy), 0); }
`;

// ---------------------------------------------------------------- particles --
export const PARTICLE_PASS = /* wgsl */ `
@group(1) @binding(0) var distTex2: texture_2d<f32>;
struct PIn { @location(0) pos: vec4f, @location(1) col: vec4f, @location(2) misc: vec4f };
struct POut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) misc: vec4f,
  @location(3) wpos: vec3f,
};
@vertex fn vsPart(@builtin(vertex_index) vi: u32, pin: PIn) -> POut {
  var o: POut;
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let wp = blockToWorld(pin.pos.xyz);
  let fwd = normalize(F.camPos.xyz - wp);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let a = pin.misc.x;
  let rc = vec2f(corner.x * cos(a) - corner.y * sin(a), corner.x * sin(a) + corner.y * cos(a));
  var stretch = vec3f(0.0);
  let p = wp + (right * rc.x + up * rc.y) * pin.pos.w;
  o.pos = F.viewProj * vec4f(p, 1.0);
  o.col = pin.col;
  o.uv = corner;
  o.misc = pin.misc;
  o.wpos = p;
  return o;
}
@fragment fn fsPart(pin: POut) -> @location(0) vec4f {
  let r = length(pin.uv);
  if (r > 1.0) { discard; }
  let kind = pin.misc.y;
  var a = pin.col.a;
  var shape = 1.0 - smoothstep(0.0, 1.0, r);
  if (kind > 1.5) { shape = pow(shape, 0.7) * (0.75 + 0.25 * hash12(floor((pin.uv + pin.misc.z) * 4.0))); } // smoke: lumpy
  if (kind > 2.5 && kind < 3.5) { // glint: a star
    let s = max(1.0 - abs(pin.uv.x) * 8.0, 0.0) * (1.0 - abs(pin.uv.y)) + max(1.0 - abs(pin.uv.y) * 8.0, 0.0) * (1.0 - abs(pin.uv.x));
    shape = clamp(s + (1.0 - smoothstep(0.0, 0.35, r)), 0.0, 1.0);
  }
  // soft particles against the opaque scene
  let sd = textureLoad(distTex2, vec2i(pin.pos.xy), 0).r;
  let fd = length(pin.wpos - F.camPos.xyz);
  let soft = clamp((sd - fd) / 0.08, 0.0, 1.0);
  var rgb = pin.col.rgb;
  if (kind > 1.5 && kind < 2.5) {
    // smoke is lit by the sun/ambient and from below by the fire
    let amb = mix(F.ambGround.rgb, F.ambSky.rgb, 0.6);
    let fd2 = length((F.blockInv * vec4f(pin.wpos, 1.0)).xyz - F.fire.xyz);
    rgb = rgb * (amb + F.sunCol.rgb * F.sunDir.w * 0.4) + F.fireCol.rgb * F.fire.w * 0.25 / (1.0 + fd2 * fd2 * 10.0);
  }
  let alpha = a * shape * soft;
  // premultiplied: additive particles carry alpha 0
  let additive = kind < 1.5 || (kind > 2.5 && kind < 4.5);
  return vec4f(rgb * alpha, select(alpha, 0.0, additive));
}
`;

export const POST_PASS = /* wgsl */ `
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var<uniform> post: vec4f; // exposure, srgb, time
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
fn pbrNeutral(c0: vec3f) -> vec3f {
  let sc = 0.76; let des = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let off = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c0 - off;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < sc) { return c; }
  let d = 1.0 - sc;
  let np = 1.0 - d * d / (peak + d - sc);
  c *= np / peak;
  let g = 1.0 - 1.0 / (des * (peak - np) + 1.0);
  return mix(c, vec3f(np), g);
}
fn h12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
@fragment fn fsPost(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dim = vec2f(textureDimensions(hdr));
  var c = textureLoad(hdr, vec2i(fc.xy), 0).rgb * post.x;
  let uv = fc.xy / dim;
  c *= 1.0 - 0.18 * smoothstep(0.45, 1.1, length((uv - 0.5) * vec2f(1.2, 1.0)));
  c = clamp(pbrNeutral(max(c, vec3f(0.0))), vec3f(0.0), vec3f(1.0));
  if (post.y > 0.5) { c = select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
  c += (h12(fc.xy + post.z) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
`;
