// Working harbour: two gaff-rigged luggers with crews and nets, the derrick that unloads them,
// porters, the fish market with its customers, the thieving cat, the crabbing kid and the bell.
import * as THREE from 'three';
import { env, seaHeight, rand, pick, clamp, lerp, angleLerp } from './env.js';
import { Person, Walker, mat, ik2 } from './people.js';
import { L } from './world.js';
import { makeFish, isOpenWater } from './fishing.js';

const deckY = L.quayY;

function hullGeometry(len, beam, depth) {
  // top-view outline: pointed bow (+x), round-ish stern
  const shape = new THREE.Shape();
  const n = 14;
  shape.moveTo(len / 2, 0);
  for (let i = 1; i <= n; i++) {
    const t = i / n; const x = len / 2 - t * len;
    const w = beam / 2 * Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI / 2), 0.8) * (t > 0.9 ? 0.9 : 1);
    shape.lineTo(x, w);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n; const x = len / 2 - t * len;
    const w = beam / 2 * Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI / 2), 0.8) * (t > 0.9 ? 0.9 : 1);
    shape.lineTo(x, -w);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 2 });
  g.rotateX(-Math.PI / 2); // extrude upward; shape y -> -z
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.01) { p.setZ(i, p.getZ(i) * 0.45); p.setX(i, p.getX(i) * 0.9); }
  g.computeVertexNormals();
  return g;
}

class Boat {
  constructor(name, colour, sailColour, berth, ground, game) {
    this.name = name; this.game = game; this.berth = berth; this.ground = ground;
    const g = new THREE.Group();
    this.group = g;
    const body = new THREE.Group(); // pitch/roll/heave
    g.add(body); this.body = body;
    const hull = new THREE.Mesh(hullGeometry(4.6, 1.7, 0.8), mat(colour)); hull.position.y = -0.25; hull.castShadow = true; body.add(hull);
    const rail = new THREE.Mesh(hullGeometry(4.7, 1.78, 0.1), mat('#e9ebe4')); rail.position.y = 0.52; body.add(rail);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 1.2), mat('#7c4d2c')); floor.position.set(-0.1, 0.25, 0); body.add(floor);
    for (const x of [-1.2, 0.3]) { const th = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 1.4), mat('#9b673b')); th.position.set(x, 0.42, 0); body.add(th); }
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.06), mat('#432619')); rudder.position.set(-2.25, 0.05, 0); body.add(rudder);
    const tiller = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), mat('#9b673b')); tiller.position.set(-1.9, 0.6, 0); body.add(tiller);
    // mast + gaff rig on a pivot
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.4, 0.12), mat('#5f3721')); mast.position.set(0.9, 2.4, 0); mast.castShadow = true; body.add(mast);
    this.rig = new THREE.Group(); this.rig.position.set(0.9, 0, 0); body.add(this.rig);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.08), mat('#7c4d2c')); boom.position.set(-1.3, 1.0, 0); this.rig.add(boom);
    const gaff = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.07), mat('#7c4d2c')); gaff.position.set(-1.05, 4.05, 0); gaff.rotation.z = -0.32; this.rig.add(gaff);
    // the sail: a 4x4 vertex quad we can belly out
    this.sailGeo = new THREE.BufferGeometry();
    this.sailCols = 5; this.sailRows = 5;
    const corners = { foot0: [0, 1.05], foot1: [-2.55, 1.05], head0: [0, 3.7], head1: [-2.15, 4.4] };
    this.sailBase = [];
    for (let r = 0; r < this.sailRows; r++) for (let c = 0; c < this.sailCols; c++) {
      const u = c / (this.sailCols - 1), v = r / (this.sailRows - 1);
      const x = lerp(lerp(corners.foot0[0], corners.foot1[0], u), lerp(corners.head0[0], corners.head1[0], u), v);
      const y = lerp(lerp(corners.foot0[1], corners.foot1[1], u), lerp(corners.head0[1], corners.head1[1], u), v);
      this.sailBase.push([x, y, Math.sin(u * Math.PI) * Math.sin(v * Math.PI)]);
    }
    const idx = [];
    for (let r = 0; r < this.sailRows - 1; r++) for (let c = 0; c < this.sailCols - 1; c++) { const a = r * this.sailCols + c; idx.push(a, a + 1, a + this.sailCols, a + 1, a + this.sailCols + 1, a + this.sailCols); }
    this.sailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.sailBase.length * 3), 3));
    this.sailGeo.setIndex(idx);
    const sm = new THREE.MeshLambertMaterial({ color: sailColour, side: THREE.DoubleSide, flatShading: true });
    this.sail = new THREE.Mesh(this.sailGeo, sm); this.sail.castShadow = true;
    this.rig.add(this.sail);
    // crew
    this.skipper = new Person({ shirt: '#f0b142', trousers: '#2c313b', hat: 'souwester', hatColor: '#f0b142', beard: true });
    this.hand = new Person({ shirt: '#2c6293', trousers: '#432619', hat: 'beanie', hatColor: '#2c313b' });
    this.skipper.group.position.set(-1.55, 0.28, 0.25); this.skipper.group.rotation.y = Math.PI / 2;
    this.hand.group.position.set(0.25, 0.28, -0.2); this.hand.group.rotation.y = -Math.PI / 2;
    body.add(this.skipper.group, this.hand.group);
    // fish crates aboard
    this.crateMeshes = [];
    for (let i = 0; i < 4; i++) { const c = crateMesh(); c.position.set(-0.5 + (i % 2) * 0.55, 0.45 + Math.floor(i / 2) * 0.3, (i % 2 ? 0.3 : -0.3)); c.visible = false; body.add(c); this.crateMeshes.push(c); }
    this.crates = 0;
    // mooring lines
    this.lines = [0, 1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ba8653' })); l.frustumCulled = false; return l; });
    game.scene.add(...this.lines);
    // net
    this.net = new Net(game);
    // state
    this.x = berth.x; this.z = berth.z; this.heading = 0; this.speed = 0;
    this.state = 'moored'; this.t = rand(8, 25); this.path = [];
    this.heave = 0; this.pitch = 0; this.roll = 0; this.heel = 0; this.boom = 0;
    this.status = 'Moored';
    this.place();
  }

  routeOut() {
    const b = this.berth, gr = this.ground;
    return b.x > -5 ? [[b.x - 1, -5.5], [-3, 1.5], [-2.5, 9], [gr.x - 2, gr.z]] : [[b.x - 2.5, -5], [-12, -3.5], [gr.x, gr.z]];
  }
  routeHome() { const r = this.routeOut().slice(0, -1).reverse(); return [...r, [this.berth.x + (this.berth.x > -5 ? 0 : 0), this.berth.z + 1.2], [this.berth.x, this.berth.z]]; }

  setStatus(s) { if (s !== this.status) { this.status = s; } }

  update(dt) {
    this.t -= dt;
    const storm = env.weather === 'storm';
    switch (this.state) {
      case 'moored':
        this.setStatus(storm ? 'Sheltering at the quay' : 'Moored');
        if (this.t <= 0 && !storm && !this.game.harbour.boats.some((b) => b !== this && (b.state === 'castoff' || b.state === 'out'))) this.castOff();
        break;
      case 'castoff':
        this.setStatus('Casting off');
        if (this.t <= 0) { this.state = 'out'; this.path = this.routeOut(); this.game.ticker(`The ${this.name} slips her moorings and makes sail for the grounds.`); }
        break;
      case 'out':
        this.setStatus('Sailing to the grounds');
        if (this.sail2(dt)) { this.state = 'shoot'; this.t = 4; this.net.shoot(this); this.game.ticker(`The ${this.name} shoots her net on the grounds.`); }
        break;
      case 'shoot': this.setStatus('Shooting the net'); this.drift(dt); if (this.t <= 0) { this.state = 'soak'; this.t = rand(9, 14); } break;
      case 'soak': this.setStatus('Net soaking'); this.drift(dt); if (this.t <= 0 || storm) { this.state = 'haul'; this.t = 6; this.net.haul(); this.game.ticker(`The ${this.name}’s crew haul the net, silver and flapping.`); } break;
      case 'haul':
        this.setStatus('Hauling the net'); this.drift(dt);
        if (this.t <= 0) {
          this.crates = Math.min(4, 2 + Math.floor(rand(0, 3)) - (storm ? 1 : 0));
          this.net.stow();
          this.state = 'home'; this.path = this.routeHome();
          this.game.ticker(`The ${this.name} heads home with ${this.crates} crates.`);
        }
        break;
      case 'home':
        this.setStatus(`Returning with ${this.crates} crates`);
        if (this.sail2(dt, 0.6)) { this.state = 'berthing'; this.t = 2; }
        break;
      case 'berthing':
        this.setStatus('Berthing');
        this.heading = angleLerp(this.heading, 0, Math.min(1, dt * 2)); this.speed *= Math.exp(-2 * dt);
        if (this.t <= 0) { this.state = 'unload'; this.game.harbour.crane.queue(this); }
        break;
      case 'unload':
        this.setStatus(this.crates ? `Unloading — ${this.crates} left` : 'Unloaded');
        if (!this.crates && !this.game.harbour.crane.busyWith(this)) { this.state = 'moored'; this.t = rand(25, 45); }
        break;
    }
    for (let i = 0; i < 4; i++) this.crateMeshes[i].visible = i < this.crates;
    this.place();
    this.animateCrew(dt);
    this.drawLines();
    this.net.update(dt, this);
  }

  castOff() { this.state = 'castoff'; this.t = 3; }
  recall() {
    if (this.state === 'out' || this.state === 'shoot' || this.state === 'soak') {
      if (this.state !== 'out') { this.crates = Math.max(1, this.state === 'soak' ? 1 : 0); this.net.stow(); }
      this.state = 'home'; this.path = this.routeHome(); return true;
    }
    if (this.state === 'moored') { this.castOff(); return true; }
    return false;
  }

  /** Follow the path under sail; true when the path is done. */
  sail2(dt, slow = 1) {
    if (!this.path.length) return true;
    const [tx, tz] = this.path[0];
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.9) { this.path.shift(); return !this.path.length; }
    const want = Math.atan2(dz, dx);
    this.heading = angleLerp(this.heading, want, Math.min(1, dt * 0.9));
    const rel = env.windDir - this.heading;
    const eff = 0.45 + 0.55 * Math.max(0, (1 + Math.cos(rel)) / 2);
    const target = clamp((0.9 + env.wind * 0.12) * eff, 0.7, 2.6) * slow * (this.path.length === 1 && this.state === 'home' ? clamp(d / 4, 0.35, 1) : 1);
    this.speed += (target - this.speed) * Math.min(1, dt * 0.8);
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;
    return false;
  }
  drift(dt) { this.speed *= Math.exp(-1.2 * dt); this.x += Math.cos(env.windDir) * 0.05 * dt; this.z += Math.sin(env.windDir) * 0.05 * dt; }

  place() {
    const h = this.heading, c = Math.cos(h), s = Math.sin(h);
    const at = (fx, fz) => seaHeight(this.x + c * fx - s * fz, this.z + s * fx + c * fz);
    const hb = at(2.1, 0), hs = at(-2.1, 0), hp = at(0, 0.8), hq = at(0, -0.8);
    const heave = (hb + hs + hp + hq) / 4;
    this.heave = lerp(this.heave, heave, 0.3);
    this.pitch = lerp(this.pitch, Math.atan2(hb - hs, 4.2), 0.2);
    // wind relative to the boat -> boom angle and heel
    const wx = Math.cos(env.windDir), wz = Math.sin(env.windDir);
    const lx = wx * c + wz * s, lz = -wx * s + wz * c;
    const sailing = this.state === 'out' || this.state === 'home';
    const side = lz >= 0 ? 1 : -1;
    const rel = Math.atan2(lz, lx);
    const boomTarget = sailing ? side * lerp(0.18, 1.35, (1 + Math.cos(rel)) / 2) : side * 0.25;
    this.boom = angleLerp(this.boom, boomTarget, 0.05);
    const heelT = sailing ? side * Math.min(0.3, env.wind * 0.028 * Math.abs(Math.sin(rel)) + 0.03) : 0;
    this.heel = lerp(this.heel, heelT, 0.03);
    this.roll = lerp(this.roll, Math.atan2(hp - hq, 1.6), 0.25);
    const g = this.group;
    g.position.set(this.x, this.heave, this.z);
    g.rotation.set(0, -h, 0);
    this.body.rotation.set(this.roll * -1 + this.heel, 0, this.pitch, 'XYZ');
    this.rig.rotation.y = this.boom;
    // belly in the sail: full when sailing, slatting when not
    const P = this.sailGeo.attributes.position.array;
    const fill = sailing ? 0.25 + Math.min(0.45, env.wind * 0.04) : 0.05 + Math.sin(env.t * 6) * 0.04;
    for (let i = 0; i < this.sailBase.length; i++) {
      const [x, y, w] = this.sailBase[i];
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = -side * w * fill * (sailing ? 1 : Math.sin(env.t * 5 + i));
    }
    this.sailGeo.attributes.position.needsUpdate = true;
    this.sailGeo.computeVertexNormals();
  }

  animateCrew(dt) {
    const sk = this.skipper, hd = this.hand, t = env.t;
    sk.sitStool(0.42); sk.pose.handR.set(0.2, 0.62, 0.35); sk.pose.handL.set(-0.25, 0.4, 0.1);
    if (this.state === 'castoff' || this.state === 'unload') { hd.stand(); hd.pose.handL.set(-0.2, 1.1 + Math.sin(t * 6) * 0.15, 0.4); hd.pose.handR.set(0.2, 1.0 - Math.sin(t * 6) * 0.15, 0.4); }
    else if (this.state === 'shoot') { hd.stand(); hd.group.rotation.y = Math.PI; const s = Math.sin(t * 5); hd.pose.handL.set(-0.25, 1.0 + s * 0.3, 0.5 + s * 0.2); hd.pose.handR.set(0.25, 1.0 + s * 0.3, 0.5 + s * 0.2); }
    else if (this.state === 'haul') { hd.stand(); hd.group.rotation.y = Math.PI / 2; const s = Math.sin(t * 4); hd.pose.lean = 0.25 + s * 0.15; hd.pose.handL.set(-0.2, 0.9 + s * 0.25, 0.55); hd.pose.handR.set(0.2, 0.9 - s * 0.25, 0.55); }
    else { hd.group.rotation.y = -Math.PI / 2; hd.sitStool(0.42); hd.pose.handL.set(-0.25, 0.42, 0.25); hd.pose.handR.set(0.25, 0.42, 0.25); }
    sk.update(); hd.update();
  }

  drawLines() {
    const moored = this.state === 'moored' || this.state === 'unload' || (this.state === 'castoff' && this.t > 1.5);
    for (let i = 0; i < 2; i++) {
      const l = this.lines[i];
      l.visible = moored;
      if (!moored) continue;
      const end = this.group.localToWorld(new THREE.Vector3(i ? -2.1 : 2.0, 0.55, 0));
      const bol = new THREE.Vector3(this.berth.x + (i ? -2.6 : 2.6), deckY + 0.55, L.quayZ - 0.45);
      const mid = end.clone().lerp(bol, 0.5); mid.y -= 0.4;
      l.geometry.setFromPoints([end, mid, bol]);
    }
  }
}

function crateMesh() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.38), mat('#ba8653')); b.castShadow = true; g.add(b);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.3), mat('#a5acb6')); top.position.y = 0.13; g.add(top);
  return g;
}

/** A floating drift net: a grid of points on the water with corks along the head rope. */
class Net {
  constructor(game) {
    this.game = game;
    this.nx = 12; this.nz = 5;
    this.pts = Array.from({ length: this.nx * this.nz }, () => new THREE.Vector3());
    this.goal = this.pts.map(() => new THREE.Vector3());
    const seg = [];
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) { const a = j * this.nx + i; if (i < this.nx - 1) seg.push(a, a + 1); if (j < this.nz - 1) seg.push(a, a + this.nx); }
    this.seg = seg;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(seg.length * 3), 3));
    this.lines = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ color: '#a5acb6' }));
    this.lines.frustumCulled = false; this.lines.visible = false;
    this.corks = [];
    for (let i = 0; i < this.nx; i += 2) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.32), mat('#f0b142')); c.visible = false; this.corks.push([i, c]); game.scene.add(c); }
    game.scene.add(this.lines);
    this.state = 'stowed'; this.flop = 0; this.fish = [];
  }
  shoot(boat) {
    this.state = 'shoot'; this.t = 0;
    const h = boat.heading + Math.PI / 2, c = Math.cos(boat.heading), s = Math.sin(boat.heading);
    const sx = boat.x - c * 2.2, sz = boat.z - s * 2.2;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const p = this.pts[j * this.nx + i]; p.set(sx, 0, sz);
      const u = i / (this.nx - 1), v = j / (this.nz - 1);
      // an arc spread away from the stern
      const ang = h + (u - 0.5) * 1.6;
      const r = 2.0 + v * 2.6 + 3.5 * Math.sin(u * Math.PI) * 0.4;
      let gx = sx + Math.cos(ang) * r - c * (1.5 + v), gz = sz + Math.sin(ang) * r - s * (1.5 + v);
      if (!isOpenWater(gx, gz, 0)) { gx = lerp(sx, gx, 0.5); gz = lerp(sz, gz, 0.5); }
      this.goal[j * this.nx + i].set(gx, 0, gz);
    }
    this.lines.visible = true; for (const [, c2] of this.corks) c2.visible = true;
  }
  haul() { this.state = 'haul'; this.t = 0; }
  stow() { this.state = 'stowed'; this.lines.visible = false; for (const [, c] of this.corks) c.visible = false; for (const f of this.fish) this.game.scene.remove(f.m); this.fish = []; }
  update(dt, boat) {
    if (this.state === 'stowed') return;
    this.t += dt;
    const side = new THREE.Vector3(boat.x, 0, boat.z);
    for (let k = 0; k < this.pts.length; k++) {
      const p = this.pts[k], g = this.goal[k];
      if (this.state === 'shoot') { p.x = lerp(p.x, g.x, Math.min(1, dt * 0.9)); p.z = lerp(p.z, g.z, Math.min(1, dt * 0.9)); }
      else if (this.state === 'haul') { p.x = lerp(p.x, side.x, Math.min(1, dt * 0.35)); p.z = lerp(p.z, side.z, Math.min(1, dt * 0.35)); }
      else { p.x += Math.cos(env.windDir) * 0.04 * dt; p.z += Math.sin(env.windDir) * 0.04 * dt; }
      p.y = seaHeight(p.x, p.z) + 0.03 - (k >= this.nx ? 0.06 : 0);
    }
    if (this.state === 'shoot' && this.t > 3.5) this.state = 'soak';
    const A = this.geo.attributes.position.array;
    for (let i = 0; i < this.seg.length; i++) { const p = this.pts[this.seg[i]]; A[i * 3] = p.x; A[i * 3 + 1] = p.y; A[i * 3 + 2] = p.z; }
    this.geo.attributes.position.needsUpdate = true;
    for (const [i, c] of this.corks) c.position.copy(this.pts[i]).add(new THREE.Vector3(0, 0.05, 0));
    // the catch flapping in the net, and gulls drawn to it
    if (this.state === 'soak' || this.state === 'haul') {
      this.flop -= dt;
      if (this.flop <= 0) {
        this.flop = this.state === 'haul' ? rand(0.08, 0.25) : rand(0.4, 1.2);
        const p = this.pts[Math.floor(rand(this.nx, this.pts.length))];
        const m = makeFish(pick(['mackerel', 'herring', 'herring']));
        m.scale.setScalar(0.7);
        this.game.scene.add(m);
        this.fish.push({ m, x: p.x, z: p.z, t: 0, d: rand(0.4, 0.7) });
        this.game.fx.splash(p.x, p.z, 0.12);
        if (Math.random() < 0.3) this.game.gulls?.attract(p.x, p.z);
      }
    }
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i]; f.t += dt;
      const u = f.t / f.d;
      f.m.position.set(f.x, seaHeight(f.x, f.z) + Math.sin(Math.min(1, u) * Math.PI) * 0.5, f.z);
      f.m.rotation.set(Math.sin(f.t * 30) * 0.6, f.t * 3, 0);
      if (u >= 1) { this.game.scene.remove(f.m); this.fish.splice(i, 1); }
    }
  }
  center() { const c = new THREE.Vector3(); for (const p of this.pts) c.add(p); return c.multiplyScalar(1 / this.pts.length); }
}

/** The wooden derrick: slews, luffs and lowers its hook to lift crates one by one. */
class Crane {
  constructor(game) {
    this.game = game;
    const g = new THREE.Group();
    g.position.set(L.crane.x, deckY, L.crane.z);
    this.group = g;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), mat('#5d6572')); base.position.y = 0.2; base.castShadow = true; g.add(base);
    this.slew = new THREE.Group(); this.slew.position.y = 0.4; g.add(this.slew);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.24, 5.6, 0.24), mat('#5f3721')); mast.position.y = 2.8; mast.castShadow = true; this.slew.add(mast);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), mat('#1b1f27')); cap.position.y = 5.65; this.slew.add(cap);
    this.boomPivot = new THREE.Group(); this.boomPivot.position.y = 0.5; this.slew.add(this.boomPivot);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.2, 0.18), mat('#7c4d2c')); boom.position.y = 3.1; boom.castShadow = true; this.boomPivot.add(boom);
    const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 8), mat('#1b1f27')); winch.rotation.x = Math.PI / 2; winch.position.set(0.0, 1.0, 0.45); this.slew.add(winch);
    // guys + falls
    this.ropes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: '#2b1911' }));
    this.ropes.frustumCulled = false;
    game.scene.add(this.ropes);
    this.hook = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), mat('#1b1f27')); game.scene.add(this.hook);
    this.slewA = Math.PI / 2; this.luff = 0.9; this.ropeLen = 1.5;
    this.task = null; this.q = []; this.carry = null;
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 1.4), new THREE.MeshBasicMaterial({ visible: false })); this.hit.position.copy(g.position).add(new THREE.Vector3(0, 3, 0)); game.scene.add(this.hit);
  }
  queue(boat) { if (!this.q.includes(boat)) this.q.push(boat); }
  busyWith(boat) { return this.q.includes(boat) || (this.task && this.task.boat === boat); }
  tipWorld() {
    const r = 6.2 * Math.sin(this.luff), y = deckY + 0.9 + 6.2 * Math.cos(this.luff);
    return new THREE.Vector3(L.crane.x + Math.cos(this.slewA) * r, y, L.crane.z + Math.sin(this.slewA) * r);
  }
  aim(target, dt, speed = 1) {
    const dx = target.x - L.crane.x, dz = target.z - L.crane.z;
    const want = Math.atan2(dz, dx);
    let d = want - this.slewA; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.slewA += clamp(d, -dt * 0.8 * speed, dt * 0.8 * speed);
    const reach = clamp(Math.hypot(dx, dz), 1.2, 6.0);
    const luffT = Math.asin(reach / 6.2);
    this.luff += clamp(luffT - this.luff, -dt * 0.5, dt * 0.5);
    return Math.abs(d) < 0.02 && Math.abs(luffT - this.luff) < 0.02;
  }
  update(dt) {
    const H = this.game.harbour;
    if (!this.task && this.q.length) {
      const boat = this.q[0];
      if (boat.crates > 0) this.task = { boat, step: 'toBoat' };
      else this.q.shift();
    }
    const T = this.task;
    let ropeGoal = 1.4;
    if (T) {
      const boat = T.boat;
      const hold = boat.group.localToWorld(new THREE.Vector3(-0.2, 0.6, 0));
      const pile = new THREE.Vector3(L.cratePile.x, deckY, L.cratePile.z);
      if (T.step === 'toBoat') { if (this.aim(hold, dt)) T.step = 'lower'; }
      else if (T.step === 'lower') { this.aim(hold, dt); ropeGoal = this.tipWorld().y - hold.y - 0.2; if (Math.abs(this.ropeLen - ropeGoal) < 0.05) { T.step = 'attach'; T.t = 0.6; } }
      else if (T.step === 'attach') { this.aim(hold, dt); ropeGoal = this.tipWorld().y - hold.y - 0.2; T.t -= dt; if (T.t <= 0) { boat.crates--; this.carry = crateMesh(); this.game.scene.add(this.carry); T.step = 'raise'; } }
      else if (T.step === 'raise') { ropeGoal = 1.2; if (Math.abs(this.ropeLen - ropeGoal) < 0.05) T.step = 'toPile'; }
      else if (T.step === 'toPile') { ropeGoal = 1.2; if (this.aim(pile, dt)) T.step = 'drop'; }
      else if (T.step === 'drop') { this.aim(pile, dt); ropeGoal = this.tipWorld().y - deckY - 0.45 - Math.min(H.pile, 3) * 0.27; if (Math.abs(this.ropeLen - ropeGoal) < 0.05) { this.game.scene.remove(this.carry); this.carry = null; H.addToPile(); T.step = 'up'; } }
      else if (T.step === 'up') { ropeGoal = 1.4; if (Math.abs(this.ropeLen - ropeGoal) < 0.05) { this.task = null; if (!boat.crates) this.q.shift(); } }
    } else {
      this.aim(new THREE.Vector3(L.crane.x - 2, 0, L.crane.z + 3), dt, 0.4);
    }
    this.ropeLen += clamp(ropeGoal - this.ropeLen, -dt * 1.4, dt * 1.4);
    this.slew.rotation.y = -this.slewA + Math.PI / 2;
    this.boomPivot.rotation.x = this.luff;
    const tip = this.tipWorld();
    const sway = Math.sin(env.t * 1.3) * 0.04 * env.wind * 0.2;
    const hookP = new THREE.Vector3(tip.x + sway, tip.y - this.ropeLen, tip.z);
    this.hook.position.copy(hookP);
    if (this.carry) this.carry.position.copy(hookP).add(new THREE.Vector3(0, -0.3, 0));
    const top = new THREE.Vector3(L.crane.x, deckY + 6.05, L.crane.z);
    const A = this.ropes.geometry.attributes.position;
    const pts = [tip, hookP, top, tip, top, new THREE.Vector3(L.crane.x - 2.5, deckY, L.crane.z - 2), top, new THREE.Vector3(L.crane.x + 2.5, deckY, L.crane.z - 2)];
    pts.forEach((p, i) => A.setXYZ(i, p.x, p.y, p.z));
    A.needsUpdate = true;
  }
}

/** The fish market: stall display, fishmonger, porters, customers and the cat. */
class Market {
  constructor(game) {
    this.game = game;
    this.stock = 6;
    const m = L.market;
    this.display = [];
    for (let i = 0; i < 12; i++) {
      const f = makeFish(pick(['mackerel', 'herring', 'cod', 'bass', 'flounder']));
      f.position.set(m.x - 1.6 + (i % 6) * 0.62, deckY + 1.16, m.z + 0.35 + Math.floor(i / 6) * 0.45);
      f.rotation.set(0, Math.PI / 2 + rand(-0.2, 0.2), Math.PI / 2);
      f.scale.setScalar(0.85);
      game.scene.add(f); this.display.push(f);
    }
    this.monger = new Person({ shirt: '#e9ebe4', trousers: '#2c313b', hat: 'cap', hatColor: '#224b77', apron: '#2c6293', beard: true });
    this.monger.group.position.set(m.x, deckY, m.z - 0.5); this.monger.group.rotation.y = 0;
    game.scene.add(this.monger.group);
    this.serving = null; this.serveT = 0; this.fist = 0;
    this.customers = []; this.custT = 6;
    this.porters = [0, 1].map((i) => {
      const p = new Person({ shirt: i ? '#86563b' : '#5d6572', trousers: '#19375a', hat: 'beanie', hatColor: i ? '#40702d' : '#e67156' });
      p.group.position.set(L.cratePile.x - 1 - i, deckY, L.cratePile.z - 1.5);
      game.scene.add(p.group);
      return { p, w: new Walker(p), state: 'idle', crate: null, home: [L.cratePile.x - 1 - i, L.cratePile.z - 1.5] };
    });
    // the cat
    this.cat = makeCat();
    this.catHome = [L.smokehouse.x - 2.4, L.smokehouse.z + 2.2];
    this.cat.position.set(this.catHome[0], deckY, this.catHome[1]);
    game.scene.add(this.cat);
    this.catState = 'nap'; this.catT = rand(20, 35); this.catFish = null;
  }
  refresh() { this.display.forEach((f, i) => { f.visible = i < this.stock; }); }

  update(dt) {
    const H = this.game.harbour, m = L.market;
    // porters carry crates from the pile to the stall
    for (const po of this.porters) {
      const p = po.p;
      if (po.state === 'idle') {
        p.stand(); p.armsRest();
        if (H.pile > 0 && !this.porters.some((o) => o !== po && o.state === 'toPile')) { po.state = 'toPile'; po.w.go([[L.cratePile.x + 0.7, L.cratePile.z - 0.6]]); }
      } else if (po.state === 'toPile') {
        const ph = po.w.step(dt); p.armsSwing(typeof ph === 'number' ? ph : 0);
        if (!po.w.busy) { if (H.pile > 0) { H.takeFromPile(); po.crate = crateMesh(); this.game.scene.add(po.crate); po.state = 'carry'; po.w.go([[m.x + 2.6, m.z + 2.4], [m.x + 1.0, m.z + 1.9]], 1.0); } else po.state = 'home'; }
      } else if (po.state === 'carry') {
        po.w.step(dt);
        p.pose.handL.set(-0.2, 1.05, 0.38); p.pose.handR.set(0.2, 1.05, 0.38);
        po.crate.position.copy(p.localToWorld(new THREE.Vector3(0, 1.15, 0.42))); po.crate.rotation.y = p.group.rotation.y;
        if (!po.w.busy) { this.game.scene.remove(po.crate); po.crate = null; this.stock = Math.min(12, this.stock + 4); this.game.ticker('A porter sets a fresh crate down at the fish market.'); po.state = 'home'; po.w.go([po.home]); }
      } else if (po.state === 'home') {
        const ph = po.w.step(dt); p.armsSwing(typeof ph === 'number' ? ph : 0);
        if (!po.w.busy) { po.state = 'idle'; p.group.rotation.y = 0; }
      }
      p.update();
    }
    // customers
    this.custT -= dt;
    if (this.custT <= 0 && this.customers.length < 3) {
      this.custT = rand(10, 22);
      const looks = [{ shirt: '#c54236', hat: 'hair', hatColor: '#cdd2d7' }, { shirt: '#86689e', hat: 'hair', hatColor: '#2b1911' }, { shirt: '#97b951', hat: 'cap', hatColor: '#432619' }, { shirt: '#f6d36c', hat: 'hair', hatColor: '#743a10' }];
      const p = new Person({ ...pick(looks), trousers: pick(['#2c313b', '#19375a', '#432619']), skin: pick(['#c08761', '#ebbf98', '#86563b']) });
      const fromEast = Math.random() < 0.5;
      p.group.position.set(fromEast ? 4 : -21, deckY, fromEast ? -21 : -18);
      this.game.scene.add(p.group);
      const c = { p, w: new Walker(p), state: 'arrive', fish: null };
      this.customers.push(c);
    }
    this.customers.forEach((c, i) => {
      const slot = [m.x + 0.3 - i * 0.9, m.z + 2.3];
      if (c.state === 'arrive') { if (!c.w.busy) c.w.go([[m.x + (c.p.group.position.x > m.x ? 3 : -3), m.z + 3.2], slot]); c.state = 'walk'; }
      if (c.state === 'walk') { const ph = c.w.step(dt); c.p.armsSwing(typeof ph === 'number' ? ph : 0); if (!c.w.busy) { c.state = 'queue'; c.p.group.rotation.y = Math.PI; } }
      else if (c.state === 'queue') {
        c.p.stand(); c.p.armsRest();
        if (Math.hypot(c.p.group.position.x - slot[0], c.p.group.position.z - slot[1]) > 0.3) c.w.go([slot]), (c.state = 'walk');
        else if (i === 0 && !this.serving) {
          if (this.stock > 0) { this.serving = c; this.serveT = 2.8; }
          else { c.state = 'leave'; c.w.go([[m.x + 6, m.z + 4], [8, -21]]); this.game.ticker('A customer finds the stall sold out.'); }
        }
      } else if (c.state === 'leave') {
        const ph = c.w.step(dt); c.p.armsSwing(typeof ph === 'number' ? ph : 0);
        if (c.fish) { c.fish.position.copy(c.p.localToWorld(new THREE.Vector3(0.28, 0.75, 0.1))); c.fish.rotation.set(Math.PI / 2, c.p.group.rotation.y, 0); }
        if (!c.w.busy) { this.game.scene.remove(c.p.group); if (c.fish) this.game.scene.remove(c.fish); c.dead = true; }
      }
      c.p.update();
    });
    this.customers = this.customers.filter((c) => !c.dead);
    // the fishmonger
    const mo = this.monger;
    mo.stand();
    if (this.serving) {
      this.serveT -= dt;
      const s = Math.sin(env.t * 9);
      mo.pose.handL.set(-0.25, 1.15 + s * 0.08, 0.45); mo.pose.handR.set(0.25, 1.15 - s * 0.08, 0.45);
      if (this.serveT <= 0) {
        const c = this.serving; this.serving = null;
        if (this.stock > 0) { this.stock--; c.fish = makeFish(pick(['mackerel', 'cod', 'bass'])); c.fish.scale.setScalar(0.8); this.game.scene.add(c.fish); this.game.sold++; }
        c.state = 'leave'; c.w.go([[m.x + 4, m.z + 4], [pick([8, -21]), -20]]);
        this.game.ticker(pick(['“Two mackerel, please.” The fishmonger wraps them in paper.', 'A customer haggles over a fine cod — and wins.', 'Another happy customer leaves the fish market.']));
      }
    } else if (this.fist > 0) {
      this.fist -= dt; mo.pose.handR.set(0.25, 1.7 + Math.sin(env.t * 20) * 0.1, 0.35); mo.pose.handL.set(-0.27, 0.9, 0.05);
    } else mo.armsRest();
    mo.update();
    // the cat
    this.updateCat(dt);
    this.refresh();
  }

  updateCat(dt) {
    const cat = this.cat, m = L.market;
    this.catT -= dt;
    const moveTo = (x, z, sp) => {
      const dx = x - cat.position.x, dz = z - cat.position.z, d = Math.hypot(dx, dz);
      if (d < 0.08) return true;
      cat.rotation.y = Math.atan2(dx, dz);
      cat.position.x += (dx / d) * Math.min(d, sp * dt); cat.position.z += (dz / d) * Math.min(d, sp * dt);
      cat.userData.step(env.t * sp * 4);
      return false;
    };
    if (this.catState === 'nap') { cat.userData.sit(); if (this.catT <= 0 && this.stock > 0) { this.catState = 'sneak'; } }
    else if (this.catState === 'sneak') { if (moveTo(m.x + 1.9, m.z + 1.25, 0.9)) { this.catState = 'grab'; this.catT = 0.6; } }
    else if (this.catState === 'grab') {
      if (this.catT <= 0) {
        if (this.stock > 0) { this.stock--; this.catFish = makeFish('mackerel'); this.catFish.scale.setScalar(0.7); this.game.scene.add(this.catFish); this.game.ticker('The harbour cat makes off with a mackerel! The fishmonger shakes a fist.'); this.fist = 2.2; }
        this.catState = 'flee';
      }
    } else if (this.catState === 'flee') { if (moveTo(this.catHome[0], this.catHome[1], 4.5)) { this.catState = 'eat'; this.catT = 8; } }
    else if (this.catState === 'eat') { cat.userData.sit(); if (this.catT <= 0) { if (this.catFish) this.game.scene.remove(this.catFish); this.catFish = null; this.catState = 'nap'; this.catT = rand(35, 70); } }
    if (this.catFish) { this.catFish.position.copy(cat.position).add(new THREE.Vector3(Math.sin(cat.rotation.y) * 0.32, 0.22, Math.cos(cat.rotation.y) * 0.32)); this.catFish.rotation.set(0, cat.rotation.y + Math.PI / 2, 0); }
  }
}

function makeCat() {
  const g = new THREE.Group();
  const c = '#dc872b', d = '#b05d1b';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.48), mat(c)); body.position.y = 0.22; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), mat(c)); head.position.set(0, 0.34, 0.28);
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.04), mat(d)); e1.position.set(-0.07, 0.46, 0.27);
  const e2 = e1.clone(); e2.position.x = 0.07;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.32), mat(d)); tail.position.set(0, 0.32, -0.36); tail.rotation.x = -0.7;
  const legs = [];
  for (const [x, z] of [[-0.08, 0.16], [0.08, 0.16], [-0.08, -0.16], [0.08, -0.16]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.06), mat(d)); l.position.set(x, 0.07, z); legs.push(l); g.add(l); }
  g.add(body, head, e1, e2, tail);
  g.userData.step = (ph) => { legs.forEach((l, i) => { l.position.y = 0.07 + Math.max(0, Math.sin(ph + (i % 2) * Math.PI + (i > 1 ? Math.PI / 2 : 0))) * 0.05; }); body.position.y = 0.22; head.position.y = 0.34; tail.rotation.x = -0.4 + Math.sin(ph * 0.5) * 0.3; };
  g.userData.sit = () => { body.position.y = 0.16; head.position.y = 0.36; tail.rotation.x = -1.4; legs.forEach((l) => (l.position.y = 0.07)); };
  return g;
}

/** A kid crabbing off the quay wall with a hand line. */
class Kid {
  constructor(game) {
    this.game = game;
    this.p = new Person({ shirt: '#e67156', trousers: '#2c6293', hat: 'cap', hatColor: '#f0b142', scale: 0.62, skin: '#ebbf98' });
    this.p.group.position.set(L.kid.x, deckY + 0.02, L.kid.z - 0.12);
    this.p.group.rotation.y = 0;
    game.scene.add(this.p.group);
    this.bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.28, 8), mat('#f0b142'));
    this.bucket.position.set(L.kid.x + 0.6, deckY + 0.14, L.kid.z - 0.6); game.scene.add(this.bucket);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#cdd2d7' }));
    this.line.frustumCulled = false; game.scene.add(this.line);
    this.crab = makeFish('crab'); this.crab.scale.setScalar(0.8); this.crab.visible = false; game.scene.add(this.crab);
    this.state = 'down'; this.t = rand(8, 16); this.depth = 0; this.count = 0;
  }
  update(dt) {
    const p = this.p; p.sitEdge(env.t * 1.3);
    this.t -= dt;
    const hand = p.localToWorld(new THREE.Vector3(0.05, 0.5, 0.32));
    const water = seaHeight(L.kid.x, L.kid.z + 0.5) - 0.3;
    let endY;
    if (this.state === 'down') { endY = water; if (this.t <= 0) { this.state = 'up'; this.crab.visible = true; } }
    else if (this.state === 'up') {
      this.depth = Math.min(1, this.depth + dt * 0.5); endY = lerp(water, hand.y - 0.35, this.depth);
      if (this.depth >= 1) { this.state = 'show'; this.t = 1.6; this.count++; this.game.popup(this.count === 1 ? 'Got one!' : `${this.count} crabs!`, hand.clone().add(new THREE.Vector3(0, 1.0, 0)), '#f6d36c'); this.game.ticker(`The kid on the quay hauls up crab number ${this.count}.`); }
    } else if (this.state === 'show') { endY = hand.y - 0.35; if (this.t <= 0) { this.state = 'drop'; this.crab.visible = false; this.depth = 0; this.t = rand(10, 22); } }
    else { endY = water; this.state = 'down'; }
    const end = new THREE.Vector3(hand.x, endY, L.kid.z + 0.35);
    this.line.geometry.setFromPoints([hand, end]);
    if (this.crab.visible) { this.crab.position.copy(end).add(new THREE.Vector3(0, -0.08, 0)); this.crab.rotation.y = Math.sin(env.t * 4) * 0.4; }
    p.pose.handR.set(0.05, 0.5 + (this.state === 'up' ? Math.sin(env.t * 10) * 0.08 : 0), 0.32); p.pose.handL.set(-0.12, 0.35, 0.25);
    p.update();
  }
}

/** The harbour bell on its frame. */
class Bell {
  constructor(game) {
    this.game = game;
    this.pivot = new THREE.Group();
    this.pivot.position.set(L.bell.x, deckY + 2.5, L.bell.z);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 0.6, 10), mat('#dc872b')); bell.position.y = -0.38; bell.castShadow = true;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 10), mat('#b05d1b')); lip.position.y = -0.7;
    this.pivot.add(bell, lip);
    game.scene.add(this.pivot);
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.2, 1.2), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.set(L.bell.x, deckY + 1.5, L.bell.z); game.scene.add(this.hit);
    this.a = 0; this.v = 0;
  }
  ring() { this.v += 5; this.game.sound?.bell(); }
  update(dt) { this.v += (-this.a * 30 - this.v * 1.2) * dt; this.a += this.v * dt; this.pivot.rotation.x = this.a * 0.6; }
}

export class Harbour {
  constructor(game) {
    this.game = game;
    game.harbour = this;
    this.pile = 0;
    this.pileMeshes = [];
    for (let i = 0; i < 6; i++) { const c = crateMesh(); c.position.set(L.cratePile.x + (i % 2) * 0.55, deckY + 0.13 + Math.floor(i / 2) * 0.27, L.cratePile.z); c.visible = false; game.scene.add(c); this.pileMeshes.push(c); }
    this.boats = [
      new Boat('Morwenna', '#224b77', '#b05d1b', L.berths[0], L.grounds[0], game),
      new Boat('Lowena', '#40702d', '#e9ebe4', L.berths[1], L.grounds[1], game),
    ];
    this.boats[1].t = 45;
    for (const b of this.boats) game.scene.add(b.group);
    this.crane = new Crane(game); game.scene.add(this.crane.group);
    this.market = new Market(game);
    this.kid = new Kid(game);
    this.bell = new Bell(game);
  }
  addToPile() { this.pile++; this.refreshPile(); }
  takeFromPile() { this.pile = Math.max(0, this.pile - 1); this.refreshPile(); }
  refreshPile() { this.pileMeshes.forEach((m, i) => (m.visible = i < this.pile)); }
  ringBell() {
    this.bell.ring();
    let any = false;
    for (const b of this.boats) if (b.state !== 'moored' && b.recall()) { any = true; this.game.ticker(`The bell rings out — the ${b.name} turns for home.`); }
    if (!any) {
      const b = this.boats.find((x) => x.state === 'moored');
      if (b && env.weather !== 'storm') { b.castOff(); this.game.ticker(`The bell rings — the ${b.name}’s crew run to cast off.`); }
      else this.game.ticker(env.weather === 'storm' ? 'The bell clangs in the gale, but nobody is putting to sea in this.' : 'The bell rings across the harbour.');
    }
  }
  update(dt) {
    for (const b of this.boats) b.update(dt);
    this.crane.update(dt);
    this.market.update(dt);
    this.kid.update(dt);
    this.bell.update(dt);
  }
}
