export const STRINGS = {
  en: {
    docTitle: 'Whole Orange Jelly — Material Studies No. 032',
    kicker: 'Material Studies / No. 032',
    title1: 'Whole',
    title2: 'Orange.',
    caption: 'Eleven segments, set in jelly. Zest, pith and juice. Cut it as small as you like.',
    live: 'WEBGPU · LIVE',
    offline: 'NO WEBGPU',
    loading: 'SETTING THE JELLY',
    tool: 'Tool', hand: 'Hand', knife: 'Knife',
    variety: 'Variety', navel: 'Navel', blood: 'Blood', caracara: 'Cara Cara',
    firmness: 'Firmness', damping: 'Internal damping',
    nudge: 'Give it a nudge', reset: 'Reset', pause: 'Pause', resume: 'Resume',
    quarter: '¼ speed', mesh: 'Show mesh',
    mass: 'Mass', volume: 'Volume', kinetic: 'Kinetic', pieces: 'Pieces',
    volumeUnit: '% of rest',
    hintHand: 'Drag the orange to grab and stretch it · drag the backdrop to turn · scroll to zoom',
    hintKnife: 'Draw a stroke across the orange to cut · right-drag to turn',
    hintBusy: 'Cutting…',
    maxPieces: 'Thirty pieces is the limit — reset for a fresh orange.',
    tooThin: 'That slice would be a sliver — try a little further in.',
    inside: 'Inside the experiment',
    notes: `
<p><b>Shape.</b> The orange is a signed distance field: a gently oblate ellipsoid (polar half-length 1.27, equatorial radius 1.36) lying on its side, with a softly flattened seat. Each piece is that field clipped by the half-spaces <i>n·X ≤ c</i> of the cuts that made it, the fresh edges rounded with a smooth max (k ≈ 0.085). Every piece keeps the orange's original rest frame, so the anatomy stays where it grew.</p>
<p><b>Anatomy.</b> Zest 0.07 deep with oil-gland pores, a green stem button and a small navel; white pith to 0.19; eleven segments with thin, bowed, wandering membranes around a pithy core; teardrop juice vesicles fanning out from the core; sixteen pips and a few bubbles. A pip that a cut goes through stays with the side holding its centre, eased just under the new face.</p>
<p><b>Jelly.</b> Each piece has a surface-nets skin on a 0.042 grid and a hex lattice in its own principal frame, boundary nodes snapped to the surface. Render vertices ride the lattice tets barycentrically. XPBD solves co-rotational shape matching per cell and volume per tet — zest and pith firmer than the flesh — with edge and deformation damping, Coulomb friction, a little rolling resistance, piece-to-piece contact against each other's exact rest shape, and sleeping. Fixed 60 Hz, small substeps.</p>
<p><b>Knife.</b> The stroke, read on the top of what it crosses, fixes a vertical blade plane. Each crossed piece receives it in its rest frame through its best-fit rotation as a new half-space. The halves build while the knife lines up and presses a groove, take over the position and speed of the jelly they came from, and the blade wedges them apart.</p>
<p><b>Light.</b> A soft PCSS key shadow tinted by the jelly and contact AO from a height map. Back-face thickness, refraction with each tap dimmed by its own path, and a volumetric march in rest space using a per-vertex inverse deformation gradient: zest, pith, membranes and flesh absorb with their own colours while scattering stays grey, so light scattered out of orange flesh stays orange. Fresnel studio reflections, GGX, sugar glints, Khronos PBR Neutral, sRGB, dither.</p>`,
    fallbackTitle: 'This study needs WebGPU.',
    fallbackBody: 'Your browser did not offer a WebGPU adapter, so the live jelly cannot run here. Try a current Chrome, Edge or Safari (Technology Preview) on a desktop or recent phone.',
    massUnit: 'g', keUnit: 'mJ',
    lang: '中文',
  },
  zh: {
    docTitle: '整颗果冻橙子 — 材料研究 第 032 号',
    kicker: '材料研究 / 第 032 号',
    title1: '整颗',
    title2: '橙子。',
    caption: '十一瓣，凝在果冻里。果皮、白络与果汁。想切多小，就切多小。',
    live: 'WEBGPU · 实时',
    offline: '无 WEBGPU',
    loading: '果冻正在凝固',
    tool: '工具', hand: '手', knife: '刀',
    variety: '品种', navel: '脐橙', blood: '血橙', caracara: '红肉脐橙',
    firmness: '硬度', damping: '内部阻尼',
    nudge: '轻推一下', reset: '重置', pause: '暂停', resume: '继续',
    quarter: '¼ 速', mesh: '显示网格',
    mass: '质量', volume: '体积', kinetic: '动能', pieces: '块数',
    volumeUnit: '% 静止体积',
    hintHand: '拖动橙子可以抓起、拉伸 · 拖动背景旋转视角 · 滚轮缩放',
    hintKnife: '在橙子上划一道线来切 · 右键拖动旋转视角',
    hintBusy: '正在切…',
    maxPieces: '最多三十块——重置后换一颗新橙子。',
    tooThin: '这一刀切下来会太薄——往里一点再试。',
    inside: '实验内部',
    notes: `
<p><b>形状。</b>橙子是一个有向距离场：一个略扁的椭球（极向半长 1.27，赤道半径 1.36）侧躺着，底部被柔和地压平。每一块都是这个场被切出它的那些半空间 <i>n·X ≤ c</i> 裁剪后的结果，新切边用平滑最大值（k ≈ 0.085）倒圆。所有块共享橙子原来的静止坐标系，所以内部结构始终留在它生长的位置。</p>
<p><b>解剖。</b>0.07 深的果皮带油胞小孔、绿色果蒂和小小的脐；白色的络到 0.19 深；十一瓣，瓣膜很薄，略微弯曲、沿轴线游走，中间是一根白芯；泪滴形的汁胞从芯向外呈扇形排开；十六颗种子和几个小气泡。被刀切到的种子留给包含其中心的那一侧，并被轻轻推到新切面之下。</p>
<p><b>果冻。</b>每块都有一层 0.042 网格的 surface-nets 表皮，以及一个按自身主轴方向排布的六面体晶格，边界节点贴合到表面上。渲染顶点用重心坐标嵌在晶格四面体里。XPBD 对每个单元做共旋形状匹配、对每个四面体做体积约束——果皮和白络比果肉更硬——外加边阻尼和形变阻尼、库仑摩擦、少量滚动阻力、块与块之间按对方精确静止形状的碰撞，以及休眠。固定 60 Hz，小子步。</p>
<p><b>刀。</b>划线落在所经过物体的顶部，确定一个竖直的刀面。每个被划过的块通过最佳拟合旋转把它带入自己的静止坐标系，作为一个新的半空间。刀在对准、压出凹槽的同时，两半在后台逐步构建；新块继承原来果冻的位置和速度，刀身把两个切面楔开。</p>
<p><b>光。</b>带果冻色调的 PCSS 柔和主光阴影，以及来自高度图的接触遮蔽。背面厚度、折射（每次采样按自己的路径长度衰减），以及一次在静止空间里、借助逐顶点逆形变梯度进行的体积步进：果皮、白络、瓣膜和果肉各自按自己的颜色吸收，而散射是灰色的，所以从橙色果肉里散射出来的光依然是橙色。再加上菲涅尔棚拍反射、GGX 高光、糖晶闪点、Khronos PBR Neutral 色调映射、sRGB 和抖动。</p>`,
    fallbackTitle: '这个实验需要 WebGPU。',
    fallbackBody: '你的浏览器没有提供 WebGPU 适配器，实时果冻无法在这里运行。请在桌面或较新的手机上使用最新版 Chrome、Edge 或 Safari（技术预览版）。',
    massUnit: '克', keUnit: '毫焦',
    lang: 'EN',
  },
};

export function applyLang(lang) {
  const S = STRINGS[lang];
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = S.docTitle;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const k = el.dataset.i18n;
    if (S[k] !== undefined) el.textContent = S[k];
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    const k = el.dataset.i18nHtml;
    if (S[k] !== undefined) el.innerHTML = S[k];
  }
  return S;
}
