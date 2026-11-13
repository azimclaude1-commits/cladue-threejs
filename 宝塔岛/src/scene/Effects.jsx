// The miniature look: screen-space ambient occlusion, a shallow depth of field, a soft bloom, ACES.
import { EffectComposer, N8AO, Bloom, DepthOfField, Vignette, ToneMapping, SMAA } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

export function Effects({ high, dof, target }) {
  const dofRef = useRef();
  useFrame(() => { if (dofRef.current && dofRef.current.target) dofRef.current.target.copy(target.current); });
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {high ? <N8AO aoRadius={4} distanceFalloff={1.2} intensity={2.2} aoSamples={16} denoiseSamples={8} denoiseRadius={8} /> : <></>}
      {high && dof ? <DepthOfField ref={dofRef} target={[0, 12, 0]} worldFocusRange={120} bokehScale={1.7} focalLength={0.03} /> : <></>}
      <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.86} luminanceSmoothing={0.2} radius={0.72} />
      <Vignette offset={0.32} darkness={0.42} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  );
}
