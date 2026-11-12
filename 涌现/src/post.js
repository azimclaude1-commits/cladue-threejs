// Bloom, then a cinematic finish: exposure, ACES, a touch of chromatic aberration, vignette, grain, fades.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const Finish = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uExposure: { value: 1 }, uFade: { value: 0 }, uFlash: { value: 0 }, uCA: { value: 0.6 }, uBars: { value: 0 }, uSat: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uExposure, uFade, uFlash, uCA, uBars, uSat;
    varying vec2 vUv;
    float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec2 q = vUv - 0.5;
      float r2 = dot(q, q);
      vec2 off = q * r2 * uCA * 0.02;
      vec3 c = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      c *= uExposure;
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c *= 1.0 - r2 * 0.55;
      c = mix(c, vec3(1.0), uFlash);
      c *= 1.0 - uFade;
      c += (h12(vUv * uRes + fract(uTime * 7.31) * 113.0) - 0.5) * 0.028;
      if (abs(q.y) > 0.5 - uBars) c = vec3(0.0);
      gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    }`,
};

export function makePost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: true });
  const composer = new EffectComposer(renderer, rt);
  const render = new RenderPass(scene, camera);
  render.clearColor = new THREE.Color(0, 0, 0); render.clearAlpha = 1;
  composer.addPass(render);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.9, 0.6, 0.6);
  composer.addPass(bloom);
  const fin = new ShaderPass(Finish);
  composer.addPass(fin);
  return {
    composer, bloom, u: fin.uniforms,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); fin.uniforms.uRes.value.set(w * pr, h * pr); },
  };
}
