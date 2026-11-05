// Box-rigged people: a pelvis, torso, head and hat, with arms and legs solved by two-bone IK.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const matCache = new Map();
export function mat(hex) {
  if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
  return matCache.get(hex);
}
function box(w, h, d, hex) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
  m.castShadow = true;
  return m;
}
/** A unit-height box we can stretch between two points. */
function segment(t, hex) {
  const g = new THREE.BoxGeometry(t, 1, t);
  const m = new THREE.Mesh(g, mat(hex));
  m.castShadow = true;
  return m;
}
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
function place(seg, a, b) {
  _d.subVectors(b, a);
  const L = _d.length();
  seg.position.addVectors(a, b).multiplyScalar(0.5);
  seg.scale.set(1, Math.max(L, 1e-3), 1);
  seg.quaternion.setFromUnitVectors(UP, _d.normalize());
}

/** Two-bone IK: returns the middle joint for root -> target with lengths a, b, bending toward pole. */
export function ik2(root, target, a, b, pole, outJoint, outEnd) {
  const d = new THREE.Vector3().subVectors(target, root);
  let len = d.length();
  const dir = len > 1e-6 ? d.clone().divideScalar(len) : new THREE.Vector3(0, -1, 0);
  len = Math.min(Math.max(len, Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const cosA = (a * a + len * len - b * b) / (2 * a * len);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  outJoint.copy(root).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  outEnd.copy(root).addScaledVector(dir, len);
}

let nextId = 1;
export class Person {
  constructor({ shirt = '#224b77', trousers = '#2c313b', skin = '#c08761', hat = 'beanie', hatColor = '#c54236', boots = '#1b1f27', scale = 1, beard = false, apron = null } = {}) {
    this.id = nextId++;
    this.s = scale;
    const s = scale;
    this.group = new THREE.Group();
    this.root = new THREE.Group(); // hips frame (moves with the pose)
    this.group.add(this.root);
    this.dims = { thigh: 0.46 * s, shin: 0.46 * s, upper: 0.32 * s, fore: 0.3 * s, shoulderY: 0.56 * s, shoulderX: 0.22 * s, hipX: 0.11 * s };
    this.pelvis = box(0.36 * s, 0.18 * s, 0.22 * s, trousers); this.root.add(this.pelvis);
    this.torso = new THREE.Group(); this.root.add(this.torso);
    const chest = box(0.44 * s, 0.52 * s, 0.26 * s, shirt); chest.position.y = 0.32 * s; this.torso.add(chest);
    if (apron) { const ap = box(0.36 * s, 0.6 * s, 0.03 * s, apron); ap.position.set(0, 0.24 * s, 0.14 * s); this.torso.add(ap); }
    this.head = new THREE.Group(); this.head.position.y = 0.66 * s; this.torso.add(this.head);
    const face = box(0.3 * s, 0.3 * s, 0.28 * s, skin); face.position.y = 0.12 * s; this.head.add(face);
    const eyes = box(0.2 * s, 0.04 * s, 0.02 * s, '#0b0d12'); eyes.position.set(0, 0.16 * s, 0.145 * s); this.head.add(eyes);
    if (beard) { const b = box(0.3 * s, 0.12 * s, 0.06 * s, '#d6aa78'); b.position.set(0, 0.0, 0.13 * s); this.head.add(b); }
    if (hat === 'souwester') {
      const h = box(0.36 * s, 0.14 * s, 0.34 * s, hatColor); h.position.y = 0.31 * s; this.head.add(h);
      const brim = box(0.46 * s, 0.04 * s, 0.5 * s, hatColor); brim.position.set(0, 0.25 * s, -0.04 * s); this.head.add(brim);
    } else if (hat === 'beanie') {
      const h = box(0.32 * s, 0.14 * s, 0.3 * s, hatColor); h.position.y = 0.32 * s; this.head.add(h);
    } else if (hat === 'cap') {
      const h = box(0.32 * s, 0.08 * s, 0.32 * s, hatColor); h.position.y = 0.3 * s; this.head.add(h);
      const peak = box(0.28 * s, 0.03 * s, 0.14 * s, hatColor); peak.position.set(0, 0.27 * s, 0.2 * s); this.head.add(peak);
    } else if (hat === 'hair') {
      const h = box(0.32 * s, 0.1 * s, 0.3 * s, hatColor); h.position.set(0, 0.3 * s, -0.02 * s); this.head.add(h);
    }
    const lim = (t, c) => { const m = segment(t * s, c); this.group.add(m); return m; };
    this.armL = [lim(0.13, shirt), lim(0.11, shirt)]; this.armR = [lim(0.13, shirt), lim(0.11, shirt)];
    this.handL = box(0.1 * s, 0.1 * s, 0.1 * s, skin); this.handR = box(0.1 * s, 0.1 * s, 0.1 * s, skin);
    this.group.add(this.handL, this.handR);
    this.legL = [lim(0.15, trousers), lim(0.13, trousers)]; this.legR = [lim(0.15, trousers), lim(0.13, trousers)];
    this.footL = box(0.13 * s, 0.09 * s, 0.24 * s, boots); this.footR = box(0.13 * s, 0.09 * s, 0.24 * s, boots);
    this.group.add(this.footL, this.footR);
    // pose (all in the person's local frame: x right, y up, z forward)
    this.pose = {
      hip: new THREE.Vector3(0, 0.92 * s, 0), lean: 0, twist: 0, headYaw: 0, headPitch: 0,
      handL: new THREE.Vector3(-0.25 * s, 0.85 * s, 0.1 * s), handR: new THREE.Vector3(0.25 * s, 0.85 * s, 0.1 * s),
      footL: new THREE.Vector3(-0.12 * s, 0.05 * s, 0), footR: new THREE.Vector3(0.12 * s, 0.05 * s, 0),
      kneePole: new THREE.Vector3(0, 0, 1), elbowPole: new THREE.Vector3(0, -0.4, -1),
    };
    this.walkPhase = 0;
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), j: new THREE.Vector3(), e: new THREE.Vector3() };
  }

  // ---- pose presets -------------------------------------------------------------
  stand() {
    const s = this.s, p = this.pose;
    p.hip.set(0, 0.92 * s, 0); p.lean = 0;
    p.footL.set(-0.12 * s, 0.05 * s, 0); p.footR.set(0.12 * s, 0.05 * s, 0);
    p.kneePole.set(0, 0, 1);
  }
  sitEdge(swing = 0) {
    const s = this.s, p = this.pose;
    p.hip.set(0, 0.1 * s, -0.05 * s); p.lean = -0.05;
    p.footL.set(-0.13 * s, -0.42 * s + Math.sin(swing) * 0.02, 0.48 * s + Math.sin(swing) * 0.1 * s);
    p.footR.set(0.13 * s, -0.42 * s + Math.sin(swing + 2) * 0.02, 0.48 * s + Math.sin(swing + 2) * 0.1 * s);
    p.kneePole.set(0, 1, 1);
  }
  sitStool(h = 0.62) {
    const s = this.s, p = this.pose;
    p.hip.set(0, h * s, -0.02 * s); p.lean = 0.05;
    p.footL.set(-0.15 * s, 0.05 * s, 0.4 * s); p.footR.set(0.15 * s, 0.05 * s, 0.38 * s);
    p.kneePole.set(0, 1, 1);
  }
  walk(dt, speed) {
    const s = this.s, p = this.pose;
    this.walkPhase += dt * speed * 6.5 / s;
    const ph = this.walkPhase, st = 0.22 * s * Math.min(1, speed);
    p.hip.set(0, 0.9 * s + Math.abs(Math.cos(ph)) * 0.04 * s, 0); p.lean = 0.06;
    p.footL.set(-0.12 * s, 0.05 * s + Math.max(0, Math.sin(ph)) * 0.12 * s, Math.cos(ph) * st);
    p.footR.set(0.12 * s, 0.05 * s + Math.max(0, -Math.sin(ph)) * 0.12 * s, -Math.cos(ph) * st);
    p.kneePole.set(0, 0, 1);
    return ph;
  }
  armsSwing(ph) {
    const s = this.s, p = this.pose;
    p.handL.set(-0.27 * s, p.hip.y + 0.0, -Math.cos(ph) * 0.18 * s);
    p.handR.set(0.27 * s, p.hip.y + 0.0, Math.cos(ph) * 0.18 * s);
    p.elbowPole.set(0, -0.2, -1);
  }
  armsRest() {
    const s = this.s, p = this.pose;
    p.handL.set(-0.27 * s, p.hip.y - 0.02 * s, 0.02 * s); p.handR.set(0.27 * s, p.hip.y - 0.02 * s, 0.02 * s);
    p.elbowPole.set(0, 0, -1);
  }
  /** set hand targets from world points */
  handsWorld(l, r) {
    this.group.updateMatrixWorld();
    this.pose.handL.copy(l); this.group.worldToLocal(this.pose.handL);
    this.pose.handR.copy(r); this.group.worldToLocal(this.pose.handR);
  }
  localToWorld(v) { this.group.updateMatrixWorld(); return this.group.localToWorld(v.clone()); }

  update() {
    const p = this.pose, d = this.dims, t = this.tmp;
    this.root.position.copy(p.hip);
    this.root.rotation.set(0, p.twist, 0);
    this.torso.rotation.set(p.lean, 0, 0);
    this.head.rotation.set(p.headPitch, p.headYaw, 0);
    this.root.updateMatrixWorld(true);
    // shoulders and hips in the group frame
    for (const side of [-1, 1]) {
      const sh = this.torso.localToWorld(t.a.set(side * d.shoulderX, d.shoulderY, 0));
      this.group.worldToLocal(sh);
      const hand = side < 0 ? p.handL : p.handR;
      const pole = p.elbowPole.clone(); pole.x += side * 0.6;
      ik2(sh, hand, d.upper, d.fore, pole, t.j, t.e);
      const arm = side < 0 ? this.armL : this.armR;
      place(arm[0], sh, t.j); place(arm[1], t.j, t.e);
      (side < 0 ? this.handL : this.handR).position.copy(t.e);
      const hp = t.b.set(p.hip.x + side * d.hipX, p.hip.y - 0.06 * this.s, p.hip.z);
      const foot = side < 0 ? p.footL : p.footR;
      const kp = p.kneePole.clone(); kp.x += side * 0.1;
      ik2(hp, foot, d.thigh, d.shin, kp, t.j, t.e);
      const leg = side < 0 ? this.legL : this.legR;
      place(leg[0], hp, t.j); place(leg[1], t.j, t.e);
      const f = side < 0 ? this.footL : this.footR;
      f.position.set(t.e.x, t.e.y - 0.0, t.e.z + 0.05 * this.s);
    }
  }
}

/** Walk a person along a polyline of [x, z] points; returns true when done. */
export class Walker {
  constructor(person, y = 0) { this.p = person; this.path = []; this.speed = 1.3; this.y = y; }
  go(path, speed = 1.3) { this.path = path.slice(); this.speed = speed; }
  get busy() { return this.path.length > 0; }
  step(dt) {
    const g = this.p.group;
    if (!this.path.length) return true;
    const [tx, tz, ty] = this.path[0];
    const dx = tx - g.position.x, dz = tz - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (ty !== undefined) g.position.y += (ty - g.position.y) * Math.min(1, dt * 4);
    if (dist < 0.08) { this.path.shift(); return !this.path.length; }
    const yaw = Math.atan2(dx, dz);
    let dy = yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(1, dt * 8);
    const st = Math.min(dist, this.speed * dt);
    g.position.x += (dx / dist) * st; g.position.z += (dz / dist) * st;
    const ph = this.p.walk(dt, this.speed);
    return ph;
  }
}
