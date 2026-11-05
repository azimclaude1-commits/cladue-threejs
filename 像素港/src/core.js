// Pixel pipeline: the scene is drawn into a small render target (with depth), then one
// full-screen pass adds depth outlines, snaps every texel to the 64-colour palette in OKLab
// (with a little ordered dither) and blows it up to the screen with nearest-neighbour pixels.
import * as THREE from 'three';
import { PALETTE, hexToRgb, rgbToOklab } from './palette.js';

const POST_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FS = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 lowRes;
uniform float scale;
uniform vec3 palLab[64];
uniform vec3 palRgb[64];
uniform float dither;
uniform float outline;
uniform float flash;
varying vec2 vUv;

vec3 oklab(vec3 c) {
  float l = pow(max(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 0.0), 1.0 / 3.0);
  float m = pow(max(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 0.0), 1.0 / 3.0);
  float s = pow(max(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 0.0), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
float bayer4(ivec2 p) {
  int i = (p.x & 3) + (p.y & 3) * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0 - 0.5;
}
vec3 nearest(vec3 lab) {
  float best = 1e9; vec3 col = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    vec3 d = palLab[i] - lab;
    d.yz *= 1.25; // a touch more weight on hue so colours stay true
    float e = dot(d, d);
    if (e < best) { best = e; col = palRgb[i]; }
  }
  return col;
}
float depthAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(lowRes) - 1);
  return texelFetch(tDepth, p, 0).r;
}
void main() {
  ivec2 px = ivec2(floor(gl_FragCoord.xy / scale));
  px = clamp(px, ivec2(0), ivec2(lowRes) - 1);
  vec3 c = texelFetch(tColor, px, 0).rgb;
  c += flash;
  // depth outline: darken the nearer side of every depth step
  float d = depthAt(px);
  float e = 0.0;
  if (outline > 0.0 && d < 0.9999) {
    float t = 0.0025;
    e = max(e, step(t, depthAt(px + ivec2(1, 0)) - d));
    e = max(e, step(t, depthAt(px - ivec2(1, 0)) - d));
    e = max(e, step(t, depthAt(px + ivec2(0, 1)) - d));
    e = max(e, step(t, depthAt(px - ivec2(0, 1)) - d));
  }
  vec3 lab = oklab(max(c, vec3(0.0)));
  lab.x += bayer4(px) * dither;
  if (e > 0.0) { lab.x *= 0.42; lab.yz *= 0.8; }
  gl_FragColor = vec4(nearest(lab), 1.0);
}
`;

export class PixelPipeline {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__CAPTURE__ });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.BasicShadowMap;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.autoClear = true;
    this.renderer = r;
    this.canvas = canvas;
    const lab = [], rgb = [];
    for (const h of PALETTE) { const c = hexToRgb(h); rgb.push(new THREE.Vector3(...c)); lab.push(new THREE.Vector3(...rgbToOklab(c))); }
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, lowRes: { value: new THREE.Vector2(1, 1) }, scale: { value: 3 },
        palLab: { value: lab }, palRgb: { value: rgb }, dither: { value: 0.035 }, outline: { value: 1 }, flash: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lowW = 0; this.lowH = 0;
  }

  makeTarget(w, h, depth) {
    const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType, depthBuffer: true });
    if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.type = THREE.UnsignedIntType; }
    return rt;
  }

  /** Size the canvas to its CSS box and pick an integer pixel scale. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const W = Math.max(2, Math.round(cw * dpr)), H = Math.max(2, Math.round(ch * dpr));
    // aim for roughly 260-330 low-res pixels on the short side
    const scale = Math.max(2, Math.round(Math.min(W, H) / 300));
    const w = Math.ceil(W / scale), h = Math.ceil(H / scale);
    this.renderer.setSize(W, H, false);
    this.scale = scale;
    if (w === this.lowW && h === this.lowH) return false;
    this.lowW = w; this.lowH = h;
    this.rt?.dispose(); this.reflect?.dispose();
    this.rt = this.makeTarget(w, h, true);
    this.reflect = this.makeTarget(w, h, false);
    this.post.uniforms.tColor.value = this.rt.texture;
    this.post.uniforms.tDepth.value = this.rt.depthTexture;
    this.post.uniforms.lowRes.value.set(w, h);
    return true;
  }

  render(scene, camera, { world, water, waterLevel }) {
    const r = this.renderer;
    this.post.uniforms.scale.value = this.scale;
    // 1) mirror image for the water: the world flipped about the water plane, clipped below it
    if (water) {
      water.visible = false;
      world.scale.y = -1;
      world.position.y = 2 * waterLevel;
      world.updateMatrixWorld(true);
      r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), waterLevel + 0.02)];
      r.setRenderTarget(this.reflect);
      r.render(scene, camera);
      r.clippingPlanes = [];
      world.scale.y = 1;
      world.position.y = 0;
      world.updateMatrixWorld(true);
      water.visible = true;
      water.material.uniforms.tReflect.value = this.reflect.texture;
      water.material.uniforms.resolution.value.set(this.lowW, this.lowH);
    }
    // 2) the scene, small
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    // 3) outline + palette + upscale
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}

/** Orthographic isometric camera with animated quarter turns and pixel snapping. */
export class IsoCamera {
  constructor() {
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.target = new THREE.Vector3(0, 0, -1);
    this.turn = 0; // quarter turns
    this.az = Math.PI / 4;
    this.azGoal = this.az;
    this.elev = Math.atan(Math.sin(Math.PI / 6) / 1) * 0 + (30 * Math.PI) / 180;
    this.zoom = 46; // world units across the short side
  }
  rotate(dir) { this.turn += dir; this.azGoal = Math.PI / 4 + (this.turn * Math.PI) / 2; }
  update(dt, lowW, lowH) {
    this.az += (this.azGoal - this.az) * Math.min(1, dt * 7);
    if (Math.abs(this.azGoal - this.az) < 1e-4) this.az = this.azGoal;
    const aspect = lowW / lowH;
    const h = aspect >= 1 ? this.zoom : this.zoom / aspect;
    const w = h * aspect;
    const c = this.cam;
    c.left = -w / 2; c.right = w / 2; c.top = h / 2; c.bottom = -h / 2;
    c.updateProjectionMatrix();
    const ce = Math.cos(this.elev);
    const dir = new THREE.Vector3(Math.sin(this.az) * ce, Math.sin(this.elev), Math.cos(this.az) * ce);
    // keep the island clear of the side panels on wide screens
    const right = new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az));
    const look = this.target.clone().addScaledVector(right, aspect > 1.2 ? this.zoom * 0.07 : 0);
    // portrait: lift the island into the space between the header and the controls
    if (aspect < 0.8) look.addScaledVector(new THREE.Vector3(-Math.sin(this.az) * Math.sin(this.elev), Math.cos(this.elev), -Math.cos(this.az) * Math.sin(this.elev)), -h * 0.08);
    const pos = look.clone().addScaledVector(dir, 150);
    c.position.copy(pos);
    c.up.set(0, 1, 0);
    c.lookAt(look);
    // snap the camera to the pixel grid so static geometry doesn't shimmer
    if (this.az === this.azGoal) {
      c.updateMatrixWorld(true);
      const upp = h / lowH;
      const rx = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
      const pr = pos.dot(rx), pu = pos.dot(up);
      pos.addScaledVector(rx, Math.round(pr / upp) * upp - pr).addScaledVector(up, Math.round(pu / upp) * upp - pu);
      c.position.copy(pos);
    }
    c.updateMatrixWorld(true);
    this.unitsPerPixel = h / lowH;
  }
}
