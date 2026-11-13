// Materials for the voxels, patched from three's standard ones so they keep proper lighting and shadows.
import * as THREE from 'three';

export const U = { uTime: { value: 0 } };

const EDGE_VS = `attribute vec2 fuv;\nvarying vec2 vFuv;\nvarying vec3 vVox;\n`;
const EDGE_FS = `
  float ed = min(min(vFuv.x, 1.0 - vFuv.x), min(vFuv.y, 1.0 - vFuv.y));
  diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.11, ed));
  // a fine grain inside each face, only noticeable up close
  vec3 cell = floor(vVox * 4.0 + 0.002);
  diffuseColor.rgb *= 0.965 + 0.07 * fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
`;
// leaves and grass: a slow sway, a quicker flutter, more for higher foliage
const SWAY = `
  float ph = position.x * 0.09 + position.z * 0.07;
  float amp = clamp((position.y - 2.0) / 16.0, 0.18, 1.0);
  transformed.x += (sin(uTime * 1.25 + ph) * 0.24 + sin(uTime * 3.9 + position.y * 0.6 + ph * 3.0) * 0.05) * amp;
  transformed.z += (cos(uTime * 1.05 + ph * 1.3) * 0.18 + cos(uTime * 4.3 + position.x * 0.5) * 0.04) * amp;
  transformed.y += sin(uTime * 2.2 + ph * 2.0) * 0.04 * amp;
`;

function patch(mat, { sway = false, edge = true, extraFS = '' } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = (edge ? EDGE_VS : '') + 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${edge ? 'vFuv = fuv; vVox = position;' : ''}\n${sway ? SWAY : ''}`);
    if (edge) sh.fragmentShader = 'varying vec2 vFuv;\nvarying vec3 vVox;\nuniform float uTime;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${EDGE_FS}\n${extraFS}`);
  };
  mat.customProgramCacheKey = () => `vox-${sway}-${edge}-${extraFS.length}`;
  return mat;
}

export function voxelMaterials() {
  const solid = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 }));
  const leaf = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 }), { sway: true });
  const gold = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.92 }));
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 1.9, 1.7), toneMapped: false });
  glow.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    sh.fragmentShader = 'varying vec3 vP;\nuniform float uTime;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.9 + 0.1 * sin(uTime * 6.0 + vP.x * 1.7 + vP.z * 2.3) * sin(uTime * 2.3 + vP.y);');
  };
  glow.customProgramCacheKey = () => 'vox-glow';
  // water: flowing streaks down falling faces, a shimmer on still ones, and it thins out into the sky
  const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.84 });
  water.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'varying vec3 vP;\nvarying vec3 vN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN = normal;');
    sh.fragmentShader = 'varying vec3 vP;\nvarying vec3 vN;\nuniform float uTime;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float foam = 0.0;
        if (abs(vN.y) < 0.5) {
          float col = floor(vP.x * 1.0) * 1.7 + floor(vP.z * 1.0) * 2.9;
          float s = fract(vP.y * 0.22 + uTime * 1.6 + fract(sin(col) * 43758.5));
          foam = smoothstep(0.82, 0.97, s) * 0.85 + smoothstep(0.5, 0.0, abs(fract(vP.y * 0.9 + uTime * 3.1 + col) - 0.5)) * 0.12;
        } else {
          foam = smoothstep(0.75, 1.0, sin(vP.x * 1.3 + uTime * 1.4) * sin(vP.z * 1.1 - uTime * 1.1)) * 0.5;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foam);
        diffuseColor.a *= smoothstep(-56.0, -24.0, vP.y) * (0.82 + foam * 0.18);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(0.25, 0.32, 0.35) * foam;');
  };
  water.customProgramCacheKey = () => 'vox-water';
  // shadows that sway with the leaves
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  leafDepth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}`);
  };
  return { solid, leaf, gold, glow, water, leafDepth };
}
