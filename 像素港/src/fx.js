// Square-pixel particles (splashes, smoke, spray, bread crumbs) and rain streaks.
import * as THREE from 'three';
import { env, seaHeight, rand } from './env.js';

const MAX = 3000;
const VS = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float pxScale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * pxScale;
}
`;
const FS = /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`;

export class FX {
  constructor() {
    this.n = 0;
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.c = new Float32Array(MAX * 3); this.size = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.g = new Float32Array(MAX); this.kind = new Uint8Array(MAX);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr); g.setAttribute('color', this.colAttr); g.setAttribute('size', this.sizeAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { pxScale: { value: 1 } } });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    // rain
    const rg = new THREE.BufferGeometry();
    this.rainN = 700;
    this.rain = new Float32Array(this.rainN * 6);
    for (let i = 0; i < this.rainN; i++) this.resetDrop(i, true);
    rg.setAttribute('position', new THREE.BufferAttribute(this.rain, 3).setUsage(THREE.DynamicDrawUsage));
    rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    this.rainLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#a5acb6' }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.tmpC = new THREE.Color();
  }
  resetDrop(i, any) {
    const x = rand(-26, 26), z = rand(-26, 26), y = any ? rand(0, 22) : rand(18, 24);
    this.rain.set([x, y, z, x, y - 0.6, z], i * 6);
  }
  emit(kind, x, y, z, vx, vy, vz, life, size, color, gravity = -9.8) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    const c = this.tmpC.set(color);
    this.c[i * 3] = c.r; this.c[i * 3 + 1] = c.g; this.c[i * 3 + 2] = c.b;
    this.life[i] = life; this.size[i] = size; this.g[i] = gravity; this.kind[i] = kind;
  }
  splash(x, z, big = 1) {
    const y = seaHeight(x, z);
    const n = Math.round(10 + big * 14);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.6, 2.2) * Math.sqrt(big);
      this.emit(0, x, y + 0.05, z, Math.cos(a) * s * 0.6, rand(2, 4.2) * Math.sqrt(big), Math.sin(a) * s * 0.6, rand(0.4, 0.8), Math.random() < 0.3 ? 2 : 1, Math.random() < 0.5 ? '#e9ebe4' : '#a7d3e8');
    }
    for (let i = 0; i < 8 * big; i++) { const a = (i / (8 * big)) * Math.PI * 2; this.emit(1, x + Math.cos(a) * 0.3, y + 0.02, z + Math.sin(a) * 0.3, Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2, 0.5, 1, '#d2eaf2', 0); }
  }
  smoke(x, y, z) {
    const g = Math.random() < 0.5 ? '#7f8794' : '#a5acb6';
    this.emit(2, x + rand(-0.15, 0.15), y, z + rand(-0.15, 0.15), Math.cos(env.windDir) * env.wind * 0.12, rand(0.6, 1.0), Math.sin(env.windDir) * env.wind * 0.12, rand(3, 5), rand(2, 3), g, 0.05);
  }
  spray(x, y, z) {
    this.emit(0, x, y, z, Math.cos(env.windDir) * rand(2, 5), rand(2, 5), Math.sin(env.windDir) * rand(2, 5), rand(0.5, 1.0), rand(1, 2), '#e9ebe4');
  }
  sparkle(x, y, z, color = '#faecae') { this.emit(3, x, y, z, rand(-0.4, 0.4), rand(0.5, 1.5), rand(-0.4, 0.4), rand(0.3, 0.6), 1, color, -2); }

  update(dt, pxScale) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      let px = this.p[i * 3], py = this.p[i * 3 + 1], pz = this.p[i * 3 + 2];
      let vx = this.v[i * 3], vy = this.v[i * 3 + 1] + this.g[i] * dt, vz = this.v[i * 3 + 2];
      if (this.kind[i] === 2) { vx *= 0.99; vz *= 0.99; vy *= 0.99; }
      px += vx * dt; py += vy * dt; pz += vz * dt;
      if (this.kind[i] === 0 && py < seaHeight(px, pz) - 0.05 && vy < 0) continue;
      this.p[j * 3] = px; this.p[j * 3 + 1] = py; this.p[j * 3 + 2] = pz;
      this.v[j * 3] = vx; this.v[j * 3 + 1] = vy; this.v[j * 3 + 2] = vz;
      for (let k = 0; k < 3; k++) this.c[j * 3 + k] = this.c[i * 3 + k];
      this.life[j] = l;
      this.size[j] = this.kind[i] === 2 ? Math.min(4, this.size[i] + dt * 0.4) : this.size[i];
      this.g[j] = this.g[i]; this.kind[j] = this.kind[i];
      j++;
    }
    this.n = j;
    this.posAttr.array.set(this.p.subarray(0, j * 3)); this.colAttr.array.set(this.c.subarray(0, j * 3)); this.sizeAttr.array.set(this.size.subarray(0, j));
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, j);
    this.mat.uniforms.pxScale.value = 1;
    // rain
    this.rainLines.visible = env.rain > 0.01;
    if (this.rainLines.visible) {
      const fall = 22 * dt, wx = Math.cos(env.windDir) * env.wind * 0.08 * dt * 10, wz = Math.sin(env.windDir) * env.wind * 0.08 * dt * 10;
      const n = Math.floor(this.rainN * env.rain);
      for (let i = 0; i < this.rainN; i++) {
        const o = i * 6;
        if (i >= n) { this.rain[o + 1] = this.rain[o + 4] = -100; continue; }
        this.rain[o] += wx; this.rain[o + 2] += wz; this.rain[o + 1] -= fall;
        this.rain[o + 3] = this.rain[o] - wx * 3; this.rain[o + 5] = this.rain[o + 2] - wz * 3; this.rain[o + 4] = this.rain[o + 1] - 0.7;
        if (this.rain[o + 1] < -2 || this.rain[o + 1] < -50) this.resetDrop(i, false);
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
  }
}
