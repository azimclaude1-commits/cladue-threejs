import * as THREE from 'three';
import { waterSDF, waterNormal } from './layout.js';

const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _qTilt = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _s = {};

/**
 * Something resting on (or bouncing on) the jelly. It is held up by a stiff
 * spring proportional to how deep it sinks into the surface, and pushes the
 * jelly down by the same amount — so heavy things make dents and dropped
 * things bounce.
 */
export class Floater {
  constructor(object, opts = {}) {
    this.object = object;
    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.y = opts.y ?? 2;
    this.vx = opts.vx ?? 0;
    this.vz = opts.vz ?? 0;
    this.vy = opts.vy ?? 0;
    this.yaw = opts.yaw ?? 0;
    this.yawVel = 0;
    this.radius = opts.radius ?? 0.2; // collision radius vs. walls
    this.footprint = opts.footprint ?? this.radius; // dent radius on the jelly
    this.lift = opts.lift ?? 0; // object origin height above surface at rest
    this.weight = opts.weight ?? 1; // how hard it presses on the jelly
    this.spring = opts.spring ?? 260;
    this.springDamp = opts.springDamp ?? 9;
    this.slide = opts.slide ?? 2.2; // how much it slides down slopes
    this.drag = opts.drag ?? 1.4;
    this.tiltFollow = opts.tiltFollow ?? 8;
    this.tiltAmount = opts.tiltAmount ?? 1;
    this.restitution = opts.restitution ?? 0.5;
    this.ax = 0; // external horizontal acceleration (paddling)
    this.az = 0;
    this.inContact = false;
    this.airTime = 0;
    this.tilt = new THREE.Quaternion();
    this.onLand = null;
    this.anchor = opts.anchor ?? null; // e.g. a lily pad's stem
  }

  update(dt, jelly) {
    const s = jelly.sample(this.x, this.z, _s);

    // horizontal motion: slide downhill on the jelly, plus any paddling
    const contactF = this.inContact ? 1 : 0.05;
    const sgx = s.dgx + (s.gx - s.dgx) * 0.25;
    const sgz = s.dgz + (s.gz - s.dgz) * 0.25;
    this.vx += (-sgx * this.slide * 9.8 * contactF + this.ax) * dt;
    this.vz += (-sgz * this.slide * 9.8 * contactF + this.az) * dt;
    if (this.anchor) {
      this.vx += (this.anchor.x - this.x) * this.anchor.k * dt;
      this.vz += (this.anchor.z - this.z) * this.anchor.k * dt;
    }
    const damp = Math.exp(-this.drag * dt * (this.inContact ? 1 : 0.15));
    this.vx *= damp;
    this.vz *= damp;
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    const sd = waterSDF(nx, nz) + this.radius;
    if (sd > 0) {
      const [gx, gz] = waterNormal(nx, nz);
      nx -= gx * sd;
      nz -= gz * sd;
      const vn = this.vx * gx + this.vz * gz;
      if (vn > 0) {
        this.vx -= (1 + this.restitution) * vn * gx;
        this.vz -= (1 + this.restitution) * vn * gz;
      }
    }
    this.x = nx;
    this.z = nz;

    // vertical: gravity + jelly spring
    const surf = s.y + this.lift + 9.8 / this.spring;
    const pen = surf - this.y;
    this.vy -= 9.8 * dt;
    const wasInContact = this.inContact;
    if (pen > 0) {
      this.inContact = true;
      const relV = this.vy - s.vy;
      this.vy += (this.spring * pen - this.springDamp * relV) * dt;
      jelly.addForce(this.x, this.z, this.footprint, -this.weight * (6 + this.spring * pen * 0.35));
      if (!wasInContact && this.airTime > 0.25 && this.onLand) this.onLand(this, -this.vy);
      this.airTime = 0;
    } else {
      this.inContact = pen > -0.01;
      this.airTime += dt;
    }
    this.y += this.vy * dt;

    // tilt toward the surface normal
    _n.set(-s.gx * this.tiltAmount, 1, -s.gz * this.tiltAmount).normalize();
    _qTilt.setFromUnitVectors(UP, _n);
    this.tilt.slerp(_qTilt, 1 - Math.exp(-this.tiltFollow * dt));
    this.yaw += this.yawVel * dt;
    _qYaw.setFromAxisAngle(UP, this.yaw);
    this.object.position.set(this.x, this.y, this.z);
    this.object.quaternion.copy(this.tilt).multiply(_qYaw);
  }
}
