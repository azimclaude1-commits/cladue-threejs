import * as THREE from 'three';
import { INNER, WATER_Y, BULGE, sdRoundRect, waterSDF } from './layout.js';
import { makeRippleNormalMap } from './utils.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Jelly surface: a height field driven by a damped wave equation with an extra
 * elastic restoring force (−k·h). The restoring force is what makes it feel like
 * jelly rather than water: dents spring back, overshoot and wobble in place
 * while slow, thick ripples spread outward.
 *
 *   dv/dt = tension·∇²h − stiffness·h − damping·v + viscosity·∇²v + forces
 *   dh/dt = v
 */
export class Jelly {
  constructor({ nx = 150, nz = 132 } = {}) {
    this.nx = nx;
    this.nz = nz;
    const hx = INNER.hx, hz = INNER.hz;
    this.x0 = -hx;
    this.z0 = -hz;
    this.dx = (2 * hx) / (nx - 1);
    this.dz = (2 * hz) / (nz - 1);
    const N = nx * nz;
    this.h = new Float32Array(N);
    this.v = new Float32Array(N);
    this.a = new Float32Array(N);
    this.f = new Float32Array(N);
    this.mask = new Uint8Array(N);
    this.dome = new Float32Array(N);
    this.cellX = new Float32Array(N);
    this.cellZ = new Float32Array(N);

    this.params = { tension: 2.6, stiffness: 28, damping: 1.7, viscosity: 0.05 };
    this.slosh = { x: 0, z: 0 };
    this.presses = [];
    this.time = 0;
    this.acc = 0;

    const pos = new Float32Array(N * 3);
    const uv = new Float32Array(N * 2);
    const active = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = this.x0 + i * this.dx;
        const z = this.z0 + j * this.dz;
        this.cellX[k] = x;
        this.cellZ[k] = z;
        const s = waterSDF(x, z);
        if (s < -0.03 && i > 0 && j > 0 && i < nx - 1 && j < nz - 1) {
          this.mask[k] = 1;
          active.push(k);
        }
        this.dome[k] = BULGE * smoothstep(0, 1.3, -s);
        // Pull vertices outside the rounded rect onto its border so the mesh fits the tray.
        let px = x, pz = z;
        const sr = sdRoundRect(px, pz, hx, hz, INNER.r);
        if (sr > -0.004) {
          const e = 0.01;
          let gx = sdRoundRect(px + e, pz, hx, hz, INNER.r) - sdRoundRect(px - e, pz, hx, hz, INNER.r);
          let gz = sdRoundRect(px, pz + e, hx, hz, INNER.r) - sdRoundRect(px, pz - e, hx, hz, INNER.r);
          const l = Math.hypot(gx, gz) || 1;
          gx /= l; gz /= l;
          px -= gx * (sr + 0.004);
          pz -= gz * (sr + 0.004);
        }
        pos[k * 3] = px;
        pos[k * 3 + 1] = WATER_Y + this.dome[k];
        pos[k * 3 + 2] = pz;
        uv[k * 2] = (x - this.x0) / (2 * hx) * (hx / hz);
        uv[k * 2 + 1] = (z - this.z0) / (2 * hz);
      }
    }
    this.active = Int32Array.from(active);

    const index = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const col = new Float32Array(N * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, WATER_Y, 0), Math.hypot(hx, hz) + 1);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-hx, WATER_Y - 1, -hz), new THREE.Vector3(hx, WATER_Y + 1, hz));
    this.geometry = g;

    const ripple = makeRippleNormalMap(256, 7);
    ripple.repeat.set(3, 3);
    this.rippleMap = ripple;
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xc4fff7,
      vertexColors: true,
      roughness: 0.1,
      metalness: 0,
      transmission: 1,
      thickness: 0.55,
      ior: 1.3,
      attenuationColor: new THREE.Color(0x35cfc6),
      attenuationDistance: 2.2,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      specularIntensity: 1,
      sheen: 0.45,
      sheenColor: new THREE.Color(0xd4fff8),
      sheenRoughness: 0.35,
      iridescence: 0.2,
      iridescenceIOR: 1.3,
      normalMap: ripple,
      normalScale: new THREE.Vector2(0.22, 0.22),
      envMapIntensity: 1.2,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'jelly';
    this._updateGeometry();
  }

  // ---- interaction --------------------------------------------------------

  _forEachNear(x, z, r, fn) {
    const { nx, nz, x0, z0, dx, dz } = this;
    const reach = r * 2.2;
    const i0 = Math.max(1, Math.floor((x - reach - x0) / dx));
    const i1 = Math.min(nx - 2, Math.ceil((x + reach - x0) / dx));
    const j0 = Math.max(1, Math.floor((z - reach - z0) / dz));
    const j1 = Math.min(nz - 2, Math.ceil((z + reach - z0) / dz));
    const inv = 1 / (r * r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!this.mask[k]) continue;
        const ddx = this.cellX[k] - x, ddz = this.cellZ[k] - z;
        const d2 = (ddx * ddx + ddz * ddz) * inv;
        if (d2 > 4.8) continue;
        fn(k, Math.exp(-d2));
      }
    }
  }

  /** Acceleration applied for the current frame (negative pushes down). */
  addForce(x, z, r, amount) {
    const f = this.f;
    this._forEachNear(x, z, r, (k, w) => { f[k] += amount * w; });
  }

  /** Instant velocity kick (negative pushes down). */
  impulse(x, z, r, amount) {
    const v = this.v;
    this._forEachNear(x, z, r, (k, w) => { v[k] += amount * w; });
  }

  /** Hold a finger-like dent at (x, z) for this frame. */
  press(x, z, r, depth) {
    this.presses.push({ x, z, r, depth });
  }

  // ---- simulation ---------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.acc += Math.min(dt, 1 / 20);
    const sub = 1 / 120;
    let n = 0;
    while (this.acc >= sub && n < 6) {
      this._step(sub);
      this.acc -= sub;
      n++;
    }
    if (n >= 6) this.acc = 0;
    this.f.fill(0);
    this.presses.length = 0;
    this.rippleMap.offset.set(this.time * 0.012, this.time * 0.008);
    this._updateGeometry();
  }

  _step(dt) {
    const { h, v, a, f, nx, active, cellX, cellZ } = this;
    const p = this.params;
    const inv = 1 / (this.dx * this.dx);
    const c2 = p.tension * inv, k = p.stiffness, d = p.damping, nu = p.viscosity * inv;
    const sx = this.slosh.x / INNER.hx, sz = this.slosh.z / INNER.hz;
    for (let n = 0; n < active.length; n++) {
      const i = active[n];
      const lap = h[i - 1] + h[i + 1] + h[i - nx] + h[i + nx] - 4 * h[i];
      const lapv = v[i - 1] + v[i + 1] + v[i - nx] + v[i + nx] - 4 * v[i];
      a[i] = c2 * lap - k * h[i] - d * v[i] + nu * lapv + f[i] + sx * cellX[i] + sz * cellZ[i];
    }
    for (const pr of this.presses) {
      this._forEachNear(pr.x, pr.z, pr.r, (i, w) => {
        a[i] += w * (160 * (-pr.depth - h[i]) - 14 * v[i]);
      });
    }
    for (let n = 0; n < active.length; n++) {
      const i = active[n];
      v[i] += a[i] * dt;
      h[i] += v[i] * dt;
    }
  }

  _updateGeometry() {
    const { h, dome, nx, nz } = this;
    const pos = this.geometry.attributes.position.array;
    const nor = this.geometry.attributes.normal.array;
    const col = this.geometry.attributes.color.array;
    const N = nx * nz;
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] = WATER_Y + dome[i] + h[i];
      // tint by deformation: dents look deeper teal, crests look lighter
      const t = Math.max(-1, Math.min(1, h[i] * 5.5));
      if (t < 0) {
        col[i * 3] = 1 + t * 0.55;
        col[i * 3 + 1] = 1 + t * 0.22;
        col[i * 3 + 2] = 1 + t * 0.18;
      } else {
        col[i * 3] = 1 + t * 0.12;
        col[i * 3 + 1] = 1 + t * 0.12;
        col[i * 3 + 2] = 1 + t * 0.12;
      }
    }
    const idx2 = 1 / (2 * this.dx), idz2 = 1 / (2 * this.dz);
    for (let j = 0; j < nz; j++) {
      const jm = j > 0 ? j - 1 : j, jp = j < nz - 1 ? j + 1 : j;
      for (let i = 0; i < nx; i++) {
        const im = i > 0 ? i - 1 : i, ip = i < nx - 1 ? i + 1 : i;
        const k = j * nx + i;
        const gx = (pos[(j * nx + ip) * 3 + 1] - pos[(j * nx + im) * 3 + 1]) * idx2;
        const gz = (pos[(jp * nx + i) * 3 + 1] - pos[(jm * nx + i) * 3 + 1]) * idz2;
        const l = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        nor[k * 3] = -gx * l;
        nor[k * 3 + 1] = l;
        nor[k * 3 + 2] = -gz * l;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  // ---- queries ------------------------------------------------------------

  _heightRaw(x, z, withDome = true) {
    const { nx, nz, x0, z0, dx, dz, h } = this;
    const dome = withDome ? this.dome : this._zero || (this._zero = new Float32Array(h.length));
    let fx = (x - x0) / dx, fz = (z - z0) / dz;
    fx = Math.min(nx - 1.001, Math.max(0, fx));
    fz = Math.min(nz - 1.001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * nx + i;
    const a = h[k] + dome[k], b = h[k + 1] + dome[k + 1];
    const c = h[k + nx] + dome[k + nx], d = h[k + nx + 1] + dome[k + nx + 1];
    return WATER_Y + (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Surface height and slope at (x, z). Reuses `out` to avoid allocations. */
  sample(x, z, out = {}) {
    const e = 0.08;
    out.y = this._heightRaw(x, z);
    out.gx = (this._heightRaw(x + e, z) - this._heightRaw(x - e, z)) / (2 * e);
    out.gz = (this._heightRaw(x, z + e) - this._heightRaw(x, z - e)) / (2 * e);
    out.dgx = (this._heightRaw(x + e, z, false) - this._heightRaw(x - e, z, false)) / (2 * e);
    out.dgz = (this._heightRaw(x, z + e, false) - this._heightRaw(x, z - e, false)) / (2 * e);
    // vertical surface velocity (used to fling light objects)
    const { nx, x0, z0, dx, dz } = this;
    const i = Math.round((x - x0) / dx), j = Math.round((z - z0) / dz);
    const k = Math.min(Math.max(j, 0), this.nz - 1) * nx + Math.min(Math.max(i, 0), nx - 1);
    out.vy = this.v[k];
    return out;
  }

  energy() {
    let s = 0;
    for (let n = 0; n < this.active.length; n++) {
      const i = this.active[n];
      s += this.h[i] * this.h[i];
    }
    return Math.sqrt(s / this.active.length);
  }
}
