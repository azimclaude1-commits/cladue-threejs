import * as THREE from 'three';
import { WATER_Y } from './layout.js';

const SKIN = 0xe9b48d;
const CLOTHES = [0x2f3f63, 0x7a3d2e, 0x5a4636, 0x384c6e, 0x9b4a2c, 0x2c2c3a, 0xb36a3a];

function makeHull(L, B) {
  const NI = 48, NJ = 18;
  const pos = [], col = [], idx = [];
  const wood = new THREE.Color(0xb47a48), woodDark = new THREE.Color(0x7d4b2b), trim = new THREE.Color(0x5b3320);
  const c = new THREE.Color();
  for (let i = 0; i <= NI; i++) {
    const t = -1 + (2 * i) / NI;
    const at = Math.abs(t);
    const w = B * Math.pow(Math.max(0, 1 - Math.pow(at, 2.4)), 0.55);
    const top = 0.15 + 0.15 * Math.pow(at, 3);
    const bot = -0.06 + 0.18 * Math.pow(at, 4);
    for (let j = 0; j <= NJ; j++) {
      const th = (Math.PI * j) / NJ;
      const z = -w * Math.cos(th);
      const y = top - (top - bot) * Math.pow(Math.sin(th), 0.6);
      pos.push(t * L, y, z);
      const edge = j <= 1 || j >= NJ - 1;
      const plank = Math.floor((y - bot) / 0.045) % 2;
      c.copy(edge ? trim : plank ? wood : woodDark.clone().lerp(wood, 0.6));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NI; i++) {
    for (let j = 0; j < NJ; j++) {
      const a = i * (NJ + 1) + j, b = a + 1, d = a + NJ + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function person(color, { standing = false } = {}) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1d1a1a, roughness: 0.6 });
  const bodyH = standing ? 0.14 : 0.06;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, bodyH, 4, 10), cloth);
  body.position.y = 0.05 + bodyH / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), skin);
  head.position.y = 0.1 + bodyH + 0.05;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.047, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.copy(head.position);
  cap.rotation.x = -0.25;
  for (const m of [body, head, cap]) { m.castShadow = true; g.add(m); }
  g.userData.headY = head.position.y;
  return g;
}

function roof(cx, len, y, span, pitch, matTop, matTrim) {
  const g = new THREE.Group();
  const mats = [matTrim, matTrim, matTop, matTrim, matTrim, matTrim];
  for (const side of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.022, span), mats);
    b.rotation.x = side * pitch;
    b.position.set(cx, y - Math.sin(pitch) * span * 0.5, side * Math.cos(pitch) * span * 0.5);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

/**
 * A small wooden canopy boat (about 2.4 units long — noticeably smaller than
 * in the reference so the river feels wider). It cruises a loop, rides the
 * jelly's height and slope, and its weight presses a moving dent into the jelly.
 */
export function buildBoat() {
  const L = 0.95, B = 0.26;
  const S = 1.25; // overall scale
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts/bobs
  body.scale.setScalar(S);
  root.add(body);

  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
  const hull = new THREE.Mesh(makeHull(L, B), woodMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  body.add(hull);

  // deck
  const deckShape = new THREE.Shape();
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = -0.86 + (1.72 * i) / N;
    const w = B * 0.86 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.4)), 0.55);
    if (i === 0) deckShape.moveTo(t * L, w); else deckShape.lineTo(t * L, w);
  }
  for (let i = N; i >= 0; i--) {
    const t = -0.86 + (1.72 * i) / N;
    const w = B * 0.86 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.4)), 0.55);
    deckShape.lineTo(t * L, -w);
  }
  const deckGeo = new THREE.ShapeGeometry(deckShape);
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0xc89663, roughness: 0.7 }));
  deck.position.y = 0.03;
  deck.receiveShadow = true;
  body.add(deck);

  // canopies
  const roofTop = new THREE.MeshStandardMaterial({ color: 0x5b9a8c, roughness: 0.55 });
  const roofTrim = new THREE.MeshStandardMaterial({ color: 0x2c3a58, roughness: 0.6 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.7 });
  const canopy = (x0, x1, y) => {
    for (const x of [x0 + 0.03, x1 - 0.03]) {
      for (const z of [-0.19, 0.19]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, y - 0.03, 6), postMat);
        p.position.set(x, 0.03 + (y - 0.03) / 2, z);
        p.castShadow = true;
        body.add(p);
      }
    }
    // little railing
    const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.012, 0.012), postMat);
    for (const z of [-0.19, 0.19]) {
      const r = rail.clone();
      r.position.set((x0 + x1) / 2, 0.17, z);
      body.add(r);
    }
    body.add(roof((x0 + x1) / 2, x1 - x0 + 0.1, y + 0.07, 0.27, 0.3, roofTop, roofTrim));
  };
  canopy(-0.08, 0.5, 0.36);
  canopy(-0.62, -0.1, 0.44);

  // passengers
  const seats = [[0.08, -0.1], [0.08, 0.1], [0.28, -0.1], [0.3, 0.1], [-0.45, 0.09], [-0.27, -0.1], [-0.25, 0.1]];
  seats.forEach(([x, z], i) => {
    const p = person(CLOTHES[i % CLOTHES.length]);
    p.position.set(x, 0.03, z);
    p.rotation.y = z > 0 ? -Math.PI / 2 + 0.3 : Math.PI / 2 - 0.3;
    body.add(p);
  });

  // stern rower with a sculling oar
  const rower = person(0x8a3f24, { standing: true });
  rower.position.set(-0.78, 0.08, 0.05);
  rower.rotation.y = -Math.PI / 2;
  body.add(rower);
  const oarPivot = new THREE.Group();
  oarPivot.position.set(-0.88, 0.3, 0.1);
  const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.95, 6), postMat);
  oar.rotation.z = Math.PI / 2;
  oar.position.x = -0.47;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.05), postMat);
  blade.position.x = -0.92;
  oarPivot.add(oar, blade);
  oarPivot.rotation.z = 0.42;
  oar.castShadow = blade.castShadow = true;
  body.add(oarPivot);

  // bow pole-man
  const bowman = person(0x324a72, { standing: true });
  bowman.position.set(0.68, 0.06, -0.05);
  bowman.rotation.y = Math.PI / 2;
  body.add(bowman);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 6), postMat);
  pole.position.set(0.72, 0.3, -0.16);
  pole.rotation.set(0.5, 0, -0.3);
  pole.castShadow = true;
  body.add(pole);

  // ---- motion -----------------------------------------------------------
  const path = (s, out) => {
    out.x = -0.35 + 2.55 * Math.cos(s) + 0.25 * Math.sin(2 * s);
    out.z = -0.45 + 1.45 * Math.sin(s);
    return out;
  };
  const state = {
    s: 0.6, speed: 0.085, y: WATER_Y + 0.2, vy: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, heading: 0,
    strokeT: 0,
  };
  const p0 = {}, p1 = {}, smp = {};

  function update(dt, t, jelly) {
    state.s += state.speed * dt;
    path(state.s, p0);
    path(state.s + 0.01, p1);
    state.heading = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
    const ch = Math.cos(state.heading), sh = -Math.sin(state.heading);
    // sample the jelly under bow, stern, port, starboard
    const h = (fx, fz) => jelly.sample(p0.x + S * (ch * fx - sh * fz), p0.z + S * (sh * fx + ch * fz), smp).y;
    const yb = h(0.7, 0), ys = h(-0.7, 0), yp = h(0, -0.2), yq = h(0, 0.2), yc = h(0, 0);
    const target = (yb + ys + yp + yq + yc * 2) / 6 + 0.01;
    // springy follow -> the boat bounces on the jelly
    state.vy += ((target - state.y) * 140 - state.vy * 7) * dt;
    state.y += state.vy * dt;
    const tp = Math.atan2(yb - ys, 1.4 * S), tr = Math.atan2(yq - yp, 0.4 * S);
    state.pitchV += ((tp - state.pitch) * 90 - state.pitchV * 6) * dt;
    state.rollV += ((tr - state.roll) * 90 - state.rollV * 6) * dt;
    state.pitch += state.pitchV * dt;
    state.roll += state.rollV * dt;

    root.position.set(p0.x, 0, p0.z);
    root.rotation.y = state.heading;
    body.position.y = state.y;
    body.rotation.set(-state.roll * 0.8, 0, state.pitch * 0.8);

    // the hull presses on the jelly
    for (const fx of [-0.6, 0, 0.6]) {
      jelly.addForce(p0.x + ch * fx * S, p0.z + sh * fx * S, 0.34, -7);
    }
    // sculling oar
    const stroke = Math.sin(t * 2.2);
    oarPivot.rotation.y = stroke * 0.35;
    rower.rotation.z = stroke * 0.05;
    state.strokeT += dt;
    if (state.strokeT > Math.PI / 2.2) {
      state.strokeT = 0;
      const ox = -1.7 * S, oz = (0.1 + stroke * 0.3) * S;
      jelly.impulse(p0.x + ch * ox - sh * oz, p0.z + sh * ox + ch * oz, 0.13, -0.9);
    }
  }

  return { group: root, update, get position() { return root.position; } };
}
