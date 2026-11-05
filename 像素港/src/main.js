import * as THREE from 'three';
import { PixelPipeline, IsoCamera } from './core.js';
import { env, tide, seaHeight, seaNormal, rand, pick, clamp, lerp, fmtClock } from './env.js';
import { createWater } from './water.js';
import { buildWorld, L } from './world.js';
import { FX } from './fx.js';
import { Fishing, isOpenWater, period } from './fishing.js';
import { Harbour } from './harbour.js';
import { Gulls } from './gulls.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const pipe = new PixelPipeline(canvas);
const iso = new IsoCamera();
const scene = new THREE.Scene();
const world = new THREE.Group(); // everything that is mirrored in the water
scene.add(world);
const water = createWater();
scene.add(water);

// ---- lights -----------------------------------------------------------------------
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0015;
world.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe9f1, 0x5f3721, 0.8);
world.add(hemi);
const lamps = [[-6.5, -11.6], [9.5, -11.0], [L.pier.tx1 - 0.6, L.pier.z1 - 0.2]].map(([x, z]) => {
  const l = new THREE.PointLight(0xffc870, 0, 9, 1.6);
  l.position.set(x, (z > 0 ? L.pier.y : L.quayY) + 2.6, z);
  world.add(l);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), new THREE.MeshLambertMaterial({ color: '#1b1f27' }));
  post.position.set(x, l.position.y - 1.3, z); world.add(post);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.3), new THREE.MeshBasicMaterial({ color: '#f6d36c' }));
  glass.position.copy(l.position); world.add(glass);
  return { l, glass };
});

// ---- the island ----------------------------------------------------------------------
const W = buildWorld();
world.add(W.group);
const fx = new FX();
world.add(fx.points, fx.rainLines);

// ---- the shared game object -------------------------------------------------------------
const game = {
  scene: world, fx, sold: 0, stolen: 0,
  stats: { best: null, landed: 0, kept: 0, crates: 0 },
  log: [],
  popup, ticker, logCatch,
};
const fishing = new Fishing(game); game.fishing = fishing; world.add(fishing.group);
const harbour = new Harbour(game);
const gulls = new Gulls(game); world.add(gulls.group);
// count crates landed on the quay toward the day's total
const _add = harbour.addToPile.bind(harbour);
harbour.addToPile = () => { _add(); const kg = +rand(14, 22).toFixed(1); game.stats.landed += kg; game.stats.crates++; ticker(`A crate of fish (${kg} kg) swings ashore on the derrick.`); renderScore(); };

// ---- sky: clouds below and around the island, stars, the lighthouse beam -------------------------
const clouds = [];
const cloudMat = new THREE.MeshLambertMaterial({ color: '#fbfbf5', flatShading: true });
for (let i = 0; i < 10; i++) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rand(0, 3));
  for (let k = 0; k < n; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(rand(1.6, 3.2), rand(0.5, 0.9), rand(1.2, 2.2)), cloudMat); m.position.set(k * 1.4 - n * 0.7, rand(-0.2, 0.3), rand(-0.6, 0.6)); g.add(m); }
  const a = rand(0, Math.PI * 2), r = rand(36, 56);
  g.position.set(Math.cos(a) * r, rand(-34, -9), Math.sin(a) * r); // drifting below the island
  world.add(g); clouds.push(g); // in the world group, so the water mirrors them properly
}
const starGeo = new THREE.BufferGeometry();
const sp = [];
for (let i = 0; i < 400; i++) { const v = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(140); sp.push(v.x, v.y, v.z); }
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#faecae', size: 1, sizeAttenuation: false }));
scene.add(stars);
// two opposite beams, fading along their length (the post-pass dither turns the fade into pixels)
const beamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { strength: { value: 0 } },
  vertexShader: 'varying float vT; void main() { vT = clamp(position.x / 20.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float strength; varying float vT; void main() { gl_FragColor = vec4(vec3(1.0, 0.93, 0.7) * strength * pow(1.0 - vT, 1.6) * 0.5, 1.0); }',
});
const beamGeo = new THREE.ConeGeometry(1.6, 20, 10, 1, true);
beamGeo.translate(0, -10, 0); beamGeo.rotateZ(Math.PI / 2); // apex at the lantern, pointing along +x
const beam = new THREE.Group();
const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat);
b2.rotation.y = Math.PI;
beam.add(b1, b2);
const beamPivot = new THREE.Group(); beamPivot.position.set(L.lighthouse.x, 1.4 + 9 + 1.3, L.lighthouse.z); beamPivot.add(beam);
world.add(beamPivot);

// ---- buoys riding the same swell: a red can, a green cone and a yellow mooring buoy ----------------------
const buoys = [[11.5, 15.5, '#c54236', 'can'], [15.0, 12.0, '#40702d', 'cone'], [-4.5, -4.5, '#f0b142', 'ball']].map(([x, z, c, kind]) => {
  const g = new THREE.Group();
  const m = (geo, col, y) => { const o = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col, flatShading: true })); o.position.y = y; o.castShadow = true; g.add(o); return o; };
  if (kind === 'ball') { m(new THREE.SphereGeometry(0.42, 6, 4), c, 0.15); m(new THREE.BoxGeometry(0.12, 0.3, 0.12), '#1b1f27', 0.6); }
  else { m(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 8), '#e9ebe4', 0.05); m(kind === 'can' ? new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8) : new THREE.ConeGeometry(0.38, 0.9, 8), c, 0.75); }
  g.position.set(x, 0, z);
  world.add(g);
  return g;
});
const _n = [0, 1, 0];
function floatBuoys() {
  for (const b of buoys) {
    b.position.y = seaHeight(b.position.x, b.position.z) - 0.12;
    seaNormal(b.position.x, b.position.z, env.t, _n);
    b.rotation.set(Math.atan2(_n[2], _n[1]) * 1.4, 0, -Math.atan2(_n[0], _n[1]) * 1.4);
  }
}

// ---- chalkboard on the pier (tiny bitmap font) --------------------------------------------------
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '-': '000000111000000', ' ': '000000000000000', "'": '010010000000000',
};
const chalkCanvas = document.createElement('canvas'); chalkCanvas.width = 64; chalkCanvas.height = 44;
const chalkTex = new THREE.CanvasTexture(chalkCanvas);
chalkTex.magFilter = chalkTex.minFilter = THREE.NearestFilter; chalkTex.generateMipmaps = false;
chalkTex.colorSpace = THREE.SRGBColorSpace;
function drawChalk() {
  const c = chalkCanvas.getContext('2d');
  c.fillStyle = '#1b2a22'; c.fillRect(0, 0, 64, 44);
  c.fillStyle = '#7c4d2c'; c.fillRect(0, 0, 64, 2); c.fillRect(0, 42, 64, 2); c.fillRect(0, 0, 2, 44); c.fillRect(62, 0, 2, 44);
  const txt = (s, x, y, col) => { c.fillStyle = col; for (const ch of s.toUpperCase()) { const g = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') c.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1); x += 4; } };
  const b = game.stats.best;
  txt('POLGRAN', 4, 4, '#e9ebe4');
  txt(`TIDE ${tideRising() ? 'UP' : 'DN'}`, 4, 11, '#a7d3e8');
  txt('BEST', 4, 18, '#f6d36c');
  txt(b ? `${b.species.split(' ').pop().slice(0, 7)}` : '-', 4, 24, '#e9ebe4');
  txt(b ? `${b.kg.toFixed(1)}KG` : '', 4, 30, '#e9ebe4');
  txt(`${game.stats.landed.toFixed(0)}KG IN`, 4, 37, '#97b951');
  chalkTex.needsUpdate = true;
}
const chalk = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.9), new THREE.MeshLambertMaterial({ map: chalkTex }));
chalk.position.set(L.chalk.x + 0.06, L.pier.y + 0.85, L.chalk.z);
chalk.rotation.set(0, Math.PI / 2, 0); chalk.rotateX(-0.25);
world.add(chalk);
function tideRising() { return Math.cos((env.clock / 60 / 12.4) * Math.PI * 2 + 1.0) > 0; }

// ---- time of day + weather ------------------------------------------------------------------------
const KEYS = [
  [0, { sky: '#0a1729', sun: '#86a0d8', I: 0.85, hs: '#2c4a7a', hg: '#101834', hI: 0.95, deep: '#0a1f33', sh: '#144a4a', night: 1 }],
  [4.8, { sky: '#0a1729', sun: '#86a0d8', I: 0.85, hs: '#2c4a7a', hg: '#101834', hI: 0.95, deep: '#0a1f33', sh: '#144a4a', night: 1 }],
  [6.2, { sky: '#f2ab86', sun: '#ffb07a', I: 1.25, hs: '#c9a0b8', hg: '#33264c', hI: 0.75, deep: '#224b77', sh: '#3f9a90', night: 0.3 }],
  [8, { sky: '#a7d3e8', sun: '#fff0d0', I: 1.9, hs: '#d2eaf2', hg: '#5f3721', hI: 0.8, deep: '#19375a', sh: '#297d78', night: 0 }],
  [12.5, { sky: '#80b8dc', sun: '#ffffff', I: 2.2, hs: '#d2eaf2', hg: '#5f3721', hI: 0.85, deep: '#19375a', sh: '#297d78', night: 0 }],
  [17, { sky: '#a7d3e8', sun: '#fff0d0', I: 1.9, hs: '#d2eaf2', hg: '#5f3721', hI: 0.8, deep: '#19375a', sh: '#297d78', night: 0 }],
  [18.8, { sky: '#e67156', sun: '#ff8a50', I: 1.35, hs: '#86689e', hg: '#33264c', hI: 0.7, deep: '#33264c', sh: '#574173', night: 0.35 }],
  [20.2, { sky: '#1a1430', sun: '#86689e', I: 0.55, hs: '#33264c', hg: '#06080f', hI: 0.6, deep: '#101834', sh: '#1a1430', night: 0.9 }],
  [21.5, { sky: '#0a1729', sun: '#86a0d8', I: 0.85, hs: '#2c4a7a', hg: '#101834', hI: 0.95, deep: '#0a1f33', sh: '#144a4a', night: 1 }],
  [24, { sky: '#0a1729', sun: '#86a0d8', I: 0.85, hs: '#2c4a7a', hg: '#101834', hI: 0.95, deep: '#0a1f33', sh: '#144a4a', night: 1 }],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function mixHex(a, b, t) { return _c1.set(a).lerp(_c2.set(b), t).clone(); }
function lightAt(hour) {
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
  const t = clamp((hour - h0) / (h1 - h0), 0, 1);
  const o = {};
  for (const k of Object.keys(a)) o[k] = typeof a[k] === 'number' ? lerp(a[k], b[k], t) : mixHex(a[k], b[k], t);
  return o;
}
const WEATHER = { calm: { wind: 1.2, swell: 0.45, rain: 0 }, breeze: { wind: 5, swell: 1, rain: 0 }, storm: { wind: 12, swell: 2.3, rain: 1 } };
let flash = 0, nextFlash = 8;
function setWeather(k) {
  env.weather = k;
  document.querySelectorAll('[data-weather]').forEach((b) => b.classList.toggle('on', b.dataset.weather === k));
  ticker(k === 'storm' ? 'A squall blows in off the sea — rain and spray across the harbour.' : k === 'calm' ? 'The wind drops. The harbour goes glassy.' : 'A fresh breeze fills the sails.');
  if (k === 'storm') for (const b of harbour.boats) if (b.state !== 'moored' && b.state !== 'unload') b.recall();
}
function setTime(k) {
  env.clock = { dawn: 6 * 60, noon: 12 * 60, dusk: 18.5 * 60, night: 22 * 60 }[k];
  updateTimeButtons();
}
function updateTimeButtons() {
  const p = period();
  document.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('on', (b.dataset.time === 'noon' ? 'day' : b.dataset.time) === p));
}

function applyLighting(dt) {
  const hour = (env.clock / 60) % 24;
  const k = lightAt(hour);
  const W2 = WEATHER[env.weather];
  env.wind = lerp(env.wind, W2.wind, Math.min(1, dt * 0.5));
  env.swell = lerp(env.swell, W2.swell, Math.min(1, dt * 0.3));
  env.rain = lerp(env.rain, W2.rain, Math.min(1, dt * 0.6));
  env.windDir += Math.sin(env.t * 0.05) * 0.0006;
  const storm = clamp(env.rain, 0, 1);
  const grey = '#434a56';
  const sky = k.sky.clone().lerp(_c1.set(grey).multiplyScalar(1 - k.night * 0.7), storm * 0.65);
  scene.background = sky;
  // sun path (east -> south -> west); the moon after dark
  const day = clamp((hour - 5.5) / 13.5, 0, 1);
  const el = Math.sin(day * Math.PI);
  let dir;
  if (k.night < 0.6) dir = new THREE.Vector3(Math.cos(day * Math.PI) * 0.9, Math.max(0.18, el), 0.55).normalize();
  else dir = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
  sun.position.copy(dir).multiplyScalar(60); sun.target.position.set(0, 0, 0);
  sun.color.copy(k.sun); sun.intensity = k.I * (1 - storm * 0.55) + flash * 3;
  hemi.color.copy(k.hs).lerp(_c1.set(grey), storm * 0.4); hemi.groundColor.copy(k.hg); hemi.intensity = k.hI + flash * 2;
  cloudMat.color.copy(_c1.set('#fbfbf5').lerp(_c2.set('#5d6572'), storm * 0.7));
  const U = water.material.uniforms;
  U.sunDir.value.copy(dir); U.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity * 0.5);
  U.ambient.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.6);
  U.deep.value.copy(k.deep).lerp(_c1.set('#2c313b'), storm * 0.5); U.shallow.value.copy(k.sh).lerp(_c1.set('#434a56'), storm * 0.5);
  U.rainAmt.value = storm;
  // night: lamps, windows, lighthouse beam, stars
  const n = k.night;
  for (const l of lamps) { l.l.intensity = n * 6; l.glass.material.color.set(n > 0.4 ? '#f6d36c' : '#7f8794'); }
  W.glow.material.color.setRGB(0.3 + n * 0.7, 0.3 + n * 0.62, 0.33 + n * 0.35);
  stars.visible = n > 0.6 && storm < 0.5;
  beam.visible = n > 0.45;
  beamPivot.rotation.y += dt * 0.7;
  U.beamOn.value = n > 0.45 ? n : 0;
  U.beamPos.value.copy(beamPivot.position);
  U.beamAngle.value = -beamPivot.rotation.y;
  beamMat.uniforms.strength.value = n * (1 - storm * 0.3);
  U.viewDir.value.copy(iso.cam.position).sub(iso.target).normalize();
  return k;
}

// ---- UI ----------------------------------------------------------------------------------------
const tickerQ = [];
function ticker(msg) {
  tickerQ.unshift(`${fmtClock(env.clock)}  ${msg}`);
  if (tickerQ.length > 7) tickerQ.pop();
  const el = $('tickerText');
  el.textContent = tickerQ.join('   ·   ');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
function popup(text, worldPos, color = '#e9ebe4') {
  const el = document.createElement('div');
  el.className = 'pop'; el.textContent = text; el.style.color = color;
  $('labels').appendChild(el);
  pops.push({ el, pos: worldPos.clone(), t: 0 });
}
const pops = [];
function placePops(dt) {
  const r = canvas.getBoundingClientRect();
  for (const p of pops) {
    p.t += dt;
    const v = p.pos.clone().add(new THREE.Vector3(0, p.t * 0.6, 0)).project(iso.cam);
    p.el.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px) translate(-50%, -100%)`;
    p.el.style.opacity = String(clamp(2.6 - p.t, 0, 1));
  }
  for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t > 2.6) { pops[i].el.remove(); pops.splice(i, 1); }
}
function logCatch(e) {
  e.time = fmtClock(env.clock);
  game.log.unshift(e);
  if (e.result === 'kept') {
    game.stats.landed += e.kg; game.stats.kept++;
    if (!game.stats.best || e.kg > game.stats.best.kg) { game.stats.best = { species: e.species, kg: e.kg, angler: e.angler }; ticker(`New best of the day: ${e.angler}’s ${e.species.toLowerCase()}, ${e.kg.toFixed(2)} kg!`); }
    else ticker(`${e.angler} lands a ${e.species.toLowerCase()} of ${e.kg.toFixed(2)} kg.`);
  }
  renderLog(); renderScore();
}
function renderScore() {
  const b = game.stats.best;
  $('best').textContent = b ? `${b.species} ${b.kg.toFixed(2)} kg` : '—';
  $('bestBy').textContent = b ? b.angler : 'no fish yet';
  $('landed').textContent = `${game.stats.landed.toFixed(1)} kg`;
  $('landedBy').textContent = `${game.stats.kept} by rod · ${game.stats.crates} crates`;
  drawChalk();
}
function renderLog() {
  const rows = game.log.slice(0, 9).map((e) => `<tr class="${e.result}"><td>${e.time}</td><td>${e.angler}</td><td>${e.species}</td><td>${e.kg == null ? '—' : e.kg.toFixed(2)}</td><td>${{ kept: 'KEPT', released: 'BACK', junk: 'JUNK', snapped: 'SNAP' }[e.result]}</td></tr>`);
  $('logBody').innerHTML = rows.join('') || '<tr><td colspan="5" class="empty">Waiting for the first bite…</td></tr>';
}
function renderBoats() {
  $('boatList').innerHTML = harbour.boats.map((b) => `<div class="boat"><b>${b.name}</b><span>${b.status}</span></div>`).join('') +
    `<div class="boat"><b>Market</b><span>${harbour.market.stock} fish on the slab · ${game.sold} sold</span></div>`;
}
function renderHeader(k) {
  $('clock').textContent = fmtClock(env.clock);
  const per = period();
  $('cond').textContent = `${{ dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' }[per]} · ${{ calm: 'Calm', breeze: 'Breeze', storm: 'Storm' }[env.weather]} · Tide ${tideRising() ? 'rising' : 'falling'}`;
}

// ---- input ----------------------------------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, iso.cam);
  const hits = ray.intersectObjects([...fishing.hits(), harbour.bell.hit], false);
  if (hits.length) {
    const o = hits[0].object;
    if (o.userData.angler) { o.userData.angler.click(); return; }
    if (o === harbour.bell.hit) { harbour.ringBell(); return; }
  }
  // the water: throw bread
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -env.level);
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(plane, p) && isOpenWater(p.x, p.z, 0.2)) { gulls.throwBread(p.x, p.z); return; }
}
let down = null; const touches = new Map(); let pinch0 = 0, zoom0 = 0;
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = iso.zoom; down = null; return; }
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2 && pinch0) { const [a, b] = [...touches.values()]; iso.zoom = clamp(zoom0 * pinch0 / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), 14, 62); }
});
const up = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch0 = 0;
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) iso.rotate(dx > 0 ? 1 : -1);
  else if (Math.hypot(dx, dy) < 10) pickAt(e.clientX, e.clientY);
  down = null;
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); iso.zoom = clamp(iso.zoom * Math.exp(e.deltaY * 0.0012), 14, 62); }, { passive: false });
addEventListener('keydown', (e) => {
  if (e.key === 'q' || e.key === 'Q') iso.rotate(-1);
  if (e.key === 'e' || e.key === 'E') iso.rotate(1);
  if (e.key === 's' || e.key === 'S') toggleSlow();
  if (e.key === 'b' || e.key === 'B') harbour.ringBell();
});
function toggleSlow() { env.slow = !env.slow; $('bSlow').classList.toggle('on', env.slow); }
$('bLeft').onclick = () => iso.rotate(-1);
$('bRight').onclick = () => iso.rotate(1);
$('bSlow').onclick = toggleSlow;
$('bIn').onclick = () => (iso.zoom = clamp(iso.zoom / 1.25, 14, 62));
$('bOut').onclick = () => (iso.zoom = clamp(iso.zoom * 1.25, 14, 62));
document.querySelectorAll('[data-time]').forEach((b) => (b.onclick = () => setTime(b.dataset.time)));
document.querySelectorAll('[data-weather]').forEach((b) => (b.onclick = () => setWeather(b.dataset.weather)));
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { document.body.dataset.tab = document.body.dataset.tab === b.dataset.tab ? '' : b.dataset.tab; }));

// ---- sound: a synthesised harbour bell ----------------------------------------------------------------
let actx = null;
game.sound = {
  bell() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      for (const [f, a, d] of [[392, 0.32, 3.5], [784, 0.16, 2.2], [941, 0.12, 2.6], [1176, 0.08, 1.6], [1568, 0.05, 1.1]]) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(a, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + d);
        o.connect(g).connect(actx.destination); o.start(now); o.stop(now + d);
      }
    } catch { /* audio is optional */ }
  },
};

// ---- loop ----------------------------------------------------------------------------------------------
let last = performance.now(), smokeT = 0, sprayT = 0, uiT = 0;
function resize() { pipe.resize(); }
addEventListener('resize', resize); resize();
renderLog(); renderScore(); setWeather('breeze'); tickerQ.length = 0;
ticker('Morning on Polgran Quay. The anglers are out on the pier.');
updateTimeButtons();

function frame(now) {
  const real = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const dt = real * (env.slow ? 0.25 : 1);
  const k = simulate(dt);
  iso.update(real, pipe.lowW, pipe.lowH);
  pipe.render(scene, iso.cam, { world, water, waterLevel: env.level });
  placePops(real);
  uiT -= real;
  if (uiT <= 0) { uiT = 0.25; renderHeader(k); renderBoats(); updateTimeButtons(); }
  requestAnimationFrame(frame);
}
function simulate(dt) {
  env.t += dt;
  env.clock = (env.clock + dt * 1.0 + 1440) % 1440; // one game minute per second
  env.level = tide();
  const k = applyLighting(dt);
  water.userData.update();
  floatBuoys();
  fishing.update(dt);
  harbour.update(dt);
  gulls.update(dt);
  // smoke from the smokehouse and cottages, spray in a storm, lightning
  smokeT -= dt;
  if (smokeT <= 0) { smokeT = 0.12; fx.smoke(L.smokehouse.x + 1.1, L.quayY + 4.5, L.smokehouse.z); if (Math.random() < 0.25) fx.smoke(L.cottages[0].x + 2, L.quayY + 5, L.cottages[0].z); }
  if (env.rain > 0.3) {
    sprayT -= dt;
    if (sprayT <= 0) { sprayT = 0.03; const a = rand(-0.4, Math.PI + 0.4); fx.spray(Math.cos(a) * 22.5, 1.5, Math.sin(a) * 22.5); }
    nextFlash -= dt;
    if (nextFlash <= 0) { flash = 0.7; nextFlash = rand(6, 15); ticker('Lightning flickers over the harbour.'); }
  }
  flash = Math.max(0, flash - dt * 3);
  pipe.post.uniforms.flash.value = flash * 0.25;
  for (const c of clouds) {
    c.position.x += Math.cos(env.windDir) * env.wind * 0.03 * dt; c.position.z += Math.sin(env.windDir) * env.wind * 0.03 * dt;
    if (Math.hypot(c.position.x, c.position.z) > 60) { const a = env.windDir + Math.PI + rand(-0.8, 0.8); c.position.x = Math.cos(a) * 55; c.position.z = Math.sin(a) * 55; }
  }
  fx.update(dt);
  return k;
}
requestAnimationFrame(frame);
window.__harbour = { scene, world, iso, pipe, game, fishing, harbour, gulls, env, setTime, setWeather, advance(sec) { for (let t = 0; t < sec; t += 1 / 30) simulate(1 / 30); } };
