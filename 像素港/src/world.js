// The floating island and everything fixed on it.
import * as THREE from 'three';
import { Kit, col, lambert, xform } from './kit.js';
import { rand } from './env.js';

export const L = {
  quayZ: -10, quayY: 1.5, R: 24,
  pier: { x0: 3.2, x1: 5.6, z0: -10, z1: 5.4, y: 1.3, tx0: 0.5, tx1: 9.5, tz0: 3.0 },
  berths: [{ x: -1.6, z: -8.6 }, { x: -8.4, z: -8.6 }],
  crane: { x: -4.8, z: -11.2 },
  market: { x: -12.5, z: -14.2 },
  cratePile: { x: -6.8, z: -12.6 },
  bell: { x: 1.6, z: -11.0 },
  chalk: { x: 5.95, z: -7.5 },
  lighthouse: { x: -9.5, z: 9.5 },
  smokehouse: { x: 15.5, z: -13.5 },
  cottages: [{ x: -16.5, z: -15.5, ry: 0.0 }, { x: 10.5, z: -16.5, ry: 0.0 }],
  kid: { x: -16.2, z: -10.15 },
  mouth: 0.95, // angle of the harbour mouth (radians, from +x toward +z)
  grounds: [{ x: 6, z: 12.5 }, { x: -15.5, z: -1 }],
};

const C = {
  granite: col('#7f8794'), graniteD: col('#5d6572'), graniteL: col('#a5acb6'), cobble: col('#6f7784'),
  white: col('#e9ebe4'), slate: col('#434a56'), slateD: col('#2c313b'), tar: col('#1b1f27'), tarL: col('#2c313b'),
  wood: col('#7c4d2c'), woodD: col('#5f3721'), woodL: col('#9b673b'), plank: col('#8a5a34'), rope: col('#ba8653'),
  red: col('#c54236'), redD: col('#982824'), blue: col('#2c6293'), green: col('#40702d'), net: col('#294d40'),
  rock: col('#5d6572'), rockD: col('#434a56'), earth: col('#5f3721'), moss: col('#64933a'), sand: col('#d6aa78'),
  iron: col('#1b1f27'), brass: col('#dc872b'), yellow: col('#f0b142'),
};

function islandBody(kit) {
  // cliff wall + underside: a jagged inverted cone of rock
  const rings = [[24.6, 0.6], [24.9, -1.5], [24.2, -4], [21.5, -7.5], [17.5, -11], [12.5, -14.5], [7, -18], [2.5, -22], [0.3, -25]];
  const segs = 40;
  const pos = [], colr = [];
  const ringPts = rings.map(([r, y], ri) => {
    const pts = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const n = ri === 0 ? 0 : (Math.sin(a * 5 + ri) * 0.08 + Math.sin(a * 11 + ri * 3) * 0.05) * r + (ri > 1 ? rand(-0.6, 0.6) : 0);
      pts.push(new THREE.Vector3(Math.cos(a) * (r + n), y + (ri > 0 ? rand(-0.5, 0.5) : 0), Math.sin(a) * (r + n)));
    }
    return pts;
  });
  const shade = (y) => (y > -2 ? C.rock : y > -6 ? C.earth : y > -13 ? C.rockD : col('#2c313b'));
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = ringPts[ri][s], b = ringPts[ri][s1], c = ringPts[ri + 1][s], d = ringPts[ri + 1][s1];
      for (const [p, q, r] of [[a, c, b], [b, c, d]]) {
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
        const cc = shade((p.y + q.y + r.y) / 3);
        for (let k = 0; k < 3; k++) colr.push(cc.r, cc.g, cc.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  kit.parts.push(g);
  // grassy lip on the rim
  for (let s = 0; s < 70; s++) {
    const a = (s / 70) * Math.PI * 2;
    if (Math.sin(a) < -0.42) continue;
    kit.box(1.4, 0.35, 0.9, s % 3 ? C.moss : col('#40702d'), Math.cos(a) * 24.4, 0.75, Math.sin(a) * 24.4, -a);
  }
  // dangling roots and hanging rocks
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2), r = rand(6, 22);
    const y = -4 - (24 - r) * 0.75;
    const len = rand(1.5, 4.5);
    kit.box(0.18, len, 0.18, C.woodD, Math.cos(a) * r, y - len / 2, Math.sin(a) * r, 0, rand(-0.2, 0.2), rand(-0.2, 0.2));
  }
}

function quay(kit) {
  const { quayZ, quayY, R } = L;
  // granite platform: the part of the disc north of the quay edge
  const shape = new THREE.Shape();
  const x0 = Math.sqrt(R * R - quayZ * quayZ);
  shape.moveTo(-x0, quayZ);
  shape.lineTo(x0, quayZ);
  const a0 = Math.atan2(quayZ, x0), a1 = Math.atan2(quayZ, -x0); // -0.43 down to -2.71, through north
  for (let i = 1; i <= 30; i++) { const a = a0 + ((a1 - a0) * i) / 30; shape.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
  const g = new THREE.ExtrudeGeometry(shape, { depth: quayY + 3, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape (x, y) -> world (x, z); extrusion runs downward
  g.translate(0, quayY, 0);
  kit.add(g, C.granite);
  // cobbles on top
  for (let z = quayZ - 0.6; z > -23; z -= 1.15) {
    for (let x = -21; x < 21; x += 1.15) {
      if (x * x + z * z > (R - 1.2) ** 2) continue;
      if (Math.random() < 0.45) kit.box(1.0, 0.06, 1.0, Math.random() < 0.5 ? C.cobble : C.graniteL, x + rand(-0.1, 0.1), quayY + 0.03, z, rand(-0.1, 0.1));
    }
  }
  // quay wall: dressed stone blocks along the face, kerb on top
  for (let x = -x0 + 0.6; x < x0 - 0.5; x += 1.6) {
    for (let y = -2.6, row = 0; y < quayY - 0.2; y += 0.8, row++) {
      kit.box(1.5, 0.74, 0.3, row % 2 ? C.graniteD : C.granite, x + (row % 2) * 0.8, y + 0.4, quayZ + 0.12);
    }
  }
  kit.box(2 * x0, 0.3, 0.7, C.graniteL, 0, quayY + 0.15, quayZ - 0.25);
  // stone steps down to the water by the berths
  for (let i = 0; i < 6; i++) kit.box(1.4, 0.3, 0.7, C.graniteD, -11.6, quayY - 0.3 - i * 0.4, quayZ + 0.35 + i * 0.0, 0);
  // bollards
  for (const x of [-12, -5.8, -3.6, 0.2, 7.5, 12]) { kit.cyl(0.18, 0.24, 0.55, 8, C.iron, x, quayY + 0.3, quayZ - 0.45); kit.cyl(0.26, 0.26, 0.1, 8, C.iron, x, quayY + 0.6, quayZ - 0.45); }
}

function cottage(kit, x, z, ry, door) {
  const T = (dx, dy, dz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + dx * c + dz * s, dy, z - dx * s + dz * c]; };
  const y = L.quayY;
  const [bx, , bz] = T(0, 0, 0);
  kit.box(5.2, 3.0, 3.6, C.white, bx, y + 1.5, bz, ry);
  // slate roof
  for (const s of [-1, 1]) { const [rx, , rz] = T(0, 0, s * 1.0); kit.box(5.6, 0.25, 2.3, C.slate, rx, y + 3.55, rz, ry, s * -0.6); }
  const [cx, , cz] = T(2.0, 0, 0); kit.box(0.6, 1.4, 0.6, C.white, cx, y + 4.1, cz, ry);
  kit.box(0.7, 0.15, 0.7, C.slateD, cx, y + 4.85, cz, ry);
  const [dx, , dz] = T(-0.8, 0, 1.81); kit.box(0.9, 1.7, 0.08, door, dx, y + 0.85, dz, ry);
  // window frames (glass is a separate glowing mesh)
  for (const wx of [0.9, 2.0]) { const [wx2, , wz2] = T(wx, 0, 1.81); kit.box(0.8, 0.8, 0.05, C.slateD, wx2, y + 1.8, wz2, ry); }
}

function smokehouse(kit) {
  const { x, z } = L.smokehouse, y = L.quayY;
  kit.box(3.6, 2.6, 3.0, C.tar, x, y + 1.3, z);
  for (let i = -1.6; i <= 1.6; i += 0.4) kit.box(0.05, 2.6, 0.06, C.tarL, x + i, y + 1.3, z + 1.52);
  for (const s of [-1, 1]) kit.box(4.0, 0.2, 1.9, C.slateD, x, y + 2.95, z + s * 0.8, 0, s * -0.55);
  kit.box(0.7, 1.6, 0.7, C.graniteD, x + 1.1, y + 3.6, z);
  kit.box(0.9, 1.4, 0.06, C.woodD, x - 0.8, y + 0.7, z + 1.53);
  // fish hanging on a rail outside
  kit.box(2.2, 0.06, 0.06, C.wood, x - 0.2, y + 2.0, z + 1.75);
  for (let i = 0; i < 6; i++) kit.box(0.12, 0.45, 0.05, C.brass, x - 1.1 + i * 0.35, y + 1.72, z + 1.75);
}

function netRacks(kit) {
  const y = L.quayY;
  for (const [x0, z0] of [[-2.2, -16.0], [3.8, -15.2]]) {
    for (let i = 0; i < 3; i++) kit.box(0.14, 2.4, 0.14, C.wood, x0 + i * 2.2, y + 1.2, z0);
    kit.box(4.8, 0.1, 0.1, C.woodL, x0 + 2.2, y + 2.35, z0);
    // draped net with a mesh pattern
    for (let i = 0; i < 9; i++) kit.box(0.04, 1.5 - (i % 2) * 0.2, 0.06, C.net, x0 + 0.3 + i * 0.5, y + 1.6, z0 + 0.02);
    for (let j = 0; j < 4; j++) kit.box(4.2, 0.04, 0.06, C.net, x0 + 2.2, y + 2.2 - j * 0.38, z0 + 0.04);
    for (let i = 0; i < 9; i++) kit.box(0.12, 0.12, 0.12, C.yellow, x0 + 0.3 + i * 0.5, y + 2.3, z0 + 0.06);
  }
}

function clutter(kit) {
  const y = L.quayY;
  const barrel = (x, z) => { kit.cyl(0.42, 0.38, 1.05, 10, C.woodL, x, y + 0.52, z); for (const h of [0.2, 0.85]) kit.cyl(0.44, 0.44, 0.08, 10, C.iron, x, y + h, z); };
  for (const [x, z] of [[8.2, -11.6], [9.1, -11.9], [8.6, -12.7], [-15, -12.2], [13.2, -11.2]]) barrel(x, z);
  kit.cyl(0.42, 0.42, 1.0, 10, C.woodL, 8.65, y + 1.6, -12.1, 0, Math.PI / 2);
  // lobster pots (stacked creels)
  const pot = (x, yy, z) => {
    kit.box(1.0, 0.08, 0.7, C.woodD, x, yy + 0.04, z);
    for (let i = -1; i <= 1; i++) kit.box(0.06, 0.6, 0.72, C.woodL, x + i * 0.45, yy + 0.32, z, 0, 0, 0);
    kit.box(1.0, 0.05, 0.05, C.rope, x, yy + 0.6, z + 0.33); kit.box(1.0, 0.05, 0.05, C.rope, x, yy + 0.6, z - 0.33);
    kit.box(0.96, 0.5, 0.02, C.net, x, yy + 0.32, z + 0.34); kit.box(0.96, 0.5, 0.02, C.net, x, yy + 0.32, z - 0.34);
  };
  pot(10.6, y, -11.4); pot(11.7, y, -11.5); pot(11.1, y + 0.65, -11.45); pot(12.2, y, -12.5); pot(10.4, y, -12.6);
  // rope coils, a dinghy upturned
  for (const [x, z] of [[-1.2, -11.4], [6.6, -11.3]]) { kit.cyl(0.4, 0.4, 0.14, 10, C.rope, x, y + 0.07, z); kit.cyl(0.25, 0.25, 0.16, 8, C.woodD, x, y + 0.09, z); }
  kit.box(3.0, 0.5, 1.2, C.blue, -19, y + 0.3, -14.5, 0.3);
  kit.box(3.1, 0.12, 1.3, C.white, -19, y + 0.58, -14.5, 0.3);
  // fish boxes stacked by the market
  for (let i = 0; i < 3; i++) kit.box(0.9, 0.4, 0.6, C.woodL, -9.4, y + 0.2 + i * 0.42, -16.4 + (i % 2) * 0.1);
}

function market(kit) {
  const { x, z } = L.market, y = L.quayY;
  // posts
  for (const [dx, dz] of [[-2.2, -1.3], [2.2, -1.3], [-2.2, 1.3], [2.2, 1.3]]) kit.box(0.16, 2.6, 0.16, C.woodD, x + dx, y + 1.3, z + dz);
  // striped awning, sloping toward the front
  for (let i = 0; i < 10; i++) kit.box(0.5, 0.1, 3.0, i % 2 ? C.white : C.red, x - 2.25 + i * 0.5, y + 2.7, z + 0.2, 0, -0.22);
  for (let i = 0; i < 10; i++) kit.box(0.5, 0.45, 0.05, i % 2 ? C.white : C.red, x - 2.25 + i * 0.5, y + 2.2, z + 1.72);
  // stall: table + slab of ice + sign
  kit.box(4.2, 0.12, 1.4, C.woodL, x, y + 1.0, z + 0.6);
  kit.box(4.0, 0.06, 1.2, col('#cdd2d7'), x, y + 1.09, z + 0.6);
  for (const dx of [-1.9, 1.9]) for (const dz of [0.05, 1.15]) kit.box(0.12, 1.0, 0.12, C.woodD, x + dx, y + 0.5, z + dz);
  kit.box(2.2, 0.5, 0.06, C.slateD, x, y + 3.25, z + 1.65);
  kit.box(0.6, 0.5, 0.06, C.white, x - 0.5, y + 3.25, z + 1.69);
}

function bellFrame(kit) {
  const { x, z } = L.bell, y = L.quayY;
  kit.box(0.2, 2.6, 0.2, C.woodD, x - 0.6, y + 1.3, z);
  kit.box(0.2, 2.6, 0.2, C.woodD, x + 0.6, y + 1.3, z);
  kit.box(1.6, 0.2, 0.26, C.wood, x, y + 2.6, z);
  kit.box(1.8, 0.12, 0.6, C.slateD, x, y + 2.8, z);
}

function pier(kit) {
  const P = L.pier, y = P.y;
  // deck planks across the walkway
  for (let z = P.z0; z < P.tz0; z += 0.42) kit.box(P.x1 - P.x0 + 0.2, 0.12, 0.38, (Math.round(z / 0.42) % 3) ? C.plank : C.woodL, (P.x0 + P.x1) / 2, y, z + 0.21);
  // T-head
  for (let x = P.tx0; x < P.tx1; x += 0.42) kit.box(0.38, 0.12, P.z1 - P.tz0 + 0.2, (Math.round(x / 0.42) % 3) ? C.plank : C.woodL, x + 0.21, y, (P.tz0 + P.z1) / 2);
  // stringers
  kit.box(0.2, 0.25, P.tz0 - P.z0, C.woodD, P.x0, y - 0.18, (P.z0 + P.tz0) / 2);
  kit.box(0.2, 0.25, P.tz0 - P.z0, C.woodD, P.x1, y - 0.18, (P.z0 + P.tz0) / 2);
  // tarred piles + cross bracing
  const pile = (x, z) => { kit.cyl(0.17, 0.2, 5.2, 8, C.tar, x, y - 2.6, z); kit.cyl(0.19, 0.19, 0.06, 8, C.tarL, x, y + 0.04, z); };
  for (let z = P.z0 + 1.5; z < P.tz0; z += 2.2) { pile(P.x0, z); pile(P.x1, z); kit.beam(new THREE.Vector3(P.x0, y - 0.3, z), new THREE.Vector3(P.x1, y - 2.2, z), 0.1, C.tarL); }
  for (let x = P.tx0 + 0.2; x <= P.tx1; x += 2.2) { pile(x, P.tz0); pile(x, P.z1); }
  // a ladder down to the water at the T-head
  for (let i = 0; i < 6; i++) kit.box(0.6, 0.06, 0.06, C.woodD, P.tx1 - 1, y - 0.4 - i * 0.4, P.z1 + 0.12);
  // stool for angler 3
  kit.cyl(0.3, 0.3, 0.08, 8, C.woodL, 2.5, y + 0.55, 4.6);
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [0, 0.2]]) kit.box(0.06, 0.55, 0.06, C.woodD, 2.5 + dx, y + 0.28, 4.6 + dz);
  // chalkboard A-frame
  const { x, z } = L.chalk;
  kit.box(0.08, 1.5, 0.1, C.woodD, x, y + 0.72, z - 0.55, 0, 0, -0.25);
  kit.box(0.08, 1.5, 0.1, C.woodD, x, y + 0.72, z + 0.55, 0, 0, -0.25);
  kit.box(0.08, 1.5, 0.1, C.woodD, x - 0.35, y + 0.72, z, 0, 0, 0.3);
}

function rockRing(kit) {
  for (let i = 0; i < 74; i++) {
    const a = (i / 74) * Math.PI * 2 + rand(-0.02, 0.02);
    const z = Math.sin(a) * 22.5;
    if (z < L.quayZ + 1) continue;
    const da = Math.abs(Math.atan2(Math.sin(a - L.mouth), Math.cos(a - L.mouth)));
    if (da < 0.13) continue; // harbour mouth
    const r = rand(1.1, 2.1) * (da < 0.25 ? 0.7 : 1);
    kit.rock(r, Math.random() < 0.5 ? C.rock : C.rockD, Math.cos(a) * rand(22.2, 23.6), rand(-0.4, 0.5), Math.sin(a) * rand(22.2, 23.6), i, 0.8);
    if (Math.random() < 0.5) kit.rock(r * 0.5, C.graniteL, Math.cos(a) * 21.2, rand(-0.6, 0), Math.sin(a) * 21.2, i + 7, 0.6);
    if (Math.random() < 0.3) kit.box(0.8, 0.12, 0.6, C.moss, Math.cos(a) * 22.8, r * 0.75, Math.sin(a) * 22.8, a);
  }
  // beacon posts at the harbour mouth
  for (const s of [-1, 1]) {
    const a = L.mouth + s * 0.17;
    kit.cyl(0.25, 0.3, 3.2, 8, s > 0 ? C.red : C.green, Math.cos(a) * 21.8, 1.2, Math.sin(a) * 21.8);
  }
}

function lighthouse(kit) {
  const { x, z } = L.lighthouse;
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; kit.rock(rand(1.2, 1.9), i % 2 ? C.rock : C.rockD, x + Math.cos(a) * 2.2, rand(-0.3, 0.4), z + Math.sin(a) * 2.2, i * 3, 0.9); }
  kit.cyl(2.4, 2.8, 1.6, 12, C.granite, x, 0.6, z);
  const H = 9, segs = 6;
  for (let i = 0; i < segs; i++) {
    const r0 = 1.25 - (i / segs) * 0.35, r1 = 1.25 - ((i + 1) / segs) * 0.35;
    kit.cyl(r1, r0, H / segs, 12, i % 2 ? C.red : C.white, x, 1.4 + (i + 0.5) * (H / segs), z);
  }
  kit.cyl(1.35, 1.35, 0.2, 12, C.slateD, x, 1.4 + H + 0.1, z);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; kit.box(0.06, 0.5, 0.06, C.iron, x + Math.cos(a) * 1.3, 1.4 + H + 0.45, z + Math.sin(a) * 1.3); }
  kit.cyl(1.38, 1.38, 0.06, 12, C.iron, x, 1.4 + H + 0.7, z);
  kit.cyl(0.85, 1.05, 0.5, 10, C.red, x, 1.4 + H + 2.15, z);
  kit.cyl(0.05, 0.85, 0.7, 10, C.red, x, 1.4 + H + 2.75, z);
  kit.box(0.6, 1.0, 0.06, C.woodD, x + 0.0, 1.9, z + 1.2);
  // windows up the tower
  for (let i = 0; i < 3; i++) kit.box(0.3, 0.45, 0.08, C.slateD, x + 0.0, 3.5 + i * 2.5, z + 1.15 - i * 0.1);
}

/** Things that change at night (window glass, the lantern room) */
function glowParts() {
  const kit = new Kit();
  const y = L.quayY;
  for (const c of L.cottages) for (const wx of [0.9, 2.0]) kit.box(0.6, 0.6, 0.06, '#f6d36c', c.x + wx, y + 1.8, c.z + 1.84);
  kit.box(0.3, 0.3, 0.05, '#f6d36c', L.smokehouse.x + 0.6, y + 1.6, L.smokehouse.z + 1.54);
  const { x, z } = L.lighthouse;
  kit.cyl(0.95, 0.95, 1.1, 10, '#faecae', x, 1.4 + 9 + 1.3, z);
  for (let i = 0; i < 3; i++) kit.box(0.2, 0.32, 0.06, '#f6d36c', x, 3.5 + i * 2.5, z + 1.2 - i * 0.1);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(0.35, 0.35, 0.4) });
  const m = kit.mesh(mat, { cast: false, receive: false });
  return m;
}

export function buildWorld() {
  const group = new THREE.Group();
  const stone = new Kit();
  islandBody(stone);
  quay(stone);
  rockRing(stone);
  lighthouse(stone);
  group.add(stone.mesh(lambert()));
  const build = new Kit();
  for (const c of L.cottages) cottage(build, c.x, c.z, c.ry, c.x < 0 ? C.blue : C.green);
  smokehouse(build);
  netRacks(build);
  clutter(build);
  market(build);
  bellFrame(build);
  pier(build);
  group.add(build.mesh(lambert()));
  const glow = glowParts();
  group.add(glow);
  return { group, glow };
}

/** Gull perches: [x, y, z] */
export function perches() {
  const y = L.quayY;
  const P = [];
  for (const c of L.cottages) for (const dx of [-1.8, -0.6, 0.8]) P.push([c.x + dx, y + 4.05, c.z]);
  P.push([L.smokehouse.x - 1, y + 3.3, L.smokehouse.z]);
  P.push([L.lighthouse.x + 1.3, 1.4 + 9 + 0.75, L.lighthouse.z], [L.lighthouse.x - 1.3, 1.4 + 9 + 0.75, L.lighthouse.z]);
  P.push([L.pier.tx0 + 0.2, L.pier.y + 0.1, L.pier.z1], [L.pier.tx1 - 0.2, L.pier.y + 0.1, L.pier.tz0]);
  for (const x of [-12, 0.2, 7.5, 12]) P.push([x, y + 0.7, L.quayZ - 0.45]);
  P.push([L.market.x + 1.5, y + 2.85, L.market.z + 0.4]);
  return P;
}
