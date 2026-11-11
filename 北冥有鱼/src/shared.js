import * as THREE from 'three';
// Uniforms shared by every custom material (one object, so a single update reaches all of them).
export const U = {
  uTime: { value: 0 },
  uCam: { value: new THREE.Vector3() },
  uFogColor: { value: new THREE.Color(0x02060a) },
  uFogDensity: { value: 0.006 },
  uFogFar: { value: new THREE.Color(0x02060a) },
  uUnder: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0, 0.3, 1).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.8, 0.5) },
  uSkyTop: { value: new THREE.Color(0.05, 0.07, 0.1) },
  uSkyHorizon: { value: new THREE.Color(0.3, 0.3, 0.32) },
  uLight: { value: 1 },
  uDisc: { value: new THREE.Color(2.0, 1.9, 1.7) }, // the sun's disc
};
export const share = (extra = {}) => ({ ...U, ...extra });
