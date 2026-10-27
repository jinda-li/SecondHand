// The landing page's room: what is in it, the SVG for those things (the worker renders it, so the
// page reads without JavaScript), and the scroll animation app.js starts on / and /en.
//
// Scrolling through the opening stage plays one list from start to finish: a phone photographs
// each thing and its price tag pops up, people from several groups queue for them, then they sell
// one by one and leave an empty, clean room. A second room further down fills up again for buyers.

// x/y/w/h place a thing in the room's 760×640 drawing; tx/ty is where its price tag points.
// a: the order things are photographed; k: the order they sell; q: how many people end up in line.
export const THINGS = [
  { id: 'rug', zh: '地毯', en: 'Rug', price: 15, sym: 'g-rug', x: 230, y: 385, w: 300, h: 150, tx: 380, ty: 400, a: 7, k: 9, q: 1 },
  { id: 'plant', zh: '绿植', en: 'Plant', price: 3, sym: 'g-plant', x: 345, y: 205, w: 70, h: 110, tx: 380, ty: 206, a: 5, k: 1, q: 2 },
  { id: 'shelf', zh: '书架', en: 'Shelf', price: 25, sym: 'g-shelf', x: 420, y: 180, w: 130, h: 200, tx: 492, ty: 182, a: 2, k: 6, q: 3 },
  { id: 'mirror', zh: '落地镜', en: 'Mirror', price: 12, sym: 'g-mirror', x: 80, y: 305, w: 70, h: 150, tx: 118, ty: 326, a: 6, k: 3, q: 1 },
  { id: 'sofa', zh: '沙发', en: 'Sofa', price: 40, sym: 'g-sofa', x: 160, y: 300, w: 190, h: 160, tx: 250, ty: 300, a: 0, k: 7, q: 4 },
  { id: 'desk', zh: '书桌', en: 'Desk', price: 35, sym: 'g-desk', x: 540, y: 313, w: 150, h: 150, tx: 640, ty: 352, a: 1, k: 5, q: 3 },
  { id: 'lamp', zh: '台灯', en: 'Lamp', price: 5, sym: 'g-lamp', x: 615, y: 309, w: 50, h: 70, tx: 640, ty: 304, a: 4, k: 0, q: 2 },
  { id: 'chair', zh: '椅子', en: 'Chair', price: 20, sym: 'g-chair', x: 520, y: 380, w: 80, h: 100, tx: 556, ty: 394, a: 3, k: 4, q: 2 },
  { id: 'box1', zh: '一箱厨具', en: 'Kitchen box', price: 8, sym: 'g-box', x: 440, y: 478, w: 62, h: 58, tx: 470, ty: 486, a: 8, k: 2, q: 1 },
  { id: 'box2', zh: '书和杂物', en: 'Books & bits', price: 0, sym: 'g-box', x: 492, y: 503, w: 52, h: 48, tx: 540, ty: 520, a: 9, k: 8, q: 1 },
];

const S = {
  zh: {
    free: '送', sold: '已售', inLine: (n) => `${n} 人排队`, available: '可预订', soldRow: '已出',
    shot: ['AI 认出', '件'], queue: ['已经有', '人在排队'], left: ['还剩', '件'], done: ['全部卖完，还剩', '件'],
  },
  en: {
    free: 'Free', sold: 'Sold', inLine: (n) => `${n} in line`, available: 'Available', soldRow: 'Sold',
    shot: ['AI found', 'things'], queue: ['', 'people in line'], left: ['', 'left'], done: ['All sold,', 'left'],
  },
};

const priceText = (t, lang) => (t.price ? `€${t.price}` : S[lang].free);
const cjk = (s) => /[㐀-鿿]/.test(s);
const textW = (s, size) => [...s].reduce((w, c) => w + (cjk(c) ? size : size * 0.58), 0);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The things, drawn in the room. The buyer's room gets the same things.
export function thingsSvg() {
  return THINGS.map((t) => `<g class="it" data-id="${t.id}"><ellipse cx="${t.x + t.w / 2}" cy="${t.y + t.h * 0.93}" rx="${t.w * 0.34}" ry="${t.h * 0.07}" fill="#5a3a2a" fill-opacity="${t.id === 'rug' || t.id === 'lamp' ? 0 : 0.22}"></ellipse><use href="#${t.sym}" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}"></use></g>`).join('');
}

// Price tags: name, a yellow price chip that turns into a blue "sold", and a queue bubble above.
export function tagsSvg(lang) {
  return THINGS.map((t) => {
    const name = t[lang];
    const price = priceText(t, lang);
    const nameW = Math.round(textW(name, 14));
    const chipW = Math.max(lang === 'en' ? 40 : 30, Math.round(textW(price, 13)) + 14);
    const w = 12 + nameW + 6 + chipW + 5;
    const cx = -w / 2 + 12 + nameW + 6;
    const qw = lang === 'en' ? 70 : 66;
    return `<g class="tag" transform="translate(${t.tx} ${t.ty})"><g class="tag-in">
<path d="M-5 -3 L0 3 L5 -3 Z" fill="#fff" stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round"></path>
<rect x="${-w / 2}" y="-31" width="${w}" height="28" rx="14" fill="#fff" stroke="#5a3a2a" stroke-width="1.8"></rect>
<path d="M-5 -4.2 L5 -4.2" stroke="#fff" stroke-width="2.4"></path>
<text x="${-w / 2 + 12}" y="-12.5" font-size="14" fill="#16213a">${esc(name)}</text>
<rect class="pb" x="${cx}" y="-27" width="${chipW}" height="20" rx="7"></rect>
<text class="price-t" x="${cx + chipW / 2}" y="-12.5" font-size="13" text-anchor="middle" fill="#16213a">${esc(price)}</text>
<text class="sold-t" x="${cx + chipW / 2}" y="-12.5" font-size="12" text-anchor="middle" fill="#fff">${S[lang].sold}</text>
<g class="q"><rect x="${-qw / 2}" y="-54" width="${qw}" height="20" rx="10" fill="#0058a3"></rect><text class="qt" x="0" y="-40" font-size="11.5" text-anchor="middle" fill="#fff"></text></g>
</g></g>`;
  }).join('');
}

// The seller's list beside the room, in the order things are photographed.
export function rowsHtml(lang) {
  return THINGS.map((t, i) => [t, i]).sort(([a], [b]) => a.a - b.a).map(([t, i]) => `<li class="row" data-i="${i}"><span class="th"><svg viewBox="0 0 ${t.w} ${t.h}"><use href="#${t.sym}"></use></svg></span><span class="nm">${esc(t[lang])}<small>${esc(priceText(t, lang))}</small></span><span class="stt">${S[lang].available}</span></li>`).join('');
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x) => 1 - Math.pow(1 - x, 3);
// Where each stage of the opening starts, as a share of its scroll.
const T_SHOT = 0.17, SHOT_STEP = 0.024; // photos: 0.17 – 0.41
const T_Q = 0.44, Q_SPAN = 0.2; // queues fill up: 0.44 – 0.64
const T_SELL = 0.68, SELL_STEP = 0.026; // things sell: 0.68 – 0.93
const T_CLEAN = 0.945;

export function initLanding(root, lang) {
  const s = S[lang] || S.zh;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const N = THINGS.length;

  // ---- the opening stage ----
  const hero = $('.hero');
  const room1 = $('#room1');
  const items1 = [...room1.querySelectorAll('.it')];
  const tags1 = [...room1.querySelectorAll('.tag')];
  const qTexts = tags1.map((t) => t.querySelector('.qt'));
  const phg = room1.querySelector('.phg');
  const phItem = phg.querySelector('.ph-item');
  const vf = room1.querySelector('.vf');
  const vfRect = vf.querySelector('rect');
  const rows = [];
  $$('#rows .row').forEach((r) => (rows[r.dataset.i] = r));
  const rowSt = rows.map((r) => r.querySelector('.stt'));
  const caps = $$('[data-cap]');
  const counter = $('#counter');
  const [cPre, cN, cPost] = ['#count-pre', '#count-n', '#count-post'].map($);
  const mini = $('#mini');
  const gp = $('#gp');
  const gpm = $('#gpm');
  const gpTabs = [...gp.querySelectorAll('.gp-tabs span')];
  const gpScreens = [...gp.querySelectorAll('.gp-s')];
  const gpmRows = [...gpm.querySelectorAll('.row-g')];
  const qTotals = $$('[data-qtotal]');
  const nav = $('.nav');
  let lastShot = -1;
  const setCount = ([pre, post], n) => { cPre.textContent = pre; cN.textContent = n; cPost.textContent = post; };

  function heroFrame() {
    const r = hero.getBoundingClientRect();
    const p = clamp(-r.top / (hero.offsetHeight - innerHeight));
    const e = ease(clamp(p / 0.14));
    hero.style.setProperty('--e', e.toFixed(4));
    hero.classList.toggle('past-words', e > 0.55);

    // 1. The phone waits beside the next thing with it on screen; when it is taken, the screen
    // blinks and its tag pops up.
    let shot = -1, shotCount = 0;
    THINGS.forEach((t, i) => {
      if (p < T_SHOT + t.a * SHOT_STEP) return;
      shotCount++;
      if (shot < 0 || t.a > THINGS[shot].a) shot = i;
    });
    const shooting = p >= T_SHOT - 0.02 && p < T_Q - 0.02;
    const aim = THINGS[shotCount < N ? THINGS.findIndex((t) => t.a === shotCount) : shot];
    phg.classList.toggle('on', shooting);
    vf.classList.toggle('on', shooting);
    // Beside the thing: on its left, or on its right near the room's left edge.
    phg.style.transform = `translate(${aim.x < 150 ? aim.x + aim.w + 6 : aim.x - 66}px,${aim.y + aim.h / 2 - 60}px)`;
    if (phItem.getAttribute('href') !== `#${aim.sym}`) phItem.setAttribute('href', `#${aim.sym}`);
    vf.style.transform = `translate(${aim.x - 6}px,${aim.y - 6}px)`;
    vfRect.setAttribute('width', aim.w + 12);
    vfRect.setAttribute('height', aim.h + 12);
    if (shooting && lastShot >= 0 && shotCount > lastShot) {
      phg.classList.remove('snap');
      void phg.getBBox();
      phg.classList.add('snap');
    }
    lastShot = shotCount;

    // 2. Queues fill up while the list goes round the groups; 3. things sell and leave.
    let inLine = 0, left = N;
    THINGS.forEach((t, i) => {
      const on = p >= T_SHOT + t.a * SHOT_STEP;
      const qn = Math.round(t.q * clamp((p - T_Q - t.a * 0.006) / (Q_SPAN * 0.8)));
      const at = T_SELL + t.k * SELL_STEP;
      const sold = p >= at;
      const gone = p >= at + 0.013;
      if (gone) left--;
      if (!sold) inLine += qn;
      tags1[i].classList.toggle('on', on);
      tags1[i].classList.toggle('queued', qn > 0 && !sold);
      tags1[i].classList.toggle('sold', sold);
      tags1[i].classList.toggle('gone', gone);
      qTexts[i].textContent = s.inLine(qn);
      items1[i].classList.toggle('gone', gone);
      rows[i].classList.toggle('on', on);
      rows[i].classList.toggle('queued', qn > 0 && !sold);
      rows[i].classList.toggle('sold', sold);
      rowSt[i].textContent = sold ? s.soldRow : qn ? s.inLine(qn) : s.available;
    });

    const phase = p < 0.16 ? 0 : p < T_Q - 0.01 ? 1 : p < T_SELL - 0.01 ? 2 : 3;
    caps.forEach((c) => c.classList.toggle('on', +c.dataset.cap === phase));
    mini.classList.toggle('on', phase === 1 || phase === 3);
    gp.classList.toggle('on', phase === 2);
    gpm.classList.toggle('on', phase === 2);
    // The same line, seen from three groups in turn.
    const g = clamp(Math.floor(((p - T_Q) / Q_SPAN) * 3), 0, 2);
    gpTabs.forEach((el, j) => el.classList.toggle('on', j === g));
    gpScreens.forEach((el, j) => {
      el.classList.toggle('on', j === g);
      el.classList.toggle('off', j < g);
    });
    gpmRows.forEach((el, j) => el.classList.toggle('on', j === g));
    qTotals.forEach((el) => (el.textContent = inLine));

    counter.classList.toggle('on', phase > 0);
    counter.classList.toggle('done', p >= T_CLEAN);
    if (phase === 1) setCount(s.shot, shotCount);
    else if (phase === 2) setCount(s.queue, inLine);
    else if (phase === 3) setCount(p >= T_CLEAN ? s.done : s.left, left);
    room1.classList.toggle('cleaned', p >= T_CLEAN);
    nav.classList.toggle('solid', r.bottom < 80);
  }

  // ---- the buyer's room: things land in it as it scrolls by ----
  const box2 = $('#room2box');
  const items2 = [...box2.querySelectorAll('.it')];
  const landOrder = [...THINGS.keys()].sort((a, b) => THINGS[b].k - THINGS[a].k);
  const landed = new Array(N).fill(false);
  items2.forEach((it) => it.classList.add('drop'));
  const gotN = $('#got-n');
  const gotE = $('#got-e');
  function buyerFrame() {
    const r = box2.getBoundingClientRect();
    const p = clamp((innerHeight * 0.92 - r.top) / (innerHeight * 0.75));
    let n = 0, sum = 0;
    landOrder.forEach((i, j) => {
      const on = p > (j + 0.5) / (N + 1);
      if (on) {
        n++;
        sum += THINGS[i].price;
      }
      if (on === landed[i]) return;
      landed[i] = on;
      items2[i].classList.toggle('drop', !on);
      items2[i].classList.toggle('land', on);
    });
    gotN.textContent = n;
    gotE.textContent = `€${sum}`;
  }

  let ticking = false;
  const frame = () => {
    ticking = false;
    heroFrame();
    buyerFrame();
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  frame();

  // ---- small loops in the cards, only while they are on screen ----
  // The queue card: the seller taps 他不要了 on the first in line, they leave, and the next moves up.
  const subst = $('[data-subst]');
  const qlist = subst.querySelector('.qlist');
  const qrows = [...subst.querySelectorAll('.qr')];
  const toast = subst.querySelector('.qtoast');
  let step = 0, timer = null;
  const place = (order) => order.forEach((k, i) => {
    qrows[k].className = `qr q${i}${i ? '' : ' first'}`;
    qrows[k].querySelector('.pos').textContent = i + 1;
  });
  function stepLine() {
    step = (step + 1) % 5;
    if (step === 1) qrows[0].classList.add('press');
    else if (step === 2) {
      qrows[0].className = 'qr out';
      place([1, 2]);
      toast.classList.add('on');
    } else if (step === 3) toast.classList.remove('on');
    else if (step === 4) {
      qlist.classList.add('fade');
      setTimeout(() => place([0, 1, 2]), 400);
    } else qlist.classList.remove('fade');
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    const card = e.target;
    card.classList.toggle('go', e.isIntersecting);
    if (!card.contains(subst) || still) return;
    if (e.isIntersecting && !timer) timer = setInterval(stepLine, 1500);
    else if (!e.isIntersecting && timer) {
      clearInterval(timer);
      timer = null;
    }
  }), { threshold: 0.4 });
  $$('[data-go]').forEach((c) => io.observe(c));
}
