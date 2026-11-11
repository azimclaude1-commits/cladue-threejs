// The whole film is a pure function of time t (seconds). Scenes, captions and the camera live here.
export const DURATION = 86;

export const CHAPTERS = [
  { t: 0, name: '题', label: '北冥有鱼' },
  { t: 6, name: '其一', label: '北冥' },
  { t: 16, name: '其二', label: '鲲' },
  { t: 30, name: '其三', label: '海运' },
  { t: 40, name: '其四', label: '化鹏' },
  { t: 50, name: '其五', label: '扶摇' },
  { t: 64, name: '其六', label: '南冥' },
  { t: 78, name: '跋', label: '逍遥' },
];

// Key moments
export const T = {
  inkDrop: 4.6,      // the ink drop that opens the deep
  eye: 19.5,         // the eye of the Kun passes the camera
  rise: 29,          // Kun turns up toward the surface
  breach: 37.8,      // Kun breaks the surface
  dissolve: 40.6,    // Kun begins to come apart
  formed: 47.5,      // Peng fully formed
  climb: 50,         // Peng rides the whirlwind upward
  clouds: 58.5,      // Peng breaks through the cloud sea
  glide: 64,         // gliding south
  endFade: 78,       // light whitens to paper
};

export const CAPTIONS = [
  // [start, end, text, placement, tone]  tone: ink (dark on paper) | moon (light on dark) | gold
  [0.6, 5.2, '北冥有鱼', 'title', 'ink'],
  [7.5, 15.5, '北冥有鱼', 'right', 'moon'],
  [17.5, 23.5, '其名为鲲', 'right', 'moon'],
  [23.0, 29.5, '鲲之大，不知其几千里也', 'right', 'moon'],
  [31.0, 37.0, '是鱼也，海运则将徙于南冥', 'left', 'moon'],
  [38.5, 43.5, '化而为鸟', 'right', 'moon'],
  [42.5, 48.5, '其名为鹏', 'right', 'gold'],
  [45.5, 51.5, '鹏之背，不知其几千里也', 'left', 'moon'],
  [51.0, 57.0, '怒而飞，其翼若垂天之云', 'right', 'moon'],
  [56.5, 63.5, '水击三千里，抟扶摇而上者九万里', 'left', 'gold'],
  [65.0, 71.0, '去以六月息者也', 'right', 'gold'],
  [70.5, 77.5, '南冥者，天池也', 'right', 'ink'],
  [79.0, 86.0, '逍遥游', 'end', 'ink'],
];

// Notes in the manner of the old bestiary, shown small in a ruled box
export const NOTES = [
  [8.5, 15.0, '北冥', '北冥，北海也。其水玄，不见底，终岁无日。'],
  [20.5, 28.5, '鲲', '有鱼焉，其状如鲸而大，其名曰鲲。其目如月，其背若山，潜则海暗。'],
  [31.5, 37.0, '海运', '海运，海动也。六月大风起，鲲乃出焉。'],
  [44.0, 50.5, '鹏', '有鸟焉，其状如鹰而五采，其名曰鹏。其翼若垂天之云，见则天下风。'],
  [52.5, 60.5, '扶摇', '扶摇，旋风也，自下而上，鹏乘之。'],
  [66.0, 74.0, '南冥', '南冥，天池也，日出之所，其水如金。'],
];

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export function chapterAt(t) { let c = CHAPTERS[0]; for (const k of CHAPTERS) if (t >= k.t) c = k; return c; }
