// Gray-Scott reaction-diffusion on a 512² torus covering TILE world units, seeded by the
// footprint of the Thomas attractor where the particles land.
import * as THREE from 'three';
import { HASH } from './glsl.js';
import { worldSamples } from './attractors.js';
import { T } from './timeline.js';

export const TILE = 420;          // world units covered by one period of the pattern
const RATE = 300;                 // simulation steps per film second

export class RD {
  constructor(renderer, size = 512, type = THREE.FloatType) {
    this.renderer = renderer; this.size = size;
    const opt = { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false };
    this.rt = [new THREE.WebGLRenderTarget(size, size, opt), new THREE.WebGLRenderTarget(size, size, opt)];
    this.height = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false });
    this.cur = 0; this.steps = -1;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene.add(this.mesh);

    // the seed: where the last attractor lies down on the plane
    const seed = new Uint8Array(size * size * 4);
    const w = worldSamples(3);
    for (let n = 0; n < w.length; n += 3) {
      const p = w[n];
      const cu = ((p[0] / TILE) + 0.5) * size, cv = ((p[2] / TILE) + 0.5) * size;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const u = Math.floor(cu) + dx, v = Math.floor(cv) + dy;
        if (u < 0 || v < 0 || u >= size || v >= size) continue;
        const o = (v * size + u) * 4; seed[o] = 255; seed[o + 3] = 255;
      }
    }
    this.seedTex = new THREE.DataTexture(seed, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.seedTex.needsUpdate = true;

    const vs = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    this.init = new THREE.ShaderMaterial({
      uniforms: { uSeed: { value: this.seedTex } }, vertexShader: vs,
      fragmentShader: /* glsl */ `uniform sampler2D uSeed; void main() { float s = texelFetch(uSeed, ivec2(gl_FragCoord.xy), 0).r; gl_FragColor = vec4(1.0 - 0.5 * s, 0.25 * s, 0.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.step = new THREE.ShaderMaterial({
      uniforms: { uState: { value: null } }, vertexShader: vs,
      fragmentShader: /* glsl */ `
        ${HASH}
        uniform sampler2D uState;
        // periodic value noise for the parameter map
        float pnoise(vec2 p, int P) {
          vec2 f = fract(p), fl = floor(p); f = f * f * (3.0 - 2.0 * f);
          ivec2 i = ivec2(fl);
          float a = hashi(i % P), b = hashi((i + ivec2(1, 0)) % P), c = hashi((i + ivec2(0, 1)) % P), d = hashi((i + ivec2(1, 1)) % P);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        void main() {
          ivec2 c = ivec2(gl_FragCoord.xy), S = textureSize(uState, 0);
          #define AT(dx, dy) texelFetch(uState, (c + ivec2(dx, dy) + S) % S, 0).xy
          vec2 s = AT(0, 0);
          vec2 lap = 0.2 * (AT(1, 0) + AT(-1, 0) + AT(0, 1) + AT(0, -1)) + 0.05 * (AT(1, 1) + AT(-1, 1) + AT(1, -1) + AT(-1, -1)) - s;
          vec2 uv = vec2(c) / vec2(S);
          float n = 0.5 + 0.5 * pnoise(uv * 4.0, 4) * 0.7 + 0.15 * pnoise(uv * 8.0 + 3.0, 8);
          // coral where n is low, a finer labyrinth where it is high
          float f = mix(0.0545, 0.040, n), k = mix(0.0620, 0.0600, n);
          float r = s.x * s.y * s.y;
          vec2 ns = s + vec2(1.0 * lap.x - r + f * (1.0 - s.x), 0.5 * lap.y + r - (f + k) * s.y);
          gl_FragColor = vec4(clamp(ns, 0.0, 1.0), 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { uState: { value: null } }, vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform sampler2D uState;
        void main() {
          ivec2 c = ivec2(gl_FragCoord.xy), S = textureSize(uState, 0);
          float v = 0.0, w = 0.0;
          for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
            float k = exp(-float(x * x + y * y) / 2.5);
            v += texelFetch(uState, (c + ivec2(x, y) + S) % S, 0).y * k; w += k;
          }
          gl_FragColor = vec4(v / w, 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }
  _pass(mat, target) {
    this.mesh.material = mat;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(target); r.render(this.scene, this.camera); r.setRenderTarget(prev);
  }
  reset() { this._pass(this.init, this.rt[this.cur]); this.steps = 0; }
  /** steps the pattern should have taken by time t (it grows until the land has risen) */
  static stepsAt(t) { return Math.max(0, Math.floor((Math.min(t, T.world + 2) - T.seed) * RATE)); }
  advanceTo(t, maxSteps = 600) {
    const want = RD.stepsAt(t);
    if (this.steps < 0 || want < this.steps) this.reset();
    let n = 0;
    while (this.steps < want && n < maxSteps) {
      this.step.uniforms.uState.value = this.rt[this.cur].texture;
      this._pass(this.step, this.rt[1 - this.cur]);
      this.cur = 1 - this.cur; this.steps++; n++;
    }
    if (n > 0 || !this._blurred) { this.blur.uniforms.uState.value = this.rt[this.cur].texture; this._pass(this.blur, this.height); this._blurred = true; }
    return this.steps >= want;
  }
}
