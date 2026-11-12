// One million particles on the GPU: born in a burst, carried by strange attractors, laid down as seeds,
// and at the end gathered into a word and back into a single point.
import * as THREE from 'three';
import { SIMPLEX, HASH } from './glsl.js';
import { ATTRACTORS, worldSamples } from './attractors.js';
import { T, smooth, clamp } from './timeline.js';

const DT = 1 / 60;

function fieldGLSL() {
  let s = '';
  ATTRACTORS.forEach((A, i) => { s += `vec3 fA${i}(vec3 q) { return ${A.glsl}; }\n`; });
  s += `
uniform vec4 uNorm[4];   // xyz centre, w scale k
uniform mat3 uRot[4];
uniform float uVel[4];
vec3 attractorField(int id, vec3 p) {
  mat3 R = uRot[id]; vec4 N = uNorm[id];
  vec3 q = transpose(R) * p / N.w + N.xyz;
  vec3 f;
  if (id == 0) f = fA0(q); else if (id == 1) f = fA1(q); else if (id == 2) f = fA2(q); else f = fA3(q);
  return R * f * N.w * uVel[id];
}
uniform int uA, uB;
uniform float uMix;
vec3 field(vec3 p) {
  vec3 a = attractorField(uA, p);
  if (uMix <= 0.0) return a;
  return mix(a, attractorField(uB, p), uMix);
}
`;
  return s;
}

export class Particles {
  constructor(renderer, size = 1024, type = THREE.FloatType) {
    this.renderer = renderer;
    this.size = size;
    this.count = size * size;
    const opt = { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
    this.rt = [new THREE.WebGLRenderTarget(size, size, opt), new THREE.WebGLRenderTarget(size, size, opt)];
    this.cur = 0;
    this.simT = -1;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.PlaneGeometry(2, 2);

    // initial state: a tiny ball, dormant
    const init = new Float32Array(this.count * 4);
    let s = 1234567;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < this.count; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = 0.4 + 1.6 * Math.cbrt(r());
      const q = Math.sqrt(1 - u * u);
      init[i * 4] = Math.cos(a) * q * rad; init[i * 4 + 1] = u * rad; init[i * 4 + 2] = Math.sin(a) * q * rad; init[i * 4 + 3] = 100 + r();
    }
    this.initTex = new THREE.DataTexture(init, size, size, THREE.RGBAFormat, THREE.FloatType);
    this.initTex.needsUpdate = true;
    // samples of each attractor (its natural distribution), 128x128 per attractor, side by side
    const SS = 128, smp = new Float32Array(SS * 4 * SS * 4);
    ATTRACTORS.forEach((A, a) => {
      const w = worldSamples(a);
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const p = w[(j * SS + i) % w.length], o = (j * SS * 4 + a * SS + i) * 4;
        smp[o] = p[0]; smp[o + 1] = p[1]; smp[o + 2] = p[2]; smp[o + 3] = 1;
      }
    });
    this.sampleTex = new THREE.DataTexture(smp, SS * 4, SS, THREE.RGBAFormat, THREE.FloatType);
    this.sampleTex.needsUpdate = true;
    this.targetTex = null;   // text targets
    this.netTex = null;      // samples on the neural network

    this.sim = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null }, uTime: { value: 0 }, uDt: { value: DT },
        uNorm: { value: ATTRACTORS.map(() => new THREE.Vector4()) }, uRot: { value: ATTRACTORS.map(() => new THREE.Matrix3()) }, uVel: { value: ATTRACTORS.map(() => 1) },
        uA: { value: 0 }, uB: { value: 1 }, uMix: { value: 0 },
        uBang: { value: 0 }, uField: { value: 0 }, uFlat: { value: 0 }, uRespawn: { value: 1 },
        uPointer: { value: new THREE.Vector4() }, uSamples: { value: this.sampleTex },
        uTarget: { value: null }, uTargetMix: { value: 0 }, uCollapse: { value: 0 }, uCenter: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${HASH}
        ${SIMPLEX}
        ${fieldGLSL()}
        uniform sampler2D uPos, uTarget, uSamples;
        uniform float uTime, uDt, uBang, uField, uFlat, uRespawn, uTargetMix, uCollapse;
        uniform vec4 uPointer;
        uniform vec3 uCenter;
        varying vec2 vUv;
        vec3 vel(vec3 p, float h) {
          vec3 v = field(p) * uField;
          // the burst: everything flies out of the point
          v += normalize(p + 1e-4) * uBang * (0.35 + 0.65 * h);
          // a hand in the cloud
          if (uPointer.w > 0.0) {
            vec3 d = p - uPointer.xyz; float r = length(d);
            float k = uPointer.w * exp(-r / 70.0);
            v += (cross(normalize(d), vec3(0.0, 1.0, 0.0)) * 160.0 - d * 0.8) * k;
          }
          // lie down on the plane
          v = mix(v, vec3(v.x * 0.15, -p.y * 2.8, v.z * 0.15), uFlat);
          return v;
        }
        void main() {
          ivec2 ij = ivec2(gl_FragCoord.xy);
          vec4 s = texelFetch(uPos, ij, 0);
          vec3 p = s.xyz; float life = s.w;
          float h = hash12(vec2(ij) * 0.731 + 0.17);
          if (uTargetMix > 0.0) {
            // gather into the word, then into one point
            vec3 tg = texelFetch(uTarget, ij, 0).xyz;
            tg = mix(tg, uCenter, uCollapse);
            vec3 sw = curl(p * 0.012 + uTime * 0.1) * 40.0 * (1.0 - uTargetMix) * (1.0 - uCollapse);
            float k = 1.0 - exp(-uDt * (1.2 + 3.5 * uTargetMix * (0.5 + h) + 8.0 * uCollapse));
            p += (tg - p) * k + sw * uDt;
            gl_FragColor = vec4(p, life);
            return;
          }
          vec3 k1 = vel(p, h);
          vec3 k2 = vel(p + k1 * uDt * 0.5, h);
          p += k2 * uDt;
          if (life > 50.0 && uRespawn > 0.5) life = 0.2 + h * h * 3.0;   // leave the burst behind, quickly
          if (life < 50.0) life -= uDt * uRespawn;
          // Lorenz: above z = 27 the z axis draws trajectories in; nothing there belongs to the attractor
          if (uA == 0 && uRespawn > 0.5) {
            vec3 q = transpose(uRot[0]) * p / uNorm[0].w + uNorm[0].xyz;
            if (length(q.xy) < 1.2 && q.z > 4.0) life = -1.0;
          }
          if (any(isnan(p)) || length(p) > 900.0) life = -1.0;
          if (life < 0.0 && uRespawn > 0.5) {
            // reborn somewhere on the attractor, drawn from its natural distribution
            vec3 rr = hash32(vec2(ij) * 0.913 + fract(uTime * 0.6180339) * 1000.0);
            int id = rr.z < uMix ? uB : uA;
            ivec2 o = ivec2(id * 128 + int(rr.x * 127.99), int(rr.y * 127.99));
            p = texelFetch(uSamples, o, 0).xyz + (hash32(vec2(ij) * 1.3 + uTime).xyz - 0.5) * 3.0;
            life = 2.0 + h * 6.0;
          }
          gl_FragColor = vec4(p, life);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null } },
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D uSrc; void main() { gl_FragColor = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }`,
      depthTest: false, depthWrite: false,
    });
    this.simMesh = new THREE.Mesh(quad, this.sim);
    this.simScene = new THREE.Scene(); this.simScene.add(this.simMesh);
    ATTRACTORS.forEach((A, i) => {
      this.sim.uniforms.uNorm.value[i].set(A.center.x, A.center.y, A.center.z, A.k);
      this.sim.uniforms.uRot.value[i].copy(A.rot);
      this.sim.uniforms.uVel.value[i] = A.vel;
    });

    // ---- drawing
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.draw = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null }, uPx: { value: 800 }, uAlpha: { value: 1 }, uFocus: { value: 400 }, uCoc: { value: 0.012 },
        uSize: { value: 1.0 }, uGain: { value: 1 }, uTime: { value: 0 }, uColA: { value: 0 }, uColB: { value: 1 }, uColMix: { value: 0 },
        uNorm: this.sim.uniforms.uNorm, uRot: this.sim.uniforms.uRot, uVel: this.sim.uniforms.uVel, uA: this.sim.uniforms.uA, uB: this.sim.uniforms.uB, uMix: this.sim.uniforms.uMix,
        uFlat: this.sim.uniforms.uFlat, uWarm: { value: 0 },
      },
      vertexShader: /* glsl */ `
        ${HASH}
        ${fieldGLSL()}
        uniform sampler2D uPos;
        uniform float uPx, uFocus, uCoc, uSize, uGain, uTime, uColMix, uFlat, uWarm;
        uniform int uColA, uColB;
        varying vec3 vCol;
        vec3 palette(int id, float s, float h) {
          vec3 a, b;
          if (id == 0) { a = vec3(0.05, 0.25, 1.0); b = vec3(0.6, 0.95, 1.0); }        // Lorenz: deep blue to ice
          else if (id == 1) { a = vec3(0.9, 0.12, 0.45); b = vec3(1.0, 0.75, 0.35); } // Aizawa: magenta to amber
          else if (id == 2) { a = vec3(0.0, 0.55, 0.5); b = vec3(1.0, 0.85, 0.4); }   // Halvorsen: teal to gold
          else { a = vec3(0.45, 0.2, 1.0); b = vec3(1.0, 0.55, 0.8); }                // Thomas: violet to rose
          return mix(a, b, s) * (0.8 + 0.4 * h);
        }
        void main() {
          int S = textureSize(uPos, 0).x;
          ivec2 ij = ivec2(gl_VertexID % S, gl_VertexID / S);
          vec4 st = texelFetch(uPos, ij, 0);
          vec3 p = st.xyz;
          float h = hash12(vec2(ij) * 0.37);
          float sp = clamp(length(field(p)) / 140.0, 0.0, 1.0);
          vec3 c = mix(palette(uColA, sp, h), palette(uColB, sp, h), uColMix);
          c = mix(c, vec3(1.0, 0.82, 0.55) * (0.7 + 0.6 * h), uWarm);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float coc = abs(d - uFocus) * uCoc;
          float px = uSize * (1.0 + h * 0.6) + coc;
          gl_PointSize = clamp(px, 1.0, 24.0);
          // keep energy constant as the point spreads
          vCol = c * uGain * (0.6 + 0.8 * sp) / (gl_PointSize * gl_PointSize) * (d > 0.5 ? 1.0 : 0.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying vec3 vCol;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = dot(q, q) * 4.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(vCol * uAlpha * (1.0 - r * 0.6), 1.0);
        }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.draw);
    this.points.frustumCulled = false;
    this.points.renderOrder = 50;
    this.reset(0, this.initTex);
  }

  _pass(mat, target) {
    this.simMesh.material = mat;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(target); r.render(this.simScene, this.camera); r.setRenderTarget(prev);
  }
  reset(t, tex) {
    this.copy.uniforms.uSrc.value = tex;
    this._pass(this.copy, this.rt[this.cur]);
    this.simT = t;
  }
  /** Parameters of the flow at time t */
  params(t) {
    const u = this.sim.uniforms;
    const morphs = [[T.aizawa, 0, 1], [T.halvorsen, 1, 2], [T.thomas, 2, 3]];
    let A = 0, B = 1, m = 0;
    for (const [tm, a, b] of morphs) { if (t >= tm - 0.8) { A = a; B = b; m = smooth(tm - 0.8, tm + 1.6, t); } }
    if (m >= 1) { A = B; m = 0; }
    u.uA.value = A; u.uB.value = B; u.uMix.value = m;
    u.uBang.value = t >= T.bang ? 300 * Math.exp(-(t - T.bang) * 2.2) : 0;
    u.uField.value = smooth(T.bang + 0.5, T.bang + 2.4, t);
    u.uRespawn.value = t > T.bang + 2.4 ? 1 : 0;
    u.uFlat.value = smooth(T.land, T.land + 1.6, t);
    u.uTargetMix.value = t >= T.dissolve ? 0.001 + smooth(T.text - 0.6, T.text + 2.4, t) : 0;
    u.uCollapse.value = smooth(T.collapse, T.collapse + 1.6, t);
    return u;
  }
  step(t) {
    const u = this.params(t);
    u.uTime.value = t; u.uPos.value = this.rt[this.cur].texture;
    this._pass(this.sim, this.rt[1 - this.cur]);
    this.cur = 1 - this.cur;
  }
  /** Bring the simulation to time t (deterministic up to the chaos itself). */
  advanceTo(t, maxSteps = 900) {
    const needReset = t < this.simT - 1e-6 || t - this.simT > 6;
    if (needReset) {
      if (t >= T.dissolve && this.netTex) { this.reset(T.dissolve, this.netTex); }
      else if (t < T.bang + 2) { this.reset(0, this.initTex); }
      else {
        // warm start: the attractors forget where you came from in a few seconds
        this.reset(0, this.initTex);
        this.simT = Math.max(0, t - 6);
        if (this.simT < T.bang + 2.6) this.simT = 0;
      }
    }
    if (t < T.bang) { this.simT = t; return true; }
    if (this.simT < T.bang) this.simT = T.bang;
    let n = 0;
    while (this.simT + DT <= t + 1e-6 && n < maxSteps) { this.simT += DT; this.step(this.simT); n++; }
    return this.simT + DT > t;
  }
  get texture() { return this.rt[this.cur].texture; }
  /** Point the drawing at the current state and set the look for time t */
  look(t) {
    const d = this.draw.uniforms, u = this.sim.uniforms;
    d.uPos.value = this.texture; d.uTime.value = t;
    const m = u.uMix.value;
    d.uColA.value = u.uA.value; d.uColB.value = u.uB.value; d.uColMix.value = m;
    d.uWarm.value = t >= T.dissolve ? 1 : 0;
  }
}
