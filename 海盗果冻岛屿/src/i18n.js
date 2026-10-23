export const STRINGS = {
  en: {
    docTitle: 'Pirate Jelly — Material Studies',
    eyebrow: 'MATERIAL STUDIES',
    title1: 'Pirate', title2: 'Jelly.',
    copy: 'A cove set in turquoise jelly: a ship at anchor, a skull in the shallows, a fire on the beach and gold under the palms.',
    live: 'WebGPU · Live', paused: 'WebGPU · Paused', unavailable: 'WebGPU · Unavailable', loading: 'Setting the jelly',
    cove: 'The cove', fire: 'Fire a gun', coins: 'Doubloons', barrel: 'Barrel',
    lively: 'Liveliness', shots: 'Shots', afloat: 'Afloat', sunk: 'Sunk',
    flavour: 'Flavour', turquoise: 'Turquoise', rum: 'Rum', kraken: 'Kraken',
    firmness: 'Firmness', damping: 'Wave damping', tod: 'Time of day',
    reset: 'Reset', pause: 'Pause', resume: 'Resume', view: 'Reset view',
    howTitle: 'How to play',
    how: 'Tap the ship to fire · tap the chest, the fire or the X · drag the water, a palm, a barrel or the ship · drag a side to tip the block · drag the sky to orbit, wheel or pinch to zoom · Space fires a gun',
    times: ['Noon', 'Afternoon', 'Golden hour', 'Sunset', 'Dusk', 'Night', 'Midnight'],
    fallbackTitle: 'This study needs WebGPU.',
    fallbackBody: 'Your browser didn’t offer a WebGPU adapter, so the jelly can’t set here. Try a current Chrome or Edge, or Safari with WebGPU enabled.',
    sheet: 'Controls',
    lang: '中文',
  },
  zh: {
    docTitle: '海盗果冻 — 材料研究',
    eyebrow: '材料研究',
    title1: '海盗', title2: '果冻。',
    copy: '一片凝在青绿果冻里的海湾：抛锚的海盗船、浅滩上的骷髅岩、沙滩上的篝火，还有棕榈树下的金子。',
    live: 'WebGPU · 实时', paused: 'WebGPU · 已暂停', unavailable: 'WebGPU · 不可用', loading: '果冻正在凝固',
    cove: '海湾', fire: '开一炮', coins: '金币', barrel: '木桶',
    lively: '活跃度', shots: '炮击', afloat: '漂浮', sunk: '沉底',
    flavour: '口味', turquoise: '青绿', rum: '朗姆', kraken: '海妖',
    firmness: '硬度', damping: '波浪阻尼', tod: '时间',
    reset: '重置', pause: '暂停', resume: '继续', view: '重置视角',
    howTitle: '玩法',
    how: '点船开炮 · 点宝箱、篝火或 X 标记 · 拖动海面、棕榈、木桶或船 · 拖动侧面让果冻块倾斜 · 拖动空白处旋转视角，滚轮或双指缩放 · 空格键开炮',
    times: ['正午', '午后', '黄金时刻', '日落', '黄昏', '夜晚', '午夜'],
    fallbackTitle: '这个作品需要 WebGPU。',
    fallbackBody: '你的浏览器没有提供 WebGPU 适配器，果冻无法在这里凝固。请使用最新版 Chrome 或 Edge，或开启了 WebGPU 的 Safari。',
    sheet: '控制面板',
    lang: 'EN',
  },
};

export function applyLang(lang) {
  const S = STRINGS[lang];
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = S.docTitle;
  for (const el of document.querySelectorAll('[data-i18n]')) { const v = S[el.dataset.i18n]; if (typeof v === 'string') el.textContent = v; }
  return S;
}
