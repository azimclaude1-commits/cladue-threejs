import * as THREE from 'three';
import { TRAY, INNER, FLOOR_Y, RIM_TOP, waterSDF } from './layout.js';
import { roundedRectShape, roundedRectPath, fbm3 } from './utils.js';

const CAUSTICS_GLSL = /* glsl */ `
float jellyCaustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

function floorTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const deep = new THREE.Color('#3cc4c4');
  const mid = new THREE.Color('#86e3d6');
  const sand = new THREE.Color('#e9dcc0');
  const c = new THREE.Color();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1) * 2 - 1) * INNER.hx;
      const z = (j / (size - 1) * 2 - 1) * INNER.hz;
      const d = -waterSDF(x, z);
      const n = fbm3(x * 1.3, z * 1.3, 0.5, 4);
      const grain = fbm3(x * 9, z * 9, 2.0, 2);
      const t1 = THREE.MathUtils.smoothstep(d + (n - 0.5) * 0.5, -0.1, 0.55);
      const t2 = THREE.MathUtils.smoothstep(d + (n - 0.5) * 0.8, 0.4, 2.4);
      c.copy(sand).lerp(mid, t1).lerp(deep, t2 * 0.85);
      c.multiplyScalar(0.9 + grain * 0.2);
      const k = (j * size + i) * 4;
      img.data[k] = Math.min(255, c.r * 255);
      img.data[k + 1] = Math.min(255, c.g * 255);
      img.data[k + 2] = Math.min(255, c.b * 255);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}

export function buildTray() {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  const ceramic = new THREE.MeshPhysicalMaterial({
    color: 0xf2ece6,
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xffffff),
  });

  // Rim + base as one bevelled ring.
  const bev = 0.14;
  const shape = roundedRectShape(TRAY.hx - bev, TRAY.hz - bev, TRAY.r - bev);
  shape.holes.push(roundedRectPath(INNER.hx + bev, INNER.hz + bev, INNER.r + bev));
  const depth = 1.15;
  const rimGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: 8,
    curveSegments: 24,
  });
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.translate(0, RIM_TOP - depth - bev, 0);
  const rim = new THREE.Mesh(rimGeo, ceramic);
  rim.castShadow = true;
  rim.receiveShadow = true;
  group.add(rim);

  // Underside cap.
  const capGeo = new THREE.ShapeGeometry(roundedRectShape(INNER.hx + 0.2, INNER.hz + 0.2, INNER.r + 0.2), 16);
  capGeo.rotateX(Math.PI / 2);
  capGeo.translate(0, RIM_TOP - depth - bev * 2 + 0.01, 0);
  group.add(new THREE.Mesh(capGeo, ceramic));

  // Floor under the jelly, with animated caustics.
  const floorGeo = new THREE.ShapeGeometry(roundedRectShape(INNER.hx + 0.05, INNER.hz + 0.05, INNER.r + 0.05), 24);
  floorGeo.rotateX(-Math.PI / 2);
  const p = floorGeo.attributes.position;
  const uv = floorGeo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) / INNER.hx + 1) / 2, (p.getZ(i) / INNER.hz + 1) / 2);
  }
  floorGeo.translate(0, FLOOR_Y, 0);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85 });
  floorMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\n' + CAUSTICS_GLSL)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float cst = jellyCaustic(vWPos.xz * 0.22, uTime * 0.45);
        cst += 0.5 * jellyCaustic(vWPos.xz * 0.37 + 3.1, uTime * 0.6);
        totalEmissiveRadiance += vec3(0.75, 1.0, 0.95) * cst * 0.22 * diffuseColor.g;`
      );
  };
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  group.add(floor);

  // Soft contact shadow on the "table".
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ color: 0x8a5a44, opacity: 0.22 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = RIM_TOP - depth - bev * 2;
  ground.receiveShadow = true;

  return {
    group,
    ground,
    update(t) {
      uniforms.uTime.value = t;
    },
  };
}
