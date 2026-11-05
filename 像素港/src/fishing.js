// The five anglers on the pier: rods that bend toward the line's pull, sagging lines and floats,
// parabolic casts, nibbles and bites, strikes, fights (runs, rests, jumps, snaps) and landing.
import * as THREE from 'three';
import { env, seaHeight, rand, pick, clamp, lerp, smooth } from './env.js';
import { Person, mat } from './people.js';
import { L } from './world.js';

export const SPECIES = {
  mackerel: { name: 'Mackerel', kg: [0.25, 1.1], min: 0.3, body: '#3b7cb0', belly: '#cdd2d7', len: 0.55, power: 0.65, jump: 0.35, w: { dawn: 5, day: 3, dusk: 5, night: 1 } },
  herring: { name: 'Herring', kg: [0.1, 0.45], min: 0.15, body: '#7f8794', belly: '#e9ebe4', len: 0.42, power: 0.35, jump: 0.15, w: { dawn: 4, day: 4, dusk: 3, night: 2 } },
  bass: { name: 'Sea bass', kg: [0.5, 5.5], min: 1.1, body: '#5d6572', belly: '#cdd2d7', len: 0.8, power: 1.05, jump: 0.3, w: { dawn: 2, day: 1, dusk: 4, night: 3 } },
  cod: { name: 'Cod', kg: [1, 9], min: 1.5, body: '#9b673b', belly: '#d6aa78', len: 0.95, power: 1.2, jump: 0.03, w: { dawn: 1, day: 1, dusk: 2, night: 4 } },
  flounder: { name: 'Flounder', kg: [0.3, 2.4], min: 0.4, body: '#86563b', belly: '#e9ebe4', len: 0.55, power: 0.55, jump: 0, flat: true, w: { dawn: 2, day: 4, dusk: 2, night: 1 } },
  conger: { name: 'Conger eel', kg: [2, 18], min: 0, body: '#2c313b', belly: '#5d6572', len: 1.4, power: 2.1, jump: 0, eel: true, w: { dawn: 0.3, day: 0.2, dusk: 1, night: 3 } },
  crab: { name: 'Shore crab', kg: [0.08, 0.4], min: 99, body: '#c54236', belly: '#e67156', len: 0.35, power: 0.2, jump: 0, crab: true, w: { dawn: 1.5, day: 1.5, dusk: 1.5, night: 2 } },
  boot: { name: 'Old boot', kg: [0.6, 1.3], junk: true, body: '#432619', belly: '#2b1911', len: 0.4, power: 0.15, jump: 0, w: { dawn: 0.5, day: 0.6, dusk: 0.5, night: 0.4 } },
  weed: { name: 'Seaweed', kg: [0.1, 0.6], junk: true, body: '#40702d', belly: '#64933a', len: 0.5, power: 0.1, jump: 0, w: { dawn: 1, day: 1.2, dusk: 1, night: 0.8 } },
};

export function period(clock = env.clock) {
  const h = (clock / 60) % 24;
  return h >= 5 && h < 9 ? 'dawn' : h >= 9 && h < 17 ? 'day' : h >= 17 && h < 21 ? 'dusk' : 'night';
}
function pickSpecies() {
  const per = period();
  const entries = Object.entries(SPECIES).map(([k, s]) => {
    let w = s.w[per];
    if (env.weather === 'storm' && (k === 'bass' || k === 'cod')) w *= 1.8;
    if (env.weather === 'calm' && k === 'mackerel') w *= 1.3;
    return [k, w];
  });
  let r = Math.random() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return 'mackerel';
}

/** Is (x, z) open harbour water (not pier, quay, rocks or the lighthouse islet)? */
export function isOpenWater(x, z, m = 0.6) {
  if (Math.hypot(x, z) > 20.6 - m) return false;
  if (z < L.quayZ + 0.8 + m) return false;
  const P = L.pier;
  if (x > P.x0 - m && x < P.x1 + m && z < P.z1 + m) return false;
  if (x > P.tx0 - m && x < P.tx1 + m && z > P.tz0 - m && z < P.z1 + m) return false;
  if (Math.hypot(x - L.lighthouse.x, z - L.lighthouse.z) < 4.3 + m) return false;
  return true;
}

export function makeFish(key) {
  const sp = SPECIES[key];
  const g = new THREE.Group();
  const box = (w, h, d, c, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const L0 = sp.len;
  if (sp.crab) {
    box(0.34, 0.12, 0.26, sp.body); box(0.12, 0.08, 0.1, sp.belly, 0.22, 0, 0.12); box(0.12, 0.08, 0.1, sp.belly, -0.22, 0, 0.12);
  } else if (key === 'boot') {
    box(0.14, 0.3, 0.16, sp.body, 0, 0.08, 0); box(0.14, 0.1, 0.32, sp.body, 0, -0.05, 0.1); box(0.15, 0.03, 0.34, sp.belly, 0, -0.1, 0.1);
  } else if (key === 'weed') {
    for (let i = 0; i < 4; i++) box(0.05, 0.5 - i * 0.07, 0.05, i % 2 ? sp.body : sp.belly, (i - 1.5) * 0.06, -0.2, 0);
  } else if (sp.flat) {
    box(L0 * 0.6, 0.06, L0 * 0.75, sp.body, 0, 0, 0); box(L0 * 0.6, 0.03, L0 * 0.7, sp.belly, 0, -0.04, 0); box(0.08, 0.04, L0 * 0.3, sp.body, 0, 0, -L0 * 0.5);
  } else {
    const h = sp.eel ? 0.12 : L0 * 0.28;
    box(sp.eel ? 0.1 : L0 * 0.13, h, L0 * 0.78, sp.body, 0, h * 0.12, 0);
    box(sp.eel ? 0.09 : L0 * 0.12, h * 0.45, L0 * 0.72, sp.belly, 0, -h * 0.3, 0);
    box(0.04, h * 0.9, L0 * 0.18, sp.body, 0, 0, -L0 * 0.46);
    if (key === 'mackerel') for (let i = 0; i < 3; i++) box(L0 * 0.135, 0.03, 0.06, '#0d3434', 0, h * 0.35, -0.12 + i * 0.12);
  }
  return g;
}

const ANGLERS = [
  { name: 'Ned', x: 5.6, z: -5.0, yaw: Math.PI / 2, pose: 'edge', look: { shirt: '#224b77', trousers: '#2c313b', hat: 'souwester', hatColor: '#f0b142', beard: true, skin: '#c08761' }, skill: 0.75 },
  { name: 'Morwen', x: 3.2, z: -1.6, yaw: -Math.PI / 2, pose: 'edge', look: { shirt: '#40702d', trousers: '#432619', hat: 'beanie', hatColor: '#c54236', skin: '#ebbf98' }, skill: 0.85 },
  { name: 'Jago', x: 2.5, z: 4.55, yaw: 0, pose: 'stool', look: { shirt: '#7f8794', trousers: '#19375a', hat: 'cap', hatColor: '#5f3721', skin: '#86563b' }, skill: 0.6 },
  { name: 'Tamsin', x: 6.2, z: 5.05, yaw: 0, pose: 'stand', look: { shirt: '#2c6293', trousers: '#2c313b', hat: 'hair', hatColor: '#743a10', skin: '#ebbf98', boots: '#c54236' }, skill: 0.9 },
  { name: 'Pascoe', x: 9.35, z: 4.2, yaw: Math.PI / 2, pose: 'stand', look: { shirt: '#982824', trousers: '#2c313b', hat: 'cap', hatColor: '#e9ebe4', skin: '#c08761' }, skill: 0.7 },
];

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion(), idQ = new THREE.Quaternion();

class Angler {
  constructor(def, game) {
    this.def = def; this.game = game; this.name = def.name;
    const p = new Person(def.look);
    this.person = p;
    const deckY = L.pier.y + 0.06;
    p.group.position.set(def.x, deckY, def.z);
    p.group.rotation.y = def.yaw;
    if (def.pose === 'edge') p.sitEdge(0); else if (def.pose === 'stool') p.sitStool(0.6); else p.stand();
    // rod (8 segments), line, float, bucket
    this.rodPts = Array.from({ length: 10 }, () => new THREE.Vector3());
    this.rod = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.rodPts), new THREE.LineBasicMaterial({ color: '#2b1911' }));
    this.rod.frustumCulled = false;
    this.reel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat('#5d6572'));
    this.linePts = Array.from({ length: 18 }, () => new THREE.Vector3());
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.linePts), new THREE.LineBasicMaterial({ color: '#cdd2d7' }));
    this.line.frustumCulled = false;
    this.float = new THREE.Group();
    const ft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), mat('#e67156')); ft.position.y = 0.12;
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.2), mat('#fbfbf5'));
    this.float.add(ft, fb);
    this.bucket = new THREE.Group();
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.42, 8), mat('#2c6293')); bk.position.y = 0.21; bk.castShadow = true;
    const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 8), mat('#3f9a90')); bw.position.y = 0.38;
    this.bucket.add(bk, bw);
    const bl = new THREE.Vector3(def.pose === 'edge' ? -0.6 : 0.62, 0, def.pose === 'edge' ? -0.45 : -0.15);
    this.bucket.position.copy(p.localToWorld(bl)); this.bucket.position.y = deckY;
    this.bucketCount = 0;
    this.group = new THREE.Group();
    this.group.add(p.group, this.rod, this.reel, this.line, this.float, this.bucket);
    // a hit box for clicking
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 1.2), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.set(def.x, deckY + 0.9, def.z);
    this.hit.userData.angler = this;
    this.group.add(this.hit);
    // state
    this.state = 'idle'; this.t = rand(0.5, 3);
    this.pitch = 0.65; this.yawOff = rand(-0.15, 0.15);
    this.tension = 0.05;
    this.end = new THREE.Vector3(); // where the line ends (float / fish)
    this.floatPos = new THREE.Vector3();
    this.bait = true;
    this.fish = null; this.fishMesh = null;
    this.swing = rand(0, 6);
  }

  forward() { const y = this.def.yaw + this.yawOff; return new THREE.Vector3(Math.sin(y), 0, Math.cos(y)); }
  rodBase() { const s = this.person; const b = new THREE.Vector3(0.14, s.pose.hip.y + 0.2, 0.3); return s.localToWorld(b); }
  rodDir() {
    const y = this.def.yaw + this.yawOff;
    const c = Math.cos(this.pitch);
    return new THREE.Vector3(Math.sin(y) * c, Math.sin(this.pitch), Math.cos(y) * c).normalize();
  }
  tip() { return this.rodPts[9]; }

  pickTarget() {
    const base = this.rodBase();
    for (let i = 0; i < 30; i++) {
      const a = this.def.yaw + rand(-0.55, 0.55), d = rand(4.5, 9.5);
      const x = base.x + Math.sin(a) * d, z = base.z + Math.cos(a) * d;
      if (isOpenWater(x, z, 0.8)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(base.x + Math.sin(this.def.yaw) * 4, 0, base.z + Math.cos(this.def.yaw) * 4);
  }

  say(text, color) { this.game.popup(text, this.person.localToWorld(new THREE.Vector3(0, 2.1, 0)), color); }

  // ---- interaction -------------------------------------------------------------
  click() {
    if (this.state === 'nobait') { this.bait = true; this.say('Fresh bait!', '#f6d36c'); this.game.ticker(`${this.name} baits up with a strip of mackerel.`); this.go('rebait', 1.2); return true; }
    if (this.state === 'nibble') { this.strike(true); return true; }
    if (this.state === 'bite') { this.strike(false); return true; }
    this.say(pick(['Quiet out there.', 'Bites are slow.', 'Lovely evening.', 'Tide’s turning.', 'Shh!']), '#cdd2d7');
    return false;
  }
  go(state, t = 0) { this.state = state; this.t = t; this.st = 0; }

  lose(kind) {
    this.bait = false;
    this.say(kind === 'early' ? 'Too soon!' : 'Too slow!', '#e67156');
    this.game.ticker(kind === 'early' ? `${this.name} struck at a nibble — the bait’s gone.` : `${this.name} was too slow; the fish stripped the hook.`);
    this.fish = null;
    this.go('reelEmpty', 1.4);
  }

  strike(early) {
    this.pitch = 1.25;
    if (early || !this.fish) { this.lose('early'); return; }
    this.go('fight');
    this.fish.mode = 'run'; this.fish.modeT = rand(0.8, 1.6);
    this.say('Fish on!', '#97b951');
  }

  // ---- update ------------------------------------------------------------------
  update(dt) {
    const p = this.person;
    this.t -= dt; this.st = (this.st || 0) + dt;
    this.swing += dt * 0.9;
    if (this.def.pose === 'edge') p.sitEdge(this.swing);
    const base = this.rodBase();
    let targetPitch = 0.65, lean = this.def.pose === 'edge' ? -0.05 : 0.02;
    let tension = 0.05;
    const surf = (x, z) => seaHeight(x, z);
    switch (this.state) {
      case 'idle': if (this.t <= 0) this.go(this.bait ? 'windup' : 'nobait', 0.45); break;
      case 'rebait': targetPitch = 0.3; if (this.t <= 0) this.go('windup', 0.45); break;
      case 'windup': {
        targetPitch = 1.95; lean = -0.12;
        if (this.t <= 0) { this.target = this.pickTarget(); this.go('flick', 0.2); }
        break;
      }
      case 'flick': {
        targetPitch = 0.3; lean = 0.12;
        if (this.t <= 0) {
          this.castFrom = this.tip().clone();
          const d = this.castFrom.distanceTo(this.target);
          this.flightT = 0.55 + d * 0.07; this.flightH = 1.4 + d * 0.15;
          this.go('flight', this.flightT);
        }
        break;
      }
      case 'flight': {
        targetPitch = 0.45;
        const u = clamp(1 - this.t / this.flightT, 0, 1);
        const ty = surf(this.target.x, this.target.z);
        this.floatPos.set(lerp(this.castFrom.x, this.target.x, u), lerp(this.castFrom.y, ty, u) + 4 * this.flightH * u * (1 - u), lerp(this.castFrom.z, this.target.z, u));
        tension = 0.02;
        if (this.t <= 0) { this.game.fx.splash(this.target.x, this.target.z, 0.25); this.floatPos.copy(this.target); this.go('wait'); this.nextBite = rand(4, 22) / this.biteRate(); }
        break;
      }
      case 'wait': {
        this.nextBite -= dt;
        this.floatPos.x += Math.cos(env.windDir) * env.wind * 0.004 * dt; this.floatPos.z += Math.sin(env.windDir) * env.wind * 0.004 * dt;
        this.floatPos.y = surf(this.floatPos.x, this.floatPos.z) + 0.02;
        if (this.nextBite <= 0 && this.bait) this.startBite();
        break;
      }
      case 'nibble': {
        const f = this.fish;
        const k = f.nibbles[0];
        let dip = 0;
        if (k !== undefined) {
          if (this.st > k && this.st < k + 0.16) dip = -0.09;
          if (this.st > k + 0.16) {
            f.nibbles.shift();
            // an impatient angler strikes at a nibble
            if (Math.random() < 0.12 * (1.2 - this.def.skill)) { this.strike(true); break; }
          }
        } else { this.go('bite', f.window); this.game.fx.splash(this.floatPos.x, this.floatPos.z, 0.15); f.react = rand(0.12, 0.45) + (1 - this.def.skill) * rand(0, 0.9); break; }
        this.floatPos.y = surf(this.floatPos.x, this.floatPos.z) + 0.02 + dip;
        tension = dip ? 0.12 : 0.05;
        break;
      }
      case 'bite': {
        // the float is dragged under; strike in time or lose the bait
        this.floatPos.y = lerp(this.floatPos.y, surf(this.floatPos.x, this.floatPos.z) - 0.45, Math.min(1, dt * 10));
        this.floatPos.x += Math.sin(this.st * 7) * 0.01;
        tension = 0.35;
        if (this.st >= this.fish.react && !this.fish.reacted) { this.fish.reacted = true; if (this.st <= this.fish.window) { this.strike(false); break; } }
        if (this.t <= 0 && this.state === 'bite') { this.pitchV = 6; this.lose('late'); }
        break;
      }
      case 'fight': tension = this.fight(dt, base); targetPitch = 1.0; lean = -0.15; break;
      case 'land': targetPitch = 1.25; tension = 0.3 + (this.fish.kg / 20); lean = -0.1; this.landing(dt); break;
      case 'unhook': case 'weigh': case 'stow': case 'release': targetPitch = 0.25; this.handling(dt); break;
      case 'reelEmpty': {
        targetPitch = 0.9;
        const home = base.clone().addScaledVector(this.forward(), 1.2);
        this.floatPos.x = lerp(this.floatPos.x, home.x, Math.min(1, dt * 1.6));
        this.floatPos.z = lerp(this.floatPos.z, home.z, Math.min(1, dt * 1.6));
        this.floatPos.y = surf(this.floatPos.x, this.floatPos.z) + 0.03;
        if (this.t <= 0) this.go(this.bait ? 'rebait' : 'nobait', this.bait ? 1.5 : 25);
        break;
      }
      case 'snapped': targetPitch = 0.4; if (this.t <= 0) { this.say('Retied.', '#cdd2d7'); this.bait = true; this.go('rebait', 1.0); } break;
      case 'nobait': targetPitch = 0.25; this.floatPos.copy(this.tip()).add(new THREE.Vector3(0, -0.5, 0)); if (this.t <= 0) { this.bait = true; this.say('Baited up.', '#f6d36c'); this.go('rebait', 1.0); } break;
    }
    // rod pose (springy toward the target pitch)
    this.pitchV = (this.pitchV || 0) + ((targetPitch - this.pitch) * 60 - (this.pitchV || 0) * 12) * dt;
    this.pitch += this.pitchV * dt;
    this.tension += (tension - this.tension) * Math.min(1, dt * 8);
    p.pose.lean = lerp(p.pose.lean, lean, Math.min(1, dt * 5));
    // where the line ends
    if (this.fish && (this.state === 'fight')) this.end.copy(this.fish.pos);
    else if (this.state === 'land' || this.state === 'unhook' || this.state === 'weigh') this.end.copy(this.fishMesh.position);
    else if (this.state === 'nobait' || this.state === 'snapped' || this.state === 'release' || this.state === 'stow' || this.state === 'rebait' || this.state === 'windup' || this.state === 'flick' || this.state === 'idle') this.end.copy(this.tip()).add(new THREE.Vector3(0, -0.45, 0));
    else this.end.copy(this.floatPos);
    this.solveRod(base);
    this.float.visible = this.state !== 'land' && this.state !== 'unhook' && this.state !== 'weigh' && this.state !== 'snapped';
    if (this.float.visible) this.float.position.copy(this.state === 'fight' ? new THREE.Vector3(this.fish.pos.x, surf(this.fish.pos.x, this.fish.pos.z) - 0.1, this.fish.pos.z) : this.end);
    this.drawLine();
    // hands on the rod
    const d = this.rodDir();
    p.handsWorld(base, base.clone().addScaledVector(d, 0.45));
    p.pose.headPitch = 0.25;
    p.update();
  }

  biteRate() {
    const per = period();
    return (per === 'dawn' || per === 'dusk' ? 1.4 : per === 'night' ? 1.1 : 0.8) * (env.weather === 'storm' ? 1.2 : 1);
  }

  startBite() {
    const key = pickSpecies(), sp = SPECIES[key];
    const u = Math.pow(Math.random(), 2.2);
    const kg = +(sp.kg[0] + (sp.kg[1] - sp.kg[0]) * u).toFixed(2);
    this.fish = {
      key, sp, kg, pos: this.floatPos.clone(), stamina: 1, power: sp.power * (0.6 + 0.6 * u),
      nibbles: sp.junk ? [] : Array.from({ length: 1 + Math.floor(rand(0, 3)) }, (_, i) => 0.4 + i * rand(0.5, 1.1)),
      window: sp.junk ? 3 : rand(0.55, 1.05), mode: 'rest', modeT: 1,
    };
    this.go('nibble');
  }

  fight(dt, base) {
    const f = this.fish, sp = f.sp;
    f.modeT -= dt;
    const bx = base.x, bz = base.z;
    let dist = Math.hypot(f.pos.x - bx, f.pos.z - bz), ang = Math.atan2(f.pos.z - bz, f.pos.x - bx);
    let tension;
    if (sp.junk || sp.crab) {
      dist -= dt * (sp.crab ? 1.0 : 1.3);
      tension = sp.crab ? 0.35 : 0.3;
    } else if (f.mode === 'run') {
      const v = (0.6 + 1.1 * f.power) * (0.35 + 0.65 * f.stamina);
      dist += v * dt * 0.7;
      f.angV = (f.angV || 0) + rand(-1, 1) * dt * 2; f.angV *= 0.97;
      ang += f.angV * dt;
      f.stamina -= dt * 0.11 / Math.sqrt(f.power);
      tension = 0.55 + 0.45 * Math.min(1.4, f.power) * (0.4 + 0.6 * f.stamina) + rand(-0.06, 0.06);
      if (sp.jump && !f.jumped && Math.random() < sp.jump * dt * 0.6) this.jump();
      // big fish can part the line
      if (f.power > 1.2 && tension > 1.05 && Math.random() < dt * 0.22 * (f.power - 1.1)) { this.snap(); return 0.05; }
      if (f.modeT <= 0) { f.mode = 'rest'; f.modeT = rand(0.9, 2.0) * (1.6 - f.stamina * 0.6); }
    } else {
      dist -= dt * 1.5; // reel in while the fish rests
      tension = 0.28 + 0.1 * f.power;
      f.stamina = Math.min(1, f.stamina + dt * 0.01);
      if (f.modeT <= 0 && f.stamina > 0.12) { f.mode = 'run'; f.modeT = rand(0.8, 2.4) * (0.4 + 0.6 * f.stamina); f.jumped = false; }
    }
    let nx = bx + Math.cos(ang) * dist, nz = bz + Math.sin(ang) * dist;
    if (!isOpenWater(nx, nz, 0.2) && dist > 2) { dist -= dt * 1.2; nx = bx + Math.cos(ang) * dist; nz = bz + Math.sin(ang) * dist; f.angV = -(f.angV || 0); }
    f.pos.set(nx, seaHeight(nx, nz) - (f.jumpT > 0 ? -1 : 0.3), nz);
    if (f.jumpT > 0) {
      f.jumpT -= dt;
      const u = 1 - f.jumpT / 0.7;
      f.pos.y = seaHeight(nx, nz) + Math.sin(u * Math.PI) * 1.2;
      this.fishMesh.position.copy(f.pos); this.fishMesh.rotation.set(Math.sin(u * 12) * 0.6, ang, (u - 0.5) * 2);
      if (f.jumpT <= 0) { this.game.fx.splash(nx, nz, 0.6 + f.kg * 0.1); this.fishMesh.visible = false; }
    }
    if (dist < 1.35 && (f.stamina < 0.35 || sp.junk || sp.crab)) {
      // landing: lift it out
      if (!this.fishMesh) { this.fishMesh = makeFish(f.key); this.game.scene.add(this.fishMesh); }
      this.fishMesh.visible = true;
      this.fishMesh.position.copy(f.pos);
      this.liftFrom = f.pos.clone();
      this.game.fx.splash(f.pos.x, f.pos.z, 0.3);
      this.go('land', 1.2);
    }
    return tension;
  }

  jump() {
    const f = this.fish;
    f.jumped = true; f.jumpT = 0.7;
    if (!this.fishMesh) { this.fishMesh = makeFish(f.key); this.game.scene.add(this.fishMesh); }
    this.fishMesh.visible = true;
    this.game.fx.splash(f.pos.x, f.pos.z, 0.7);
    this.game.ticker(`A ${f.sp.name.toLowerCase()} leaps clear of the water off the pier!`);
  }

  snap() {
    this.game.fx.splash(this.fish.pos.x, this.fish.pos.z, 1.0);
    this.say('SNAP!', '#e67156');
    this.game.ticker(`SNAP! A big ${this.fish.sp.name.toLowerCase()} parts ${this.name}’s line.`);
    this.game.logCatch({ angler: this.name, species: this.fish.sp.name, kg: null, result: 'snapped' });
    if (this.fishMesh) { this.game.scene.remove(this.fishMesh); this.fishMesh = null; }
    this.fish = null; this.bait = false;
    this.go('snapped', 3.5);
  }

  deckPoint() { return this.person.localToWorld(new THREE.Vector3(this.def.pose === 'edge' ? -0.55 : 0.25, -this.person.pose.hip.y * 0 + (this.def.pose === 'edge' ? 0.08 : 0.08), this.def.pose === 'edge' ? -0.1 : 0.55)); }

  landing(dt) {
    const u = smooth(clamp(1 - this.t / 1.2, 0, 1));
    const tip = this.tip();
    const hang = tip.clone().add(new THREE.Vector3(0, -0.6, 0));
    const deck = this.deckPoint();
    const a = this.liftFrom.clone().lerp(hang, Math.min(1, u * 1.6));
    const pos = u < 0.6 ? a : hang.clone().lerp(deck, (u - 0.6) / 0.4);
    this.fishMesh.position.copy(pos);
    this.fishMesh.rotation.set(Math.PI / 2 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4), this.def.yaw, Math.sin(this.st * 20) * 0.4);
    if (this.t <= 0) { this.fishMesh.position.copy(deck); this.go('unhook', 0.9); }
  }

  handling(dt) {
    const f = this.fish, m = this.fishMesh, deck = this.deckPoint();
    if (this.state === 'unhook') {
      m.position.copy(deck); m.rotation.set(0, this.def.yaw + Math.sin(this.st * 25) * 0.5, Math.sin(this.st * 18) * 0.3);
      if (this.t <= 0) {
        this.go('weigh', 1.0);
        const sp = f.sp;
        if (sp.junk) this.say(`${sp.name}!`, '#a5acb6');
        else if (sp.crab) this.say('Just a crab', '#e67156');
        else if (f.kg < sp.min) this.say(`${sp.name} ${f.kg.toFixed(2)} kg — undersized`, '#f0b142');
        else this.say(`${sp.name} ${f.kg.toFixed(2)} kg`, '#97b951');
      }
    } else if (this.state === 'weigh') {
      m.position.copy(deck).add(new THREE.Vector3(0, 0.55 + Math.sin(this.st * 8) * 0.03, 0));
      m.rotation.set(Math.PI / 2, this.def.yaw, Math.sin(this.st * 14) * 0.25);
      if (this.t <= 0) {
        const sp = f.sp;
        const keep = !sp.junk && !sp.crab && f.kg >= sp.min;
        if (sp.junk) {
          this.game.logCatch({ angler: this.name, species: sp.name, kg: f.kg, result: 'junk' });
          this.game.ticker(`${this.name} reels in ${sp.name === 'Old boot' ? 'an old boot' : 'a clump of seaweed'}. Not for the pot.`);
          this.go('stow', 0.5); this.stowTo = this.bucket.position.clone().add(new THREE.Vector3(0.5, 0, 0.3)); this.junk = true;
        } else if (keep) {
          this.game.logCatch({ angler: this.name, species: sp.name, kg: f.kg, result: 'kept' });
          this.go('stow', 0.45); this.stowTo = this.bucket.position.clone().add(new THREE.Vector3(0, 0.45, 0)); this.junk = false;
        } else {
          this.game.logCatch({ angler: this.name, species: sp.name, kg: f.kg, result: 'released' });
          this.game.ticker(`${this.name} slips an undersized ${sp.name.toLowerCase()} back into the harbour.`);
          const base = this.rodBase();
          this.releaseFrom = m.position.clone();
          this.releaseTo = base.clone().addScaledVector(this.forward(), 2.2);
          this.go('release', 0.8);
        }
      }
    } else if (this.state === 'stow') {
      const u = clamp(1 - this.t / 0.45, 0, 1);
      m.position.lerp(this.stowTo, Math.min(1, dt * 10));
      m.scale.setScalar(1 - u * 0.6);
      if (this.t <= 0) {
        if (!this.junk) this.bucketCount++;
        this.game.scene.remove(m); this.fishMesh = null; this.fish = null;
        this.go(this.bait ? 'rebait' : 'nobait', this.bait ? 1.4 : 25);
      }
    } else if (this.state === 'release') {
      const u = clamp(1 - this.t / 0.8, 0, 1);
      m.position.lerpVectors(this.releaseFrom, this.releaseTo, u);
      m.position.y = lerp(this.releaseFrom.y, seaHeight(this.releaseTo.x, this.releaseTo.z), u) + Math.sin(u * Math.PI) * 0.9;
      m.rotation.x += dt * 9;
      if (this.t <= 0) {
        this.game.fx.splash(this.releaseTo.x, this.releaseTo.z, 0.35);
        this.game.scene.remove(m); this.fishMesh = null; this.fish = null;
        this.go('rebait', 1.4);
      }
    }
  }

  solveRod(base) {
    const D = this.rodDir();
    const tipGuess = base.clone().addScaledVector(D, 3.0);
    const F = this.end.clone().sub(tipGuess);
    if (F.lengthSq() < 1e-6) F.set(0, -1, 0);
    F.normalize();
    const phi = Math.acos(clamp(D.dot(F), -1, 1));
    const bend = Math.min(phi, this.tension * 1.25);
    const q = tmpQ.setFromUnitVectors(D, F);
    const seg = 3.0 / 8;
    const pts = this.rodPts;
    pts[0].copy(base).addScaledVector(D, -0.3);
    pts[1].copy(base);
    for (let i = 1; i <= 8; i++) {
      const w = Math.pow(i / 8, 1.6) * (phi > 1e-4 ? bend / phi : 0);
      const qi = idQ.clone().slerp(q, w);
      const di = D.clone().applyQuaternion(qi);
      pts[i + 1].copy(pts[i]).addScaledVector(di, seg);
    }
    this.rod.geometry.setFromPoints(pts);
    this.reel.position.copy(base).addScaledVector(D, -0.12).add(new THREE.Vector3(0, -0.08, 0));
  }

  drawLine() {
    const a = this.tip(), b = this.end;
    const d = a.distanceTo(b);
    const slack = clamp(1 - this.tension * 1.6, 0, 1);
    const sag = slack * d * 0.22;
    const ctrl = a.clone().lerp(b, 0.5); ctrl.y -= sag;
    const n = this.linePts.length - 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = this.linePts[i];
      p.set((1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * ctrl.x + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * ctrl.y + t * t * b.y, (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * ctrl.z + t * t * b.z);
    }
    this.line.geometry.setFromPoints(this.linePts);
  }
}

export class Fishing {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.anglers = ANGLERS.map((d) => new Angler(d, game));
    for (const a of this.anglers) this.group.add(a.group);
  }
  update(dt) { for (const a of this.anglers) a.update(dt); }
  hits() { return this.anglers.map((a) => a.hit); }
}
