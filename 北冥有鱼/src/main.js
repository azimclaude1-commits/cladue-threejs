import * as THREE from 'three';
import { U } from './shared.js';
import { DURATION, CHAPTERS, T, smooth } from './timeline.js';
import { Kun } from './kun.js';
import { Peng } from './peng.js';
import { Environment } from './env.js';
import { makeTransform, makeSpray, makeWhirlwind } from './particles.js';
import { shot, dipAt } from './camera.js';
import { grade } from './grade.js';
import { makePost } from './post.js';
import { Overlay } from './overlay.js';
import { score, wav } from './audio.js';

const CAPTURE = !!window.__CAPTURE__;
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setClearColor(0x000000, 1);
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 40000);

const kun = new Kun();
const peng = new Peng();
const env = new Environment(scene);
scene.add(kun.mesh, peng.mesh);
const spray = makeSpray(kun);
const transform = makeTransform(kun, peng, CAPTURE ? 110000 : 90000);
const whirl = makeWhirlwind();
scene.add(spray, transform, whirl);
const pointMats = [env.snow, spray, transform, whirl].map((o) => o.material);

const post = makePost(renderer, scene, camera, CAPTURE ? 4 : 4);
const overlay = new Overlay(document.getElementById('overlay'));

let W = 0, H = 0, PR = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  PR = CAPTURE ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(PR);
  renderer.setSize(W, H, false);
  post.setSize(W, H, PR);
  camera.aspect = W / H;
  document.documentElement.style.setProperty('--vh', `${H / 100}px`);
  document.documentElement.style.setProperty('--vw', `${W / 100}px`);
}
window.addEventListener('resize', resize);
resize();

/** Render the film at time t. Pure: the same t always gives the same frame. */
function renderAt(t) {
  t = Math.min(DURATION, Math.max(0, t));
  U.uTime.value = t;
  const s = shot(t);
  // keep the horizontal field on narrow screens
  const ref = 16 / 9, asp = camera.aspect;
  let fov = s.fov;
  if (asp < ref) fov = (2 * Math.atan(Math.tan((s.fov * Math.PI) / 360) * Math.pow(ref / asp, 0.6)) * 180) / Math.PI;
  camera.fov = fov; camera.position.copy(s.pos); camera.lookAt(s.tgt); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  U.uCam.value.copy(s.pos);

  const g = grade(t, s.pos.y);
  U.uFogColor.value.copy(g.fogColor); U.uFogFar.value.copy(g.fogFar); U.uFogDensity.value = g.fogDensity;
  U.uSunDir.value.copy(g.sunDir); U.uSunColor.value.copy(g.sunColor); U.uSkyTop.value.copy(g.skyTop); U.uSkyHorizon.value.copy(g.skyHor);
  U.uLight.value = g.light; U.uUnder.value = g.under; U.uDisc.value.copy(g.disc);
  env.sea.material.uniforms.uSea.value = g.sea;

  kun.update(t);
  peng.update(t);
  env.update(t, s.pos, kun);
  spray.update(t); transform.update(t); whirl.update(t);
  const px = (H * PR) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  for (const m of pointMats) m.uniforms.uPx.value = px;

  const u = post.u;
  u.uTime.value = t;
  u.uReveal.value = smooth(T.inkDrop, T.inkDrop + 3.2, t) ** 0.6;
  u.uPaperIn.value = smooth(T.endFade, T.endFade + 3.5, t);
  u.uFlash.value = Math.max(0, 1 - Math.abs(t - 36.75) / 0.35) * 0.85 + Math.max(0, 1 - Math.abs(t - T.breach) / 0.5) * 0.25;
  const dip = dipAt(t);
  u.uDip.value = dip * 0.7;
  u.uDipColor.value.set(s.pos.y < 0 ? 0x000000 : 0xe9e3d4);
  u.uBars.value = asp > 1.25 ? 0.045 : 0.0;
  u.uExposure.value = 1.0 - 0.08 * smooth(58, 64, t);
  u.uSat.value = 0.82 + 0.3 * smooth(60, 70, t);
  u.uDrop.value = smooth(T.inkDrop - 0.7, T.inkDrop, t);
  post.bloom.strength = 0.55 - 0.1 * smooth(36, 38, t) - 0.33 * smooth(58, 64, t);
  post.composer.render();
  overlay.update(t);
}

// ------------------------------------------------------------------ playback
let t = CAPTURE ? 0 : 3.6, playing = false, last = performance.now(), audioCtx = null, voice = null, muted = false;
const ui = {
  start: document.getElementById('start'), bar: document.getElementById('bar'), play: document.getElementById('play'),
  restart: document.getElementById('restart'), scrub: document.getElementById('scrub'), time: document.getElementById('time'),
  sound: document.getElementById('sound'), full: document.getElementById('full'), ticks: document.getElementById('ticks'),
};

function stopVoice() { if (voice) { voice.stop(); voice = null; } }
function startVoice() {
  stopVoice();
  if (!audioCtx || muted || !playing) return;
  voice = score(audioCtx, audioCtx.destination, t);
}
function setPlaying(p) {
  playing = p;
  ui.play.textContent = p ? '❚❚' : '▶';
  ui.play.setAttribute('aria-label', p ? '暂停' : '播放');
  if (p) startVoice(); else stopVoice();
  last = performance.now();
}
function seek(x) { t = Math.min(DURATION - 0.01, Math.max(0, x)); if (playing) startVoice(); if (!playing) renderAt(t); }
const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) {
    t += dt;
    if (t >= DURATION) { t = 0; startVoice(); }
  }
  renderAt(t);
  if (!scrubbing) ui.scrub.value = String(t / DURATION * 1000);
  ui.time.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
}

let scrubbing = false;
if (!CAPTURE) {
  for (const c of CHAPTERS) {
    const b = document.createElement('button');
    b.className = 'tick'; b.style.left = `${(c.t / DURATION) * 100}%`; b.title = `${c.name} · ${c.label}`; b.textContent = c.label;
    b.addEventListener('click', () => seek(c.t + 0.01));
    ui.ticks.appendChild(b);
  }
  ui.start.querySelector('button').addEventListener('click', async () => {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); await audioCtx.resume(); } catch (e) { audioCtx = null; }
    ui.start.classList.add('gone');
    document.body.classList.add('running');
    t = 0; setPlaying(true);
  });
  ui.play.addEventListener('click', () => setPlaying(!playing));
  ui.restart.addEventListener('click', () => { t = 0; setPlaying(true); });
  ui.scrub.addEventListener('input', () => { scrubbing = true; t = (Number(ui.scrub.value) / 1000) * DURATION; stopVoice(); });
  ui.scrub.addEventListener('change', () => { scrubbing = false; seek(t); });
  ui.sound.addEventListener('click', () => { muted = !muted; ui.sound.classList.toggle('off', muted); ui.sound.setAttribute('aria-label', muted ? '开声' : '静音'); if (muted) stopVoice(); else startVoice(); });
  ui.full.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
  window.addEventListener('keydown', (e) => {
    if (ui.start && !ui.start.classList.contains('gone')) { if (e.key === ' ' || e.key === 'Enter') { ui.start.querySelector('button').click(); e.preventDefault(); } return; }
    if (e.key === ' ') { setPlaying(!playing); e.preventDefault(); }
    else if (e.key === 'ArrowRight') seek(t + 5);
    else if (e.key === 'ArrowLeft') seek(t - 5);
    else if (e.key === 'm' || e.key === 'M') ui.sound.click();
    else if (e.key === 'f' || e.key === 'F') ui.full.click();
    else if (/^[1-8]$/.test(e.key)) seek(CHAPTERS[Number(e.key) - 1].t + 0.01);
  });
  // show the bar while the pointer moves
  let hideT = 0;
  const poke = () => { document.body.classList.add('ui'); clearTimeout(hideT); hideT = setTimeout(() => document.body.classList.remove('ui'), 2600); };
  window.addEventListener('pointermove', poke); window.addEventListener('pointerdown', poke);
  requestAnimationFrame(frame);
} else {
  ui.start.remove(); ui.bar.remove();
}

// for the offline renderer
window.__app = {
  DURATION, renderAt, ready: false,
  async renderAudio(sr = 48000) {
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * DURATION), sr);
    score(ctx, ctx.destination, 0);
    const buf = await ctx.startRendering();
    const blob = wav(buf);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
};

// wait for the embedded font before declaring the page ready (the offline renderer waits on this)
(async () => {
  const all = [...document.querySelectorAll('#overlay, #start')].map((e) => e.textContent).join('');
  try { await document.fonts.load("32px 'WenKai'", all); await document.fonts.ready; } catch (e) { /* fall back to system fonts */ }
  window.__app.ready = true;
})();
