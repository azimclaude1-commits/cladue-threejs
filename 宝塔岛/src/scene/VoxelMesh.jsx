import { MATS } from './mats.js';

/** draws the per-material geometries of one meshed voxel grid */
export function VoxelMesh({ geoms, cast = true, receive = true }) {
  return (
    <>
      {geoms.solid && <mesh geometry={geoms.solid} material={MATS.solid} castShadow={cast} receiveShadow={receive} />}
      {geoms.leaf && <mesh geometry={geoms.leaf} material={MATS.leaf} customDepthMaterial={MATS.leafDepth} castShadow={cast} receiveShadow={receive} />}
      {geoms.gold && <mesh geometry={geoms.gold} material={MATS.gold} castShadow={cast} receiveShadow={receive} />}
      {geoms.glow && <mesh geometry={geoms.glow} material={MATS.glow} />}
      {geoms.water && <mesh geometry={geoms.water} material={MATS.water} receiveShadow renderOrder={5} />}
    </>
  );
}
