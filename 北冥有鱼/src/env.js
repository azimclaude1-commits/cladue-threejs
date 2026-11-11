// Sky, sea, the deep (light shafts and marine snow) and the sea of clouds.
import * as THREE from 'three';
import { NOISE, FOG } from './noise.glsl.js';
import { U, share } from './shared.js';
import { T } from './timeline.js';
import { AXIS } from './peng.js';

export const CLOUD_Y0 = 460, CLOUD_Y1 = 575;

const SKY = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec3 uDisc;
vec3 skyColor(vec3 d) {
  vec3 s = normalize(uSunDir);
  float h = max(d.y, 0.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));
  if (d.y < 0.0) c = uSkyHorizon * (0.92 + 0.08 * exp(d.y * 6.0));
  float sd = max(dot(d, s), 0.0);
  c += uSunColor * (pow(sd, 8.0) * 0.18 + pow(sd, 90.0) * 0.25);
  c = mix(c, uDisc, smoothstep(0.99935, 0.9996, sd));
  return c;
}
`;

// ---------------------------------------------------------------- sky dome
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: share(),
    vertexShader: /* glsl */ `
      uniform vec3 uCam;
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + uCam, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${FOG}
      ${SKY}
      uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // long dry-brush streaks of high cloud
        float n = fbm(vec3(d.x * 2.0 / (d.y + 0.25), d.z * 7.0 / (d.y + 0.25), uTime * 0.01));
        float band = smoothstep(0.15, 0.6, n) * smoothstep(-0.02, 0.15, d.y) * (1.0 - smoothstep(0.35, 0.8, d.y));
        c = mix(c, c * 0.82 + uSunColor * 0.06, band * 0.6);
        if (uUnder > 0.5) c = fogColorAt(d);
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ---------------------------------------------------------------- the sea
function polarGrid(nR, nA, r0, r1) {
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= nR; i++) {
    const r = r0 * Math.pow(r1 / r0, (i - 1) / (nR - 1));
    for (let j = 0; j < nA; j++) { const a = (j / nA) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let j = 0; j < nA; j++) idx.push(0, 1 + ((j + 1) % nA), 1 + j);
  for (let i = 1; i < nR; i++) for (let j = 0; j < nA; j++) {
    const a = 1 + (i - 1) * nA + j, b = 1 + (i - 1) * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const WAVES = /* glsl */ `
uniform float uTime;
uniform vec4 uBreach;   // x, z, t0, 0
uniform float uSea;     // swell height
// height and slope of the sea at p (xz), with the breach's rings
vec3 sea(vec2 p, float fade) {
  float h = 0.0; vec2 dh = vec2(0.0);
  vec4 W[5];
  W[0] = vec4(normalize(vec2(1.0, 0.3)), 0.022, 2.2);
  W[1] = vec4(normalize(vec2(0.6, 1.0)), 0.035, 1.3);
  W[2] = vec4(normalize(vec2(-0.4, 1.0)), 0.06, 0.7);
  W[3] = vec4(normalize(vec2(1.0, -0.7)), 0.11, 0.35);
  W[4] = vec4(normalize(vec2(-1.0, -0.2)), 0.19, 0.18);
  for (int i = 0; i < 5; i++) {
    float k = W[i].z, a = W[i].w * uSea * fade;
    float ph = dot(W[i].xy, p) * k + uTime * sqrt(9.8 * k) * 1.6 + float(i) * 1.7;
    h += a * sin(ph); dh += a * k * cos(ph) * W[i].xy;
  }
  float dt = uTime - uBreach.z;
  float r = length(p - uBreach.xy);
  // the dome before the breach, then rings running outward
  float pre = smoothstep(-2.2, 0.0, dt) * (1.0 - smoothstep(0.0, 1.0, dt));
  h += 9.0 * pre * exp(-r * r / 1800.0);
  if (dt > 0.0) {
    float env = exp(-dt * 0.22) * exp(-abs(r - dt * 34.0 - 10.0) * 0.012) * smoothstep(0.0, 0.6, dt);
    float ph = r * 0.075 - dt * 4.2;
    h += 7.0 * env * sin(ph);
    dh += 7.0 * env * 0.075 * cos(ph) * normalize(p - uBreach.xy + 1e-4);
  }
  return vec3(h, dh);
}
`;

function makeSea() {
  const uniforms = share({
    uBreach: { value: new THREE.Vector4(252, -16, T.breach, 0) },
    uPierce: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSea: { value: 1 },
  });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${WAVES}
      uniform vec3 uCam;
      varying vec3 vWorld;
      varying vec2 vSlope;
      void main() {
        vec3 p = position;
        p.xz += floor(uCam.xz / 8.0) * 8.0;
        float fade = 1.0 - smoothstep(400.0, 3000.0, length(p.xz - uCam.xz));
        vec3 s = sea(p.xz, fade);
        p.y = s.x;
        vWorld = p; vSlope = s.yz;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${FOG}
      ${SKY}
      uniform float uTime;
      uniform vec4 uBreach;
      uniform vec4 uPierce;   // x, z, radius, amount — where the body cuts the surface
      uniform float uLight;
      varying vec3 vWorld;
      varying vec2 vSlope;
      void main() {
        vec3 V = normalize(uCam - vWorld);
        float dist = length(uCam - vWorld);
        float near = 1.0 - smoothstep(150.0, 1500.0, dist);
        vec2 q = vWorld.xz;
        // fine ripples
        vec2 rip = vec2(snoise(vec3(q * 0.08, uTime * 0.5)), snoise(vec3(q * 0.08 + 31.0, uTime * 0.5))) * 0.14 * near;
        vec3 N = normalize(vec3(-vSlope.x + rip.x, 1.0, -vSlope.y + rip.y));
        float r = length(q - uBreach.xy), dt = uTime - uBreach.z;
        float foam = 0.0;
        if (dt > -0.3) {
          float ring = exp(-abs(r - dt * 34.0 - 10.0) * 0.06) * exp(-dt * 0.25);
          foam += ring * smoothstep(0.3, 0.8, fbm(vec3(q * 0.04, dt * 0.3)) + 0.6);
          foam += (1.0 - smoothstep(10.0, 60.0 + dt * 12.0, r)) * exp(-dt * 0.08) * 0.9 * smoothstep(-0.3, 0.2, dt);
        }
        if (uPierce.w > 0.0) {
          float rp = length(q - uPierce.xy);
          foam += uPierce.w * (1.0 - smoothstep(uPierce.z, uPierce.z * 2.2 + 8.0, rp)) * (0.6 + 0.4 * snoise(vec3(q * 0.1, uTime * 2.0)));
        }
        foam = clamp(foam * (0.55 + 0.6 * fbm(vec3(q * 0.09, uTime * 0.6))), 0.0, 1.0);
        vec3 col;
        if (uCam.y >= 0.0) {
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          float fr = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 deep = vec3(0.025, 0.05, 0.06) * uLight + uSunColor * 0.02;
          col = mix(deep, skyColor(R), fr);
          col += uSunColor * pow(max(dot(R, normalize(uSunDir)), 0.0), 400.0) * 5.0 * near;
          col += uSunColor * pow(max(dot(R, normalize(uSunDir)), 0.0), 24.0) * 0.18;
          col = mix(col, vec3(0.72, 0.73, 0.72) * uLight, foam * 0.85);
        } else {
          // seen from below: Snell's window, total reflection outside it
          vec3 d = -V;
          float win = smoothstep(0.6, 0.72, d.y + rip.x * 0.4);
          vec3 above = mix(uFogFar * 2.2, vec3(0.75, 0.9, 0.88), 0.35) * (0.8 + 0.5 * snoise(vec3(q * 0.03, uTime * 0.4)));
          col = mix(uFogColor * 1.3, above, win);
          col = mix(col, vec3(0.7, 0.85, 0.85), foam * 0.8);
        }
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(polarGrid(220, 256, 2, 30000), mat);
  m.frustumCulled = false; m.renderOrder = -5;
  return m;
}

// ---------------------------------------------------------------- the deep
function makeShafts() {
  const N = 26, pos = [], uv = [], seed = [], idx = [];
  for (let i = 0; i < N; i++) {
    const x = -420 + (i / N) * 760 + Math.sin(i * 12.9) * 30, z = -160 + ((i * 7) % 13) / 13 * 320;
    const w = 8 + (i % 5) * 5, base = pos.length / 3;
    for (const [a, b] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { pos.push(x, 0, z); uv.push(a, b); seed.push(i * 1.37 + w * 0.01); }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: share(),
    vertexShader: /* glsl */ `
      uniform vec3 uCam;
      attribute float seed;
      varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
      void main() {
        float len = 260.0, w = 10.0 + fract(seed * 7.1) * 22.0;
        vec3 top = position, dir = normalize(vec3(0.18, -1.0, 0.08));
        vec3 axisP = top + dir * len * uv.y;
        vec3 toCam = normalize(uCam - axisP);
        vec3 side = normalize(cross(dir, toCam));
        vec3 p = axisP + side * uv.x * w * (1.0 + uv.y * 1.6);
        vUv = uv; vSeed = seed; vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${FOG}
      uniform float uTime;
      uniform float uShafts;
      varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
      void main() {
        float a = (1.0 - abs(vUv.x)) * (1.0 - abs(vUv.x));
        a *= (1.0 - vUv.y) * smoothstep(0.0, 0.05, vUv.y);
        a *= 0.55 + 0.45 * snoise(vec3(vUv.x * 2.0, vUv.y * 3.0 - uTime * 0.08, vSeed));
        a *= 0.5 + 0.5 * sin(uTime * 0.3 + vSeed * 3.0);
        float f = exp(-length(uCam - vWorld) * 0.0035);
        gl_FragColor = vec4(vec3(0.35, 0.65, 0.62) * a * f * uShafts * 0.35, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

function makeSnow() {
  const N = 5000, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd(); pos[i * 3 + 1] = rnd(); pos[i * 3 + 2] = rnd(); seed[i] = rnd(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: share({ uPx: { value: 500 } }),
    vertexShader: /* glsl */ `
      uniform vec3 uCam; uniform float uTime; uniform float uPx; uniform float uUnder;
      attribute float seed;
      varying float vA;
      void main() {
        const float B = 180.0;
        vec3 drift = vec3(sin(uTime * 0.1 + seed * 6.0) * 3.0, -uTime * (1.0 + seed * 1.5), cos(uTime * 0.13 + seed * 5.0) * 3.0);
        vec3 p = mod(position * B + drift - uCam + B * 0.5, B) - B * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = (1.0 - smoothstep(20.0, 80.0, d)) * smoothstep(1.0, 6.0, d) * uUnder * (0.15 + 0.45 * seed * seed) * step(p.y, -2.0);
        gl_PointSize = clamp((0.2 + seed * 0.3) * uPx / max(d, 1.0), 0.5, 6.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.6, 0.8, 0.78) * vA * (1.0 - smoothstep(0.2, 0.5, r)), 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  return p;
}

// ---------------------------------------------------------------- the sea of clouds
function noiseTexture(size = 256) {
  // tileable value-noise fbm, four different scales in the four channels
  const lattice = (f, seed) => { const a = new Float32Array(f * f); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; } return a; };
  const sm = (x) => x * x * (3 - 2 * x);
  const vnoise = (L, f, x, y) => {
    const fx = (x / size) * f, fy = (y / size) * f, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const g = (i, j) => L[((j % f) * f) + (i % f)];
    return (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
  };
  const data = new Uint8Array(size * size * 4);
  const chans = [[4, 6], [8, 5], [16, 4], [32, 3]];
  const lats = chans.map(([f, o], c) => Array.from({ length: o }, (_, k) => lattice(f << k, 1 + c * 97 + k * 13)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) {
    const [f, o] = chans[c]; let v = 0, a = 0.5, n = 0;
    for (let k = 0; k < o; k++) { v += a * vnoise(lats[c][k], f << k, x, y); n += a; a *= 0.5; }
    data[(y * size + x) * 4 + c] = Math.round((v / n) * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

function makeClouds(tex) {
  const group = new THREE.Group();
  const NL = 12, size = 16000;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
  const layers = [];
  for (let i = 0; i < NL; i++) {
    const l = i / (NL - 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: share({ uNoise: { value: tex }, uLayer: { value: l }, uAxis: { value: AXIS }, uHole: { value: 0 }, uCloud: { value: 1 } }),
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${FOG}
        uniform sampler2D uNoise;
        uniform float uLayer, uHole, uTime, uLight, uCloud;
        uniform vec2 uAxis;
        uniform vec3 uSunColor, uSkyHorizon;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz;
          vec2 w = vec2(uTime * 2.0, uTime * 0.7);
          float d = texture2D(uNoise, (p + w) * 0.00016).r * 0.5
                  + texture2D(uNoise, (p - w * 1.5) * 0.0006 + 0.3).g * 0.32
                  + texture2D(uNoise, (p + w * 3.0) * 0.0021 + 0.7).b * 0.18;
          float rh = length(p - uAxis);
          // the whirlwind bores a well through the clouds
          d -= uHole * (1.0 - smoothstep(110.0, 420.0, rh)) * 0.55;
          d += uHole * exp(-pow((rh - 470.0) / 140.0, 2.0)) * 0.08;
          // the clouds open toward the south, over the Lake of Heaven
          d -= smoothstep(1700.0, 3000.0, p.y) * 0.5;
          float e = abs(uLayer * 2.0 - 1.0);
          float thr = 0.47 + 0.16 * e * e;
          float a = smoothstep(thr, thr + 0.07, d);
          if (a < 0.01) discard;
          // ink-wash shading: grey bellies, gilded tops, silver at thin edges
          float thick = smoothstep(thr, thr + 0.3, d);
          vec3 under = vec3(0.2, 0.21, 0.23), top = mix(vec3(0.95, 0.92, 0.86), uSunColor, 0.4);
          vec3 col = mix(under, top, pow(uLayer, 0.8)) * (0.85 + 0.25 * texture2D(uNoise, p * 0.006).a);
          col *= mix(1.0, 0.55, thick * (1.0 - uLayer));
          vec3 V = normalize(vWorld - uCam);
          col += uSunColor * (1.0 - thick) * pow(max(dot(V, normalize(uSunDir)), 0.0), 3.0) * 0.6;
          col *= uLight;
          gl_FragColor = vec4(applyFog(col, vWorld), a * 0.55 * uCloud);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(AXIS.x, CLOUD_Y0 + l * (CLOUD_Y1 - CLOUD_Y0), AXIS.y + 2500);
    m.frustumCulled = false;
    group.add(m); layers.push(m);
  }
  group.userData.layers = layers;
  return group;
}

// ---------------------------------------------------------------- far mountains above the clouds
function makeMountains() {
  const group = new THREE.Group();
  const layers = [[7200, 0.12, 1.25, 11.0], [9400, 0.4, 1.5, 23.0], [12000, 0.62, 1.8, 37.0]];
  for (const [R, haze, amp, seed] of layers) {
    const geo = new THREE.CylinderGeometry(R, R, 2600, 256, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: share({ uHaze: { value: haze }, uAmp: { value: amp }, uSeed: { value: seed }, uMount: { value: 0 } }),
      vertexShader: /* glsl */ `
        uniform vec3 uCam;
        varying vec3 vLocal; varying vec3 vWorld;
        void main() { vLocal = position; vec3 p = position + vec3(uCam.x, 1300.0 + 200.0, uCam.z); vWorld = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FOG}
        uniform float uHaze, uAmp, uSeed, uMount, uLight;
        uniform vec3 uSunColor;
        varying vec3 vLocal; varying vec3 vWorld;
        void main() {
          vec2 c = normalize(vLocal.xz);
          // ridge line: a few big peaks, sharpened, with smaller ridges between
          float n = fbm(vec3(c * 2.2, uSeed));
          float pk = pow(max(0.0, n + 0.25), 1.8);
          float ridge = 520.0 + uAmp * (pk * 1400.0 + fbm(vec3(c * 9.0, uSeed + 4.0)) * 120.0);
          float y = vWorld.y;
          if (y > ridge || uMount < 0.01) discard;
          // ink darkest just under the ridge, dissolving into mist below (留白)
          float depth = (ridge - y) / max(ridge - 450.0, 1.0);
          float ink = (1.0 - smoothstep(0.0, 0.55, depth)) * (0.7 + 0.3 * fbm(vec3(c * 40.0, y * 0.004 + uSeed)));
          // texture strokes running down the slopes (皴)
          ink *= 0.8 + 0.35 * smoothstep(0.1, 0.6, fbm(vec3(c * 140.0, y * 0.002)));
          vec3 mist = fogColorAt(normalize(vWorld - uCam));
          vec3 col = mix(mist, vec3(0.12, 0.13, 0.15) * uLight, ink * (1.0 - uHaze));
          col = mix(col, mist, smoothstep(0.0, 1.0, (450.0 + 300.0 * uHaze - y) / 300.0));
          float a = uMount * (1.0 - smoothstep(ridge - 6.0, ridge, y));
          gl_FragColor = vec4(mix(mist, col, a), 1.0);
        }`,
      side: THREE.BackSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = -8 + layers.indexOf(layers.find((l) => l[0] === R)) * -1;
    group.add(m);
  }
  return group;
}

export class Environment {
  constructor(scene) {
    this.sky = makeSky();
    this.sea = makeSea();
    this.shafts = makeShafts();
    this.snow = makeSnow();
    this.noise = noiseTexture();
    this.clouds = makeClouds(this.noise);
    this.mountains = makeMountains();
    scene.add(this.mountains);
    this.shafts.material.uniforms.uShafts = { value: 1 };
    scene.add(this.sky, this.sea, this.shafts, this.snow, this.clouds);
  }
  update(t, cam, kun) {
    const under = cam.y < 0;
    this.shafts.visible = this.snow.visible = under;
    // where the body cuts the surface
    const pu = this.sea.material.uniforms.uPierce.value;
    pu.set(0, 0, 0, 0);
    if (kun && t > T.breach - 0.5 && t < T.dissolve + 4) {
      const P = kun.spineP;
      for (let i = 0; i < P.length - 1; i++) {
        if ((P[i].y >= 0) !== (P[i + 1].y >= 0)) {
          const f = P[i].y / (P[i].y - P[i + 1].y);
          const x = P[i].x + (P[i + 1].x - P[i].x) * f, z = P[i].z + (P[i + 1].z - P[i].z) * f;
          const u = (i + f) / (P.length - 1) * 1.22;
          const vis = u * 3 + T.dissolve < t ? 0 : 1; // gone once that part has dissolved
          pu.set(x, z, Math.max(4, 20 * (1 - u)), vis);
          break;
        }
      }
    }
    // cloud draw order: farthest layer first
    const layers = this.clouds.userData.layers;
    for (let i = 0; i < layers.length; i++) layers[i].renderOrder = 10 + (cam.y > layers[i].position.y ? i : layers.length - i);
    const hole = Math.min(1, Math.max(0, (t - 49) / 5));
    for (const m of layers) m.material.uniforms.uHole.value = hole;
    this.clouds.visible = t > T.rise + 7;
    const mt = Math.min(1, Math.max(0, (t - 56) / 4));
    this.mountains.visible = mt > 0 && !under;
    for (const m of this.mountains.children) m.material.uniforms.uMount.value = mt;
  }
}
