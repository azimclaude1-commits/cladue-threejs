// Shared dimensions and shape functions for the diorama.
// The tray is a rounded rectangle in the XZ plane. +Z is the front (bank side).

export const TRAY = { hx: 5.2, hz: 4.6, r: 1.1, wall: 0.36 };
export const INNER = {
  hx: TRAY.hx - TRAY.wall,
  hz: TRAY.hz - TRAY.wall,
  r: TRAY.r - TRAY.wall,
};

export const FLOOR_Y = 0.0;
export const WATER_Y = 0.6; // jelly height where it meets the walls
export const BULGE = 0.2; // how much the jelly domes up in the middle
export const RIM_TOP = 0.8;
export const BANK_TOP = 0.74;
export const ISLAND = { x: 3.5, z: -2.85, r: 1.05 };

export function sdRoundRect(x, z, hx, hz, r) {
  const qx = Math.abs(x) - hx + r;
  const qz = Math.abs(z) - hz + r;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r;
}

// Wavy edge of the front bank (water is at z < bankEdgeZ(x)).
export function bankEdgeZ(x) {
  return 2.5 + 0.3 * Math.sin(x * 0.85 + 0.6) + 0.16 * Math.sin(x * 2.1 + 1.3);
}

export function islandRadius(angle) {
  return ISLAND.r * (1 + 0.12 * Math.sin(angle * 3 + 0.5) + 0.06 * Math.sin(angle * 5));
}

export function islandDist(x, z) {
  const dx = x - ISLAND.x;
  const dz = z - ISLAND.z;
  return Math.hypot(dx, dz) - islandRadius(Math.atan2(dz, dx));
}

// Negative inside open water, positive on walls / bank / island.
export function waterSDF(x, z) {
  return Math.max(
    sdRoundRect(x, z, INNER.hx, INNER.hz, INNER.r),
    z - bankEdgeZ(x),
    -islandDist(x, z)
  );
}

export function isWater(x, z, margin = 0) {
  return waterSDF(x, z) < -margin;
}

// Outward normal of the water boundary (points from water toward the obstacle).
export function waterNormal(x, z) {
  const e = 0.02;
  const gx = waterSDF(x + e, z) - waterSDF(x - e, z);
  const gz = waterSDF(x, z + e) - waterSDF(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

export function randomWaterPoint(rand, margin = 0.5) {
  for (let i = 0; i < 200; i++) {
    const x = (rand() * 2 - 1) * INNER.hx;
    const z = (rand() * 2 - 1) * INNER.hz;
    if (isWater(x, z, margin)) return [x, z];
  }
  return [0, 0];
}
