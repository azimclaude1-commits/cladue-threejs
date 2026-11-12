import * as THREE from 'three';
import { DURATION, ACTS, T, smooth, actAt } from './timeline.js';
import { kickEnv } from './music.js';
import { normalise } from './attractors.js';
import { Particles } from './particles.js';
import { RD } from './rd.js';
import { World } from './world.js';
import { grade } from './grade.js';
import { Flock } from './flock.js';
import { Neurons } from './neurons.js';
import { shot, NET } from './camera.js';
import { makePost } from './post.js';
import { Overlay } from './overlay.js';
import { Player, renderScore, wav } from './audio.js';

const CAPTURE = !!window.__CAPTURE__;
const Q = new URLSearchParams(location.search);
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const quality = ['high', 'medium', 'low'].includes(Q.get('q')) ? Q.get('q') : (CAPTURE ? 'high' : coarse ? 'low' : 'high');
const TIER = {
  high: { p: 1024, birds: 40000, world: [220, 5, 9, 28, 44], pr: 1.5 },
  medium: { p: 724, birds: 24000, world: [170, 5, 8, 20, 32], pr: 1.25 },
  low: { p: 512, birds: 12000, world: [120, 4, 7, 12, 20], pr: 1.0 },
}[quality];

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setClearColor(0x000000, 1);
stage.prepend(renderer.domElement);
const gl = renderer.getContext();
const floatOK = !!renderer.extensions.get('EXT_color_buffer_float');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 60000);

normalise();
const simType = floatOK ? THREE.FloatType : THREE.HalfFloatType;
const particles = new Particles(renderer, TIER.p, simType);
scene.add(particles.points);
const rd = new RD(renderer, 512, simType);
const world = new World(renderer, rd);
scene.add(world.mesh);
['uSteps', 'uOctM', 'uOctN', 'uShSteps', 'uClSteps'].forEach((k, i) => { world.uniforms[k].value = TIER.world[i]; });
const flock = new Flock(TIER.birds);
scene.add(flock.mesh);
const neurons = new Neurons(NET);
scene.add(neurons.group);
particles.netTex = new THREE.DataTexture(neurons.samples(particles.count), TIER.p, TIER.p, THREE.RGBAFormat, THREE.FloatType);
particles.netTex.needsUpdate = true;

// the single point at the beginning and the end
const seedMat = new THREE.ShaderMaterial({
  uniforms: { uI: { value: 0 }, uS: { value: 40 } },
  vertexShader: /* glsl */ `uniform float uS; varying vec2 vUv; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * uS; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */ `uniform float uI; varying vec2 vUv; void main() { float r = length(vUv - 0.5) * 2.0; float g = exp(-r * r * 60.0) * 6.0 + exp(-r * 9.0) * 0.6; gl_FragColor = vec4(vec3(1.0, 0.92, 0.85) * g * uI, 1.0); }`,
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
});
const seed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), seedMat);
seed.frustumCulled = false; seed.renderOrder = 60;
scene.add(seed);

const post = makePost(renderer, scene, camera);
const overlay = new Overlay(document.getElementById('overlay'), { particles: particles.count, birds: TIER.birds });

// ------------------------------------------------------------------ size and resolution
let W = 0, H = 0, PR = 1, scale = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  PR = CAPTURE ? 1 : Math.min(window.devicePixelRatio || 1, TIER.pr) * scale;
  renderer.setPixelRatio(PR); renderer.setSize(W, H, false);
  post.setSize(W, H, PR);
  camera.aspect = W / H;
  textDirty = true;
}
let textDirty = true;
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ the word at the end
function buildText() {
  const cw = 1200, ch = 560, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 300px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Zen Hei",sans-serif';
  g.fillText('涌现', cw / 2, 220);
  g.font = '500 58px "Helvetica Neue","Inter","Segoe UI",Arial,sans-serif';
  g.fillText('E  M  E  R  G  E  N  C  E', cw / 2, 470);
  const img = g.getImageData(0, 0, cw, ch).data, px = [];
  for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) if (img[(y * cw + x) * 4 + 3] > 140) px.push(x, y);
  // the plane faces the camera as it will be for the coda
  const s = shot(T.text + 1), cam = new THREE.PerspectiveCamera();
  cam.position.copy(s.pos); cam.lookAt(s.tgt); cam.updateMatrixWorld();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const width = 330 * Math.min(1, camera.aspect / 1.35);
  const N = particles.count, out = new Float32Array(N * 4);
  let sd = 31337; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const n = px.length / 2;
  for (let i = 0; i < N; i++) {
    const k = Math.floor(rnd() * n);
    const x = ((px[k * 2] + rnd()) / cw - 0.5) * width;
    const y = (0.5 - (px[k * 2 + 1] + rnd()) / ch) * width * (ch / cw);
    const p = NET.clone().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(fwd, (rnd() - 0.5) * 8);
    out.set([p.x, p.y, p.z, 1], i * 4);
  }
  if (!particles.targetTex) { particles.targetTex = new THREE.DataTexture(out, TIER.p, TIER.p, THREE.RGBAFormat, THREE.FloatType); }
  else particles.targetTex.image.data.set(out);
  particles.targetTex.needsUpdate = true;
  particles.sim.uniforms.uTarget.value = particles.targetTex;
  particles.sim.uniforms.uCenter.value.copy(NET);
  textDirty = false;
}

// ------------------------------------------------------------------ interaction
const look = { yaw: 0, pitch: 0, vy: 0, vp: 0, down: false, x: 0, y: 0, px: 0, py: 0 };
const pointer = new THREE.Vector4();
function onDown(e) { look.down = true; look.x = e.clientX; look.y = e.clientY; look.px = e.clientX; look.py = e.clientY; }
function onMove(e) {
  look.px = e.clientX; look.py = e.clientY;
  if (!look.down) return;
  look.yaw += (e.clientX - look.x) * 0.003; look.pitch += (e.clientY - look.y) * 0.003;
  look.yaw = Math.max(-0.6, Math.min(0.6, look.yaw)); look.pitch = Math.max(-0.4, Math.min(0.4, look.pitch));
  look.x = e.clientX; look.y = e.clientY;
}
function onUp() { look.down = false; }

// ------------------------------------------------------------------ one frame of the film
const tmpV = new THREE.Vector3();
function renderAt(t, opts = {}) {
  t = Math.min(DURATION - 1e-4, Math.max(0, t));
  const live = !CAPTURE && !opts.still;
  const s = shot(t);
  // narrow screens keep more of the scene
  const ref = 16 / 9; let fov = s.fov;
  if (camera.aspect < ref) fov = (2 * Math.atan(Math.tan((s.fov * Math.PI) / 360) * Math.pow(ref / camera.aspect, 0.65)) * 180) / Math.PI;
  camera.fov = fov; camera.position.copy(s.pos); camera.lookAt(s.tgt);
  if (live) { // a hand on the camera, springing back
    if (!look.down) { look.yaw *= 0.94; look.pitch *= 0.94; }
    camera.rotateY(-look.yaw); camera.rotateX(-look.pitch);
  }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const px = (H * PR) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const kick = kickEnv(t);
  const g = grade(t);
  const act = actAt(t).id;

  // particles
  if (textDirty && t > T.dissolve - 3) buildText();
  if (live && look.down && t > T.bang + 2 && t < T.land) {
    // stir the cloud where the pointer is
    const ndc = new THREE.Vector3((look.px / W) * 2 - 1, -(look.py / H) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    const d = camera.position.length();
    tmpV.copy(camera.position).addScaledVector(ndc, d);
    pointer.set(tmpV.x, tmpV.y, tmpV.z, 1);
  } else pointer.w = 0;
  particles.sim.uniforms.uPointer.value.copy(pointer);
  const pVis = t < T.bang ? 0 : t < T.dissolve ? 1 - smooth(T.seed + 0.5, T.seed + 2.5, t) : smooth(T.dissolve, T.dissolve + 0.8, t) * (1 - smooth(T.collapse + 0.8, T.collapse + 1.5, t));
  if (pVis > 0 || (t > T.bang && t < T.seed + 3) || t > T.dissolve) particles.advanceTo(t, opts.maxSteps ?? (CAPTURE ? 1e9 : 900));
  particles.look(t);
  const d = particles.draw.uniforms;
  d.uPx.value = px; d.uFocus.value = s.pos.distanceTo(s.tgt); d.uCoc.value = t > T.dissolve ? 0.006 : 0.014;
  d.uSize.value = 1.15 * Math.max(1, PR);
  const pg = (TIER.p === 1024 ? 1 : (1024 / TIER.p) ** 2);
  const col = particles.sim.uniforms.uCollapse.value;
  d.uGain.value = (t > T.dissolve ? 0.007 * (Math.pow(1 - col, 3) + 0.03) : 0.022 + 0.014 * kick) * pg;
  d.uAlpha.value = pVis;
  particles.points.visible = pVis > 0.001;

  // the world
  const wu = world.uniforms;
  const wv = g.worldVis * (1 - smooth(T.collapse, T.collapse + 1.8, t));
  wu.uVis.value = wv;
  world.mesh.visible = wv > 0.001;
  if (t > T.seed - 0.5) rd.advanceTo(t, opts.maxSteps ?? (CAPTURE ? 1e9 : 600));
  if (world.mesh.visible) {
    world.update(camera);
    wu.uTime.value = t; wu.uKick.value = kick;
    wu.uSun.value.copy(g.sun); wu.uSunCol.value.copy(g.sunCol); wu.uZen.value.copy(g.zen); wu.uHor.value.copy(g.hor); wu.uGlow.value.copy(g.glow); wu.uMoon.value.copy(g.moon);
    wu.uVoid.value = g.void; wu.uStars.value = g.stars; wu.uFog.value = g.fog; wu.uCloud.value = g.cloud; wu.uEarth.value = g.earth;
    wu.uUplift.value = g.uplift; wu.uRdAmp.value = g.rdAmp; wu.uWater.value = g.water; wu.uBio.value = g.bio;
  }
  flock.update(t, g, px);
  neurons.update(t, W, H, PR, px);

  // the point
  const intro = t < T.bang ? (0.25 + 1.2 * kickEnv(t, 5)) * smooth(0, 1.2, t) : Math.max(0, 1 - (t - T.bang) * 3) * 4;
  const outro = smooth(T.collapse + 1.0, T.collapse + 1.8, t) * (1 - smooth(DURATION - 0.25, DURATION, t) * 0.75);
  seedMat.uniforms.uI.value = Math.max(intro, outro * 1.2);
  seedMat.uniforms.uS.value = 40 * s.pos.distanceTo(s.tgt) / 260;
  seed.position.copy(t > 60 ? NET : new THREE.Vector3());
  seed.visible = seedMat.uniforms.uI.value > 0.001;

  // finish
  const bloom = { intro: 0.9, chaos: 0.85, rules: 0.6, world: 0.32, life: 0.32, mind: 0.7, coda: 0.6 }[act];
  post.bloom.strength = bloom; post.bloom.threshold = { world: 0.85, life: 0.85, mind: 0.8, coda: 0.8 }[act] ?? 0.7; post.bloom.radius = 0.55;
  post.u.uTime.value = t;
  post.u.uExposure.value = g.exposure;
  post.u.uFlash.value = Math.max(0, 1 - Math.abs(t - T.bang) / 0.25) * 0.6;
  post.u.uFade.value = 1 - smooth(0, 0.8, t);
  post.u.uBars.value = camera.aspect > 1.5 ? 0.06 : 0;
  post.composer.render();
  const fps = live ? ` · ${Math.round(1000 / Math.max(1, frameMs))} fps` : '';
  overlay.update(t, `实时渲染 · ${Math.round(W * PR)}×${Math.round(H * PR)}${fps} · ${particles.count.toLocaleString('en-US')} 粒子 · ${TIER.birds.toLocaleString('en-US')} 只鸟 · ${neurons.segs.length.toLocaleString('en-US')} 段神经突`);
}

// ------------------------------------------------------------------ playback
let t = 0, playing = false, last = performance.now(), frameMs = 16, audioCtx = null, player = null, muted = false;
const $ = (id) => document.getElementById(id);
const ui = { start: $('start'), bar: $('bar'), play: $('play'), restart: $('restart'), scrub: $('scrub'), time: $('time'), sound: $('sound'), full: $('full'), ticks: $('ticks'), hudBtn: $('hudbtn'), q: $('quality') };

function audioStart() { if (player && !muted && playing) player.start(t); }
function audioStop() { if (player) player.stop(); }
function setPlaying(p) {
  playing = p; ui.play.textContent = p ? '❚❚' : '▶'; ui.play.setAttribute('aria-label', p ? '暂停' : '播放');
  if (p) audioStart(); else audioStop();
  last = performance.now();
}
function seek(x) { t = Math.min(DURATION - 0.01, Math.max(0, x)); if (playing) audioStart(); }
const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;

let slowFrames = 0, fastFrames = 0, scrubbing = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  frameMs = frameMs * 0.9 + dt * 1000 * 0.1;
  if (playing && !scrubbing) { t += dt; if (t >= DURATION) { t -= DURATION; audioStart(); } }
  renderAt(t);
  // keep the frame rate: trade resolution when the GPU struggles
  if (playing) {
    if (frameMs > 24) slowFrames++; else slowFrames = 0;
    if (frameMs < 13) fastFrames++; else fastFrames = 0;
    if (slowFrames > 45 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); slowFrames = 0; resize(); }
    if (fastFrames > 180 && scale < 1) { scale = Math.min(1, scale / 0.9); fastFrames = 0; resize(); }
  }
  if (!scrubbing) ui.scrub.value = String((t / DURATION) * 1000);
  ui.time.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
}

resize();
if (!CAPTURE) {
  if (!floatOK) $('warn').textContent = '这台设备不支持 32 位浮点渲染目标，已改用半精度，部分画面可能不完整。';
  ui.q.value = quality;
  for (const a of ACTS) {
    const b = document.createElement('button');
    b.className = 'tick'; b.style.left = `${(a.t / DURATION) * 100}%`; b.textContent = a.num || a.name; b.title = `${a.name} · ${a.en}`;
    b.addEventListener('click', () => seek(a.t + 0.05));
    ui.ticks.appendChild(b);
  }
  ui.start.querySelector('button').addEventListener('click', async () => {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); await audioCtx.resume(); player = new Player(audioCtx); } catch (e) { audioCtx = null; player = null; }
    ui.start.classList.add('gone'); document.body.classList.add('running');
    t = 0; setPlaying(true);
  });
  ui.play.addEventListener('click', () => setPlaying(!playing));
  ui.restart.addEventListener('click', () => { t = 0; setPlaying(true); });
  ui.scrub.addEventListener('input', () => { scrubbing = true; t = (Number(ui.scrub.value) / 1000) * DURATION; audioStop(); });
  ui.scrub.addEventListener('change', () => { scrubbing = false; seek(t); });
  ui.sound.addEventListener('click', () => { muted = !muted; ui.sound.classList.toggle('off', muted); if (muted) audioStop(); else audioStart(); });
  ui.full.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
  ui.hudBtn.addEventListener('click', () => document.body.classList.toggle('nohud'));
  ui.q.addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('q', ui.q.value); location.href = u.toString(); });
  window.addEventListener('keydown', (e) => {
    if (!ui.start.classList.contains('gone')) { if (e.key === ' ' || e.key === 'Enter') { ui.start.querySelector('button').click(); e.preventDefault(); } return; }
    if (e.key === ' ') { setPlaying(!playing); e.preventDefault(); }
    else if (e.key === 'ArrowRight') seek(t + 5);
    else if (e.key === 'ArrowLeft') seek(t - 5);
    else if (e.key === 'm' || e.key === 'M') ui.sound.click();
    else if (e.key === 'f' || e.key === 'F') ui.full.click();
    else if (e.key === 'h' || e.key === 'H') ui.hudBtn.click();
    else if (/^[1-7]$/.test(e.key)) seek(ACTS[Number(e.key) - 1].t + 0.05);
  });
  let hideT = 0;
  const poke = () => { document.body.classList.add('ui'); clearTimeout(hideT); hideT = setTimeout(() => document.body.classList.remove('ui'), 2500); };
  window.addEventListener('pointermove', poke);
  renderer.domElement.addEventListener('pointerdown', (e) => { poke(); onDown(e); });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // a still behind the start screen
  t = 3.0;
  requestAnimationFrame(frame);
} else {
  ui.start.remove(); ui.bar.remove();
  document.body.classList.add('capture');
}

window.__app = {
  DURATION, renderAt: (x) => renderAt(x, { still: true }), ready: true,
  async renderAudio(sr = 48000) {
    const buf = await renderScore(sr);
    const bytes = new Uint8Array(await wav(buf).arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
};
