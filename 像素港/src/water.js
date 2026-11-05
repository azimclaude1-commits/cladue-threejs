// The harbour water: a vertex grid lifted every frame by the long swells and the tide,
// shaded with the mirrored scene, Fresnel, sun glint, crest foam and the lighthouse beam.
import * as THREE from 'three';
import { env, seaHeight, seaNormal } from './env.js';

const VS = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
attribute float crest;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vCrest = crest;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`;

const FS = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform sampler2D tReflect;
uniform vec2 resolution;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 ambient;
uniform vec3 deep;
uniform vec3 shallow;
uniform vec3 viewDir;
uniform float reflectAmt;
uniform vec3 beamPos;
uniform float beamAngle;
uniform float beamOn;
uniform float time;
uniform float rainAmt;
uniform float foamAmt;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  #include <clipping_planes_fragment>
  vec3 n = normalize(vNormal);
  vec3 V = normalize(viewDir);
  vec2 suv = gl_FragCoord.xy / resolution;
  vec3 refl = texture2D(tReflect, suv + n.xz * vec2(0.05, 0.08)).rgb;
  float fres = 0.18 + 0.6 * pow(1.0 - max(dot(n, V), 0.0), 2.0);
  float diff = max(dot(n, sunDir), 0.0);
  float r = length(vWorld.xz);
  vec3 base = mix(shallow, deep, smoothstep(6.0, 18.0, r)) * (ambient + sunColor * diff * 0.6);
  vec3 col = mix(base, refl, fres * reflectAmt);
  // sun glint
  vec3 H = normalize(sunDir + V);
  col += sunColor * pow(max(dot(n, H), 0.0), 140.0) * 1.6;
  // crest foam
  col = mix(col, vec3(0.9, 0.95, 0.97) * (ambient + sunColor * 0.7), smoothstep(0.8, 1.05, vCrest) * clamp(rainAmt * 0.6 + foamAmt, 0.0, 0.7));
  // the lighthouse beam sweeping the water at night
  if (beamOn > 0.0) {
    vec2 d = vWorld.xz - beamPos.xz;
    float a = atan(d.y, d.x);
    float da = abs(atan(sin(a - beamAngle), cos(a - beamAngle)));
    da = min(da, 3.14159265 - da); // two opposite beams
    float L = length(d);
    float beam = (1.0 - smoothstep(0.02, 0.05 + 0.5 / (L + 4.0), da)) * smoothstep(3.0, 6.0, L) * exp(-L * 0.06);
    col += vec3(1.0, 0.93, 0.7) * beam * beamOn * 0.6;
  }
  // rain rings
  if (rainAmt > 0.0) {
    vec2 c = floor(vWorld.xz * 3.0);
    float ph = fract(time * 1.3 + h12(c) * 7.0);
    float ring = abs(length(fract(vWorld.xz * 3.0) - 0.5) - ph * 0.45);
    col += vec3(0.5) * (1.0 - smoothstep(0.0, 0.03, ring)) * (1.0 - ph) * rainAmt * step(0.6, h12(c + 3.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createWater(radius = 23.2) {
  const rings = 46, segs = 96;
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const rr = radius * Math.pow(r / rings, 0.9);
    for (let s = 0; s < segs; s++) { const a = (s / segs) * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('crest', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, clipping: true,
    uniforms: {
      tReflect: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
      sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) }, sunColor: { value: new THREE.Color(1, 1, 1) },
      ambient: { value: new THREE.Color(0.4, 0.45, 0.5) }, deep: { value: new THREE.Color(0.05, 0.22, 0.32) },
      shallow: { value: new THREE.Color(0.12, 0.42, 0.45) }, viewDir: { value: new THREE.Vector3(0.6, 0.5, 0.6) },
      reflectAmt: { value: 0.7 }, beamPos: { value: new THREE.Vector3() }, beamAngle: { value: 0 }, beamOn: { value: 0 },
      time: { value: 0 }, rainAmt: { value: 0 }, foamAmt: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = false;
  mesh.name = 'water';
  const P = g.attributes.position.array, N = g.attributes.normal.array, Cr = g.attributes.crest.array;
  const n = [0, 1, 0];
  mesh.userData.update = () => {
    const t = env.t;
    for (let i = 0, v = 0; i < P.length; i += 3, v++) {
      const x = P[i], z = P[i + 2];
      const y = seaHeight(x, z, t);
      P[i + 1] = y;
      seaNormal(x, z, t, n);
      N[i] = n[0]; N[i + 1] = n[1]; N[i + 2] = n[2];
      Cr[v] = (y - env.level) / (0.36 * env.swell + 0.04) + (1 - n[1]) * 4;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.crest.needsUpdate = true;
    mat.uniforms.time.value = t;
    mat.uniforms.foamAmt.value = Math.max(0, Math.min(0.6, (env.swell - 0.8) * 0.4));
  };
  return mesh;
}
