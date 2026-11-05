// The 64-colour palette every final pixel snaps to (nearest in OKLab).
export const PALETTE = [
  // stone / greys
  '#0b0d12', '#1b1f27', '#2c313b', '#434a56', '#5d6572', '#7f8794', '#a5acb6', '#cdd2d7',
  // whites
  '#e9ebe4', '#fbfbf5',
  // navy / blues
  '#0a1729', '#112640', '#19375a', '#224b77', '#2c6293', '#3b7cb0', '#5598c8', '#80b8dc',
  // sea teal / green
  '#0d3434', '#144a4a', '#1c6260', '#297d78', '#3f9a90', '#6bbaac',
  // sky / dawn
  '#a7d3e8', '#d2eaf2', '#f1d2b0', '#f2ab86',
  // greens
  '#1b331c', '#2a5124', '#40702d', '#64933a', '#97b951',
  // wood / browns
  '#170d09', '#2b1911', '#432619', '#5f3721', '#7c4d2c', '#9b673b', '#ba8653', '#d6aa78',
  // reds
  '#3a0e13', '#66181d', '#982824', '#c54236', '#e67156',
  // orange / yellow
  '#743a10', '#b05d1b', '#dc872b', '#f0b142', '#f6d36c', '#faecae',
  // skin
  '#563828', '#86563b', '#c08761', '#ebbf98',
  // dusk / purple
  '#1a1430', '#33264c', '#574173', '#86689e',
  // night / extras
  '#06080f', '#101834', '#c9a0b8', '#ffd98a',
];

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function rgbToOklab([r, g, b]) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

if (PALETTE.length !== 64) throw new Error('palette must have 64 colours, has ' + PALETTE.length);
