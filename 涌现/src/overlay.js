// Titles, chapter cards and a small readout that proves it is all happening live.
import { ACTS, T, smooth } from './timeline.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

export class Overlay {
  constructor(root, info) {
    this.root = root;
    this.title = el('div', 'title', root, '<div class="zh">涌现</div><div class="en">EMERGENCE</div><div class="sub">一段完全由代码实时生成的影像与声音</div>');
    this.cards = ACTS.filter((a) => a.num).map((a) => {
      const desc = a.desc.replace('{N}', info.particles.toLocaleString('en-US')).replace('{B}', info.birds.toLocaleString('en-US'));
      const c = el('div', 'card', root, `<div class="num">${a.num}</div><div class="line"></div><div class="name"><span class="zh">${a.name}</span><span class="en">${a.en}</span></div><div class="desc">${desc}</div>`);
      return { t: a.t, c };
    });
    this.coda = el('div', 'coda', root, '从简单的规则中，涌现出复杂。<span>From simple rules, complexity emerges.</span>');
    this.hud = el('div', 'hud', root);
    this.info = info;
  }
  update(t, stats) {
    const ti = smooth(1.2, 2.4, t) * (1 - smooth(5.6, 6.8, t));
    this.title.style.opacity = ti.toFixed(3);
    this.title.style.transform = `translate(-50%, 0) scale(${(1 + 0.04 * t / 7).toFixed(4)})`;
    for (const { t: t0, c } of this.cards) {
      const a = smooth(t0 + 0.4, t0 + 1.4, t) * (1 - smooth(t0 + 5.2, t0 + 6.2, t));
      c.style.display = a > 0.001 ? '' : 'none';
      if (a <= 0.001) continue;
      c.style.opacity = a.toFixed(3);
      c.style.setProperty('--k', smooth(t0 + 0.4, t0 + 2.2, t).toFixed(3));
    }
    const ca = smooth(T.text + 2.2, T.text + 3.4, t) * (1 - smooth(T.collapse - 0.3, T.collapse + 0.6, t));
    this.coda.style.opacity = ca.toFixed(3);
    this.coda.style.display = ca > 0.001 ? '' : 'none';
    if (stats) this.hud.textContent = stats;
  }
}
