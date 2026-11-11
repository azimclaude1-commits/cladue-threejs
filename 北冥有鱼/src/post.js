// Bloom, then one pass that turns the frame into ink on paper: tone, paper, the ink-drop reveal, the closing fade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const Composite = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uReveal: { value: 0 },   // ink drop spreading: 0 paper .. 1 the whole frame
    uPaperIn: { value: 0 },  // closing: the picture sinks back into paper
    uFlash: { value: 0 },
    uDip: { value: 0 },
    uDipColor: { value: new THREE.Color(0, 0, 0) },
    uBars: { value: 0.045 },
    uExposure: { value: 1 },
    uSat: { value: 0.82 },
    uDrop: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uReveal, uPaperIn, uFlash, uDip, uBars, uExposure, uSat, uDrop;
    uniform vec3 uDipColor;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
    float fb(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.07 + 11.3; a *= 0.5; } return s; }
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 uv = vUv;
      float asp = uRes.x / uRes.y;
      vec2 px = 1.0 / uRes;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      // ink line: darken where the tone changes sharply, like a brush outline
      float l0 = luma(aces(c)), lx = luma(aces(texture2D(tDiffuse, uv + vec2(px.x * 1.5, 0.0)).rgb)), ly = luma(aces(texture2D(tDiffuse, uv + vec2(0.0, px.y * 1.5)).rgb));
      float edge = smoothstep(0.03, 0.16, length(vec2(lx - l0, ly - l0)));
      c = aces(c * uExposure);
      c *= 1.0 - edge * 0.35;
      // a little less saturated, warm in the lights
      float l = luma(c);
      c = mix(vec3(l), c, uSat);
      // xuan paper: fibres and tooth
      vec2 pp = uv * vec2(asp, 1.0);
      float fib = fb(pp * vec2(90.0, 14.0)) * 0.5 + fb(pp * vec2(14.0, 90.0) + 7.0) * 0.5;
      float tooth = vn(uv * uRes * 0.5);
      vec3 paper = vec3(0.925, 0.895, 0.83) * (0.95 + 0.05 * fib) - tooth * 0.015;
      c *= 0.95 + 0.05 * fib + tooth * 0.02;
      // vignette, toward ink
      vec2 q = uv - 0.5;
      c *= 1.0 - dot(q * vec2(1.0, 0.8), q * vec2(1.0, 0.8)) * 0.75;
      // flash (breaking the surface) and dips at cuts
      c = mix(c, vec3(0.97, 0.97, 0.94), uFlash);
      c = mix(c, uDipColor, uDip);
      // the ink drop: a blot that spreads from the centre with a ragged, darker rim
      vec2 d = (uv - vec2(0.5, 0.52)) * vec2(asp, 1.0);
      float n = fb(d * 5.0 + 3.0) - 0.5, n2 = fb(d * 18.0) - 0.5;
      float rad = length(d) + n * 0.16 * (0.4 + uReveal) + n2 * 0.03;
      float R = uReveal * 1.4;
      float m = (1.0 - smoothstep(R - 0.012, R + 0.004, rad)) * step(0.0005, uReveal);
      float rim = smoothstep(R - 0.05, R - 0.004, rad) * m * (1.0 - smoothstep(0.85, 1.0, uReveal));
      c *= 1.0 - rim * 0.55;
      // the falling drop, just before it lands
      float dr = length(d - vec2(0.0, (1.0 - uDrop) * 0.05));
      float drop = (1.0 - smoothstep(0.004 + uDrop * 0.009, 0.006 + uDrop * 0.011, dr)) * step(0.001, uDrop) * (1.0 - step(0.0005, uReveal));
      // the close: paper creeps back in from the edges, through the fibres
      float e = length(q * vec2(asp * 0.8, 1.0)) * 1.25 + (fb(pp * 3.0) - 0.5) * 0.5 + (fib - 0.5) * 0.12;
      float back = smoothstep(1.15 - uPaperIn * 1.6, 1.2 - uPaperIn * 1.6, e);
      m *= 1.0 - back;
      c = mix(paper, c, m);
      c = mix(c, vec3(0.06, 0.06, 0.07), drop);
      // mount: paper margins with a deckled edge
      float bar = uBars + (vn(vec2(uv.x * 160.0, uv.y > 0.5 ? 3.0 : 9.0)) - 0.5) * 0.004;
      float inside = step(bar, uv.y) * step(uv.y, 1.0 - bar);
      c = mix(paper * 0.985, c, inside);
      // grain
      c += (h2(uv * uRes + fract(uTime * 13.7) * 100.0) - 0.5) * 0.025;
      c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function makePost(renderer, scene, camera, samples = 4) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.55, 0.82);
  composer.addPass(bloom);
  const comp = new ShaderPass(Composite);
  composer.addPass(comp);
  return {
    composer, bloom, u: comp.uniforms,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); comp.uniforms.uRes.value.set(w * pr, h * pr); },
  };
}
