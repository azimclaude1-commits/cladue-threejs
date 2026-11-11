// Vertical captions, bestiary notes, chapter marks and the seal — all driven by t, so they scrub with the film.
import { CAPTIONS, NOTES, CHAPTERS, smooth } from './timeline.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

export class Overlay {
  constructor(root) {
    this.root = root;
    this.caps = CAPTIONS.map(([t0, t1, text, place, tone], i) => {
      const box = el('div', `cap cap-${place} tone-${tone}`, root);
      const cols = text.split(/[，。]/).filter(Boolean);
      const chars = [];
      cols.forEach((c) => {
        const col = el('div', 'col', box);
        for (const ch of c) chars.push(el('span', null, col, ch));
      });
      if (place === 'title') {
        const sub = el('div', 'sub', box);
        el('div', 'col', sub, '庄子 · 逍遥游');
        el('div', 'col', sub, '拟山海经图志');
        el('div', 'seal', box, '<i>鲲</i><i>鹏</i>');
      }
      if (place === 'end') {
        const sub = el('div', 'sub', box);
        el('div', 'col', sub, '北冥有鱼 · 终');
        el('div', 'seal', box, '<i>鲲</i><i>鹏</i>');
      }
      return { t0, t1, box, chars, slow: place === 'title' || place === 'end', i };
    });
    this.notes = NOTES.map(([t0, t1, title, text], i) => {
      const box = el('div', `note ${i >= 2 && i <= 4 ? 'note-r' : 'note-l'}`, root);
      el('div', 'nt', box, title);
      const body = el('div', 'nb', box);
      const chars = [];
      for (const ch of text) chars.push(el('span', null, body, ch));
      return { t0, t1, box, chars };
    });
    this.chap = el('div', 'chap', root);
    this.chapName = el('span', 'cn', this.chap);
    this.chapLabel = el('span', 'cl', this.chap);
    this.mark = el('div', 'seal seal-mark', root, '<i>鲲</i><i>鹏</i>');
    this.lastChap = null;
  }

  update(t) {
    for (const c of this.caps) {
      const on = t > c.t0 - 0.1 && t < c.t1 + 0.1;
      c.box.style.display = on ? '' : 'none';
      if (!on) continue;
      const step = c.slow ? 0.32 : 0.16, rise = c.slow ? 0.9 : 0.6;
      const out = 1 - smooth(c.t1 - 0.9, c.t1, t);
      c.chars.forEach((s, k) => {
        const a = smooth(c.t0 + k * step, c.t0 + k * step + rise, t) * out;
        s.style.opacity = a.toFixed(3);
        s.style.filter = a < 0.99 ? `blur(${((1 - a) * 6).toFixed(2)}px)` : 'none';
      });
      for (const s of c.box.querySelectorAll('.sub,.seal')) s.style.opacity = (smooth(c.t0 + 1.2, c.t0 + 2.2, t) * out).toFixed(3);
    }
    for (const n of this.notes) {
      const on = t > n.t0 - 0.1 && t < n.t1 + 0.1;
      n.box.style.display = on ? '' : 'none';
      if (!on) continue;
      const out = 1 - smooth(n.t1 - 0.8, n.t1, t);
      n.box.style.opacity = (smooth(n.t0, n.t0 + 0.6, t) * out).toFixed(3);
      n.chars.forEach((s, k) => { s.style.opacity = smooth(n.t0 + 0.3 + k * 0.05, n.t0 + 0.6 + k * 0.05, t).toFixed(3); });
    }
    let ch = CHAPTERS[0];
    for (const c of CHAPTERS) if (t >= c.t) ch = c;
    if (ch !== this.lastChap) { this.chapName.textContent = ch.name; this.chapLabel.textContent = ch.label; this.lastChap = ch; }
    const showChap = ch.t > 0 && ch.t < 78;
    this.chap.style.opacity = showChap ? (smooth(ch.t + 0.4, ch.t + 1.4, t) * (1 - smooth(ch.t + 4.5, ch.t + 5.5, t))).toFixed(3) : '0';
    this.mark.style.opacity = (smooth(5.5, 7, t) * (1 - smooth(77.5, 79, t)) * 0.85).toFixed(3);
    // dark ink on light ground later in the film
    this.root.classList.toggle('light', t > 38);
  }
}
