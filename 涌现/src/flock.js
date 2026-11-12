// A murmuration. Each bird keeps a fixed place in a unit ball; the ball is stretched, bent, folded and
// swept by density waves as a function of time, so the whole flock is stateless and can be scrubbed.
import * as THREE from 'three';
import { SIMPLEX, HASH } from './glsl.js';
import { T, smooth, lerp } from './timeline.js';

export function flockCentre(t) {
  const k = smooth(T.dusk, T.flyThrough, t), j = smooth(T.flyThrough, T.night, t);
  return new THREE.Vector3(
    lerp(260, 190, k) + 60 * Math.sin(t * 0.17) + 90 * j,
    lerp(125, 95, k) + 14 * Math.sin(t * 0.33) + 60 * j,
    lerp(900, 840, k) + 80 * Math.sin(t * 0.11 + 1.0) + 140 * j,
  );
}

export class Flock {
  constructor(count = 40000) {
    this.count = count;
    // one bird: two wings and a tail, nose along +z
    const pos = [
      0, 0, 0.18, 0, 0, -0.16, -1, 0, -0.12,   // left wing
      0, 0, 0.18, 1, 0, -0.12, 0, 0, -0.16,    // right wing
      0, 0, -0.05, -0.22, 0, -0.55, 0.22, 0, -0.55, // tail
      0, 0, 0.42, -0.07, 0, 0.0, 0.07, 0, 0.0,  // head
    ];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const r = new Float32Array(count * 3), p = new Float32Array(count * 3);
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      // uniform in a ball, a little denser toward the middle
      let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
      const k = Math.pow(rnd(), 0.15);
      r.set([x * k, y * k, z * k], i * 3);
      p.set([rnd() * 6.283, rnd(), 0.8 + rnd() * 0.4], i * 3);
    }
    g.setAttribute('aR', new THREE.InstancedBufferAttribute(r, 3));
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(p, 3));
    g.instanceCount = count;
    this.uniforms = {
      uTime: { value: 0 }, uC: { value: new THREE.Vector3() }, uCV: { value: new THREE.Vector3() }, uS: { value: 60 },
      uPx: { value: 800 }, uAlpha: { value: 1 }, uFog: { value: 0.0006 }, uFogC: { value: new THREE.Color() }, uSky: { value: new THREE.Color() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        ${SIMPLEX}
        uniform float uTime, uS, uPx;
        uniform vec3 uC, uCV;
        attribute vec3 aR, aP;
        varying float vA; varying float vDist; varying float vUp;
        mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
        mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
        vec3 shape(vec3 r, float t) {
          vec3 q = rotY(t * 0.21) * r;
          q.x *= 2.3 + 0.9 * sin(t * 0.29);
          q.z *= 0.95 + 0.35 * sin(t * 0.23 + 1.0);
          q.y *= 0.42 + 0.18 * sin(t * 0.37);
          // the flock bends and folds
          q.y += 0.55 * sin(q.x * 0.85 + t * 0.62);
          q.z += 0.45 * sin(q.x * 0.6 - t * 0.47 + q.y);
          // density waves sweep through it
          q.x += 0.16 * sin(q.x * 3.1 - t * 3.6) + 0.07 * sin(q.z * 5.0 + t * 2.7);
          // and it is never still
          q += 0.22 * vec3(snoise(q * 0.8 + t * 0.12), snoise(q * 0.8 + t * 0.12 + 17.0), snoise(q * 0.8 + t * 0.12 + 31.0));
          q = rotZ(0.25 * sin(t * 0.19)) * rotY(-t * 0.08) * q;
          return q;
        }
        void main() {
          float t = uTime;
          vec3 p0 = uC + shape(aR, t) * uS;
          vec3 p1 = uC + uCV * 0.06 + shape(aR, t + 0.06) * uS;
          vec3 fwd = normalize(p1 - p0 + vec3(1e-4, 0.0, 0.0));
          vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(right, fwd);
          // flap
          float flap = sin(t * (11.0 + aP.y * 5.0) + aP.x);
          vec3 lp = position;
          float tip = abs(lp.x);
          lp.y += tip * flap * 0.75;
          lp.x *= 1.0 - tip * abs(flap) * 0.25;
          // stay at least a couple of pixels wide, fading instead of vanishing
          float dist = length(p0 - cameraPosition);
          float span = 1.5 * aP.z;
          float spanPx = span * uPx / dist;
          float grow = max(1.0, 2.2 / spanPx);
          vA = min(1.0, spanPx / 2.2);
          vec3 wp = p0 + (right * lp.x + up * lp.y + fwd * lp.z) * span * 0.5 * grow;
          vDist = dist; vUp = 0.5 + 0.5 * flap;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha, uFog;
        uniform vec3 uFogC, uSky;
        varying float vA; varying float vDist; varying float vUp;
        void main() {
          vec3 c = vec3(0.012, 0.01, 0.012) + uSky * 0.05 * vUp;
          c = mix(c, uFogC, 1.0 - exp(-vDist * uFog));
          gl_FragColor = vec4(c, vA * uAlpha);
        }`,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }
  update(t, g, px) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uC.value.copy(flockCentre(t));
    u.uCV.value.copy(flockCentre(t + 0.05).sub(flockCentre(t)).multiplyScalar(20));
    u.uS.value = 78;
    u.uPx.value = px;
    u.uAlpha.value = smooth(T.dusk - 1.5, T.dusk + 1.5, t) * (1 - smooth(T.night + 1.5, T.mind + 0.5, t));
    u.uFog.value = g.fog;
    u.uFogC.value.copy(g.hor).lerp(g.zen, 0.18);
    u.uSky.value.copy(g.hor);
    this.mesh.visible = u.uAlpha.value > 0.001;
  }
}
