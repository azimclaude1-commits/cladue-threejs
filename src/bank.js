import * as THREE from 'three';
import { INNER, FLOOR_Y, BANK_TOP, ISLAND, bankEdgeZ, islandRadius } from './layout.js';
import { makeRockGeometry, makePuffGeometry, mulberry32 } from './utils.js';

/** Many small puffs drawn with one InstancedMesh. */
export class PuffField {
  constructor(geometry, material, max) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.count = 0;
    this.max = max;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }
  add(pos, scale, color, rand) {
    if (this.count >= this.max) return;
    this._e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    this._q.setFromEuler(this._e);
    if (typeof scale === 'number') this._s.set(scale, scale, scale);
    else this._s.copy(scale);
    this._m.compose(pos, this._q, this._s);
    this.mesh.setMatrixAt(this.count, this._m);
    this.mesh.setColorAt(this.count, this._c.set(color));
    this.count++;
  }
  finish() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const FLOWER_REDS = ['#e8401f', '#f0552a', '#d6301c', '#f26a2e', '#e03a22'];
const MOSS = ['#6f9a2a', '#8aa22c', '#5e8726', '#9cab34', '#55782a'];
const YELLOWS = ['#e0a020', '#d4911c', '#e8b030', '#c8821a'];

export function buildBank(rand = mulberry32(11)) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0xd8cbb3, roughness: 0.95 });

  // --- bank body ---------------------------------------------------------
  const X = INNER.hx + 0.04, Z = INNER.hz + 0.04, R = INNER.r + 0.04;
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const x = -X + (2 * X * i) / 80;
    pts.push(new THREE.Vector2(x, -bankEdgeZ(x)));
  }
  // front boundary of the rounded rect, right to left
  for (let i = 0; i <= 60; i++) {
    const th = (Math.PI * i) / 60;
    const x = X * Math.cos(th);
    const ax = Math.abs(x) - (X - R);
    const z = ax > 0 ? Z - R + Math.sqrt(Math.max(0, R * R - ax * ax)) : Z;
    pts.push(new THREE.Vector2(x, -z));
  }
  const bankShape = new THREE.Shape(pts);
  const bev = 0.1;
  const bankGeo = new THREE.ExtrudeGeometry(bankShape, {
    depth: BANK_TOP - FLOOR_Y - bev * 2,
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: 0.06,
    bevelSegments: 4,
    curveSegments: 4,
  });
  bankGeo.rotateX(-Math.PI / 2);
  bankGeo.translate(0, FLOOR_Y + bev, 0);
  const bank = new THREE.Mesh(bankGeo, soilMat);
  bank.receiveShadow = true;
  group.add(bank);

  // --- rocks -------------------------------------------------------------
  const rocks = [];
  const addRock = (x, y, z, sx, sy, sz, seed) => {
    const g = makeRockGeometry(seed, { detail: 4, lump: 0.22, freq: 1.1 });
    const m = new THREE.Mesh(g, rockMat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = rand() * Math.PI * 2;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    rocks.push(m);
    return m;
  };

  // big boulders along the water's edge, a second row behind
  let seed = 1;
  for (let x = -4.45; x < 4.6; x += 0.82 + rand() * 0.25) {
    const z = bankEdgeZ(x) + 0.2 + rand() * 0.2;
    const s = 0.5 + rand() * 0.22;
    addRock(x, BANK_TOP - 0.05, z, s * 1.15, s * (0.62 + rand() * 0.2), s, seed++);
  }
  for (let x = -4.1; x < 4.3; x += 1.1 + rand() * 0.4) {
    const z = bankEdgeZ(x) + 1.05 + rand() * 0.3;
    if (z > INNER.hz - 0.35) continue;
    const s = 0.38 + rand() * 0.2;
    addRock(x, BANK_TOP - 0.02, z, s * 1.2, s * 0.6, s, seed++);
  }
  // pebbles sitting in shallow jelly near the bank
  for (let i = 0; i < 9; i++) {
    const x = -4.3 + rand() * 8.6;
    const z = bankEdgeZ(x) - 0.15 - rand() * 0.25;
    const s = 0.12 + rand() * 0.12;
    addRock(x, 0.45, z, s * 1.3, s, s * 1.1, seed++);
  }

  // --- island under the tree --------------------------------------------
  const moundGeo = makeRockGeometry(77, { detail: 5, lump: 0.12, freq: 1.6, base: '#cdbb98', dark: '#9a8564', flat: -0.2 });
  const mound = new THREE.Mesh(moundGeo, rockMat);
  mound.position.set(ISLAND.x, 0.5, ISLAND.z);
  mound.scale.set(ISLAND.r * 1.08, 0.42, ISLAND.r * 1.08);
  mound.receiveShadow = true;
  mound.castShadow = true;
  group.add(mound);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.3;
    const rr = islandRadius(a) * (0.9 + rand() * 0.12);
    const s = 0.16 + rand() * 0.16;
    addRock(ISLAND.x + Math.cos(a) * rr, 0.62, ISLAND.z + Math.sin(a) * rr, s * 1.3, s * 0.8, s, seed++);
  }

  // --- puffy vegetation --------------------------------------------------
  const puffGeo = makePuffGeometry(3, 2, 0.28, 3.4);
  const puffMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.75, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffd0b0) });
  const puffs = new PuffField(puffGeo, puffMat, 4000);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const v = new THREE.Vector3();

  const cluster = (cx, cy, cz, radius, n, palette, size = [0.06, 0.1], squash = 0.7) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const h = Math.sqrt(Math.max(0, 1 - (r / radius) ** 2)) * radius * squash;
      v.set(cx + Math.cos(a) * r, cy + h * (0.4 + rand() * 0.6), cz + Math.sin(a) * r);
      const s = size[0] + rand() * (size[1] - size[0]);
      puffs.add(v, s, pick(palette), rand);
    }
  };

  // moss caps on top of rocks
  for (const rock of rocks) {
    if (rock.position.y < 0.5) continue;
    const n = 10 + Math.floor(rand() * 10);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const el = 0.45 + rand() * 0.9;
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      v.copy(dir).multiply(rock.scale).multiplyScalar(0.92).add(rock.position);
      const s = 0.06 + rand() * 0.07;
      puffs.add(v, new THREE.Vector3(s * 1.3, s * 0.8, s * 1.3), pick(MOSS), rand);
    }
  }

  // flower and moss clusters in between the rocks on the bank
  for (let i = 0; i < 26; i++) {
    const x = -4.5 + rand() * 9;
    const z = bankEdgeZ(x) + 0.25 + rand() * (INNER.hz - bankEdgeZ(x) - 0.45);
    const kind = rand();
    if (kind < 0.45) cluster(x, BANK_TOP, z, 0.22 + rand() * 0.12, 26, FLOWER_REDS, [0.06, 0.1]);
    else if (kind < 0.75) cluster(x, BANK_TOP, z, 0.2 + rand() * 0.15, 22, MOSS, [0.06, 0.1], 0.45);
    else cluster(x, BANK_TOP, z, 0.15 + rand() * 0.1, 16, YELLOWS, [0.05, 0.08]);
  }
  // island plants
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.35 + rand() * 0.5;
    cluster(ISLAND.x + Math.cos(a) * r, 0.86, ISLAND.z + Math.sin(a) * r, 0.2 + rand() * 0.1, 22, i % 3 === 2 ? MOSS : FLOWER_REDS, [0.06, 0.1]);
  }
  puffs.finish();
  group.add(puffs.mesh);

  // --- reeds / cattails at the water's edge ------------------------------
  const reeds = [];
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x7f9a3c, roughness: 0.8 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.9 });
  const reedSpots = [[-3.9, 0], [-1.6, 0], [1.2, 0], [3.9, 0]];
  for (const [x] of reedSpots) {
    const clump = new THREE.Group();
    clump.position.set(x, 0.55, bankEdgeZ(x) - 0.05);
    const n = 5 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const h = 0.55 + rand() * 0.5;
      const stalk = new THREE.Group();
      stalk.position.set((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.2);
      stalk.rotation.set((rand() - 0.5) * 0.3, rand() * 6, (rand() - 0.5) * 0.3);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, h, 5), reedMat);
      stem.position.y = h / 2;
      stem.castShadow = true;
      stalk.add(stem);
      if (rand() < 0.6) {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.12, 4, 8), tailMat);
        tail.position.y = h - 0.08;
        tail.castShadow = true;
        stalk.add(tail);
      } else {
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.02, h * 0.5, 4), reedMat);
        blade.position.y = h + h * 0.2;
        stalk.add(blade);
      }
      stalk.userData.phase = rand() * 6;
      stalk.userData.base = stalk.rotation.clone();
      clump.add(stalk);
      reeds.push(stalk);
    }
    group.add(clump);
  }

  return {
    group,
    update(t) {
      for (const s of reeds) {
        const ph = s.userData.phase;
        s.rotation.x = s.userData.base.x + Math.sin(t * 1.3 + ph) * 0.05;
        s.rotation.z = s.userData.base.z + Math.sin(t * 1.1 + ph * 1.7) * 0.06;
      }
    },
  };
}
