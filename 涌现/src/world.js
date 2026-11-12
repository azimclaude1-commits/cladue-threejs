// The world: one ray-marched pass. The reaction-diffusion relief, the land that rises out of it,
// water, a volumetric cloud deck, sky, sun, moon and stars. Writes depth so birds can fly in it.
import * as THREE from 'three';
import { HASH } from './glsl.js';
import { TERRAIN_GLSL } from './terrain.js';
import { TILE } from './rd.js';

export const CLOUD_B = 230, CLOUD_T = 330;

/** Tileable 3D noise for the clouds, computed on the GPU: R = Perlin-Worley, G = Worley fbm */
function makeNoise3D(renderer, N = 64) {
  const rt = new THREE.WebGL3DRenderTarget(N, N, N, { depthBuffer: false });
  const tex = rt.texture;
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLayer: { value: 0 }, uN: { value: N } },
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uLayer, uN;
      uint pcg3(uvec3 v) { v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v.x ^ v.y ^ v.z; }
      vec3 h33(vec3 c) { uint a = pcg3(uvec3(ivec3(c) + 1024)); return vec3(float(a & 1023u), float((a >> 10u) & 1023u), float((a >> 20u) & 1023u)) / 1023.0; }
      float worley(vec3 p, float P) {
        vec3 i = floor(p), f = fract(p); float d = 1.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 o = vec3(x, y, z); vec3 c = mod(i + o, P);
          d = min(d, length(o + h33(c) - f));
        }
        return d;
      }
      float vnoise(vec3 p, float P) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float n000 = h33(mod(i, P)).x, n100 = h33(mod(i + vec3(1, 0, 0), P)).x, n010 = h33(mod(i + vec3(0, 1, 0), P)).x, n110 = h33(mod(i + vec3(1, 1, 0), P)).x;
        float n001 = h33(mod(i + vec3(0, 0, 1), P)).x, n101 = h33(mod(i + vec3(1, 0, 1), P)).x, n011 = h33(mod(i + vec3(0, 1, 1), P)).x, n111 = h33(mod(i + vec3(1, 1, 1), P)).x;
        return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
      }
      void main() {
        vec3 p = vec3(gl_FragCoord.xy, uLayer + 0.5) / uN;
        float pf = 0.0, a = 0.5, fr = 4.0;
        for (int i = 0; i < 5; i++) { pf += a * vnoise(p * fr, fr); a *= 0.5; fr *= 2.0; }
        float w1 = 1.0 - worley(p * 4.0, 4.0), w2 = 1.0 - worley(p * 8.0, 8.0), w3 = 1.0 - worley(p * 16.0, 16.0);
        float wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        float pw = clamp((pf - (1.0 - wf)) / wf + 0.0, 0.0, 1.0);
        pw = clamp(mix(pf, pw, 0.6) * 1.15 - 0.08, 0.0, 1.0);
        float g = (1.0 - worley(p * 8.0, 8.0)) * 0.5 + (1.0 - worley(p * 16.0, 16.0)) * 0.3 + (1.0 - worley(p * 32.0, 32.0)) * 0.2;
        gl_FragColor = vec4(pw, g, pf, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < N; z++) { mat.uniforms.uLayer.value = z; renderer.setRenderTarget(rt, z); renderer.render(scene, cam); }
  renderer.setRenderTarget(prev);
  return tex;
}

const FS = /* glsl */ `
${HASH}
${TERRAIN_GLSL}
uniform mat4 uCamMat, uInvProj, uViewProj;
uniform vec3 uCamPos;
uniform float uTime, uFar;
uniform sampler2D uHeight;
uniform highp sampler3D uNoise3D;
uniform float uTile, uRdAmp, uUplift, uEarth, uWater, uVoid, uStars, uFog, uCloud, uKick, uBio, uVis;
uniform vec3 uSun, uSunCol, uZen, uHor, uGlow, uMoon;
uniform int uSteps, uOctM, uOctN, uShSteps, uClSteps;
varying vec2 vUv;

const float RDZ = 7.0;
const float CB = ${CLOUD_B.toFixed(1)}, CT = ${CLOUD_T.toFixed(1)};

float rdH(vec2 x) { return texture2D(uHeight, x / uTile + 0.5).r * (1.0 - smoothstep(172.0, 206.0, length(x))); }
float H(vec2 x, int oct) {
  float h = uRdAmp * RDZ * smoothstep(0.02, 0.33, rdH(x));
  if (uUplift > 0.0) h += uUplift * landH(x, oct);
  return h;
}
float maxH() { return uRdAmp * RDZ + uUplift * 470.0 + 1.0; }

float march(vec3 ro, vec3 rd) {
  float top = maxH();
  float t = 0.2;
  if (ro.y > top) { if (rd.y >= 0.0) return -1.0; t = (ro.y - top) / -rd.y; }
  float k = uUplift > 0.01 ? 0.42 : 0.55;
  for (int i = 0; i < 400; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * t;
    if (p.y > top && rd.y > 0.0) return -1.0;
    float d = p.y - H(p.xz, uOctM);
    if (abs(d) < 0.0012 * t + 0.01) return t;
    t += d * k;
    if (t > uFar) return -1.0;
  }
  return t < uFar ? t : -1.0;
}
vec3 normalAt(vec2 x, float t) {
  float e = 0.08 + 0.0015 * t;
  float hx = H(x + vec2(e, 0.0), uOctN) - H(x - vec2(e, 0.0), uOctN);
  float hz = H(x + vec2(0.0, e), uOctN) - H(x - vec2(0.0, e), uOctN);
  return normalize(vec3(-hx, 2.0 * e, -hz));
}
float softShadow(vec3 p, vec3 L) {
  float res = 1.0, t = 0.6, top = maxH();
  for (int i = 0; i < 64; i++) {
    if (i >= uShSteps) break;
    vec3 q = p + L * t;
    if (q.y > top) break;
    float h = q.y - H(q.xz, 4);
    res = min(res, 10.0 * h / t);
    if (res < 0.002) break;
    t += clamp(h * 0.6, 0.5 + t * 0.02, 60.0);
  }
  return clamp(res, 0.0, 1.0);
}

vec3 skyCol(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 c = mix(uHor, uZen, pow(y, 0.42));
  vec2 sh = normalize(uSun.xz + 1e-5), dh = normalize(rd.xz + 1e-5);
  float az = max(dot(dh, sh), 0.0);
  c += uGlow * pow(az, 5.0) * exp(-y * 7.0) + uGlow * 0.25 * exp(-y * 14.0);
  float sd = max(dot(rd, uSun), 0.0);
  c += uSunCol * (smoothstep(0.99955, 0.9998, sd) * 30.0 + pow(sd, 24.0) * 0.18 + pow(sd, 4.0) * 0.025) * smoothstep(-0.03, 0.02, rd.y) * (1.0 - uStars);
  if (uStars > 0.0) {
    // stars on a sphere grid, and a faint river of them
    vec2 g = vec2(atan(rd.z, rd.x) * 180.0, asin(clamp(rd.y, -1.0, 1.0)) * 180.0);
    vec2 cell = floor(g), f = fract(g) - 0.5;
    float h = hash12(cell);
    float star = 0.0;
    if (h > 0.972) { vec2 o = (hash32(cell).xy - 0.5) * 0.6; float r = length(f - o); star = exp(-r * r * 60.0) * (0.3 + 3.0 * pow(hash11(h * 91.0), 6.0)) * (0.75 + 0.25 * sin(uTime * (2.0 + h * 5.0) + h * 40.0)); }
    vec3 mw = normalize(vec3(0.4, 0.75, -0.52));
    float band = exp(-pow(dot(rd, mw) / 0.16, 2.0));
    float dust = hash12(floor(g * 2.0)) * band;
    c += uStars * (vec3(0.85, 0.9, 1.0) * star * (1.0 + band) + vec3(0.25, 0.28, 0.4) * band * 0.05 + vec3(0.6, 0.65, 0.8) * step(0.95, dust) * 0.12 * band) * smoothstep(-0.02, 0.1, rd.y);
    float md = max(dot(rd, uMoon), 0.0);
    c += vec3(0.9, 0.92, 1.0) * (smoothstep(0.99975, 0.9999, md) * 0.75 + pow(md, 300.0) * 0.03 + pow(md, 20.0) * 0.008) * uStars;
  }
  return mix(c, vec3(0.004, 0.006, 0.012) * (0.6 + 0.4 * y), uVoid);
}
vec3 fogCol(vec3 rd) {
  vec3 c = mix(uHor, uZen, 0.4) * 0.9;
  float sd = max(dot(rd, uSun), 0.0);
  c += uSunCol * pow(sd, 8.0) * 0.18 + uGlow * pow(max(dot(normalize(rd.xz + 1e-5), normalize(uSun.xz + 1e-5)), 0.0), 4.0) * 0.35;
  return mix(c, vec3(0.0), uVoid);
}

// ---- clouds
float cloudD(vec3 p, bool detail) {
  float hgt = (p.y - CB) / (CT - CB);
  if (hgt < 0.0 || hgt > 1.0) return 0.0;
  vec3 w = vec3(uTime * 3.0, 0.0, uTime * 1.2);
  vec4 n = texture(uNoise3D, (p + w) * 0.0016);
  float prof = smoothstep(0.0, 0.18, hgt) * smoothstep(1.0, 0.5, hgt);
  float cov = mix(0.75, 0.45, uCloud);
  float d = (n.r * 0.75 + n.b * 0.35) * prof - cov;
  if (d <= 0.0) return 0.0;
  if (detail) d -= texture(uNoise3D, (p + w * 1.5) * 0.0065).g * 0.22 * (1.0 - hgt * 0.5);
  return clamp(d * 3.0, 0.0, 1.0);
}
vec4 clouds(vec3 ro, vec3 rd, float tEnd, vec2 frag) {
  if (uCloud <= 0.0 || uClSteps == 0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0, t1;
  if (abs(rd.y) < 1e-4) return vec4(0.0, 0.0, 0.0, 1.0);
  float a = (CB - ro.y) / rd.y, b = (CT - ro.y) / rd.y;
  t0 = max(min(a, b), 0.0); t1 = min(max(a, b), tEnd);
  t1 = min(t1, t0 + 5000.0);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float ds = (t1 - t0) / float(uClSteps);
  float t = t0 + ds * hash12(frag + fract(uTime) * 61.0);
  vec3 acc = vec3(0.0); float T = 1.0;
  float mu = dot(rd, uSun);
  float phase = mix(0.08 / pow(1.0 + 0.36 - 1.2 * mu, 1.5), 0.06, 0.4) * 3.0;
  vec3 amb = mix(uHor, uZen, 0.55) * 0.75;
  for (int i = 0; i < 96; i++) {
    if (i >= uClSteps || T < 0.02) break;
    vec3 p = ro + rd * t;
    float d = cloudD(p, true);
    if (d > 0.001) {
      float l = 0.0;
      for (int j = 1; j <= 3; j++) l += cloudD(p + uSun * float(j * j) * 9.0, false);
      float lt = exp(-l * 1.6) ;
      float powder = 1.0 - exp(-d * 4.0);
      float hgt = (p.y - CB) / (CT - CB);
      vec3 S = uSunCol * lt * phase * powder * 1.1 + amb * (0.25 + 0.45 * hgt);
      float sig = d * 0.06 * ds;
      float tr = exp(-sig);
      float fogk = exp(-t * uFog * 0.6);
      acc += T * (1.0 - tr) * mix(fogCol(rd), S, fogk);
      T *= tr;
    }
    t += ds;
  }
  return vec4(acc, T);
}

void main() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize((uCamMat * vec4(v.xyz / v.w, 0.0)).xyz);
  vec3 ro = uCamPos;
  float t = march(ro, rd);
  // water
  float tw = -1.0;
  if (uWater > -100.0 && rd.y < 0.0 && ro.y > uWater) tw = (uWater - ro.y) / rd.y;
  bool water = tw > 0.0 && (t < 0.0 || tw < t);
  vec3 col; float dist; vec3 pHit;
  if (t < 0.0 && !water) {
    col = skyCol(rd); dist = 1e9; pHit = ro + rd * uFar;
  } else {
    float th = water ? tw : t;
    vec3 p = ro + rd * th; pHit = p; dist = th;
    vec3 n = water ? vec3(0.0, 1.0, 0.0) : normalAt(p.xz, th);
    // fine grain on the living surface
    if (!water && uEarth < 1.0) {
      vec3 g1 = noised(p.xz * 1.7), g2 = noised(p.xz * 5.3 + 7.0);
      n = normalize(n + vec3(-(g1.y * 0.06 + g2.y * 0.025), 0.0, -(g1.z * 0.06 + g2.z * 0.025)) * (1.0 - uEarth) * smoothstep(300.0, 40.0, th));
    }
    vec3 L = uSun;
    float sh = (L.y > -0.02 && uShSteps > 0) ? softShadow(p + n * 0.3, L) : 1.0;
    float dif = max(dot(n, L), 0.0) * sh;
    vec3 ambUp = mix(uHor, uZen, 0.6) * (0.55 + 0.45 * n.y);
    if (!water) {
      float hgt = p.y;
      // living matter: dark ground, iridescent ridges, veins that glow on the beat
      float vv = rdH(p.xz) / 0.33;
      float ndv = max(dot(n, -rd), 0.0);
      // pearl: mostly deep teal and violet, gold where the film is thin
      float film = vv * 0.7 + ndv * 0.9 + 0.1 * hash12(floor(p.xz * 2.0));
      vec3 irid = vec3(0.30, 0.48, 0.62) + vec3(0.32, 0.30, 0.28) * cos(6.28318 * (vec3(0.0, 0.18, 0.36) + film));
      vec3 bio = mix(vec3(0.008, 0.012, 0.022), irid * 0.36, smoothstep(0.15, 0.7, vv));
      vec3 glow = vec3(0.25, 0.8, 1.0) * exp(-pow((vv - 0.42) / 0.05, 2.0)) * (0.25 + 1.8 * uKick) * uBio;
      // earth
      float nz = hashi(ivec2(floor(p.xz * 0.35))) * 0.5 + 0.5;
      vec3 rock = mix(vec3(0.20, 0.18, 0.16), vec3(0.34, 0.30, 0.26), nz) ;
      vec3 grass = mix(vec3(0.07, 0.11, 0.035), vec3(0.13, 0.15, 0.05), nz);
      vec3 earth = rock;
      earth = mix(earth, grass, smoothstep(0.72, 0.9, n.y) * (1.0 - smoothstep(110.0, 170.0, hgt)));
      earth = mix(earth, vec3(0.86, 0.88, 0.92), smoothstep(0.55, 0.75, n.y) * smoothstep(165.0, 200.0, hgt + nz * 25.0));
      earth = mix(earth, vec3(0.42, 0.38, 0.3), 1.0 - smoothstep(1.0, 5.0, hgt - uWater));
      vec3 alb = mix(bio, earth, uEarth);
      col = alb * (uSunCol * dif * 2.2 + ambUp * 0.7);
      // gloss on the living surface
      vec3 hv = normalize(L - rd);
      float spec = pow(max(dot(n, hv), 0.0), 60.0) * sh;
      col += uSunCol * spec * mix(1.2, 0.03, uEarth) * (0.04 + 0.96 * pow(1.0 - ndv, 5.0) + 0.3);
      col += glow * (1.0 - uEarth);
      // rim from the sky, so the dark ridges read against the void
      col += mix(vec3(0.1, 0.25, 0.4), ambUp * 0.2, uEarth) * pow(1.0 - ndv, 4.0) * 0.4;
    } else {
      float depth = max(0.0, uWater - H(p.xz, 5));
      vec2 q = p.xz;
      vec3 n1 = noised(q * 0.07 + uTime * vec2(0.3, 0.1)), n2 = noised(q * 0.19 - uTime * vec2(0.1, 0.35));
      vec3 wn = normalize(vec3(-(n1.y * 0.07 + n2.y * 0.05), 1.0, -(n1.z * 0.07 + n2.z * 0.05)) * vec3(1.0, 1.0, 1.0));
      wn = normalize(mix(wn, vec3(0.0, 1.0, 0.0), smoothstep(400.0, 3000.0, th)));
      vec3 rr = reflect(rd, wn); rr.y = abs(rr.y);
      float fr = 0.02 + 0.98 * pow(1.0 - max(dot(wn, -rd), 0.0), 5.0);
      vec3 deep = mix(vec3(0.02, 0.09, 0.09), vec3(0.003, 0.012, 0.02), smoothstep(0.0, 25.0, depth)) * (ambUp + uSunCol * 0.3);
      col = mix(deep, skyCol(rr), fr);
      col += uSunCol * pow(max(dot(rr, L), 0.0), 600.0) * 18.0 * sh;
      col = mix(col, vec3(0.8) * (uSunCol * 0.6 + ambUp), (1.0 - smoothstep(0.0, 1.2, depth)) * 0.5 * smoothstep(0.3, 0.8, n1.x * 0.5 + 0.5));
    }
    // air between us and it
    float fk = 1.0 - exp(-th * uFog);
    col = mix(col, fogCol(rd), fk);
  }
  vec4 cl = clouds(ro, rd, dist, gl_FragCoord.xy);
  col = col * cl.a + cl.rgb;
  gl_FragColor = vec4(col * uVis, 1.0);
  vec4 clip = uViewProj * vec4(pHit, 1.0);
  gl_FragDepth = dist > 1e8 ? 1.0 : clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
}
`;

export class World {
  constructor(renderer, rd) {
    this.noise = makeNoise3D(renderer);
    this.uniforms = {
      uCamMat: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFar: { value: 9000 },
      uHeight: { value: rd.height.texture }, uNoise3D: { value: this.noise },
      uTile: { value: TILE }, uRdAmp: { value: 1 }, uUplift: { value: 0 }, uEarth: { value: 0 }, uWater: { value: -1000 },
      uVoid: { value: 1 }, uStars: { value: 0 }, uFog: { value: 0.002 }, uCloud: { value: 0 }, uKick: { value: 0 }, uBio: { value: 1 }, uVis: { value: 1 },
      uSun: { value: new THREE.Vector3(0.6, 0.3, 0.2).normalize() }, uSunCol: { value: new THREE.Color(1, 0.9, 0.8) },
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uMoon: { value: new THREE.Vector3(0, 1, 0) },
      uSteps: { value: 180 }, uOctM: { value: 5 }, uOctN: { value: 9 }, uShSteps: { value: 28 }, uClSteps: { value: 40 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: FS,
      depthTest: true, depthWrite: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -100;
  }
  update(camera) {
    const u = this.uniforms;
    u.uCamMat.value.copy(camera.matrixWorld);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uCamPos.value.copy(camera.position);
  }
}
