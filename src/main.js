import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WATER_Y, BULGE, isWater } from './layout.js';
import { buildTray } from './tray.js';
import { buildBank } from './bank.js';
import { buildTree } from './tree.js';
import { buildBoat } from './boat.js';
import { buildLife } from './life.js';
import { Jelly } from './jelly.js';

// ---------------------------------------------------------------- setup --
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!window.__CAPTURE__ });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f4e7dc');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(12.5, 12.5, 15.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.3, 1.7, -0.3);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 7;
controls.maxDistance = 34;
controls.maxPolarAngle = 1.3;
controls.update();

// lights
const hemi = new THREE.HemisphereLight(0xfff4e8, 0xd8b49c, 0.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
sun.position.set(-5, 13, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9;
sun.shadow.camera.bottom = -9;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun);
const rimLight = new THREE.DirectionalLight(0xffd9c2, 0.7);
rimLight.position.set(8, 6, -8);
scene.add(rimLight);

// ---------------------------------------------------------------- world --
const world = new THREE.Group(); // everything that moves when the tray is shaken
scene.add(world);

const tray = buildTray();
world.add(tray.group);
scene.add(tray.ground);

const jelly = new Jelly();
world.add(jelly.mesh);

const bank = buildBank();
world.add(bank.group);

const tree = buildTree();
world.add(tree.group);

const boat = buildBoat();
world.add(boat.group);

const life = buildLife({ jelly, tree, boat });
world.add(life.group);

// ----------------------------------------------------------- interaction --
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(WATER_Y + BULGE * 0.6));
const hit = new THREE.Vector3();
const pointer = { down: false, x: 0, z: 0, hold: 0, id: null };

function pickWater(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  const x = hit.x - world.position.x, z = hit.z - world.position.z;
  return isWater(x, z, 0.05) ? { x, z } : null;
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const p = pickWater(ev);
  if (!p) return;
  pointer.down = true;
  pointer.id = ev.pointerId;
  pointer.x = p.x;
  pointer.z = p.z;
  pointer.hold = 0;
  controls.enabled = false;
  renderer.domElement.setPointerCapture(ev.pointerId);
  document.body.classList.add('pressing');
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  const p = pickWater(ev);
  document.body.classList.toggle('over-water', !!p);
  if (!pointer.down || ev.pointerId !== pointer.id) return;
  if (p) { pointer.x = p.x; pointer.z = p.z; }
});
const release = (ev) => {
  if (!pointer.down || ev.pointerId !== pointer.id) return;
  pointer.down = false;
  controls.enabled = true;
  document.body.classList.remove('pressing');
};
renderer.domElement.addEventListener('pointerup', release);
renderer.domElement.addEventListener('pointercancel', release);
renderer.domElement.addEventListener('dblclick', (ev) => {
  const p = pickWater(ev);
  if (p) life.dropBall(p.x, p.z);
});

// shake the whole tray: the jelly sloshes with the container's acceleration
const shake = { t: -1, amp: 0.14, freq: 2.2, decay: 1.4 };
const shakeOffset = (t) => shake.amp * Math.sin(2 * Math.PI * shake.freq * t) * Math.exp(-t * shake.decay);

// UI
const $ = (id) => document.getElementById(id);
$('btn-shake').onclick = () => { shake.t = 0; };
$('btn-ball').onclick = () => { for (let i = 0; i < 3; i++) setTimeout(() => life.dropBall(), i * 180); };
$('btn-leaf').onclick = () => life.leafBurst(16);
const bindSlider = (id, key) => {
  const el = $(id);
  el.value = jelly.params[key];
  el.oninput = () => { jelly.params[key] = parseFloat(el.value); };
};
bindSlider('sl-stiff', 'stiffness');
bindSlider('sl-damp', 'damping');
bindSlider('sl-tension', 'tension');
$('btn-toggle').onclick = () => document.body.classList.toggle('ui-collapsed');

// ---------------------------------------------------------------- loop --
const clock = new THREE.Clock();
let time = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  time += dt;

  // tray shake
  if (shake.t >= 0) {
    shake.t += dt;
    const e = 1 / 240;
    const acc = (shakeOffset(shake.t + e) - 2 * shakeOffset(shake.t) + shakeOffset(Math.max(0, shake.t - e))) / (e * e);
    world.position.x = shakeOffset(shake.t);
    world.position.z = -0.5 * shakeOffset(shake.t * 1.1);
    jelly.slosh.x = -acc * 0.22;
    jelly.slosh.z = 0.5 * acc * 0.22;
    if (shake.t > 3.5) { shake.t = -1; world.position.set(0, 0, 0); jelly.slosh.x = jelly.slosh.z = 0; }
  }

  if (pointer.down) {
    pointer.hold += dt;
    jelly.press(pointer.x, pointer.z, 0.32, Math.min(0.32, pointer.hold * 2.2));
  }

  boat.update(dt, time, jelly);
  life.update(dt, time);
  jelly.update(dt);
  tray.update(time);
  bank.update(time);
  tree.update(time);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// handy for debugging in the console
window.__scene = { scene, camera, controls, jelly, life, boat, renderer };
