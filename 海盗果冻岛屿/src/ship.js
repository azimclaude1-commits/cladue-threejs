// The pirate ship at anchor: buoyancy on 10 points (heave, pitch, roll), a veering offshore
// breeze, an elastic anchor rode at the bow, weathervaning, towing, and recoil.
import { WATER, PLACES } from './world.js';
import { shipInfo, anchorInfo } from './geometry.js';
import { X } from './builder.js';

export class Ship {
  constructor(sea) {
    this.sea = sea;
    this.info = shipInfo();
    this.reset();
  }
  reset() {
    const p = PLACES.ship;
    this.x = p.x; this.z = p.z;
    this.vx = 0; this.vz = 0;
    // bow toward the anchor
    const a = anchorInfo().ring;
    const dx = a[0] - p.x, dz = a[2] - p.z;
    this.yaw = Math.atan2(-dz, dx); // RY(yaw) maps local +x to (cos, -sin)
    this.yawV = 0;
    this.heave = 0; this.heaveV = 0;
    this.pitch = 0; this.pitchV = 0;
    this.roll = 0; this.rollV = 0;
    this.tow = null;
    this.windAngle = Math.atan2(0.85, 0.5);
    this.time = 0;
    const hw = this.hawseWorld();
    this.rode = Math.hypot(a[0] - hw[0], a[2] - hw[2]) + 0.15;
    this.nextGun = { 1: 0, [-1]: 0 };
  }

  xf() {
    return X.mul(X.T(this.x, WATER + this.heave, this.z), X.RY(this.yaw), X.RZ(this.pitch), X.RX(this.roll));
  }
  toWorld(p) { return X.p(this.xf(), p); }
  dirToWorld(d) { const m = this.xf().m; return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[3] * d[0] + m[4] * d[1] + m[5] * d[2], m[6] * d[0] + m[7] * d[1] + m[8] * d[2]]; }
  hawseWorld() { return this.toWorld(this.info.hawse); }

  wind() {
    const a = this.windAngle;
    return [Math.cos(a), Math.sin(a)];
  }

  update(dt, windStrength = 1) {
    this.time += dt;
    const sea = this.sea;
    // gently veering offshore breeze
    this.windAngle = Math.atan2(0.85, 0.5) + 0.32 * Math.sin(this.time * 0.07) + 0.12 * Math.sin(this.time * 0.23 + 1);
    const w = this.wind();
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const bow = [c, -s];

    // ---- horizontal forces
    let fx = w[0] * 0.05 * windStrength, fz = w[1] * 0.05 * windStrength;
    const sp = Math.hypot(this.vx, this.vz);
    fx -= this.vx * (0.9 + 2.5 * sp); fz -= this.vz * (0.9 + 2.5 * sp);
    // anchor rode: elastic once taut
    const hw = this.hawseWorld();
    const ring = anchorInfo().ring;
    const rx = ring[0] - hw[0], rz = ring[2] - hw[2];
    const rl = Math.hypot(rx, rz);
    let torque = 0;
    if (rl > this.rode) {
      const k = (rl - this.rode) * 6;
      const tx = (rx / rl) * k, tz = (rz / rl) * k;
      fx += tx; fz += tz;
      // torque about the ship centre from pulling at the bow
      const ox = hw[0] - this.x, oz = hw[2] - this.z;
      torque += -(ox * tz - oz * tx) * 0.9;
    }
    if (this.tow) {
      fx += (this.tow[0] - this.x) * 6 - this.vx * 2;
      fz += (this.tow[1] - this.z) * 6 - this.vz * 2;
    }
    this.vx += fx * dt; this.vz += fz * dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // stay inside the block
    const lim = 2.6 - 0.75;
    if (Math.abs(this.x) > lim) { this.x = Math.sign(this.x) * lim; this.vx *= -0.3; }
    if (Math.abs(this.z) > lim) { this.z = Math.sign(this.z) * lim; this.vz *= -0.3; }

    // ---- weathervane: bow turns into the wind
    const up = [-w[0], -w[1]];
    const cross = bow[0] * up[1] - bow[1] * up[0];
    const dotp = bow[0] * up[0] + bow[1] * up[1];
    const ang = Math.atan2(cross, dotp); // positive: rotate bow toward "up" counter-clockwise in x-z
    torque += -ang * 0.35 * windStrength; // RY positive turns +x toward -z
    this.yawV += (torque - this.yawV * 1.6) * dt;
    this.yaw += this.yawV * dt;

    // ---- buoyancy: heave, pitch, roll
    const xf = this.xf();
    let F = 0, Tp = 0, Tr = 0;
    const kb = 9.8 / (10 * 0.06);
    for (const p of this.info.buoy) {
      const wp = X.p(xf, p);
      const surf = WATER + sea.height(wp[0], wp[2]);
      const sub = Math.max(0, Math.min(0.25, surf - wp[1]));
      const f = kb * sub;
      F += f; Tp += f * p[0]; Tr += -f * p[2];
    }
    this.heaveV += (F - 9.8 - this.heaveV * 3.2) * dt;
    this.heave += this.heaveV * dt;
    this.pitchV += (Tp * 9 - this.pitch * 2 - this.pitchV * 3.5) * dt;
    this.pitch += this.pitchV * dt;
    this.rollV += (Tr * 26 - this.roll * 2 - this.rollV * 2.2) * dt;
    this.roll += this.rollV * dt;
    this.pitch = Math.max(-0.4, Math.min(0.4, this.pitch));
    this.roll = Math.max(-0.6, Math.min(0.6, this.roll));

    // her displaced volume goes back to the sea -> a wake
    sea.addFootprint(this.x, this.z, this.yaw, 0.62, 0.2, 0.13 + this.heave * -0.5);
  }

  /** Which broadside faces the camera (block-local camera position). */
  sideFacing(cam) {
    const n = this.dirToWorld([0, 0, 1]);
    return (cam[0] - this.x) * n[0] + (cam[2] - this.z) * n[2] > 0 ? 1 : -1;
  }

  /** Fire the next gun on a side. Returns {pos, vel, dir} in block space. */
  fire(side) {
    const guns = this.info.guns.filter((g) => g.side === side);
    const g = guns[this.nextGun[side] % guns.length];
    this.nextGun[side]++;
    const pos = this.toWorld(g.pos);
    const d = this.dirToWorld([0, 0.35, side]);
    const l = Math.hypot(...d);
    const dir = d.map((x) => x / l);
    // recoil: heel away from the shot
    this.rollV += side * 1.4;
    this.vx -= dir[0] * 0.05; this.vz -= dir[2] * 0.05;
    return { pos, dir, vel: [dir[0] * 2.6 + this.vx, dir[1] * 2.6, dir[2] * 2.6 + this.vz] };
  }
}
