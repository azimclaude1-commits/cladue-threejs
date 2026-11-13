// The colours of the island (sRGB), each with the material it is drawn with.
import { Palette } from '../voxel.js';

export function makePalette() {
  const P = new Palette();
  const add = (name, hex, mat, j) => P.add(name, hex, mat, j);
  // ground
  add('grass1', 0x6aa63d); add('grass2', 0x5b9935); add('grass3', 0x7bb547); add('grass4', 0x8cc256, 'solid', 0.04); add('moss', 0x4c8632);
  add('soil1', 0x8a5a3a); add('soil2', 0x76492f); add('soil3', 0x9c6a44);
  add('rock1', 0x928a7e); add('rock2', 0x7d756b); add('rock3', 0xa39a8d); add('rock4', 0x6c655d); add('rock5', 0x57524c);
  add('boulder', 0x9a9690); add('boulder2', 0x84807a);
  // stone work
  add('slab1', 0xc2bcaf, 'solid', 0.03); add('slab2', 0xb1ab9e, 'solid', 0.03); add('slab3', 0xcfc9bd, 'solid', 0.03);
  add('wall1', 0xa69f92); add('wall2', 0x928b7f); add('mortar', 0x7b756b);
  // pagoda
  add('vermilion', 0xc4372a, 'solid', 0.03); add('vermilionDk', 0x9a2b21, 'solid', 0.03);
  add('plaster', 0xf2e9da, 'solid', 0.02); add('woodDk', 0x4f3322); add('wood', 0x7b5234); add('ochre', 0xb27b3d);
  add('tile1', 0x56637a, 'solid', 0.03); add('tile2', 0x3f4a5e, 'solid', 0.03); add('ridge', 0x8a95a6, 'solid', 0.02); add('soffit', 0x8d5b33);
  add('gold', 0xe0b04a, 'gold', 0.02); add('bronze', 0x9a7a3c, 'gold', 0.03);
  // lights
  add('lampGlow', 0xffb84d, 'glow', 0.0); add('paperGlow', 0xff5a2a, 'glow', 0.0); add('lampStone', 0xb3ada2, 'solid', 0.03);
  add('lanternRed', 0xc8352a, 'solid', 0.02); add('lanternCap', 0x2c2420);
  // plants
  add('bark1', 0x4d3328); add('bark2', 0x5d3e2f); add('barkS', 0x452b28); add('barkP', 0x5b4a3f);
  add('sak1', 0xf8b9d1, 'leaf', 0.03); add('sak2', 0xf29ec1, 'leaf', 0.03); add('sak3', 0xfcd4e3, 'leaf', 0.03); add('sak4', 0xffecf3, 'leaf', 0.02); add('sak5', 0xe58ab1, 'leaf', 0.03);
  add('pine1', 0x2f5f3c, 'leaf'); add('pine2', 0x3b7247, 'leaf'); add('pine3', 0x244e30, 'leaf');
  add('bush1', 0x4b8a3b, 'leaf'); add('bush2', 0x5c9c47, 'leaf'); add('bush3', 0x3f7a33, 'leaf');
  add('azalea1', 0xe0507a, 'leaf', 0.03); add('azalea2', 0xf27fa2, 'leaf', 0.03);
  add('tuft', 0x86c35a, 'leaf'); add('tuft2', 0x9fd06b, 'leaf');
  add('vine', 0x497f35, 'leaf'); add('root', 0x5a4030);
  add('flowerW', 0xfffaf2, 'solid', 0.0); add('flowerY', 0xffd84d, 'solid', 0.0); add('flowerP', 0xc58ef0, 'solid', 0.0); add('flowerK', 0xff8db3, 'solid', 0.0);
  // water
  add('water', 0x5fc2d6, 'water', 0.0); add('foam', 0xe9fbff, 'water', 0.0);
  // clouds
  add('cloud1', 0xffffff, 'solid', 0.015); add('cloud2', 0xfff0f3, 'solid', 0.015); add('cloud3', 0xf3e1e8, 'solid', 0.015);
  // dragon
  add('jade1', 0x2f9e7e, 'solid', 0.04); add('jade2', 0x3db592, 'solid', 0.04); add('jade3', 0x217259, 'solid', 0.04);
  add('belly', 0xeac46a, 'gold', 0.03); add('mane', 0xff7a3a, 'solid', 0.04); add('mane2', 0xffb347, 'solid', 0.04);
  add('horn', 0xf2e4c4, 'solid', 0.02); add('eye', 0xfff07a, 'glow', 0.0); add('pupil', 0x1b1410); add('teeth', 0xfffaf0); add('mouth', 0x9e2b2b);
  return P;
}
