// A five-storey pagoda (gojū-no-tō): stone podium, five tapering storeys with vermilion pillars,
// white walls and lattice, upturned tiled roofs with hip ridges, corner lanterns, balconies and a spire.
import { hash3 } from '../voxel.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function buildPagoda(G, P, cx, cz, baseY) {
  const C = (n) => P.get(n);
  const set = (x, y, z, n) => G.set(cx + x, y, cz + z, C(n));
  const lanterns = [];
  // ---- podium
  for (let y = baseY + 1; y <= baseY + 2; y++) {
    const h = y === baseY + 1 ? 10 : 9;
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
      const rim = Math.abs(x) === h || Math.abs(z) === h;
      set(x, y, z, rim ? (((x + z + y) & 1) ? 'wall1' : 'wall2') : (y === baseY + 2 ? (((x * 3 + z) & 3) ? 'slab1' : 'slab3') : 'wall2'));
    }
  }
  for (let x = -2; x <= 2; x++) { set(x, baseY + 1, 11, 'slab3'); set(x, baseY + 2, 10, 'slab3'); }

  const HW = [6, 5, 5, 4, 3], HB = [6, 5, 5, 5, 5], OV = [5, 5, 4, 4, 4];
  let y0 = baseY + 3;
  for (let k = 0; k < 5; k++) {
    const hw = HW[k], hb = HB[k], H = hw + OV[k], next = k < 4 ? HW[k + 1] : 0;
    // ---- the storey
    for (let y = y0; y < y0 + hb; y++) for (let x = -hw; x <= hw; x++) for (let z = -hw; z <= hw; z++) {
      const onX = Math.abs(x) === hw, onZ = Math.abs(z) === hw;
      if (!onX && !onZ) { set(x, y, z, 'plaster'); continue; }
      const along = onX ? z : x, front = z === hw;
      const pillar = (onX && onZ) || Math.abs(along) === (hw >= 5 ? 3 : 2);
      let c = 'plaster';
      if (y === y0) c = 'woodDk';
      else if (y === y0 + hb - 1) c = 'vermilionDk';
      else if (y === y0 + hb - 2 && k > 0) c = 'woodDk';
      if (pillar && y > y0 - 1 && y < y0 + hb - 1) c = 'vermilion';
      // lattice windows on each face, a door on the ground floor
      const win = Math.abs(along) <= 1 && y > y0 && y < y0 + hb - 2;
      if (win) {
        if (k === 0 && (front || z === -hw)) c = (Math.abs(along) === 0 && y === y0 + 2) || (Math.abs(along) === 1 && y === y0 + 2) ? 'gold' : 'woodDk';
        else c = ((along + y) & 1) ? 'woodDk' : 'wood';
      }
      set(x, y, z, c);
    }
    // ---- brackets under the eaves
    const yb = y0 + hb;
    for (let x = -hw - 1; x <= hw + 1; x++) for (let z = -hw - 1; z <= hw + 1; z++) {
      if (Math.abs(x) <= hw - 1 && Math.abs(z) <= hw - 1) { set(x, yb, z, 'woodDk'); continue; }
      const along = Math.abs(x) >= Math.abs(z) ? z : x;
      set(x, yb, z, (along & 1) ? 'ochre' : 'vermilionDk');
    }
    for (let x = -hw - 2; x <= hw + 2; x++) for (let z = -hw - 2; z <= hw + 2; z++) {
      if (Math.abs(x) < hw + 2 && Math.abs(z) < hw + 2) continue;
      const along = Math.abs(x) >= Math.abs(z) ? z : x;
      if ((along & 1) === 0) set(x, yb, z, 'ochre');
    }
    // ---- the roof: shallow at the eaves, steeper above, corners swept up
    const yE = yb + 1;
    const span = H - next;
    const rise = (e) => 0.42 * e + 0.055 * e * e;
    let yTop = yE;
    for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
      const ex = H - Math.abs(x), ez = H - Math.abs(z), e = Math.min(ex, ez);
      if (e > span) continue;
      const cornerDist = Math.max(ex, ez);
      const sweep = 2.8 * Math.pow(1 - clamp(cornerDist / (H * 0.9), 0, 1), 2.2) * (1 - e / (span + 1));
      const yr = Math.round(yE + rise(e) + sweep);
      yTop = Math.max(yTop, yr);
      const hip = Math.abs(ex - ez) === 0;
      const stripe = (ex < ez ? z : x) & 1;
      const tile = e === 0 ? 'tile2' : hip ? 'ridge' : stripe ? 'tile1' : 'tile2';
      set(x, yr, z, tile);
      // thickness, and the rafters seen from below
      const prev = Math.round(yE + rise(Math.max(0, e - 1)) + 2.8 * Math.pow(1 - clamp(cornerDist / (H * 0.9), 0, 1), 2.2) * (1 - Math.max(0, e - 1) / (span + 1)));
      for (let y = Math.min(prev, yr) - 1; y < yr; y++) set(x, y, z, e <= 1 ? 'tile2' : ((ex < ez ? z : x) & 1) ? 'soffit' : 'woodDk');
      if (e >= span - 1 && next) for (let y = yr; y <= yr + 2; y++) G.put(cx + x, y, cz + z, C('plaster'));
    }
    // gilded tips at the four corners and a lantern hanging under each
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * H, z = sz * H;
      const yr = Math.round(yE + 2.8);
      set(x, yr + 1, z, 'gold'); set(x - sx, yr, z - sz, 'gold');
      const ly = yE - 1;
      set(x - sx, ly, z - sz, 'lanternCap');
      set(x - sx, ly - 1, z - sz, 'paperGlow'); set(x - sx, ly - 2, z - sz, 'paperGlow');
      set(x - sx, ly - 3, z - sz, 'lanternCap');
      if (k <= 1) lanterns.push([cx + x - sx + 0.5, ly - 1.5, cz + z - sz + 0.5]);
    }
    // ---- a balcony with a vermilion railing on the storeys above the first
    if (k < 4) {
      const ny = Math.round(yE + rise(span)) + 1;
      const nhw = next;
      for (let x = -nhw - 1; x <= nhw + 1; x++) for (let z = -nhw - 1; z <= nhw + 1; z++) {
        if (Math.abs(x) <= nhw && Math.abs(z) <= nhw) continue;
        set(x, ny - 1, z, 'wood');
        const along = Math.abs(x) === nhw + 1 ? z : x;
        set(x, ny, z, (along & 1) || (Math.abs(x) === nhw + 1 && Math.abs(z) === nhw + 1) ? 'vermilion' : 'vermilionDk');
      }
      y0 = ny;
    } else {
      // ---- the spire: base, nine rings, water flame and jewel
      let y = yTop + 1;
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { set(x, y, z, 'bronze'); set(x, y + 1, z, 'bronze'); }
      set(0, y + 2, 0, 'gold');
      y += 3;
      for (let i = 0; i < 9; i++) {
        set(0, y, 0, 'bronze');
        if (i % 1 === 0) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) set(dx, y, dz, (i & 1) ? 'gold' : 'bronze');
        set(0, y + 1, 0, 'bronze');
        y += 2;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { set(dx, y, dz, 'gold'); set(dx * 2, y + 1, dz * 2, 'gold'); set(dx, y + 2, dz, 'gold'); }
      set(0, y, 0, 'gold'); set(0, y + 1, 0, 'gold'); set(0, y + 2, 0, 'gold'); set(0, y + 3, 0, 'gold'); set(0, y + 4, 0, 'gold');
      G.sphere(cx, y + 5, cz, 0.9, C('gold'));
      set(0, y + 6, 0, 'gold');
    }
  }
  void hash3;
  return { lanterns, top: y0 };
}
