import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const c = (a, b, c2) => hash(xi + a, yi + b, zi + c2);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w
  );
}

export function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// Smooth, lumpy pebble/boulder with a slightly flattened bottom and baked colour variation.
export function makeRockGeometry(seed = 0, {
  detail = 4, lump = 0.32, freq = 1.2, base = '#9c9a97', dark = '#64625f', flat = -0.35,
} = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c0 = new THREE.Color(base), c1 = new THREE.Color(dark), c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = fbm3(v.x * freq + seed * 7.1, v.y * freq + seed * 3.3, v.z * freq - seed * 5.7, 4);
    const r = 1 + (n - 0.5) * 2 * lump;
    v.multiplyScalar(r);
    if (v.y < flat) v.y = flat + (v.y - flat) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
    const shade = fbm3(v.x * 3 + seed, v.y * 3, v.z * 3, 3);
    c.copy(c1).lerp(c0, THREE.MathUtils.clamp(0.25 + shade * 0.9 + v.y * 0.25, 0, 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// Bumpy "pom-pom" blob used for foliage, moss and flower clusters.
export function makePuffGeometry(seed = 1, detail = 2, bump = 0.22, freq = 3.2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = noise3(v.x * freq + seed, v.y * freq, v.z * freq);
    v.multiplyScalar(1 + (n - 0.5) * 2 * bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Tube along a curve whose radius tapers from r0 to r1 (with a flared base).
export function taperedTube(points, r0, r1, { tubular = 48, radial = 12, flare = 0.5, seed = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position;
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, p);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.75)) * (1 + flare * Math.exp(-t * 14));
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(p);
      const bark = 1 + 0.08 * (noise3(t * 18 + seed, j * 0.9, seed) - 0.5);
      v.multiplyScalar(r * bark).add(p);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return { geometry: g, curve };
}

export function roundedRectShape(hx, hz, r, segs = 12) {
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hz - r);
  s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hz);
  s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hz + r);
  s.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function roundedRectPath(hx, hz, r) {
  const p = new THREE.Path();
  p.moveTo(-hx + r, -hz);
  p.lineTo(hx - r, -hz);
  p.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
  p.lineTo(hx, hz - r);
  p.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
  p.lineTo(-hx + r, hz);
  p.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(-hx, -hz + r);
  p.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}

// Tileable micro-ripple normal map built from integer-frequency sine waves.
export function makeRippleNormalMap(size = 256, seed = 3) {
  const rand = mulberry32(seed);
  const waves = [];
  for (let i = 0; i < 14; i++) {
    const m = Math.floor(rand() * 9) - 4;
    const n = Math.floor(rand() * 9) - 4;
    if (m === 0 && n === 0) continue;
    waves.push({ m, n, a: 1 / Math.hypot(m, n), p: rand() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let dx = 0, dy = 0;
      for (const w of waves) {
        const ph = Math.PI * 2 * (w.m * u + w.n * v) + w.p;
        const c = Math.cos(ph) * w.a;
        dx += c * w.m;
        dy += c * w.n;
      }
      const s = 0.09;
      const nx = -dx * s, ny = -dy * s, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function placeInstance(mesh, i, pos, scale, rot = null) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (rot) q.setFromEuler(rot);
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
  m.compose(pos, q, s);
  mesh.setMatrixAt(i, m);
}
