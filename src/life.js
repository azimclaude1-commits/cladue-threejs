import * as THREE from 'three';
import { Floater } from './floaters.js';
import { INNER, WATER_Y, FLOOR_Y, isWater, waterSDF, waterNormal, randomWaterPoint } from './layout.js';
import { makeRockGeometry, mulberry32 } from './utils.js';

const tmpV = new THREE.Vector3();

// ---------------------------------------------------------------- models --

function lilyPad(r, rand) {
  const g = new THREE.Group();
  const notch = 0.35 + rand() * 0.2;
  const geo = new THREE.CylinderGeometry(r, r * 0.97, 0.018, 36, 1, false, notch / 2, Math.PI * 2 - notch);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, pos.getY(i) + 0.03 * (1 - (x * x + z * z) / (r * r)) * 0.6);
  }
  geo.computeVertexNormals();
  const shade = new THREE.Color().setHSL(0.25 + rand() * 0.05, 0.6, 0.2 + rand() * 0.06);
  const mat = new THREE.MeshStandardMaterial({ color: shade, roughness: 0.45 });
  const pad = new THREE.Mesh(geo, mat);
  pad.castShadow = true;
  pad.receiveShadow = true;
  g.add(pad);
  return g;
}

function lotus(scale = 1, bud = false) {
  const g = new THREE.Group();
  const petalGeo = new THREE.SphereGeometry(1, 12, 10);
  petalGeo.translate(0, 1, 0);
  const outer = new THREE.MeshStandardMaterial({ color: 0xf59ab8, roughness: 0.5 });
  const inner = new THREE.MeshStandardMaterial({ color: 0xffd5e2, roughness: 0.5 });
  const rings = bud ? [[5, 0.25, outer]] : [[8, 1.0, outer], [6, 0.55, inner], [5, 0.2, inner]];
  rings.forEach(([n, tilt, mat], ri) => {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(petalGeo, mat);
      p.scale.set(0.028, 0.055 - ri * 0.006, 0.014);
      const a = (i / n) * Math.PI * 2 + ri * 0.4;
      p.rotation.set(0, -a, 0);
      p.rotateZ(tilt);
      p.castShadow = true;
      g.add(p);
    }
  });
  if (!bud) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 }));
    c.position.y = 0.035;
    g.add(c);
  }
  g.scale.setScalar(scale);
  return g;
}

function duck(adult) {
  const g = new THREE.Group();
  const bodyCol = adult ? 0xf7f3ea : 0xffd84a;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.6 });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.5 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), bodyMat);
  body.scale.set(0.14, 0.08, 0.095);
  body.position.y = 0.045;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), bodyMat);
  head.position.set(0.1, 0.15, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 10), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.scale.set(1, 1, 0.6);
  beak.position.set(0.18, 0.14, 0);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 8), bodyMat);
  tail.rotation.z = Math.PI / 2 + 0.6;
  tail.position.set(-0.14, 0.09, 0);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), eyeMat);
    e.position.set(0.14, 0.165, s * 0.04);
    g.add(e);
  }
  for (const m of [body, head, beak, tail]) { m.castShadow = true; g.add(m); }
  const inner = new THREE.Group();
  inner.add(g);
  inner.scale.setScalar(adult ? 1 : 0.55);
  return inner;
}

function koi(rand) {
  const g = new THREE.Group();
  const bodyGeo = new THREE.SphereGeometry(1, 24, 14);
  const pos = bodyGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const orange = new THREE.Color(rand() < 0.5 ? 0xff6a1f : 0xf2501a);
  const white = new THREE.Color(0xfbf4ea);
  const black = new THREE.Color(0x222222);
  const seed = rand() * 10;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // taper toward the tail
    const k = x < 0 ? 1 + x * 0.55 : 1 - x * x * 0.15;
    pos.setXYZ(i, x, y * k, z * k);
    const n = Math.sin(x * 5 + seed) * Math.cos(z * 4 + seed * 2) + Math.sin(y * 6 - seed);
    const c = n > 0.25 ? orange : n < -1.1 ? black : white;
    col.set([c.r, c.g, c.b], i * 3);
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }));
  body.scale.set(0.17, 0.045, 0.055);
  g.add(body);
  const finMat = new THREE.MeshStandardMaterial({ color: orange, roughness: 0.5, side: THREE.DoubleSide });
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.quadraticCurveTo(-0.08, 0.07, -0.12, 0.07);
  tailShape.quadraticCurveTo(-0.08, 0, -0.12, -0.07);
  tailShape.quadraticCurveTo(-0.08, -0.07, 0, 0);
  const tailPivot = new THREE.Group();
  tailPivot.position.x = -0.15;
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), finMat);
  tail.rotation.x = Math.PI / 2;
  tailPivot.add(tail);
  g.add(tailPivot);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.CircleGeometry(0.03, 8, 0, Math.PI), finMat);
    fin.rotation.set(-Math.PI / 2, 0, s > 0 ? Math.PI * 0.7 : -Math.PI * 0.7);
    fin.position.set(0.05, -0.02, s * 0.045);
    g.add(fin);
  }
  g.userData.tail = tailPivot;
  return g;
}

function mapleLeafGeometry() {
  const s = new THREE.Shape();
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const lobes = Math.pow(Math.abs(Math.cos((th * 5) / 2)), 2.5);
    const r = 0.45 + 0.55 * lobes - 0.25 * Math.max(0, -Math.sin(th)) * (1 - lobes);
    const x = Math.cos(th + Math.PI / 2) * r, y = Math.sin(th + Math.PI / 2) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ShapeGeometry(s, 4);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.12 * (x * x + z * z));
  }
  g.computeVertexNormals();
  g.scale(0.085, 0.085, 0.085);
  return g;
}

// ---------------------------------------------------------------- build --

export function buildLife({ jelly, tree, boat, rand = mulberry32(21) }) {
  const group = new THREE.Group();
  const floaters = [];

  // lily pads + lotus
  const padSpots = [[-3.6, -2.6], [-3.1, -3.2], [-3.9, -1.6], [-2.4, -3.4], [1.8, 1.6], [2.4, 2.0], [-1.0, 1.9], [4.1, -0.6], [3.7, 0.2]];
  padSpots.forEach(([x, z], i) => {
    if (!isWater(x, z, 0.35)) return;
    const r = 0.2 + rand() * 0.13;
    const obj = lilyPad(r, rand);
    if (i % 3 === 0) {
      const f = lotus(1 + rand() * 0.3);
      f.position.set(r * 0.1, 0.02, r * 0.1);
      obj.add(f);
    } else if (i % 4 === 1) {
      const b = lotus(0.9, true);
      b.position.set(-r * 0.2, 0.02, 0);
      obj.add(b);
    }
    group.add(obj);
    floaters.push(new Floater(obj, {
      x, z, y: WATER_Y + 0.3, yaw: rand() * 6, radius: r * 0.8, footprint: r, lift: 0.03,
      weight: 0.25, slide: 1.6, drag: 1.6, spring: 220, anchor: { x, z, k: 1.2 },
    }));
  });

  // ducks: a mother and three ducklings
  const ducks = [];
  for (let i = 0; i < 4; i++) {
    const obj = duck(i === 0);
    group.add(obj);
    const fl = new Floater(obj, {
      x: -2.4 - i * 0.3, z: 1.1, y: WATER_Y + 0.3, radius: i === 0 ? 0.15 : 0.08, footprint: 0.15,
      lift: -0.02, weight: i === 0 ? 0.6 : 0.25, slide: 1.4, drag: 2.2, spring: 240, tiltAmount: 1.3,
    });
    fl.heading = 0;
    ducks.push(fl);
    floaters.push(fl);
  }

  // koi under the jelly
  const fish = [];
  for (let i = 0; i < 6; i++) {
    const obj = koi(rand);
    const [x, z] = randomWaterPoint(rand, 0.6);
    obj.position.set(x, 0.3, z);
    group.add(obj);
    fish.push({ obj, x, z, y: 0.25 + rand() * 0.15, heading: rand() * 6.28, speed: 0.25 + rand() * 0.2, phase: rand() * 10, rise: 0, riseCd: 4 + rand() * 10 });
  }

  // seaweed swaying on the floor
  const swayUniforms = { uTime: { value: 0 } };
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x3c9a5e, roughness: 0.6 });
  weedMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hh = clamp(position.y / 0.5 + 0.5, 0.0, 1.0);
        float ph = modelMatrix[3].x * 3.1 + modelMatrix[3].z * 1.7;
        transformed.x += sin(uTime * 1.4 + ph + position.y * 6.0) * 0.06 * hh * hh;
        transformed.z += cos(uTime * 1.1 + ph * 1.3 + position.y * 5.0) * 0.05 * hh * hh;`);
  };
  const weedBases = [];
  for (let i = 0; i < 18; i++) {
    const [x, z] = randomWaterPoint(rand, 0.35);
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const h = 0.22 + rand() * 0.22;
      const geo = new THREE.CylinderGeometry(0.004, 0.022, h, 5, 8);
      const m = new THREE.Mesh(geo, weedMat);
      m.position.set(x + (rand() - 0.5) * 0.12, FLOOR_Y + h / 2, z + (rand() - 0.5) * 0.12);
      m.scale.set(1, 1, 0.4);
      m.rotation.y = rand() * 6;
      group.add(m);
    }
    weedBases.push([x, z]);
  }

  // pebbles on the jelly floor
  const pebbleGeo = makeRockGeometry(4, { detail: 2, lump: 0.15, base: '#ffffff', dark: '#d8d8d8' });
  const pebbleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, 90);
  const pebbleCols = ['#f3efe6', '#c9c2b6', '#9aa3a0', '#d98d5c', '#e7c07a', '#7d8f8a'];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (let i = 0; i < 90; i++) {
    const [x, z] = randomWaterPoint(rand, 0.15);
    const s = 0.035 + rand() * 0.05;
    e.set(0, rand() * 6, 0);
    q.setFromEuler(e);
    sc.set(s * 1.3, s * 0.6, s);
    m4.compose(tmpV.set(x, FLOOR_Y + s * 0.3, z), q, sc);
    pebbles.setMatrixAt(i, m4);
    pebbles.setColorAt(i, new THREE.Color(pebbleCols[Math.floor(rand() * pebbleCols.length)]));
  }
  pebbles.receiveShadow = true;
  group.add(pebbles);

  // rising bubbles (pop as little bumps on the jelly)
  const NB = 36;
  const bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xeafffb, roughness: 0.05, clearcoat: 1, emissive: 0x3aa9a0, emissiveIntensity: 0.25 });
  const bubbleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 10), bubbleMat, NB);
  group.add(bubbleMesh);
  const bubbles = [];
  const resetBubble = (b, initial) => {
    const [x, z] = weedBases[Math.floor(rand() * weedBases.length)];
    b.x = x + (rand() - 0.5) * 0.1;
    b.z = z + (rand() - 0.5) * 0.1;
    b.y = initial ? FLOOR_Y + rand() * 0.5 : FLOOR_Y + 0.05;
    b.r = 0.012 + rand() * 0.02;
    b.speed = 0.12 + rand() * 0.1;
    b.ph = rand() * 6;
  };
  for (let i = 0; i < NB; i++) { const b = {}; resetBubble(b, true); bubbles.push(b); }

  // falling maple leaves
  const leafGeo = mapleLeafGeometry();
  const leafMats = ['#ff4a2a', '#ff6a30', '#f0391f', '#ff8c3a', '#f5b43a'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide })
  );
  const leaves = [];
  const spawnLeaf = () => {
    if (leaves.length > 55) {
      const old = leaves.find((l) => !l.dying);
      if (old) old.dying = 0.6;
    }
    const mesh = new THREE.Mesh(leafGeo, leafMats[Math.floor(Math.random() * leafMats.length)]);
    mesh.castShadow = true;
    tree.randomCanopyPoint(mesh.position);
    group.add(mesh);
    leaves.push({
      mesh, state: 'fall', ph: Math.random() * 10, spin: (Math.random() - 0.5) * 4, age: 0, dying: 0,
      vx: -0.15 - Math.random() * 0.25, vz: 0.1 + Math.random() * 0.25,
    });
  };

  // bouncy balls
  const balls = [];
  const ballGeo = new THREE.SphereGeometry(1, 24, 18);
  const ballCols = [0xff5d5d, 0xffc93c, 0x6bcB77, 0x4d96ff, 0xff8fd8, 0xffffff];
  const dropBall = (x, z) => {
    if (x === undefined) [x, z] = randomWaterPoint(Math.random, 0.6);
    const r = 0.09 + Math.random() * 0.05;
    const mat = new THREE.MeshPhysicalMaterial({ color: ballCols[Math.floor(Math.random() * ballCols.length)], roughness: 0.15, clearcoat: 1 });
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.scale.setScalar(r);
    mesh.castShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    group.add(holder);
    const fl = new Floater(holder, {
      x, z, y: 3.2 + Math.random(), radius: r, footprint: r * 2.6, lift: r * 0.75, weight: 2.2 + r * 10,
      spring: 520, springDamp: 2.5, slide: 3, drag: 0.5, tiltAmount: 0, restitution: 0.7,
    });
    fl.ball = { r, mesh, age: 0, roll: new THREE.Quaternion() };
    fl.onLand = (f, speed) => jelly.impulse(f.x, f.z, r * 2.5, -Math.min(6, speed * 1.4));
    balls.push(fl);
    floaters.push(fl);
    if (balls.length > 14) {
      const old = balls.shift();
      old.removing = true;
    }
  };

  // ---------------------------------------------------------------- update
  let leafTimer = 0;
  const boatPush = new THREE.Vector3();

  function steerAwayFromWalls(x, z, hx, hz, look, margin) {
    const lx = x + hx * look, lz = z + hz * look;
    const s = waterSDF(lx, lz);
    if (s > -margin) {
      const [nx, nz] = waterNormal(lx, lz);
      const k = (s + margin) / margin;
      return [-nx * k * 2.5, -nz * k * 2.5];
    }
    return [0, 0];
  }

  function update(dt, t) {
    swayUniforms.uTime.value = t;

    // ducks
    const mom = ducks[0];
    mom.heading += (Math.sin(t * 0.3) * 0.25 + (rand() - 0.5) * 0.4) * dt;
    let dx = Math.cos(mom.heading), dz = Math.sin(mom.heading);
    const [ax, az] = steerAwayFromWalls(mom.x, mom.z, dx, dz, 0.9, 0.7);
    const bp = boat.position;
    let bx = mom.x - bp.x, bz = mom.z - bp.z;
    const bd = Math.hypot(bx, bz);
    let avoidX = 0, avoidZ = 0;
    if (bd < 1.8) { avoidX = (bx / bd) * (1.8 - bd) * 2; avoidZ = (bz / bd) * (1.8 - bd) * 2; }
    const want = Math.atan2(dz + az + avoidZ, dx + ax + avoidX);
    let diff = want - mom.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    mom.heading += diff * Math.min(1, dt * 2);
    mom.ax = Math.cos(mom.heading) * 0.55;
    mom.az = Math.sin(mom.heading) * 0.55;
    for (let i = 1; i < ducks.length; i++) {
      const lead = ducks[i - 1], d = ducks[i];
      const sp = Math.hypot(lead.vx, lead.vz) || 1;
      const tx = lead.x - (lead.vx / sp) * 0.28, tz = lead.z - (lead.vz / sp) * 0.28;
      d.ax = (tx - d.x) * 6 - d.vx * 1.5;
      d.az = (tz - d.z) * 6 - d.vz * 1.5;
    }
    for (const d of ducks) {
      const sp = Math.hypot(d.vx, d.vz);
      if (sp > 0.03) {
        const target = Math.atan2(-d.vz, d.vx);
        let dy = target - d.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        d.yaw += dy * Math.min(1, dt * 5);
      }
    }

    // push floaters out of the boat's way
    const bh = boat.group.rotation.y;
    const fx = Math.cos(bh), fz = -Math.sin(bh);
    for (const f of floaters) {
      const rx = f.x - bp.x, rz = f.z - bp.z;
      const lx = rx * fx + rz * fz; // along the hull
      const lz = -rx * fz + rz * fx; // across
      const d = Math.hypot(lx / 1.3, lz / 0.42);
      if (d < 1 && f.y < WATER_Y + 0.5) {
        const side = lz >= 0 ? 1 : -1;
        boatPush.set(-fz * side, 0, fx * side);
        const k = (1 - d) * 4;
        f.vx += boatPush.x * k * dt * 6;
        f.vz += boatPush.z * k * dt * 6;
      }
    }

    // balls roll along with their velocity
    for (const f of balls) {
      const b = f.ball;
      b.age += dt;
      const sp = Math.hypot(f.vx, f.vz);
      if (sp > 1e-4) {
        q.setFromAxisAngle(tmpV.set(f.vz / sp, 0, -f.vx / sp), (sp * dt) / b.r);
        b.mesh.quaternion.premultiply(q);
      }
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.update(dt, jelly);
      if (f.removing) {
        const s = f.object.scale.x - dt * 2;
        f.object.scale.setScalar(Math.max(0.001, s));
        if (s <= 0) {
          group.remove(f.object);
          floaters.splice(i, 1);
        }
      }
    }

    // koi
    for (const k of fish) {
      const hx = Math.cos(k.heading), hz = Math.sin(k.heading);
      const [ax2, az2] = steerAwayFromWalls(k.x, k.z, hx, hz, 0.6, 0.55);
      k.heading += (Math.sin(t * 0.5 + k.phase) * 0.6) * dt;
      if (ax2 || az2) {
        const want2 = Math.atan2(hz + az2, hx + ax2);
        let df = want2 - k.heading;
        df = Math.atan2(Math.sin(df), Math.cos(df));
        k.heading += df * Math.min(1, dt * 3);
      }
      k.x += Math.cos(k.heading) * k.speed * dt;
      k.z += Math.sin(k.heading) * k.speed * dt;
      if (!isWater(k.x, k.z, 0.2)) {
        const [nx, nz] = waterNormal(k.x, k.z);
        k.x -= nx * 0.02;
        k.z -= nz * 0.02;
      }
      // now and then a koi rises and nudges the jelly from below
      k.riseCd -= dt;
      if (k.riseCd < 0 && k.rise === 0) k.rise = 0.001;
      let y = k.y + Math.sin(t * 1.3 + k.phase) * 0.03;
      if (k.rise > 0) {
        k.rise += dt;
        const r = Math.sin(Math.min(1, k.rise / 3) * Math.PI);
        y += r * 0.2;
        if (k.rise > 1.4 && !k.kissed) {
          jelly.impulse(k.x, k.z, 0.14, 1.6);
          k.kissed = true;
        }
        if (k.rise > 3) { k.rise = 0; k.kissed = false; k.riseCd = 8 + rand() * 14; }
      }
      k.obj.position.set(k.x, y, k.z);
      k.obj.rotation.set(0, -k.heading, 0);
      k.obj.userData.tail.rotation.y = Math.sin(t * 7 + k.phase) * 0.45;
    }

    // bubbles
    const s = {};
    for (let i = 0; i < NB; i++) {
      const b = bubbles[i];
      b.y += b.speed * dt;
      const surf = jelly.sample(b.x, b.z, s).y;
      if (b.y > surf - 0.04) {
        jelly.impulse(b.x, b.z, 0.08, 0.5);
        resetBubble(b, false);
      }
      const wob = Math.sin(t * 3 + b.ph) * 0.015;
      m4.compose(tmpV.set(b.x + wob, b.y, b.z + wob * 0.6), q.identity(), sc.setScalar(b.r));
      bubbleMesh.setMatrixAt(i, m4);
    }
    bubbleMesh.instanceMatrix.needsUpdate = true;

    // leaves
    leafTimer -= dt;
    if (leafTimer < 0) { spawnLeaf(); leafTimer = 0.7 + Math.random() * 1.2; }
    for (let i = leaves.length - 1; i >= 0; i--) {
      const L = leaves[i];
      L.age += dt;
      const m = L.mesh;
      if (L.state === 'fall') {
        const sway = Math.sin(t * 2.2 + L.ph);
        m.position.x += (L.vx + sway * 0.35) * dt;
        m.position.z += (L.vz + Math.cos(t * 1.7 + L.ph) * 0.2) * dt;
        m.position.y -= (0.42 + Math.abs(sway) * 0.15) * dt;
        m.rotation.set(sway * 0.8, m.rotation.y + L.spin * dt, Math.cos(t * 2.2 + L.ph) * 0.6);
        const { x, z } = m.position;
        if (isWater(x, z, 0.08)) {
          const sy = jelly.sample(x, z, s).y;
          if (m.position.y <= sy + 0.01) {
            L.state = 'float';
            jelly.impulse(x, z, 0.1, -0.5);
            const holder = new THREE.Group();
            group.add(holder);
            holder.add(m);
            m.position.set(0, 0, 0);
            m.rotation.set(0, 0, 0);
            L.holder = holder;
            L.floater = new Floater(holder, {
              x, z, y: sy, yaw: Math.random() * 6, radius: 0.05, footprint: 0.08, lift: 0.005,
              weight: 0.08, slide: 2.6, drag: 0.9, spring: 200, tiltFollow: 12,
            });
            L.floater.yawVel = (Math.random() - 0.5) * 0.4;
            floaters.push(L.floater);
          }
        } else if (Math.abs(x) > INNER.hx + 0.6 || Math.abs(z) > INNER.hz + 0.6) {
          if (m.position.y < -0.6) L.dying = 0.5;
        } else if (m.position.y <= 0.78) {
          L.state = 'ground';
          m.position.y = 0.79;
          m.rotation.set(0, m.rotation.y, 0);
        }
      }
      if (L.age > 40 && !L.dying) L.dying = 1;
      if (L.dying) {
        L.dying -= dt;
        const k = Math.max(0.001, L.dying);
        (L.holder || m).scale.setScalar(Math.min(1, k * 2));
        if (L.dying <= 0) {
          if (L.holder) {
            group.remove(L.holder);
            const fi = floaters.indexOf(L.floater);
            if (fi >= 0) floaters.splice(fi, 1);
          } else group.remove(m);
          leaves.splice(i, 1);
        }
      }
    }
  }

  return {
    group,
    floaters,
    update,
    dropBall,
    leafBurst(n = 14) {
      for (let i = 0; i < n; i++) spawnLeaf();
    },
  };
}
