// Herring gulls: perch, soar, float on the swell, dive for bread, and steal from buckets.
import * as THREE from 'three';
import { env, seaHeight, rand, pick, clamp, lerp } from './env.js';
import { mat } from './people.js';
import { perches } from './world.js';
import { isOpenWater, makeFish } from './fishing.js';

function gullMesh() {
  const g = new THREE.Group();
  const b = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  b(0.22, 0.2, 0.52, '#fbfbf5', 0, 0, 0);
  b(0.16, 0.16, 0.16, '#fbfbf5', 0, 0.12, 0.3);
  b(0.05, 0.05, 0.12, '#f0b142', 0, 0.1, 0.43);
  b(0.16, 0.06, 0.18, '#a5acb6', 0, 0.04, -0.32);
  const wing = (s) => {
    const piv = new THREE.Group(); piv.position.set(s * 0.1, 0.06, 0); g.add(piv);
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.26), mat('#a5acb6')); w.position.x = s * 0.31; w.castShadow = true; piv.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.2), mat('#1b1f27')); tip.position.x = s * 0.64; piv.add(tip);
    return piv;
  };
  g.userData.wl = wing(-1); g.userData.wr = wing(1);
  return g;
}

export class Gulls {
  constructor(game) {
    this.game = game;
    game.gulls = this;
    this.group = new THREE.Group();
    this.perches = perches();
    this.list = [];
    this.bread = [];
    for (let i = 0; i < 9; i++) {
      const m = gullMesh();
      this.group.add(m);
      const g = { m, pos: new THREE.Vector3(rand(-15, 15), rand(6, 12), rand(-12, 15)), vel: new THREE.Vector3(), state: 'soar', t: rand(3, 12), ctr: new THREE.Vector3(rand(-8, 8), 0, rand(-4, 12)), rad: rand(5, 9), alt: rand(7, 12), ang: rand(0, 6.28), flap: rand(0, 6), carry: null };
      if (i < 4) this.toPerch(g, true);
      this.list.push(g);
    }
  }
  toPerch(g, snap) {
    const used = new Set(this.list.filter((o) => o.state === 'perch' || o.state === 'toPerch').map((o) => o.perch));
    const free = this.perches.map((p, i) => i).filter((i) => !used.has(i));
    if (!free.length) { g.state = 'soar'; return; }
    g.perch = pick(free); g.target = new THREE.Vector3(...this.perches[g.perch]);
    g.state = snap ? 'perch' : 'toPerch'; g.t = rand(8, 25);
    if (snap) g.pos.copy(g.target);
  }
  toFloat(g) {
    for (let i = 0; i < 20; i++) { const x = rand(-16, 16), z = rand(-7, 18); if (isOpenWater(x, z, 1)) { g.target = new THREE.Vector3(x, 0, z); g.state = 'toFloat'; g.t = 30; return; } }
    g.state = 'soar';
  }
  throwBread(x, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.16), mat('#d6aa78'));
    this.group.add(m);
    const b = { m, x, z, t: 22, taken: false };
    this.bread.push(b);
    this.game.fx.splash(x, z, 0.12);
    // the nearest few gulls dive for it
    const near = this.list.filter((g) => !g.carry && g.state !== 'steal').sort((a, c) => a.pos.distanceToSquared(new THREE.Vector3(x, 1, z)) - c.pos.distanceToSquared(new THREE.Vector3(x, 1, z))).slice(0, 3);
    for (const g of near) { g.state = 'dive'; g.prey = b; g.t = 12; }
  }
  attract(x, z) {
    const g = this.list.find((o) => o.state === 'soar' || o.state === 'float');
    if (g) { g.state = 'dive'; g.prey = { x, z, t: 4, fish: true, m: null }; g.t = 8; }
  }
  update(dt) {
    const anglers = this.game.fishing.anglers;
    // drifting / sinking bread
    for (const b of this.bread) {
      b.t -= dt;
      b.x += Math.cos(env.windDir) * env.wind * 0.01 * dt; b.z += Math.sin(env.windDir) * env.wind * 0.01 * dt;
      b.m.position.set(b.x, seaHeight(b.x, b.z) + 0.03 - (b.t < 3 ? (3 - b.t) * 0.08 : 0), b.z);
      b.m.rotation.y += dt * 0.3;
    }
    this.bread = this.bread.filter((b) => { if (b.t <= 0 || b.taken) { this.group.remove(b.m); return false; } return true; });
    for (const g of this.list) {
      g.t -= dt; g.flap += dt * 12;
      let target = null, speed = 5.5, flapping = true, sitting = false;
      switch (g.state) {
        case 'soar': {
          g.ang += dt * 0.45;
          target = new THREE.Vector3(g.ctr.x + Math.cos(g.ang) * g.rad, g.alt + Math.sin(g.ang * 2) * 0.6, g.ctr.z + Math.sin(g.ang) * g.rad);
          flapping = Math.sin(g.flap * 0.08) > 0.6;
          if (g.t <= 0) {
            const r = Math.random();
            // sometimes go thieving from a bucket
            const full = anglers.filter((a) => a.bucketCount > 0);
            if (r < 0.22 && full.length) { g.state = 'steal'; g.victim = pick(full); g.t = 14; }
            else if (r < 0.55) this.toPerch(g); else if (r < 0.8 && env.weather !== 'storm') this.toFloat(g);
            else { g.t = rand(6, 14); g.ctr.set(rand(-8, 8), 0, rand(-4, 12)); }
          }
          break;
        }
        case 'toPerch': target = g.target.clone().add(new THREE.Vector3(0, 0.12, 0)); if (g.pos.distanceTo(target) < 0.15) { g.state = 'perch'; g.pos.copy(target); } break;
        case 'perch': sitting = true; target = g.pos; if (g.t <= 0) { g.state = 'soar'; g.t = rand(8, 15); g.vel.set(0, 2, 0); } break;
        case 'toFloat': {
          const y = seaHeight(g.target.x, g.target.z);
          target = new THREE.Vector3(g.target.x, y + 0.1, g.target.z); speed = 4.5;
          if (g.pos.distanceTo(target) < 0.2) { g.state = 'float'; g.t = rand(10, 25); }
          break;
        }
        case 'float': {
          sitting = true;
          g.target.x += Math.cos(env.windDir) * env.wind * 0.01 * dt; g.target.z += Math.sin(env.windDir) * env.wind * 0.01 * dt;
          g.pos.set(g.target.x, seaHeight(g.target.x, g.target.z) + 0.1, g.target.z);
          if (g.t <= 0 || !isOpenWater(g.target.x, g.target.z, 0.3)) { g.state = 'soar'; g.t = rand(6, 12); g.vel.set(0, 2.5, 0); }
          break;
        }
        case 'dive': {
          const b = g.prey;
          if (!b || b.taken || b.t <= 0) { g.state = 'soar'; g.t = rand(4, 10); break; }
          const y = seaHeight(b.x, b.z) + 0.15;
          target = new THREE.Vector3(b.x, y, b.z); speed = 8;
          flapping = g.pos.y < 3;
          if (g.pos.distanceTo(target) < 0.35) {
            if (!b.fish) { b.taken = true; this.game.ticker(pick(['A gull snatches the bread before it hits the water!', 'Squabbling gulls — the boldest one wins the crust.'])); }
            g.carry = makeFish(b.fish ? 'herring' : 'weed'); g.carry.scale.setScalar(b.fish ? 0.5 : 0.01); this.group.add(g.carry);
            this.game.fx.splash(b.x, b.z, 0.15);
            g.state = 'soar'; g.t = rand(5, 9); g.vel.y = 3; g.carryT = 4;
          }
          if (g.t <= 0) g.state = 'soar';
          break;
        }
        case 'steal': {
          const a = g.victim;
          if (!a || a.bucketCount <= 0 || g.t <= 0) { g.state = 'soar'; g.t = rand(5, 10); break; }
          target = a.bucket.position.clone().add(new THREE.Vector3(0, 0.55, 0)); speed = 6;
          if (g.pos.distanceTo(target) < 0.3) {
            a.bucketCount--;
            a.say(pick(['Oi! That’s mine!', 'Thief!', 'Shoo!']), '#e67156');
            this.game.ticker(`A gull steals a fish from ${a.name}’s bucket!`);
            this.game.stolen++;
            g.carry = makeFish('mackerel'); g.carry.scale.setScalar(0.6); this.group.add(g.carry); g.carryT = 6;
            g.state = 'soar'; g.t = rand(6, 10); g.vel.set(0, 4, 0); g.ctr.set(rand(-6, 6), 0, rand(8, 16));
          }
          break;
        }
      }
      if (target && !sitting) {
        const d = target.clone().sub(g.pos);
        const want = d.clone().normalize().multiplyScalar(Math.min(speed, d.length() * 2.5));
        g.vel.lerp(want, Math.min(1, dt * 2.2));
        g.pos.addScaledVector(g.vel, dt);
      }
      // orient + flap
      const m = g.m;
      m.position.copy(g.pos);
      if (g.vel.lengthSq() > 0.05 && !sitting) m.rotation.set(-clamp(g.vel.y * 0.08, -0.5, 0.5), Math.atan2(g.vel.x, g.vel.z), 0);
      const wa = sitting ? 1.25 : flapping ? Math.sin(g.flap) * 0.7 : 0.08;
      m.userData.wl.rotation.z = sitting ? -1.3 : -wa; m.userData.wr.rotation.z = sitting ? 1.3 : wa;
      if (g.carry) {
        g.carry.position.copy(g.pos).add(new THREE.Vector3(Math.sin(m.rotation.y) * 0.45, 0.02, Math.cos(m.rotation.y) * 0.45));
        g.carry.rotation.set(0, m.rotation.y + Math.PI / 2, 0);
        g.carryT -= dt;
        if (g.carryT <= 0) { this.group.remove(g.carry); g.carry = null; }
      }
    }
  }
}
