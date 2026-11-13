// Builds everything once.
import { makePalette } from './palette.js';
import { buildIsland, PAGODA } from './island.js';
import { buildPagoda } from './pagoda.js';
import { plantIsland } from './flora.js';
import { meshGrid } from '../voxel.js';

export const PAL = makePalette();
let cache = null;
export function buildWorld() {
  if (cache) return cache;
  const W = buildIsland(PAL);
  const pg = buildPagoda(W.grid, PAL, PAGODA.x, PAGODA.z, PAGODA.y);
  plantIsland(W.grid, PAL, W);
  cache = { geoms: meshGrid(W.grid, PAL), lanterns: W.lanterns, paper: pg.lanterns, fall: W.fall, pagodaTop: pg.top };
  return cache;
}
