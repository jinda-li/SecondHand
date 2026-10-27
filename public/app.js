import { money as moneyIn, shareText, openItems, byRecent, defaultIntro, stripLinks, listMark, conditionText, CURRENCIES, RULES, itemText, saleText, textLang, contactNote, normTelegram, looksLikeTelegram, fbProfileUrl, fbListing } from './lib.js';
import { LANG, chosenLang, tr, isWeChat, isTelegram, isFacebook, setLang, movedHere } from './i18n.js';

const $app = document.getElementById('app');
const UI = new URLSearchParams(location.search).get('ui');
if (UI) document.documentElement.dataset.ui = UI;
const BOOT = window.__DATA__ || {};
// c=1 is set on our QR links; WeChat adds from= to links opened from a forwarded card.
const OPENED_AS_CARD = ['c', 'from'].some((k) => new URLSearchParams(location.search).has(k));
// A WeChat page opened from a QR code or a card keeps forwarding as a card after tapping links
// inside it, so this is remembered for the tab. The seller can also set or clear it by hand
// when the guess is wrong (old QR codes without c=1, cards whose links lack from=).
function cardSession() {
  try {
    return sessionStorage.getItem('cardSession') === '1';
  } catch {
    return false;
  }
}
function setCardSession(on) {
  try {
    if (on) sessionStorage.setItem('cardSession', '1');
    else sessionStorage.removeItem('cardSession');
  } catch {}
}
if (OPENED_AS_CARD) setCardSession(true);
// fw=1 is only on the "send the card" QR code: whoever scans it is about to forward, so point at
// WeChat's ··· menu. Not when opened from the card itself (from=), and fw is dropped from the address
// so the forwarded card doesn't carry it.
{
  const q = new URLSearchParams(location.search);
  if (q.has('fw')) {
    if (isWeChat && !q.has('from')) forwardGuide();
    q.delete('fw');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
}

function forwardGuide() {
  const el = document.createElement('div');
  el.className = 'wx-guide';
  el.innerHTML = `<div class="arrow">⤴</div>
    <div class="msg">${tr('点右上角 <b>···</b><br>→「发送给朋友」→ 选群<br>发出去就是卡片了', 'Tap <b>···</b> at the top right<br>→ Send to Chat → pick the group<br>it goes as a card')}</div>
    <button class="ok">${tr('知道了', 'Got it')}</button>`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}
const HOUR = 3600 * 1000;
const CHECK_AFTER_MS = 12 * HOUR;
// The management page starts warning this long before a list pauses (see LIST_TTL_MS in the worker).
const RENEW_WARN_MS = 7 * 24 * HOUR;
const MAX_PHOTOS = 3;
// Title = "<name>" + one of these; the first is the default.
const TITLE_SUFFIXES = tr(['的二手清单', '的搬家甩卖', '的毕业清仓', '回国前出闲置', '的闲置转让'], ["'s secondhand list", "'s moving sale", "'s graduation sale", "'s leaving sale", "'s stuff for sale"]);
const TITLE_PICKS = [tr('我的二手清单', 'My secondhand list')];
const DEFAULT_RULES = RULES[LANG];
const APP_NAME = tr('二手清单', 'Secondhand List');

// Money, item and list texts in the UI language (see lib.js).
const money = (cents, cur) => moneyIn(cents, cur, LANG);
const itemT = (it) => itemText(it, LANG);
const saleT = (sale) => saleText(sale, LANG);

// Telegram's own share page: pick a chat (or Saved Messages) and the link and text go there.
const tgShareUrl = (url, text = '') => `https://t.me/share/url?url=${encodeURIComponent(url)}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
// A chat with a Telegram user; text is pre-filled where Telegram supports it.
const tgChatUrl = (username, text = '') => `https://t.me/${encodeURIComponent(username)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

// ---------- small utilities ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

function rid(n) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % abc.length]).join('');
}

function buyerToken(create) {
  let t = store.get('buyerToken');
  if (!t && create) {
    t = rid(24);
    store.set('buyerToken', t);
  }
  return t;
}

async function api(path, { method = 'GET', body, key, form } = {}) {
  const headers = {};
  if (key) headers['X-Key'] = key;
  const tok = buyerToken(false);
  if (tok) headers['X-Buyer'] = tok;
  headers['X-Lang'] = LANG;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload });
  } catch {
    throw { code: 'NETWORK', message: tr('没保存成功，网络恢复后再点一次', 'Not saved. Tap again once you are back online') };
  }
  let j;
  try {
    j = await res.json();
  } catch {
    throw { code: 'NETWORK', message: tr('网络出错了，再点一次', 'Network error, tap again') };
  }
  if (!j.ok) throw j;
  return j.data;
}

function toast(msg, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Returns stop(); stop.say(msg) changes the message while it shows.
function loading(msg = tr('请稍候…', 'One moment…')) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div><i class="spin"></i><span></span></div>`;
  const say = (m) => (el.querySelector('span').textContent = m);
  say(msg);
  document.body.appendChild(el);
  return Object.assign(() => el.remove(), { say });
}

// Bottom half-screen sheet. render() returns HTML; clicks on [data-act] go to onAct(act, el).
// locked: tapping outside does not close it, so the seller can't skip a required step.
function openSheet(render, onAct, { onClose, locked = false } = {}) {
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="sheet"></div>`;
  const sheet = mask.firstChild;
  const api = {
    el: sheet,
    refresh() {
      sheet.innerHTML = render();
    },
    close() {
      mask.remove();
      onClose?.();
    },
  };
  mask.addEventListener('click', (e) => {
    if (e.target === mask) return locked ? undefined : api.close();
    const a = e.target.closest('[data-act]');
    if (a && sheet.contains(a)) onAct(a.dataset.act, a, api);
  });
  api.refresh();
  document.body.appendChild(mask);
  return api;
}

// In-page confirm dialog. Native confirm()/prompt() show the site address or "JavaScript"
// as their title (especially inside WeChat), so every confirmation goes through this.
function ask({ title, text = '', ok = tr('确定', 'OK'), danger = false, word = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, s) => {
      if (done) return;
      done = true;
      s?.close();
      resolve(v);
    };
    openSheet(() => `<h2>${esc(title)}</h2>
      ${text ? `<div class="hint center" style="padding-top:0">${esc(text).replace(/\n/g, '<br>')}</div>` : ''}
      ${word ? `<div class="group"><div class="cell"><input class="inp grow" name="askword" placeholder="${esc(tr(`输入「${word}」确认`, `Type "${word}" to confirm`))}" autocomplete="off"></div></div>` : ''}
      <div class="actions">
        <button class="btn ${danger ? 'danger-solid' : 'primary'} big block" data-act="ok">${esc(ok)}</button>
        <button class="btn block" data-act="cancel">${tr('取消', 'Cancel')}</button>
      </div>`, (act, el, s) => {
      if (act === 'cancel') return finish(false, s);
      if (act !== 'ok') return;
      if (word && s.el.querySelector('[name=askword]').value.trim() !== word) return toast(tr(`请输入「${word}」`, `Type "${word}"`));
      finish(true, s);
    }, { onClose: () => finish(false) });
  });
}

async function copy(text, okMsg = tr('已复制', 'Copied')) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    try {
      document.execCommand('copy');
    } catch {}
    ta.remove();
  }
  toast(okMsg);
}

const img = (id, thumb = true) => (id ? `/img/${id}${thumb ? '/t' : ''}` : '');

// Asking price, with the original price struck through after it when one is set and higher.
function moneyHtml(cents, cur, orig) {
  const p = `<span class="price${cents === 0 ? ' free' : ''}">${esc(money(cents, cur))}</span>`;
  return orig > cents ? `<span class="prices">${p}<s class="orig">${esc(money(orig, cur))}</s></span>` : p;
}

// Optional price box: blank means none; a number like "5", "5.5" or "5,50"; anything else is invalid.
function parsePrice(v) {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

function agoText(ts, now) {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 60) return m <= 1 ? tr('刚刚', 'just now') : tr(`${m} 分钟前`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 48) return tr(`${h} 小时前`, `${h} h ago`);
  return tr(`${Math.round(h / 24)} 天前`, `${Math.round(h / 24)} days ago`);
}

function dateText(d, lang = LANG) {
  if (!d) return '';
  const [, mm, dd] = d.split('-').map(Number);
  return lang === 'en' ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mm - 1]} ${dd}` : `${mm}月${dd}日`;
}

// "10月21日前出完" / "until Oct 21"
const untilText = (d) => (d ? tr(`${dateText(d)}前出完`, `until ${dateText(d)}`) : '');

const statusText = tr(
  { available: '在售', reserved: '已预订', sold: '已出', removed: '已下架' },
  { available: 'For sale', reserved: 'Reserved', sold: 'Sold', removed: 'Removed' },
);

function pickFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => {
      resolve([...input.files]);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

// ---------- image compression & upload (6.3: long edge 1280, JPEG ~0.75) ----------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

function canvasBlob(canvas, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
}

async function resize(im, maxSide, q) {
  const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return canvasBlob(c, q);
}

// Shrinking a big phone photo is the slow part, so the composer starts it as soon as a photo is
// picked and listing only sends the small JPEGs. One photo at a time: several 48 MP photos
// decoded at once can run a phone out of memory.
const shrunk = new WeakMap();
let shrinkQueue = Promise.resolve();
function shrinkPhoto(file) {
  let p = shrunk.get(file);
  if (!p) {
    p = shrinkQueue.then(async () => {
      const url = URL.createObjectURL(file);
      try {
        const im = await loadImage(url);
        const [full, thumb] = await Promise.all([resize(im, 1280, 0.75), resize(im, 600, 0.72)]);
        return { full, thumb };
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    shrinkQueue = p.catch(() => {});
    shrunk.set(file, p);
  }
  return p;
}

// A smaller copy for the AI, made from the shrunk photo rather than decoding the original again.
async function aiImage(file, maxSide, q) {
  const url = URL.createObjectURL((await shrinkPhoto(file)).full);
  try {
    return await resize(await loadImage(url), maxSide, q);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadPhoto(saleId, key, file) {
  const { full, thumb } = await shrinkPhoto(file);
  const form = new FormData();
  form.append('full', full, 'full.jpg');
  form.append('thumb', thumb, 'thumb.jpg');
  const { photoId } = await api(`/sale/${saleId}/photo`, { method: 'POST', key, form });
  return photoId;
}

// ---------- 打码: smear a mosaic over parts of a photo, on the phone, before upload ----------

// Resolves to the edited JPEG file, or null when cancelled or nothing was painted.
async function mosaicEditor(file) {
  const url = URL.createObjectURL(file);
  let im;
  try {
    im = await loadImage(url);
  } catch {
    toast(tr('这张照片打不开', "Can't open this photo"));
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  // Work at upload size: big enough to keep, small enough to repaint on every finger move.
  const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
  const W = Math.round(im.naturalWidth * s);
  const H = Math.round(im.naturalHeight * s);
  const layer = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
  const base = layer();
  base.getContext('2d').drawImage(im, 0, 0, W, H);
  // Coarse blocks, so text and faces underneath can't be read back.
  const block = Math.max(10, Math.round(Math.max(W, H) / 36));
  const small = Object.assign(document.createElement('canvas'), { width: Math.ceil(W / block), height: Math.ceil(H / block) });
  small.getContext('2d').drawImage(base, 0, 0, small.width, small.height);
  const mosaic = layer();
  const mg = mosaic.getContext('2d');
  mg.imageSmoothingEnabled = false;
  mg.drawImage(small, 0, 0, small.width * block, small.height * block);
  const mask = layer();
  const kg = mask.getContext('2d');
  const tmp = layer();
  const tg = tmp.getContext('2d');

  const el = document.createElement('div');
  el.className = 'mosaic-ed';
  el.innerHTML = `
    <div class="mosaic-tip">${tr('用手指涂抹要遮住的地方', 'Rub over what you want to hide')}</div>
    <div class="mosaic-stage"><canvas width="${W}" height="${H}"></canvas></div>
    <div class="mosaic-bar">
      <button class="pill" data-m="cancel">${tr('取消', 'Cancel')}</button>
      <button class="pill" data-m="undo" disabled>${tr('撤销', 'Undo')}</button>
      <button class="pill dark" data-m="done">${tr('完成', 'Done')}</button>
    </div>`;
  document.body.appendChild(el);
  const view = el.querySelector('canvas');
  const vg = view.getContext('2d');
  const undoBtn = el.querySelector('[data-m=undo]');
  const strokes = [];
  let cur = null;

  const paint = () => {
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, W, H);
    tg.drawImage(mosaic, 0, 0);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(mask, 0, 0);
    vg.drawImage(base, 0, 0);
    vg.drawImage(tmp, 0, 0);
  };
  const line = (st, from) => {
    kg.lineCap = kg.lineJoin = 'round';
    kg.lineWidth = st.r * 2;
    kg.beginPath();
    const p = st.pts;
    kg.moveTo(...p[Math.max(0, from - 1)]);
    for (let i = from; i < p.length; i++) kg.lineTo(...p[i]);
    kg.stroke();
  };
  const at = (e) => {
    const r = view.getBoundingClientRect();
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
  };
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    // Brush about 44 screen pixels wide, whatever the photo's size.
    const r = 22 * (W / view.getBoundingClientRect().width);
    const p = at(e);
    cur = { r, pts: [p, [p[0] + 0.1, p[1]]] };
    strokes.push(cur);
    line(cur, 1);
    paint();
    undoBtn.disabled = false;
  });
  view.addEventListener('pointermove', (e) => {
    if (!cur) return;
    cur.pts.push(at(e));
    line(cur, cur.pts.length - 1);
    paint();
  });
  const end = () => (cur = null);
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  paint();

  return new Promise((resolve) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'undo') {
        strokes.pop();
        kg.clearRect(0, 0, W, H);
        strokes.forEach((st) => line(st, 1));
        undoBtn.disabled = !strokes.length;
        return paint();
      }
      const done = b.dataset.m === 'done' && strokes.length;
      const blob = done ? await canvasBlob(view, 0.9) : null;
      el.remove();
      resolve(blob && new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    });
  });
}

// ---------- 裁剪: keep part of a photo, e.g. the item out of a seller's screenshot ----------

// Resolves to the cropped JPEG file, or null when cancelled or the whole photo was kept.
async function cropEditor(file) {
  const url = URL.createObjectURL(file);
  let im;
  try {
    im = await loadImage(url);
  } catch {
    toast(tr('这张照片打不开', "Can't open this photo"));
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
  const W = Math.round(im.naturalWidth * s);
  const H = Math.round(im.naturalHeight * s);

  const el = document.createElement('div');
  el.className = 'mosaic-ed crop-ed';
  el.innerHTML = `
    <div class="mosaic-tip">${tr('拖动四个角，框出要留下的部分', 'Drag the corners around the part to keep')}</div>
    <div class="mosaic-stage"><div class="crop-wrap"><canvas width="${W}" height="${H}"></canvas><div class="crop-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
    <div class="mosaic-bar">
      <button class="pill" data-m="cancel">${tr('取消', 'Cancel')}</button>
      <button class="pill" data-m="reset">${tr('还原', 'Reset')}</button>
      <button class="pill dark" data-m="done">${tr('完成', 'Done')}</button>
    </div>`;
  document.body.appendChild(el);
  const stage = el.querySelector('.mosaic-stage');
  const wrap = el.querySelector('.crop-wrap');
  const view = el.querySelector('canvas');
  const box = el.querySelector('.crop-box');
  view.getContext('2d').drawImage(im, 0, 0, W, H);

  // The crop in photo pixels; k converts screen pixels to photo pixels.
  let r = { x: 0, y: 0, w: W, h: H };
  let k = 1;
  const fit = () => {
    const sw = stage.clientWidth - 16;
    const sh = stage.clientHeight;
    const z = Math.min(sw / W, sh / H);
    k = 1 / z;
    view.style.width = `${Math.round(W * z)}px`;
    view.style.height = `${Math.round(H * z)}px`;
    draw();
  };
  const draw = () => Object.assign(box.style, { left: `${r.x / k}px`, top: `${r.y / k}px`, width: `${r.w / k}px`, height: `${r.h / k}px` });
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  // Dragging a corner moves that corner; dragging inside moves the whole frame.
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    const h = e.target.dataset?.h || (e.target === box ? 'move' : null);
    if (!h) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    drag = { h, x: e.clientX, y: e.clientY, r: { ...r } };
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) * k;
    const dy = (e.clientY - drag.y) * k;
    const o = drag.r;
    const min = 48 * k;
    if (drag.h === 'move') {
      r = { ...o, x: Math.min(W - o.w, Math.max(0, o.x + dx)), y: Math.min(H - o.h, Math.max(0, o.y + dy)) };
    } else {
      let [x1, y1, x2, y2] = [o.x, o.y, o.x + o.w, o.y + o.h];
      if (drag.h.includes('w')) x1 = Math.min(x2 - min, Math.max(0, x1 + dx));
      else x2 = Math.max(x1 + min, Math.min(W, x2 + dx));
      if (drag.h.includes('n')) y1 = Math.min(y2 - min, Math.max(0, y1 + dy));
      else y2 = Math.max(y1 + min, Math.min(H, y2 + dy));
      r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    draw();
  });
  const end = () => (drag = null);
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  fit();

  return new Promise((resolve) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'reset') {
        r = { x: 0, y: 0, w: W, h: H };
        return draw();
      }
      ro.disconnect();
      el.remove();
      const cw = Math.round(r.w);
      const ch = Math.round(r.h);
      if (b.dataset.m !== 'done' || (cw >= W - 1 && ch >= H - 1)) return resolve(null);
      const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      c.getContext('2d').drawImage(view, Math.round(r.x), Math.round(r.y), cw, ch, 0, 0, cw, ch);
      const blob = await canvasBlob(c, 0.9);
      resolve(blob && new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    });
  });
}

const CFG = window.__CFG__ || {};

function mergeSales(list) {
  const mine = store.get('mySales', []);
  for (const s of list) {
    const v = { id: s.id, key: s.key, title: s.title };
    const i = mine.findIndex((m) => m.id === s.id);
    if (i >= 0) mine[i] = v;
    else mine.push(v);
  }
  store.set('mySales', mine);
}

// ---------- routing ----------

function boot() {
  // Every 推荐朋友 entry (home, buyer list corner, manage top bar, after a sale).
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-recommend]');
    if (!r) return;
    e.preventDefault();
    recommendFriend();
  });
  // 中文 / English in the bar at the top of every page.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-lang-switch]')) return;
    e.preventDefault();
    setLang(LANG === 'en' ? 'zh' : 'en');
  });
  // Any page that renders a .nearby-feed placeholder gets the live feed filled in.
  new MutationObserver(mountNearbyFeeds).observe($app, { childList: true, subtree: true });
  $app.insertAdjacentHTML('beforebegin', langBarHtml());
  movedNotice();
  // The server titles pages for the share card (Chinese for WeChat); pages that don't set their own follow the UI.
  if (LANG === 'en' && textLang(document.title) === 'zh') document.title = APP_NAME;
  const path = location.pathname;
  let m;
  if (BOOT.notFound) return notFound();
  if ((m = path.match(/^\/s\/([A-Za-z0-9]+)\/i\/(\d+)/))) return buyerItem(m[1], Number(m[2]));
  if ((m = path.match(/^\/s\/([A-Za-z0-9]+)/))) return buyerSale(m[1]);
  if ((m = path.match(/^\/manage\/([A-Za-z0-9]+)/))) return manage(m[1]);
  if (path === '/my') return myQueues();
  if (path === '/nearby') return nearbyPage();
  if (path === '/keep') return keepPage();
  if (path === '/lists') return listsPage();
  if (path === '/new') return createSale();
  if (BOOT.landing) return landing();
  return home();
}

// / and /en arrive with the landing page already rendered by the server. People who already have
// lists get their home instead; someone who chose English is sent to /en.
function landing() {
  if (store.get('mySales', []).length) return home();
  if (BOOT.landing === 'zh' && chosenLang === 'en') return location.replace('/en');
  playLanding();
}

function playLanding() {
  $app.querySelectorAll('[data-feedback]').forEach((b) => (b.onclick = feedbackSheet));
  // The room that empties as you scroll; the page reads fine without it.
  import('./landing.js').then((m) => m.initLanding($app, BOOT.landing)).catch(() => {});
}

// The seller's own key for this sale, if this browser has one.
function localKey(saleId) {
  return store.get('mySales', []).find((s) => s.id === saleId)?.key || null;
}

// A list's own pages show the seller's view (banner, back-to-manage bar) only in a tab that came
// from that list's management page (its 买家视角 and 分享 buttons add #preview). Opened any other
// way they are the buyer page, even in a browser holding the key: a management link sent to a
// buyer by mistake leaves the key in their browser.
function previewing(saleId) {
  try {
    if (location.hash === '#preview') {
      sessionStorage.setItem('preview', saleId);
      history.replaceState(null, '', location.pathname + location.search);
    }
    return sessionStorage.getItem('preview') === saleId;
  } catch {
    return false;
  }
}


// 中文 | English at the top of every page, the current one highlighted; switching reloads the page.
// The manage page puts it beside the list's title instead, so it takes no row of its own.
function langSegHtml() {
  return `<span class="lang-seg">${[['zh', '中文'], ['en', 'English']]
    .map(([k, l]) => (k === LANG ? `<b>${l}</b>` : `<button data-lang-switch>${l}</button>`)).join('')}</span>`;
}
const langBarHtml = () => `<div class="lang-bar">${langSegHtml()}</div>`;

function ownerBanner(sale) {
  return `<div class="banner">${tr('这是买家看到的样子。你是卖家，不能预订自己的东西。', 'This is what buyers see. You are the seller, so you can\'t reserve your own things.')}</div>`;
}

// Seller previewing their own list sees buyer buttons; tapping one points them to the management page.
async function ownerTap(sale) {
  if (await ask({ title: tr('这是你自己的东西', 'This is your own item'), text: tr('买家点这里会排队预订。\n要改价格、标已出，去管理页。', 'Buyers tap here to reserve.\nTo change prices or mark things sold, go to the management page.'), ok: tr('去管理', 'Manage') })) location.href = `/manage/${sale.id}`;
}

// Ended and deleted lists look the same to buyers.
function notFound() {
  const item = BOOT.item;
  const ended = BOOT.endedTitle;
  $app.innerHTML = `<div class="empty">
    <div style="font-size:20px;font-weight:800;color:var(--text)">${item ? tr('这件东西已经不见了', 'This item is gone') : ended ? tr(`「${esc(ended)}」已经结束了`, `"${esc(ended)}" has ended`) : tr('这份清单已经不见了', 'This list is gone')}</div>
    <div style="margin-top:8px">${item ? tr('可能已经被卖家下架。', 'The seller probably took it down.') : ended ? tr('卖家已经收摊了，下面是附近还在卖的。', 'The seller has packed up. Here is what is still for sale nearby.') : tr('卖家已经结束或删除了这份清单。', 'The seller ended or deleted this list.')}</div>
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:center"><a class="btn small" href="/my">${tr('我的排队', 'My reservations')}</a><a class="btn small" href="/">${tr('回首页', 'Home')}</a></div>
  </div>
  ${keepWanted() ? keepBlockHtml(tr('你以后要出闲置，也能这样发', 'Selling your own stuff some day? Do it like this'), tr('拍照、填价格就上架，群友点开自己排队。', 'Snap a photo, add a price, and people get in line themselves.')) : ''}
  ${nearbyEntryHtml()}`;
}

// ---------- entry ----------

async function home() {
  const mine = store.get('mySales', []);
  $app.innerHTML = `
    <div class="appbar">${LOGO}</div>
    <div class="head has-keep-tag">${recommendTagHtml()}<h1>${tr('我的二手', 'My stuff')}</h1><div class="meta">${tr('拍照就上架，别人点开就能排队', 'Snap a photo to list it; people tap the link and get in line')}</div></div>
    ${mine.length ? `<div class="hint" style="padding-bottom:4px">${tr(`我的清单（${mine.length}）`, `My lists (${mine.length})`)} · <a href="/lists">${tr('全部清单和收藏入口 ›', 'All lists and the saved entry ›')}</a></div><div class="section">${mine.map((s) => `
      <a class="cell" href="/manage/${esc(s.id)}"><div class="grow"><div>${esc(s.title)}</div><div class="muted small">${tr('管理我的清单', 'Manage this list')}</div></div><span class="muted">›</span></a>`).join('')}
    </div>` : ''}
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <a class="btn primary big block" href="/new?go=1">${mine.length ? tr('再发一份新清单', 'Start another list') : tr('发布我的二手清单', 'Post my secondhand list')}</a>
      <a class="btn big block" href="/my">${tr('我的排队', 'My reservations')}</a>
      <button class="btn big block rec-btn" data-recommend>🎁 ${tr('推荐给要搬家的朋友', 'Recommend to a friend who is moving')}</button>
    </div>
    ${nearbyEntryHtml()}
    <div class="hint center"><a href="/privacy${tr('', '#en')}">${tr('隐私政策', 'Privacy')}</a> · <a href="/terms${tr('', '#en')}">${tr('服务条款', 'Terms')}</a> · <button class="link-btn small" id="feedback">${tr('反馈', 'Feedback')}</button>${tipOn() ? ` · <button class="link-btn small" id="tip">${tr('打赏开发者', 'Tip the developer')}</button>` : ''}</div>`;
  const tipBtn = $app.querySelector('#tip');
  if (tipBtn) tipBtn.onclick = () => tipSheet();
  $app.querySelector('#feedback').onclick = feedbackSheet;
}

// ---------- 6.1 create sale ----------

function rulesEditor(rules) {
  const all = [...rules, ...DEFAULT_RULES.filter((r) => !rules.includes(r))].slice(0, 5);
  return all.map((r) => `
    <div class="rule-row"><input type="checkbox" ${rules.includes(r) ? 'checked' : ''}><input class="inp" type="text" maxlength="40" value="${esc(r)}"></div>`).join('');
}

function readRules(root) {
  return [...root.querySelectorAll('.rule-row')]
    .filter((row) => row.querySelector('input[type=checkbox]').checked)
    .map((row) => row.querySelector('.inp').value.trim())
    .filter(Boolean);
}

function guessCurrency() {
  const lang = (navigator.language || '').toLowerCase();
  if (lang.endsWith('-us')) return 'USD';
  if (lang.endsWith('-gb')) return 'GBP';
  if (lang.endsWith('-se') || lang.startsWith('sv')) return 'SEK';
  return 'EUR';
}

// create: the title is built from the seller's name + a suffix chip; settings: plain editable title.
function saleFormHtml(s, { create = false } = {}) {
  const titleHtml = create
    ? `<label class="field"><span>${tr('你的名字', 'Your name')} <b class="req">*</b></span><input type="text" name="owner" maxlength="12" value="${esc(s.owner)}" placeholder="${tr('别人怎么称呼你', 'What people call you')}" autocomplete="nickname"></label>
      <div class="field">
        <span>${tr('清单标题', 'List title')}</span>
        <div class="seg">${TITLE_SUFFIXES.map((t, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-suffix="${esc(t)}">${esc(t.replace(/^'s /, ''))}</button>`).join('')}</div>
        <div class="help">${tr('标题：', 'Title: ')}<b class="title-preview"></b></div>
        <input type="hidden" name="title">
      </div>`
    : `<label class="field"><span>${tr('标题', 'Title')}</span><input type="text" name="title" maxlength="60" value="${esc(s.title)}"></label>`;
  // Two boxes, each named for its app, so nobody puts a WeChat ID where a Telegram username goes.
  // The one this person more likely uses comes first.
  const tgField = `<label class="field"><span>${tr('Telegram 用户名', 'Telegram username')}</span><input type="text" name="telegram" maxlength="64" value="${esc(s.telegram ? `@${s.telegram}` : '')}" placeholder="@username" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
  const wxField = `<label class="field"><span>${tr('微信号', 'WeChat ID')}</span><input type="text" name="wechatId" maxlength="60" value="${esc(s.wechatId)}" placeholder="${tr('你的微信号', 'Your WeChat ID')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
  const fbField = `<label class="field"><span>${tr('Facebook 主页链接', 'Facebook profile link')}</span><input type="text" inputmode="url" name="facebook" maxlength="200" value="${esc(s.facebook)}" placeholder="https://www.facebook.com/…" autocomplete="off" autocapitalize="off" spellcheck="false">
        <small class="help fb-help">${tr('Facebook 里点进自己的主页 → ··· →「复制主页链接」', 'In Facebook, open your profile → ··· → Copy profile link')}</small></label>`;
  const contact = `<div class="field"><span>${tr('联系方式', 'How buyers reach you')} <b class="req">*</b></span>
        <div class="help">${tr('至少填一个：发到微信群要填微信号，发到 Telegram 群要填 Telegram，发到 Facebook 群填 Facebook。买家一般在群里直接私聊你；排第 1 位又找不到你的人，才会看到这里填的。', 'Fill in at least one: your WeChat ID for WeChat groups, your Telegram for Telegram groups, Facebook for Facebook groups. Buyers usually message you in the group; only the first in line sees these, for when they can’t find you there.')}</div></div>
      ${isFacebook ? fbField + tgField + wxField : LANG === 'en' || isTelegram ? tgField + wxField + fbField : wxField + tgField + fbField}
      <label class="field"><span>${tr('取货地点', 'Pick-up place')} <b class="req">*</b></span><input type="text" name="location" maxlength="60" value="${esc(s.location)}" placeholder="${tr('例：地铁站附近自提', 'e.g. near the metro station')}"></label>`;
  const more = `<label class="field"><span>${tr('货币', 'Currency')}</span><select name="currency">${Object.keys(CURRENCIES).map((c) => `<option value="${c}" ${c === s.currency ? 'selected' : ''}>${c} ${CURRENCIES[c].trim()}</option>`).join('')}</select></label>
      <div class="field"><span>${tr('规则', 'Rules')}</span><div class="rules">${rulesEditor(s.rules)}</div></div>
      <label class="field"><span>${tr('截止日期（选填）', 'Last day (optional)')}</span><input type="date" name="leaveDate" value="${esc(s.leaveDate)}"></label>`;
  const nearby = `<label class="field nearby-row"><input type="checkbox" name="nearby" ${s.publicNearby === false ? '' : 'checked'}>
        <span style="margin:0;color:var(--text)">${tr('公开到「附近的二手」：你的东西会出现在附近别人的清单下面，卖得更快', 'Show in "Nearby": your things appear under other lists nearby and sell faster')}<br><span class="small muted">${tr('会用到你的大概位置（约 1 公里范围），不会显示具体地址', 'Uses your rough location (about 1 km), never your address')}</span></span></label>
      <div class="help nearby-tip" ${nearbyTipWanted(s.publicNearby !== false, s.telegram) ? '' : 'hidden'}>${tr('公开到附近的话，建议也填个 Telegram：附近看到的人不一定在你发的群里，也不一定用微信，Telegram 几乎哪里都有人用。', 'Showing in Nearby? Add a Telegram username too: people who find you there may not be in your group or use WeChat, and Telegram is used almost everywhere.')}</div>`;
  // Creating: the three required fields up front, the rest folded away with their defaults.
  if (create) {
    return `
    <div class="form ik">
      ${titleHtml}
      ${contact}
      <details class="ik-more">
        <summary><span><b>${tr('更多设置', 'More settings')}</b><span class="help">${tr(`货币 ${esc(s.currency)} · 规则 · 截止日期，都有默认值`, `Currency ${esc(s.currency)} · rules · last day, all have defaults`)}</span></span></summary>
        ${more}
      </details>
      ${nearby}
    </div>`;
  }
  return `
    <div class="form">
      ${titleHtml}
      ${contact}
      ${more}
      ${nearby}
    </div>`;
}

// Strangers from "Nearby" can't reach the seller through a group, so a list shown there without a
// Telegram username gets a nudge to add one: the one contact that works for most people anywhere.
const nearbyTipWanted = (nearby, telegram) => nearby && !String(telegram ?? '').trim();

function bindNearbyTip(root) {
  const sync = () => {
    const tip = root.querySelector('.nearby-tip');
    if (tip) tip.hidden = !nearbyTipWanted(root.querySelector('[name=nearby]')?.checked, root.querySelector('[name=telegram]')?.value);
  };
  root.addEventListener('input', sync);
  root.addEventListener('change', sync);
}

// Keeps the hidden title in sync with "<name><suffix>" in the create form.
function syncTitle(form) {
  const name = form.querySelector('[name=owner]').value.trim();
  const suffix = form.querySelector('[data-suffix].on')?.dataset.suffix || TITLE_SUFFIXES[0];
  // "Jinda's moving sale"; without a name, "My moving sale".
  const title = LANG === 'en' && !name ? `My ${suffix.replace(/^'s /, '')}` : (name || '我') + suffix;
  form.querySelector('[name=title]').value = title;
  form.querySelector('.title-preview').textContent = title;
}

function readSaleForm(root) {
  const v = (n) => root.querySelector(`[name=${n}]`).value.trim();
  return {
    title: v('title'),
    wechatId: v('wechatId'),
    telegram: v('telegram'),
    facebook: v('facebook'),
    location: v('location'),
    currency: v('currency'),
    leaveDate: v('leaveDate'),
    rules: readRules(root),
    nearby: root.querySelector('[name=nearby]').checked,
  };
}

// The contact boxes, checked before sending: at least one, each in its own box. Returns an error or ''.
function contactError(f) {
  if (!f.wechatId && !f.telegram && !f.facebook) return tr('微信号、Telegram、Facebook 至少填一个', 'Add a Telegram username, a Facebook profile link or a WeChat ID');
  if (f.facebook && !fbProfileUrl(f.facebook)) return tr('Facebook 那一栏要填主页链接：在 Facebook 里点进自己的主页 → ··· →「复制主页链接」', 'For Facebook, paste your profile link: open your profile → ··· → Copy profile link');
  if (looksLikeTelegram(f.wechatId)) return tr('微信号那一栏填的像是 Telegram 用户名，请填到 Telegram 那一栏', 'That looks like a Telegram username: put it in the Telegram box');
  if (f.telegram && !normTelegram(f.telegram)) return tr('Telegram 用户名不对：5 到 32 位字母、数字或下划线，例如 @jinda_li', 'Not a Telegram username: 5–32 letters, digits or underscores, like @jinda_li');
  return '';
}

// Approximate position for "附近的二手"; null when unavailable or refused. The server rounds it to ~1 km.
function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
    );
  });
}

// The first time a browser arrives from the old workers.dev address, ask it to save the new one.
// It sits above $app, so page renders don't wipe it. Telegram links live in chats, not bookmarks.
function movedNotice() {
  if (!movedHere || store.get('movedNoticed', false)) return;
  store.set('movedNoticed', true);
  const el = document.createElement('div');
  el.className = 'banner';
  el.style.marginTop = '12px';
  el.innerHTML = `${tr(`二手清单搬到新网址 <b>${esc(location.host)}</b> 了。${isTelegram ? '' : '收藏过旧网址的话，请重新收藏这一页。'}`,
    `Secondhand List has moved to <b>${esc(location.host)}</b>.${isTelegram ? '' : ' If you saved the old address, please save this page again.'}`)}
    <div class="row" style="margin-top:8px">
      ${isTelegram ? '' : `<button class="btn small primary" data-act="how">${tr('怎么收藏', 'How to save it')}</button>`}
      <button class="btn small" data-act="ok">${tr('知道了', 'Got it')}</button>
    </div>`;
  el.querySelector('[data-act=ok]').onclick = () => el.remove();
  const how = el.querySelector('[data-act=how]');
  if (how) how.onclick = () => {
    el.remove();
    if (isWeChat) return menuGuide('收藏');
    toast(/Mobi/i.test(navigator.userAgent) ? tr('在浏览器菜单里选「添加书签」或「添加到主屏幕」', 'Use "Add bookmark" or "Add to Home Screen" in the browser menu') : tr('按 Ctrl+D（Mac 上 ⌘+D）加到书签', 'Press Ctrl+D (⌘+D on a Mac) to bookmark'), 3000);
  };
  $app.before(el);
}

// WeChat gives pages no way to bookmark or share themselves, so point at its ··· menu instead.
function menuGuide(item) {
  const el = document.createElement('div');
  el.className = 'menu-guide';
  el.innerHTML = `
    <svg class="mg-arrow" viewBox="0 0 120 120" aria-hidden="true"><path d="M20 110 C 30 60, 60 30, 100 18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/><path d="M84 10 L104 16 L94 34" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="mg-steps">
      <div class="mg-step"><span class="mg-no">1</span>${tr('点右上角', 'Tap')} <b class="mg-dots">···</b>${tr('', ' at the top right')}</div>
      <div class="mg-step"><span class="mg-no">2</span>${tr(`选「<b>${esc(item)}</b>」`, `Choose <b>${esc({ 收藏: 'Favorite', 发送给朋友: 'Send to Chat' }[item] || item)}</b>`)}</div>
      ${item === '收藏' ? `<div class="mg-tip">${tr('以后在微信「我 → 收藏」里就能找到', 'Find it later in WeChat under Me → Favorites')}</div>` : ''}
    </div>
    <button class="pill mg-ok">${tr('知道了', 'Got it')}</button>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

// ---------- keep the tool for later ----------

// Most buyers are not selling today. Rather than push them to post (or to invite anyone),
// offer to save the tool in WeChat 收藏 for the day they move out.
function keepWanted() {
  return !store.get('kept', false) && !store.get('mySales', []).length;
}

// AI tries waiting inside a saved /keep link (worker KEEP_GIFT_USES).
const GIFT_USES = CFG.keepGiftUses || 10;

function keepButtonsHtml() {
  return `<div class="keep-btns"><a class="btn primary big" href="/keep?save=1">☆ ${tr('收藏备用', 'Keep for later')}</a><a class="btn big" href="/new?go=1">${tr('现在就发', 'Post now')}</a></div>
    <div class="small muted center">${tr(`送你 ${GIFT_USES} 次 AI 识图，存在${isWeChat ? '收藏' : '书签'}的页面里，以后打开就到账`, `${GIFT_USES} free AI photo tries live in the saved page, yours when you open it later`)}</div>`;
}

// Where people keep a page in the app they are in: WeChat 收藏, Telegram Saved Messages, or a bookmark.
const keepWhere = () => (isWeChat ? tr('收藏', 'Favorites') : isTelegram ? 'Saved Messages' : tr('书签', 'bookmarks'));
const keepVerb = () => (isWeChat ? tr('收藏', 'Add to Favorites') : isTelegram ? tr('存到 Saved Messages', 'Send to Saved Messages') : tr('存成书签', 'Bookmark it'));

// Steps for keeping the current page. extra: what the saved page gives back later.
function keepStepsHtml(extra = tr('就能找到', 'to find it again')) {
  if (isWeChat) return tr(`1. 点右上角 <b>···</b><br>2. 选「<b>收藏</b>」<br>3. 以后在「<b>我 → 收藏</b>」里，或者搜「<b>二手</b>」${extra}`, `1. Tap <b>···</b> at the top right<br>2. Choose <b>Favorite</b><br>3. Look under <b>Me → Favorites</b> ${extra}`);
  if (isTelegram) return tr(`1. 点下面的「存到 Saved Messages」<br>2. 选「<b>Saved Messages</b>」，发送<br>3. 以后在 Telegram 的 Saved Messages 里点开${extra}`, `1. Tap "Send to Saved Messages" below<br>2. Choose <b>Saved Messages</b> and send<br>3. Open it from Saved Messages later ${extra}`);
  return tr('用浏览器的「<b>添加书签</b>」或「<b>添加到主屏幕</b>」，以后点开就是这个页面。', 'Use <b>Add bookmark</b> or <b>Add to Home Screen</b> in your browser; it opens straight to this page.');
}

// In Telegram, the button that sends this page to Saved Messages.
const keepTgBtnHtml = () => (isTelegram ? `<a class="btn primary big block" href="${esc(tgShareUrl(location.href))}" data-act="tgkeep">${tr('存到 Saved Messages', 'Send to Saved Messages')}</a>` : '');

function keepBlockHtml(title, text) {
  return `<div class="highlight keep-block">
    <b>${title}</b> ${text}
    ${keepButtonsHtml()}
  </div>`;
}

// Bottom of a buyer's list page: what made this list, and how to get one.
function brandCardHtml() {
  return `<div class="brand-card">
    <div class="brand-card-head">${tr('这份清单是用「二手清单」做的', 'This list was made with Secondhand List')}</div>
    <div class="brand-card-body">
      ${tr('📷 拍照，填个价格就上架<br>💬 一个链接，发几个群都行<br>🙋 群友自己排队，不撞单', '📷 Snap a photo, add a price<br>💬 One link for all your groups<br>🙋 Buyers line up themselves, no double-selling')}
      ${keepWanted()
        ? `<div class="brand-card-note">${tr('现在用不上也没关系。收藏起来，搬家、毕业、回国那天再打开。', 'No use for it today? Keep it for the day you move out.')}</div>${keepButtonsHtml()}`
        : `<a class="btn primary big block" href="/new?go=1" style="margin-top:12px">${tr('我也发一份', 'Make my own list')}</a>`}
    </div>
  </div>`;
}

// Slides up once the buyer has scrolled past the first screen; hidden near the brand card.
function keepBar() {
  if (!keepWanted() || store.get('keepBarClosed', false) || document.querySelector('.keep-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'keep-bar';
  bar.innerHTML = `<span class="keep-star">☆</span>
    <div class="grow"><b>${tr('以后搬家用得上', 'Handy when you move out')}</b><div>${tr(`收藏起来，送你 ${GIFT_USES} 次 AI 识图`, `Keep it and get ${GIFT_USES} free AI photo tries`)}</div></div>
    <a class="btn small" href="/keep?save=1">${tr('收藏', 'Keep')}</a>
    <button class="keep-x" aria-label="${tr('关闭', 'Close')}">×</button>`;
  const onScroll = () => {
    const nearEnd = window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 500;
    bar.classList.toggle('on', window.scrollY > window.innerHeight * 0.8 && !nearEnd);
  };
  bar.querySelector('.keep-x').onclick = () => {
    store.set('keepBarClosed', true);
    window.removeEventListener('scroll', onScroll);
    bar.remove();
  };
  document.body.appendChild(bar);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// /keep is the page buyers save. ?save=1 makes a gift code and swaps the address to
// /keep?gift=<code>: WeChat 收藏 (or a bookmark) keeps the current URL, so the gift travels
// with the saved link and is claimed when someone opens it later. The page under it is the
// landing page, in the card's language; someone who chose the other one gets it via ?lang=.
async function keepPage() {
  const q = new URLSearchParams(location.search);
  if (chosenLang && chosenLang !== BOOT.landing) {
    q.set('lang', chosenLang);
    return location.replace(`/keep?${q}`);
  }
  // A plain saved /keep is the way back in: sellers get their home, as on /.
  if (!q.has('gift') && !q.has('save') && store.get('mySales', []).length) return home();
  playLanding();
  if (q.has('gift')) return redeemKeepGift(q.get('gift'));
  if (!q.has('save')) return;
  buyerToken(true);
  let gift = null;
  try {
    gift = await api('/keep/gift', { method: 'POST', body: {} });
  } catch {}
  history.replaceState(null, '', gift ? `/keep?gift=${encodeURIComponent(gift.code)}` : '/keep?from=fav');
  // The server titled this page for a gift; without one, fall back to the plain title.
  if (!gift) document.title = tr('二手清单｜搬家、毕业、回国出闲置', 'Secondhand List | Sell your stuff when you move out');
  const removeArrow = isWeChat ? wxMenuArrow() : () => {};
  openSheet(() => `<h2>${gift ? tr(`送你 ${gift.uses} 次 AI 识图`, `${gift.uses} free AI photo tries for you`) : tr(`${keepVerb()}，用的时候再打开`, `${keepVerb()}, open it when you need it`)}</h2>
    ${gift ? `<div class="hint center" style="padding-top:0">${tr(`发清单时拍张照，AI 就认出是什么，不用打字。<br>次数存在这个页面里：${keepVerb()}，以后打开就到账。`, `Snap a photo when you list something and the AI knows what it is, no typing.<br>The tries live in this page: keep it, and they are yours when you open it later.`)}</div>` : ''}
    <div class="group"><div class="cell small" style="display:block;line-height:2">${keepStepsHtml()}</div></div>
    <div class="actions">
      ${keepTgBtnHtml()}
      <button class="btn ${isTelegram ? '' : 'primary big'} block" data-act="done">${isWeChat ? tr('收藏好了', 'Saved it') : tr('存好了', 'Done')}</button>
      <a class="link-btn small" href="/new?go=1" style="margin:4px auto 0">${tr('现在就发一份', 'Post a list now')}</a>
    </div>`, (act, el, s) => {
    if (act !== 'done') return;
    store.set('kept', true);
    s.close();
    toast(gift ? tr('存好了，搬家时打开就到账', 'Saved. Open it when you move out') : tr('好，要用的时候见', 'See you when you need it'));
  }, { onClose: removeArrow });
}

// Opening a saved /keep?gift= link: the tries move onto this device, once.
async function redeemKeepGift(code) {
  store.set('kept', true);
  buyerToken(true);
  let r;
  try {
    r = await api(`/keep/gift/${encodeURIComponent(code)}`, { method: 'POST', body: {} });
  } catch {
    return;
  }
  if (r.status === 'own') return friendSendSheet(code);
  if (r.status === 'added' && r.friend) return friendWelcomeSheet(r.uses);
  if (r.status === 'added') {
    openSheet(() => `<h2>${tr('欢迎回来', 'Welcome back')}</h2>
      <div class="quota-out">${tr(`${r.uses} 次 AI 识图已到账`, `${r.uses} AI photo tries added`)}</div>
      <div class="hint center" style="padding-top:0">${tr('上架时拍张照，AI 就认出是什么，不用打字。', 'Snap a photo when you list something and the AI knows what it is, no typing.')}</div>
      <div class="actions"><a class="btn primary big block" href="/new?go=1">${tr('开始发布', 'Get started')}</a><button class="btn block" data-act="close">${tr('先看看', 'Just looking')}</button></div>`,
    (act, el, s) => act === 'close' && s.close());
    return;
  }
  const msg = tr({
    early: '次数存在这个页面里，以后再打开就到账',
    mine: '这份礼物你已经领过了',
    taken: '这份礼物已经被领走了，页面照样能用',
    onePerDevice: '这台手机已经领过一份礼物了',
  }, {
    early: 'The tries live in this page, yours when you open it later',
    mine: 'You already claimed this gift',
    taken: 'Someone already claimed this gift; the page still works',
    onePerDevice: 'This phone already claimed a gift',
  })[r.status];
  if (msg) toast(msg, 2600);
}

// ---------- 推荐朋友: send the tool, with AI tries inside, to a friend who is moving ----------

function recommendTagHtml() {
  return `<a class="keep-tag" href="#" data-recommend>🎁 ${tr('推荐给朋友', 'Tell a friend')}<small>${tr(`送 TA ${GIFT_USES} 次 AI 识图`, `${GIFT_USES} AI tries for them`)}</small></a>`;
}

// Makes a friend gift and opens its /keep page: that page is what ··· → 发送给朋友 sends,
// titled with the sender's name. Never shared from the current page, which may carry a seller key.
async function recommendFriend() {
  buyerToken(true);
  const stop = loading(tr('正在准备卡片…', 'Preparing the card…'));
  let gift;
  try {
    gift = await api('/keep/gift', { method: 'POST', body: { friend: true, name: store.get('ownerName', '') || store.get('nickname', '') } });
  } catch (e) {
    return toast(e.message);
  } finally {
    stop();
  }
  location.href = `/keep?gift=${encodeURIComponent(gift.code)}`;
}

// The sender lands on their own gift link: show what the friend will get, then send it.
function friendSendSheet(code) {
  const url = `${location.origin}/keep?gift=${encodeURIComponent(code)}`;
  const desc = document.querySelector('meta[name=description]')?.content || '';
  const canShare = !isWeChat && !isTelegram && !!navigator.share;
  const removeArrow = isWeChat ? wxMenuArrow() : () => {};
  openSheet(() => `<h2>${tr('推荐给要搬家的朋友', 'Recommend to a friend who is moving')}</h2>
    <div class="wx-chat"><div class="small muted center">${tr('朋友会收到这样一张卡片', 'Your friend gets a card like this')}</div>
      <div class="wx-card"><div class="grow"><div class="t">${esc(document.title)}</div><div class="d">${esc(desc)}</div></div><img src="/keep-icon.png" alt=""></div>
    </div>
    <div class="group"><div class="cell small" style="display:block;line-height:2">
      ${isWeChat
        ? tr('1. 点右上角 <b>···</b><br>2. 选「<b>发送给朋友</b>」，挑一个要搬家的人<br>3. TA 打开就到账，收藏起来以后用', '1. Tap <b>···</b> at the top right<br>2. Choose <b>Send to Chat</b> and pick a friend who is moving<br>3. The tries are theirs when they open it')
        : tr('把链接发给要搬家的朋友，TA 打开就到账。', 'Send the link to a friend who is moving; the tries are theirs when they open it.')}
    </div></div>
    <div class="small muted center" style="margin:-4px 0 12px">${tr('一张卡片只能一个人领。还想送别人，回来再点一次「推荐给朋友」。', 'One card, one friend. For someone else, tap "Tell a friend" again.')}</div>
    <div class="actions">
      ${isTelegram ? `<a class="btn primary big block" href="${esc(tgShareUrl(url, desc))}">${tr('在 Telegram 发给朋友', 'Send on Telegram')}</a>` : ''}
      ${isWeChat ? '' : `${canShare ? `<button class="btn primary big block" data-act="share">${tr('发给朋友', 'Send to a friend')}</button>` : ''}<button class="btn ${canShare || isTelegram ? '' : 'primary big'} block" data-act="copy">${tr('复制链接', 'Copy link')}</button>`}
      <button class="btn ${isWeChat ? 'primary big' : ''} block" data-act="done">${isWeChat ? tr('发好了', 'Sent it') : tr('好了', 'Done')}</button>
      ${isWeChat ? `<button class="link-btn small" data-act="qr" style="margin:4px auto 0">${tr('发出去只是一串网址？用二维码', 'Only a bare link got sent? Use the QR code')}</button>` : ''}
    </div>`, async (act, el, s) => {
    if (act === 'copy') copy(url, tr('已复制，发给朋友吧', 'Copied, send it to a friend'));
    if (act === 'share') {
      try {
        await navigator.share({ title: document.title, text: desc, url });
      } catch {}
    }
    if (act === 'qr') {
      s.close();
      sendCard(url, tr('送朋友的卡片', 'Gift card for a friend'));
    }
    if (act === 'done') {
      s.close();
      if (history.length > 1) history.back();
      else location.href = '/';
    }
  }, { onClose: removeArrow });
}

// The friend opens the card: the tries are in, and the page is worth keeping for moving day.
function friendWelcomeSheet(uses) {
  const fg = BOOT.friendGift || {};
  openSheet(() => `<h2>${tr(`${esc(fg.name || '朋友')}送你 ${uses} 次 AI 识图`, `${esc(fg.name || 'A friend')} sent you ${uses} AI photo tries`)}</h2>
    <div class="quota-out">${tr(`${uses} 次已到账`, `${uses} tries added`)}</div>
    <div class="hint center" style="padding-top:0">${tr(`出闲置时拍张照，AI 就认出是什么，不用打字。<br>现在用不上？${keepVerb()}这一页，搬家时再打开。`, `Snap a photo when you sell something and the AI knows what it is, no typing.<br>No use for it today? ${keepVerb()} and open it when you move out.`)}</div>
    <div class="actions">
      <a class="btn primary big block" href="/new?go=1">${tr('开始发布', 'Get started')}</a>
      <button class="btn block" data-act="keep">☆ ${isWeChat ? tr('收藏备用', 'Keep for later') : keepVerb()}</button>
    </div>`, (act, el, s) => {
    if (act !== 'keep') return;
    s.close();
    // The tries already sit on this phone; what gets saved is the plain page.
    history.replaceState(null, '', '/keep?from=fav');
    document.title = tr('二手清单｜搬家、毕业、回国出闲置', 'Secondhand List | Sell your stuff when you move out');
    const removeArrow = isWeChat ? wxMenuArrow() : () => {};
    openSheet(() => `<h2>${isWeChat ? tr('收藏到微信', 'Add to WeChat Favorites') : keepVerb()}</h2>
      <div class="group"><div class="cell small" style="display:block;line-height:2">${keepStepsHtml()}</div></div>
      <div class="actions">${keepTgBtnHtml()}<button class="btn ${isTelegram ? '' : 'primary big'} block" data-act="done">${isWeChat ? tr('收藏好了', 'Saved it') : tr('存好了', 'Done')}</button></div>`,
    (a, b, s2) => {
      if (a !== 'done') return;
      store.set('kept', true);
      s2.close();
      toast(tr('好，搬家时见', 'See you on moving day'));
    }, { onClose: removeArrow });
  });
}

// Right after a sale brings money in: the moment a seller is most likely to pass the tool on.
// Once per list.
function soldRecommendSheet(S) {
  const { sale, soldCents } = S.data();
  const asked = store.get('recAsked', []);
  if (asked.includes(S.saleId)) return;
  store.set('recAsked', [...asked, S.saleId].slice(-50));
  openSheet(() => `<div class="sold-rec">
      <b>${tr(`已经收回 ${esc(money(soldCents, sale.currency))} 了 🎉`, `${esc(money(soldCents, sale.currency))} back in your pocket 🎉`)}</b>
      <div class="small">${tr(`好用的话，转给也要搬家的朋友，送 TA ${GIFT_USES} 次 AI 识图`, `If it helped, pass it to a friend who is moving: they get ${GIFT_USES} AI photo tries`)}</div>
      <button class="btn block" data-recommend>🎁 ${tr('推荐给朋友', 'Tell a friend')}</button>
    </div>
    <div class="actions"><button class="btn block" data-act="close">${tr('下次再说', 'Maybe later')}</button></div>`,
  (act, el, s) => act === 'close' && s.close());
}

// ---------- 我的清单: every list this seller can manage ----------

// The /lists address carries each list's id and key, so a saved copy opens them on any phone.
function listsLink(lists) {
  return `/lists?${lists.map((s) => `s=${encodeURIComponent(`${s.id}-${s.key}`)}`).join('&')}`;
}

// Management data for every stored list. Lists that are gone (or whose key no longer works)
// are forgotten; a network error keeps them for next time.
async function loadMyLists() {
  const res = await Promise.all(store.get('mySales', []).map((s) => api(`/sale/${s.id}/manage`, { key: s.key }).then(
    (d) => ({ ...s, d }),
    (e) => ({ ...s, gone: e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN' }),
  )));
  res.filter((r) => r.gone).forEach((r) => forgetSale(r.id));
  const lists = res.filter((r) => r.d);
  mergeSales(lists.map((r) => ({ id: r.id, key: r.key, title: r.d.sale.title })));
  return lists;
}

function earnedText(d) {
  return d.soldCents ? money(d.soldCents, d.sale.currency) : CURRENCIES[d.sale.currency].trim() + '0';
}

function listRowHtml({ id, key, d }) {
  const n = (st) => d.items.filter((i) => i.status === st).length;
  return `<a class="list-row" href="/manage/${esc(id)}?k=${esc(key)}">
    <div class="row"><b class="grow ellipsis">${esc(d.sale.title)}</b><span class="small muted">${d.sale.status === 'ended' ? tr('已结束', 'Ended') : d.sale.paused ? tr('已暂停', 'Paused') : tr('进行中', 'Open')}</span><span class="muted">›</span></div>
    <div class="list-row-stats"><span>${statusText.available} <b>${n('available')}</b></span><span>${statusText.reserved} <b>${n('reserved')}</b></span><span>${statusText.sold} <b>${n('sold')}</b></span><span>${tr('已收回', 'Earned')} <b class="earned-tag">${esc(earnedText(d))}</b></span><span class="list-forget" role="button" data-forget="${esc(id)}">${tr('移出', 'Remove')}</span></div>
  </a>`;
}

async function listsPage() {
  // Lists in the opened link join the ones this phone already knows.
  const mine = store.get('mySales', []);
  for (const v of new URLSearchParams(location.search).getAll('s')) {
    const [id, key] = v.split('-');
    if (id && key && !mine.some((m) => m.id === id)) mine.push({ id, key, title: '' });
  }
  store.set('mySales', mine);
  $app.innerHTML = `<div class="empty">${tr('加载中…', 'Loading…')}</div>`;
  const lists = await loadMyLists();
  // Keep the address complete, so whatever gets saved opens every list.
  history.replaceState(null, '', lists.length ? listsLink(lists) : '/lists');
  const currencies = new Set(lists.map((l) => l.d.sale.currency));
  const total = lists.reduce((a, l) => a + l.d.soldCents, 0);
  $app.innerHTML = `
    <div class="head"><h1>${tr('我的清单', 'My lists')}</h1><div class="meta">${tr(`${lists.length} 份`, `${lists.length} ${lists.length === 1 ? 'list' : 'lists'}`)}${currencies.size === 1 && total ? tr(` · 共收回 ${esc(money(total, [...currencies][0]))}`, ` · ${esc(money(total, [...currencies][0]))} earned`) : ''}</div></div>
    ${lists.length && !store.get('listsKept', false) ? `<div class="highlight lists-keep">
      <b>☆ ${tr(`把这一页${isWeChat ? '收藏到微信' : isTelegram ? '存到 Saved Messages' : '存成书签'}`, `Keep this page in ${keepWhere()}`)}</b> ${tr('所有清单一个入口，换手机、清了浏览器也能管理。', 'One entry for all your lists, even on a new phone or after clearing the browser.')}
      <div class="small muted">${tr('只收藏，别发到群里：拿到链接的人能改你的清单。', 'Keep it to yourself, never post it in a group: anyone with the link can change your lists.')}</div>
      <div class="keep-btns"><button class="btn primary" data-act="howto">${tr('怎么收藏', 'How?')}</button><button class="btn" data-act="kept">${tr('收藏好了', 'Saved it')}</button></div>
    </div>` : ''}
    ${lists.length ? lists.map(listRowHtml).join('')
      : `<div class="empty">${tr('这台手机上还没有清单。<br>换过手机的话，从收藏或聊天记录里打开以前存的管理入口。', 'No lists on this phone yet.<br>New phone? Open the management link you saved earlier.')}</div>`}
    <div class="bottom-bar"><div class="inner"><a class="btn primary big" href="/new?go=1">${tr('＋ 新建一份清单', '+ New list')}</a></div></div>`;
  $app.onclick = async (e) => {
    // Removing only forgets the key on this phone; the list itself stays up for buyers.
    const f = e.target.closest('[data-forget]');
    if (f) {
      e.preventDefault();
      const l = lists.find((x) => x.id === f.dataset.forget);
      if (!(await ask({ title: tr(`从这台手机移出「${l.d.sale.title}」？`, `Remove "${l.d.sale.title}" from this phone?`), text: tr('清单不会被删除，买家照常能看到和预订。\n这台手机只是不再记得它的管理链接，之后要管理，重新打开管理链接就行。', "The list isn't deleted: buyers can still see it and reserve.\nThis phone just forgets its management link; open that link again to manage it."), ok: tr('移出', 'Remove') }))) return;
      forgetSale(l.id);
      // The address carries every list's key (?s=), so it is rebuilt without this one.
      history.replaceState(null, '', '/lists');
      return listsPage();
    }
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'kept') {
      store.set('listsKept', true);
      $app.querySelector('.lists-keep')?.remove();
    }
    if (a?.dataset.act === 'howto') {
      const removeArrow = isWeChat ? wxMenuArrow() : () => {};
      openSheet(() => `<h2>${isWeChat ? tr('收藏到微信', 'Add to WeChat Favorites') : keepVerb()}</h2>
        <div class="group"><div class="cell small" style="display:block;line-height:2">${keepStepsHtml(tr('点开，所有清单都在', 'and all your lists are there'))}</div></div>
        <div class="hint" style="padding-top:0">${tr('只收藏，别发到群里：拿到链接的人能改你的清单。', 'Keep it to yourself, never post it in a group: anyone with the link can change your lists.')}</div>
        <div class="actions">${keepTgBtnHtml()}<button class="btn ${isTelegram ? '' : 'primary'} block" data-act="close">${tr('知道了', 'Got it')}</button></div>`,
      (act, el, s) => act === 'close' && s.close(), { onClose: removeArrow });
    }
  };
}

// Manage page: switch between lists without going back to the home page.
async function listsSheet(S) {
  const sh = openSheet(() => `<h2>${tr('我的清单', 'My lists')}</h2><div class="empty" style="padding:24px">${tr('加载中…', 'Loading…')}</div>`, () => {});
  const lists = await loadMyLists();
  sh.el.innerHTML = `<h2>${tr('我的清单', 'My lists')}</h2>
    <div class="group">${lists.map((l) => `
      <a class="cell" href="/manage/${esc(l.id)}?k=${esc(l.key)}">
        <div class="grow"><div class="ellipsis">${esc(l.d.sale.title)}${l.id === S.saleId ? ` <span class="small muted">${tr('（当前）', '(this one)')}</span>` : ''}</div>
        <div class="small muted">${statusText.available} ${l.d.items.filter((i) => i.status === 'available').length} · ${tr('已收回', 'Earned')} ${esc(earnedText(l.d))}${l.d.sale.status === 'ended' ? ` · ${tr('已结束', 'Ended')}` : l.d.sale.paused ? ` · ${tr('已暂停', 'Paused')}` : ''}</div></div>
        <span class="muted">›</span>
      </a>`).join('')}
    </div>
    <div class="actions">
      <a class="btn primary block" href="/new?go=1">${tr('＋ 新建一份清单', '+ New list')}</a>
      <a class="btn block" href="${esc(listsLink(lists))}">☆ ${tr('收藏「我的清单」入口', 'Keep the "My lists" page')}</a>
    </div>`;
}

function createSale() {
  $app.innerHTML = `
    <div class="ik-head">${LOGO}<h1>${tr('发布二手清单', 'New secondhand list')}</h1><div class="ik-sub">${tr('填 3 项就能开始上架，其他都有默认值。', 'Three fields and you can start listing; everything else has defaults.')}</div></div>
    ${saleFormHtml({ owner: store.get('ownerName', ''), wechatId: store.get('sellerWechat', ''), telegram: store.get('sellerTelegram', ''), facebook: store.get('sellerFacebook', ''), location: '', currency: guessCurrency(), rules: DEFAULT_RULES, leaveDate: '' }, { create: true })}
    <div class="bottom-bar"><div class="inner"><button class="btn primary big" id="go">${tr('开始上架', 'Start listing')}</button></div></div>`;
  const form = $app.querySelector('.form');
  syncTitle(form);
  bindNearbyTip(form);
  form.addEventListener('input', () => syncTitle(form));
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-suffix]');
    if (!b) return;
    form.querySelectorAll('[data-suffix]').forEach((x) => x.classList.toggle('on', x === b));
    syncTitle(form);
  });
  $app.querySelector('#go').onclick = async (e) => {
    const owner = $app.querySelector('[name=owner]').value.trim();
    if (!owner) return toast(tr('填一下你的名字', 'Add your name'));
    const f = readSaleForm($app);
    const bad = contactError(f);
    if (bad) return toast(bad, 2600);
    if (!f.location) return toast(tr('填一下取货地点', 'Add a pick-up place'));
    store.set('ownerName', owner);
    store.set('sellerWechat', f.wechatId);
    store.set('sellerTelegram', normTelegram(f.telegram) || '');
    store.set('sellerFacebook', fbProfileUrl(f.facebook) || '');
    e.target.disabled = true;
    if (f.nearby) {
      e.target.textContent = tr('正在获取大概位置…', 'Getting your rough location…');
      const loc = await getLocation();
      if (loc) Object.assign(f, loc);
      else toast(tr('没拿到位置，清单还是会出现在「附近的二手」的最新列表里', 'No location, but the list still shows in the newest "Nearby" items'));
      e.target.textContent = tr('开始上架', 'Start listing');
    }
    try {
      const { id, key } = await api('/sale', { method: 'POST', body: f });
      const mine = store.get('mySales', []).filter((s) => s.id !== id);
      mine.unshift({ id, key, title: f.title });
      store.set('mySales', mine);
      location.href = `/manage/${id}?k=${key}&new=1`;
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  };
}

// ---------- 7.2 buyer sale page ----------

// Grid tile: swipeable photos, price + name, and the queue button right on the sale page.
// badge: '新' / '降价' in the photo's corner, or nothing.
function tileHtml(sale, it, mine, badge = '') {
  const my = mine?.[it.id];
  const ended = sale.status === 'ended';
  let stamp = '';
  if (it.status === 'reserved') stamp = `<div class="stamp reserved">${it.maybeSold ? tr('可能已出', 'Maybe sold') : statusText.reserved}</div>`;
  else if (it.status === 'sold') stamp = `<div class="stamp sold">${statusText.sold}</div>`;
  let btn;
  if (my) btn = `<button class="btn small mine-btn" data-cancel-item="${it.id}"><b>${tr(`第 ${my.position} 位`, `#${my.position} in line`)}</b><span class="s"> · ${tr('取消', 'cancel')}</span></button>`;
  else if (it.status === 'sold' || ended) btn = `<button class="btn small" disabled>${ended ? tr('已结束', 'Ended') : statusText.sold}</button>`;
  else if (sale.paused) btn = `<button class="btn small" disabled>${tr('暂停中', 'Paused')}</button>`;
  else if (it.queueCount === 0) btn = `<button class="btn small primary" data-join="${it.id}">${tr('预订', 'Reserve')}</button>`;
  else btn = `<button class="btn small primary ghost" data-join="${it.id}"><b>${tr('排候补', 'Waitlist')}</b><span class="s"> · ${tr(`前面 ${it.queueCount} 人`, `${it.queueCount} ahead`)}</span></button>`;
  const t = itemT(it);
  const extra = [conditionText(it.condition, LANG), t.note].filter(Boolean).join(' · ');
  return `
    <div class="tile ${it.status}">
      <div class="ph">
        <div class="track">${it.photos.map((p, k) => `<a href="/s/${sale.id}/i/${it.no}"><img src="${img(p)}" ${k ? 'loading="lazy"' : ''} alt=""></a>`).join('')}</div>
        <span class="ph-price${it.priceCents === 0 ? ' free' : ''}">${esc(money(it.priceCents, sale.currency))}</span>
        ${it.photos.length > 1 ? `<span class="dots">${it.photos.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</span>` : ''}
        ${badge ? `<span class="badge">${badge}</span>` : ''}
        ${stamp}
      </div>
      <div class="info">
        <div class="sub">${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)}${it.status === 'reserved' && it.queueCount > 1 ? `<span class="muted">${tr(`${it.queueCount - 1} 人候补`, `${it.queueCount - 1} waiting`)}</span>` : ''}</div>
        <a class="name" href="/s/${sale.id}/i/${it.no}">${esc(t.name)}</a>
        ${extra ? `<div class="extra">${esc(extra)}</div>` : ''}
        ${btn}
      </div>
    </div>`;
}

// Photo dots follow horizontal swipes inside any tile on the page.
function bindTrackDots(root) {
  root.addEventListener('scroll', (e) => {
    const t = e.target;
    if (!t.classList?.contains('track')) return;
    const dots = t.parentElement.querySelectorAll('.dots i');
    const k = Math.round(t.scrollLeft / t.clientWidth);
    dots.forEach((d, j) => d.classList.toggle('on', j === k));
  }, { capture: true, passive: true });
}

// What a buyer who is first in line does next. Most found the list in a group the seller posted it
// to, so the seller is right there: tap their name and send the opening line, which names what they
// reserved, in the buyer's language. The seller's own WeChat ID or Telegram, when they left one, is
// folded below for anyone who isn't in that group.
function contactHtml(c) {
  const note = c.items ? contactNote(c.items.map((i) => ({ no: i.no, name: itemT(i).name })), LANG) : c.note;
  const value = c.value ?? c.wechat ?? '';
  const tg = c.kind === 'telegram' && value;
  // A buyer from a Facebook group goes back to the post and taps Message: that is how Facebook sales work.
  const fb = c.kind === 'facebook' || c.buyerKind === 'facebook';
  const row = (k, v, copyText = v) => `<div class="row"><div class="grow"><div class="k">${k}</div><div class="v">${esc(v)}</div></div><button class="btn small" data-copy="${esc(copyText)}">${tr('复制', 'Copy')}</button></div>`;
  const direct = !value ? '' : c.kind === 'facebook'
    ? `<a class="btn primary block" href="${esc(value)}" target="_blank" rel="noopener">${tr('打开卖家的 Facebook 主页', "Open the seller's Facebook profile")}</a>
      <div class="hint" style="padding:6px 0 0">${tr('在主页上点 Message 私信卖家，发上面那句。', 'Tap Message on their profile and send the line above.')}</div>`
    : tg
    ? `<a class="btn primary block" href="${esc(tgChatUrl(value, note))}" target="_blank" rel="noopener">${tr(`在 Telegram 给 @${esc(value)} 发消息`, `Message @${esc(value)} on Telegram`)}</a>
      ${row(tr('卖家的 Telegram', "Seller's Telegram"), `@${value}`)}`
    : `${row(tr('卖家微信号', "Seller's WeChat ID"), value)}
      <div class="hint" style="padding:6px 0 0">${tr('微信右上角「＋」→「添加朋友」→ 粘贴搜索，好友申请里写上面那句。', 'In WeChat: ＋ at the top right → Add Contacts → paste and search, with the line above in the request.')}</div>`;
  // No seller contact, or one on an app the buyer didn't leave: the seller reaches out to the buyer instead.
  const other = (!value ? tr('卖家没留联系方式，不过', "The seller left no contact here, but ") : tr('另外，', 'Also, ')) + (c.buyerKind === 'telegram'
    ? tr('卖家能在排队名单里看到你的 Telegram，会来找你。', 'the seller sees your Telegram in the line and can message you.')
    : c.buyerKind === 'facebook'
    ? tr('卖家能在排队名单里看到你的 Facebook 名字。', 'the seller sees your Facebook name in the line.')
    : tr('卖家能在排队名单里看到你的微信号，会来加你。', 'the seller sees your WeChat ID in the line and can add you.'));
  return `
    <div class="contact">
      <div class="contact-title">${fb ? tr('你排第 1 位，回 Facebook 私信卖家吧', "You're first in line: DM the seller on Facebook") : tr('你排第 1 位，去群里私聊卖家吧', "You're first in line: message the seller from the group")}</div>
      ${row(tr('发这句', 'Send this'), note)}
      <ol class="contact-steps">
        <li>${fb
          ? tr('回到你看到这份清单的 Facebook 帖子，点 Message 私信卖家（发帖的人）', 'Go back to the Facebook post where you saw this list and tap Message to DM the seller (who posted it)')
          : tr('在你看到这份清单的群里，点卖家（发清单的人）的头像，加好友或私聊', 'In the group where you saw this list, tap the seller (who posted it) to add or message them')}</li>
        <li>${tr('把上面这句发过去，卖家一看就知道你要哪件', 'Send the line above so the seller knows what you want')}</li>
        <li>${tr('时间地点和卖家直接约', 'Agree on a time and place with the seller')}</li>
      </ol>
      <details class="contact-more">
        <summary>${tr('不在群里，或者找不到卖家？', "Not in the group, or can't find the seller?")}</summary>
        ${direct}
        <div class="hint" style="padding:8px 0 0">${other}</div>
      </details>
    </div>`;
}

function bindCopy(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copy(b.dataset.copy);
  });
}

// Display order only: item numbers stay with their items. Items without a price go last.
const SORTS = [['no', tr('默认', 'Default')], ['asc', tr('价格↑', 'Price ↑')], ['desc', tr('价格↓', 'Price ↓')]];
function sortItems(items, sort) {
  if (sort !== 'asc' && sort !== 'desc') return items;
  const dir = sort === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => (a.priceCents == null) - (b.priceCents == null) || dir * (a.priceCents - b.priceCents) || a.no - b.no);
}

// Buyers' default: newest first (see byRecent in lib.js); the shared text and pictures use it too.
function sortRecent(items) {
  return [...items].sort(byRecent);
}

// The seller's default: 未出 and 在售 as buyers see them; 已预订 and 已出 by when they got
// there, latest first, so the sale that just happened is on top.
const byChange = (a, b) => (b.changedAt || 0) - (a.changedAt || 0) || a.no - b.no;
function manageOrder(items, tab) {
  if (tab === 'open') return openItems(items);
  return items.filter((i) => i.status === tab).sort(tab === 'available' ? byRecent : byChange);
}

// A marked-down item keeps its tag this long.
const DROP_TAG_MS = 7 * 86400_000;
// Reloads within this window count as one visit, so the "new" tags don't vanish on a refresh.
const VISIT_GAP_MS = 30 * 60_000;

// When this buyer last came to the list before the current visit (null on a first visit).
function previousVisit(saleId, t) {
  const key = `seen:${saleId}`;
  const v = store.get(key, null);
  if (v && t - v.at < VISIT_GAP_MS) return v.prev;
  store.set(key, { at: t, prev: v?.at ?? null });
  return v?.at ?? null;
}

// Brand mark: the tag icon with the name, so people remember (and can search for) 二手清单.
const LOGO = `<a class="logo" href="/"><img src="/icon.svg" alt="" width="34" height="34"><span class="logo-txt"><b>${APP_NAME}</b><small>${tr('AI识别 · 多群同步', 'AI photos · all your groups')}</small></span></a>`;

// Buyers arrive from a group card without knowing what this is: a slim dismissible strip
// (like a store's "get the app" bar) above a bar with the name and, on the right, the
// 收藏 / 推荐 tag (corner) — one row each, laid out like the manage page's top bar.
function appBarHtml(isOwner, corner = '') {
  const promo = !isOwner && !store.get('promoHidden', false);
  return `
    ${promo ? `<div class="promo">
      <button class="promo-x" data-promo-x aria-label="${tr('关闭', 'Close')}">✕</button>
      <div class="promo-txt"><b>${tr('我也有二手要出', 'Selling stuff too?')}</b><span>${tr('免登录·免安装·多群同步·免费', 'No sign-up · no app · free')}</span></div>
      <a class="promo-cta" href="${tr('/', '/en')}">${tr('去发布', 'Post')}</a>
    </div>` : ''}
    <div class="appbar">
      ${LOGO}
      ${corner}
    </div>`;
}

function sortSegHtml(sort) {
  return `<div class="seg small">${SORTS.map(([k, t]) => `<button class="${sort === k ? 'on' : ''}" data-sort="${k}">${t}</button>`).join('')}</div>`;
}

function buyerSale(saleId) {
  // Assume seller view right away when previewing with the key; the refetch below confirms it.
  const preview = previewing(saleId);
  let data = BOOT.sale ? { ...BOOT, isOwner: preview && !!localKey(saleId) } : null;
  let sort = store.get('buyerSort', 'no');
  let lastVisit;

  const render = () => {
    if (!data) {
      $app.innerHTML = `<div class="empty">${tr('加载中…', 'Loading…')}</div>`;
      return;
    }
    const { sale, items, now, mine, contact, isOwner } = data;
    const st = saleT(sale);
    // Sold items aren't shown to buyers at all.
    const avail = items.filter((i) => i.status === 'available');
    const reserved = items.filter((i) => i.status === 'reserved');
    const ended = sale.status === 'ended';
    const order = (arr) => (sort === 'no' ? sortRecent(arr) : sortItems(arr, sort));
    const list = [...order(avail), ...order(reserved)];
    if (lastVisit === undefined) lastVisit = isOwner ? null : previousVisit(saleId, now);
    const badge = (it) => {
      if (isOwner || it.status !== 'available') return '';
      if (lastVisit && it.createdAt > lastVisit) return tr('新', 'New');
      return it.droppedAt && now - it.droppedAt < DROP_TAG_MS ? tr('降价', 'Price cut') : '';
    };
    const newCount = avail.filter((it) => lastVisit && it.createdAt > lastVisit).length;
    document.title = tr(`${st.title}｜在售 ${avail.length} 件`, `${st.title} | ${avail.length} for sale`);
    // Corner: newcomers are asked to save the tool; people already using it, to pass it on.
    const keepTag = !isOwner && !ended && keepWanted();
    const recTag = !isOwner && !ended && !keepTag;
    // Language sits beside the title, as on the manage page, instead of a row of its own.
    document.querySelector('.lang-bar')?.remove();
    $app.innerHTML = `
      ${appBarHtml(isOwner, keepTag ? `<a class="keep-tag" href="/keep?save=1">☆ ${tr('收藏', 'Keep')}<small>${tr(`送 ${GIFT_USES} 次 AI 识图`, `${GIFT_USES} free AI tries`)}</small></a>` : recTag ? recommendTagHtml() : '')}
      <div class="head">
        <div class="head-row"><h1>${esc(st.title)}</h1>${langSegHtml()}</div>
        <div class="meta">📍 ${esc(st.location)}${sale.leaveDate ? ` · ${untilText(sale.leaveDate)}` : ''} · ${tr(`卖家 ${agoText(sale.sellerActiveAt, now)}在线`, `seller active ${agoText(sale.sellerActiveAt, now)}`)}</div>
        ${st.rules.length ? `<div class="tags">${st.rules.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}</div>` : ''}
      </div>
      ${ended ? `<div class="banner">${tr('这份清单已结束', 'This list has ended')}</div>` : ''}
      ${sale.paused ? `<div class="banner">${tr('卖家暂停了这份清单，暂时不能排队', 'The seller paused this list; reservations are closed for now')}</div>` : ''}
      ${isOwner ? ownerBanner(sale) : ''}${contact || ended || sale.paused ? '' : `<div class="how-line">${tr('点「预订」排队，排到第 1 位就能联系卖家。显示「预订」的都还在。', "Tap Reserve to get in line; when you're first, you'll see how to reach the seller. Anything showing Reserve is still available.")}</div>`}
      ${contact ? contactHtml(contact) : ''}
      <div class="list-bar"><div class="hint">${statusText.available} ${avail.length} · ${statusText.reserved} ${reserved.length}${newCount ? ` · <b class="new-count">${tr(`上次来过后新增 ${newCount} 件`, `${newCount} new since last visit`)}</b>` : ''}</div>
        ${list.length > 1 ? sortSegHtml(sort) : ''}</div>
      ${list.length ? `<div class="grid">${list.map((it) => tileHtml(sale, it, mine, badge(it))).join('')}</div>`
        : `<div class="empty">${items.length ? tr('都卖完了', 'All sold') : tr('卖家还没上架东西', 'Nothing listed yet')}</div>`}
      ${isOwner ? `<div class="bottom-bar"><div class="inner">
        <a class="btn big" href="/manage/${sale.id}">${tr('回到管理', 'Manage')}</a>
        ${ended || sale.paused ? '' : `<button class="btn primary big" data-owner-share>${tr('分享到群', 'Share')}</button>`}
      </div></div>` : ''}
      ${isOwner ? '' : brandCardHtml()}
      <div style="padding:28px 16px 8px;display:flex;gap:10px;justify-content:center;align-items:center">
        <a class="btn small" href="/my">${tr('我的排队', 'My reservations')}</a>
        <a class="btn small" href="/">${tr('我的二手', 'My stuff')}</a>
        <button class="btn small" data-feedback>${tr('反馈问题', 'Feedback')}</button>
      </div>
      ${nearbyEntryHtml(sale.id)}`;
  };

  $app.addEventListener('click', (e) => {
    if (e.target.closest('[data-feedback]')) feedbackSheet();
    if (e.target.closest('[data-promo-x]')) {
      store.set('promoHidden', true);
      render();
    }
    const so = e.target.closest('[data-sort]');
    if (so) {
      sort = so.dataset.sort;
      store.set('buyerSort', sort);
      render();
    }
    const j = e.target.closest('[data-join]');
    if (j) data.isOwner ? ownerTap(data.sale) : joinSheet(data.sale, data.items.find((i) => i.id === j.dataset.join), reload);
    // Seller previewing their own list: same share options as on the management page.
    if (e.target.closest('[data-owner-share]')) shareSheet({ saleId, key: localKey(saleId), data: () => data });
    const c = e.target.closest('[data-cancel-item]');
    if (c) cancelMine(data.mine[c.dataset.cancelItem].seq, c);
  });
  bindCopy($app);
  bindTrackDots($app);

  const reload = () => api(`/sale/${saleId}`, { key: localKey(saleId) }).then((d) => {
    const y = window.scrollY;
    data = { ...d, isOwner: preview && d.isOwner };
    render();
    window.scrollTo(0, y);
  });

  async function cancelMine(seq, btn) {
    if (!(await askCancelQueue())) return;
    btn.disabled = true;
    try {
      await api(`/queue/${seq}/cancel`, { method: 'POST', body: {} });
      toast(tr('已取消', 'Cancelled'));
      await reload();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  render();
  // Always ask the server: it knows whether this viewer is the seller or already in line.
  reload().then(() => {
    if (!data.isOwner && data.sale.status === 'active') keepBar();
  }).catch((e) => (e.code === 'NOT_FOUND' ? notFound() : toast(e.message)));
}

const askCancelQueue = () => ask({
  title: tr('确定取消排队？', 'Leave the line?'),
  text: tr('取消后你的位置会让给后面的人。', 'Your place goes to the next person.'),
  ok: tr('取消排队', 'Leave the line'),
  danger: true,
});

// ---------- 7.3 buyer item page ----------

function buyerItem(saleId, no) {
  // Assume seller view right away when previewing with the key; the refetch below confirms it.
  const preview = previewing(saleId);
  let data = BOOT.sale ? { ...BOOT, isOwner: preview && !!localKey(saleId) } : null;

  const render = () => {
    if (!data) {
      $app.innerHTML = `<div class="empty">${tr('加载中…', 'Loading…')}</div>`;
      return;
    }
    const { sale, items, mine, contact } = data;
    const it = items.find((i) => i.no === no);
    if (!it) return notFound();
    const t = itemT(it);
    const st = saleT(sale);
    const my = mine?.[it.id];
    const ended = sale.status === 'ended';
    const closed = it.status === 'sold' || ended;
    let btn;
    if (my) btn = `<button class="btn big" data-act="cancel">${tr(`你排在第 ${my.position} 位 · 取消`, `You're #${my.position} in line · cancel`)}</button>`;
    else if (closed) btn = `<button class="btn big" disabled>${ended ? tr('清单已结束', 'List ended') : statusText.sold}</button>`;
    else if (sale.paused) btn = `<button class="btn big" disabled>${tr('卖家暂停了这份清单', 'The seller paused this list')}</button>`;
    else if (it.queueCount === 0) btn = `<button class="btn primary big" data-act="join">${tr('预订（排第 1 位）', 'Reserve (be first in line)')}</button>`;
    else btn = `<button class="btn primary big" data-act="join">${tr(`排候补（前面 ${it.queueCount} 人）`, `Join the waitlist (${it.queueCount} ahead)`)}</button>`;

    const stamp = it.status === 'sold' ? `<div class="stamp sold">${statusText.sold}</div>`
      : it.status === 'reserved' ? `<div class="stamp reserved">${it.maybeSold ? tr('可能已出', 'Maybe sold') : statusText.reserved}</div>` : '';
    document.title = `${t.name} ${money(it.priceCents, sale.currency)}`;
    $app.innerHTML = `
      <a class="back" href="/s/${sale.id}">‹ ${esc(st.title)}${tr('（全部物品）', ' (all items)')}</a>
      <div class="gallery">
        <div class="track">${it.photos.map((p) => `<img src="${img(p, false)}" alt="">`).join('')}</div>
        ${it.photos.length > 1 ? `<span class="count">1/${it.photos.length}</span>` : ''}
        ${stamp}
      </div>
      <div class="item-info">
        <div class="row">${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)}</div>
        <h1>${esc(t.name)}</h1>
        ${it.condition ? `<div class="meta">${esc(conditionText(it.condition, LANG))}</div>` : ''}
        ${t.note ? `<div style="margin-top:6px;white-space:pre-line">${esc(t.note)}</div>` : ''}
        ${t.name !== it.name ? `<details class="orig-text small muted"><summary>${tr('看原文', 'Original')}</summary>${esc(it.name)}${it.note ? `<br>${esc(it.note)}` : ''}</details>` : ''}
        <div class="meta" style="margin-top:10px">${it.status === 'reserved'
          ? it.maybeSold ? tr('预订中，可能已出', 'Reserved, maybe sold') : tr(`已预订 · ${it.queueCount} 人在排`, `Reserved · ${it.queueCount} in line`)
          : statusText[it.status]} · 📍 ${esc(st.location)}</div>
      </div>
      ${!my && !closed ? `<div class="how-to" style="margin-top:10px">${tr('点「预订」排队，排到第 1 位就去群里私聊卖家。页面是实时的，能预订就是还在。', "Tap Reserve to get in line. When you're first, message the seller from the group. The page is live: if you can reserve, it's still available.")}</div>` : ''}
      ${my && my.position > 1 ? `<div class="hint">${tr('前面的人不要了，你会自动升到第 1 位，到时再联系卖家。', "If the people ahead drop out you move up to first; message the seller then.")}</div>` : ''}
      ${my && my.position === 1 && contact ? contactHtml(contact) : ''}
      ${nearbyEntryHtml(sale.id)}
      <div class="bottom-bar"><div class="inner">${btn}</div></div>`;
    const track = $app.querySelector('.track');
    const count = $app.querySelector('.count');
    if (track && count) {
      track.addEventListener('scroll', () => {
        count.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1}/${it.photos.length}`;
      }, { passive: true });
    }
  };

  const reload = () => api(`/sale/${saleId}`, { key: localKey(saleId) }).then((d) => {
    data = { ...d, isOwner: preview && d.isOwner };
    render();
  });

  $app.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const it = data.items.find((i) => i.no === no);
    if (a.dataset.act === 'join') data.isOwner ? ownerTap(data.sale) : joinSheet(data.sale, it, reload);
    if (a.dataset.act === 'cancel') {
      if (!(await askCancelQueue())) return;
      try {
        await api(`/queue/${data.mine[it.id].seq}/cancel`, { method: 'POST', body: {} });
        toast(tr('已取消', 'Cancelled'));
        await reload();
      } catch (err) {
        toast(err.message);
      }
    }
  });
  bindCopy($app);

  render();
  // Always ask the server: it knows whether this viewer is the seller or already in line.
  reload().catch((e) => (e.code === 'NOT_FOUND' ? notFound() : toast(e.message)));
}

// Joining a queue asks for one contact: a Telegram box and a WeChat box, fill either, plus a Facebook
// box on lists posted to Facebook (or when the buyer is in Facebook). A seller not on the buyer's app
// reaches out to them there. The buyer's last choice, or the app they are in, comes first.
function joinSheet(sale, it, reload) {
  let result = null;
  const sellerOn = { telegram: !!sale.hasTelegram, wechat: sale.hasWechat !== false, facebook: !!sale.hasFacebook };
  const kind = store.get('buyerKind', '') || (isFacebook ? 'facebook' : isTelegram || (LANG === 'en' && !isWeChat) ? 'telegram' : 'wechat');
  const withFb = sellerOn.facebook || isFacebook || kind === 'facebook';
  const order = [kind, ...['telegram', 'wechat', 'facebook'].filter((k) => k !== kind)].filter((k) => k !== 'facebook' || withFb);
  const values = { wechat: store.get('buyerWechat', ''), telegram: store.get('buyerTelegram', ''), facebook: store.get('buyerFacebook', '') };
  const field = (k) => k === 'telegram'
    ? `<label class="field"><span>${tr('Telegram 用户名', 'Telegram username')}</span><input class="inp" type="text" name="telegram" maxlength="64" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@username" value="${esc(values.telegram ? `@${values.telegram}` : '')}"></label>`
    : k === 'facebook'
    ? `<label class="field"><span>${tr('Facebook 名字', 'Facebook name')}</span><input class="inp" type="text" name="facebook" maxlength="200" autocomplete="name" spellcheck="false" placeholder="${tr('你在 Facebook 上显示的名字', 'The name Facebook shows for you')}" value="${esc(values.facebook)}"></label>`
    : `<label class="field"><span>${tr('微信号', 'WeChat ID')}</span><input class="inp" type="text" name="wechat" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${tr('微信号', 'WeChat ID')}" value="${esc(values.wechat)}"></label>`;
  const sh = openSheet(() => {
    if (result) {
      const keep = keepWanted() ? keepBlockHtml(tr('以后你要出闲置，也能这样发', 'Selling your own stuff some day? Do it like this'), tr('拍照、填价格就上架。发到群里，大家点开自己排队。', 'Snap a photo, add a price, post the link; people get in line themselves.')) : '';
      if (result.position === 1) {
        return `<h2>${tr('预订成功', 'Reserved!')}</h2>${contactHtml(result.contact)}${keep}
          <div class="actions"><button class="btn block" data-act="close">${tr('好的', 'OK')}</button></div>`;
      }
      return `<h2>${tr(`排上了，你排第 ${result.position} 位`, `You're in line: #${result.position}`)}</h2>
        <div class="hint center">${tr('前面的人不要了，你会自动升到第 1 位。<br>到时回来这里或「我的排队」看怎么联系卖家，现在不用联系。', "If the people ahead drop out, you move up to first.<br>Then come back here or to My reservations to see how to reach the seller. No need to message the seller now.")}</div>${keep}
        <div class="actions"><button class="btn block" data-act="close">${tr('好的', 'OK')}</button></div>`;
    }
    return `<h2>${esc(itemT(it).name)}</h2>
      <div class="hint" style="padding:0 0 8px">${tr('留个联系方式，<b>填一个就行</b>：', `Leave a contact, <b>${order.length > 2 ? 'any one' : 'either one'} is enough</b>:`)}</div>
      <div class="group">${order.map(field).join('')}</div>
      <div class="hint" style="padding-top:0">${kind === 'facebook'
        ? tr('排到你时，回 Facebook 帖子点 Message 私信卖家就行；卖家在名单里看到你的名字，就能和私信对上。', "When you're first, go back to the Facebook post and tap Message to DM the seller; they see your name in the line and match it to your message.")
        : tr('排到你时，去群里私聊卖家就行；卖家也能在名单里看到你留的联系方式。', "When you're first, message the seller from the group; the seller sees the contact you leave here too.")}
        ${tr('Telegram 用户名在 Telegram 的「设置」里，@ 开头。', "Your Telegram username is in Telegram's Settings, starting with @.")}</div>
      <div class="actions"><button class="btn primary big block" data-act="go">${tr('排上', 'Get in line')}</button></div>`;
  }, async (act, el, s) => {
    if (act === 'close') return s.close();
    if (act !== 'go') return;
    const tgBox = s.el.querySelector('[name=telegram]');
    const wxBox = s.el.querySelector('[name=wechat]');
    values.telegram = tgBox.value.trim().replace(/^@/, '');
    values.wechat = wxBox.value.trim();
    values.facebook = s.el.querySelector('[name=facebook]')?.value.trim() || '';
    if (!values.telegram && !values.wechat && !values.facebook) {
      return toast(withFb ? tr('填一个联系方式就行', 'Fill in one contact') : tr('微信号和 Telegram 用户名，填一个就行', 'Add a Telegram username or a WeChat ID'));
    }
    // A Telegram username typed into the WeChat box moves over, when that box is still free.
    if (looksLikeTelegram(values.wechat)) {
      if (!values.telegram) values.telegram = normTelegram(values.wechat) || values.wechat.replace(/^@/, '');
      values.wechat = '';
      s.refresh();
      return toast(tr('这是 Telegram 用户名，已经挪到 Telegram 那一栏', 'That is a Telegram username, moved it to the Telegram box'));
    }
    const username = values.telegram ? normTelegram(values.telegram) : null;
    if (values.telegram && !username) {
      tgBox.focus();
      return toast(tr('Telegram 用户名不对：5 到 32 位字母、数字或下划线，例如 @jinda_li', 'Not a Telegram username: 5–32 letters, digits or underscores, like @jinda_li'), 2600);
    }
    // Several filled: the first listed that the seller is on, else the first listed.
    const filled = order.filter((k) => values[k]);
    const use = filled.find((k) => sellerOn[k]) || filled[0];
    store.set('buyerKind', use);
    if (username) store.set('buyerTelegram', username);
    if (values.wechat) store.set('buyerWechat', values.wechat);
    if (values.facebook) store.set('buyerFacebook', values.facebook);
    buyerToken(true);
    el.disabled = true;
    try {
      const body = use === 'telegram' ? { telegram: username } : use === 'facebook' ? { facebook: values.facebook } : { wechat: values.wechat };
      result = await api(`/item/${it.id}/join`, { method: 'POST', body });
      s.refresh();
      reload();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  });
  bindCopy(sh.el);
  setTimeout(() => sh.el.querySelector('.group input')?.focus(), 250);
}

// ---------- 7.4 my queues ----------

async function myQueues() {
  $app.innerHTML = `<div class="head"><h1>${tr('我的排队', 'My reservations')}</h1></div><div class="empty">${tr('加载中…', 'Loading…')}</div>`;
  let data;
  try {
    data = await api('/my');
  } catch (e) {
    $app.querySelector('.empty').textContent = e.message;
    return;
  }
  const label = tr(
    { sold: '买到了', declined: '卖家标记你不要了', cancelled: '你取消了', removed: '已出或已下架' },
    { sold: 'You got it', declined: 'The seller marked you as not taking it', cancelled: 'You cancelled', removed: 'Sold or taken down' },
  );
  const render = () => {
    const qs = data.queues;
    $app.innerHTML = `<div class="head"><h1>${tr('我的排队', 'My reservations')}</h1><div class="meta">${tr('只记在这台手机的这个浏览器里', 'Kept only in this browser on this phone')}</div></div>
      ${qs.length ? qs.map((q) => `
        <div class="section">
          <a class="row-item" href="/s/${esc(q.saleId)}/i/${q.no}">
            ${q.photo ? `<img src="${img(q.photo)}" alt="">` : '<div class="noimg"></div>'}
            <div class="grow">
              <div class="ellipsis"><span class="no">${q.no}</span> ${esc(itemT(q).name)}</div>
              <div class="small muted ellipsis">${esc(q.saleTitleAlt && textLang(q.saleTitle) !== LANG ? q.saleTitleAlt : q.saleTitle)} · ${esc(money(q.priceCents, q.currency))}</div>
              <div class="small">${q.status === 'waiting' ? (q.position === 1 ? `<b style="color:var(--green)">${tr('轮到你了，第 1 位', "It's your turn: first in line")}</b>` : tr(`第 ${q.position} 位`, `#${q.position} in line`)) : esc(label[q.status] || q.status)}</div>
            </div>
          </a>
          ${q.contact ? contactHtml(q.contact) : ''}
          ${q.status === 'waiting' ? `<div style="padding:0 16px 12px;text-align:right"><button class="btn small" data-cancel="${q.seq}">${tr('取消排队', 'Leave the line')}</button></div>` : ''}
        </div>`).join('') : `<div class="empty">${tr('还没有排队。<br>在清单页点「预订」就排上了。', 'No reservations yet.<br>Tap Reserve on a list to get in line.')}</div>`}
      ${nearbyEntryHtml()}`;
  };
  render();
  bindCopy($app);
  $app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b || !(await askCancelQueue())) return;
    try {
      await api(`/queue/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      data = await api('/my');
      render();
      toast(tr('已取消', 'Cancelled'));
    } catch (err) {
      toast(err.message);
    }
  });
}

// ---------- seller ----------

// The key arrives as ?k= (or #k= in older links). It stays in the address bar on purpose:
// WeChat's ··· → 发送给朋友 shares the current URL, so sending this page to 文件传输助手
// gives the seller a one-tap way back in.
function sellerKey(saleId) {
  const fromUrl = new URLSearchParams(location.search).get('k') || new URLSearchParams(location.hash.slice(1)).get('k');
  const mine = store.get('mySales', []);
  if (fromUrl) {
    const rest = mine.filter((s) => s.id !== saleId);
    const prev = mine.find((s) => s.id === saleId);
    rest.unshift({ id: saleId, key: fromUrl, title: prev?.title || TITLE_PICKS[0] });
    store.set('mySales', rest);
    return fromUrl;
  }
  return mine.find((s) => s.id === saleId)?.key || null;
}

function manageLink(saleId, key) {
  return `${location.origin}/manage/${saleId}?k=${key}`;
}

function showManageLinkInUrl(saleId, key) {
  if (key) history.replaceState(null, '', `/manage/${saleId}?k=${key}`);
}

function noAccess(saleId) {
  $app.innerHTML = `<div class="head"><h1>${tr('需要管理权限', 'Management access needed')}</h1><div class="meta">${tr('这台手机的浏览器里没有这份清单的管理权限。', "This browser doesn't hold the key to manage this list.")}</div></div>
    <div style="padding:16px"><div class="small muted" style="margin-bottom:6px">${tr('打开你保存的「管理链接」：', 'Open the management link you saved:')}</div><input class="inp boxed" id="lk" placeholder="${tr('粘贴管理链接', 'Paste the management link')}"><br><br><button class="btn primary block" id="go">${tr('打开', 'Open')}</button></div>`;
  $app.querySelector('#go').onclick = () => {
      const v = $app.querySelector('#lk').value.trim();
      const m = v.match(/[#?&]k=([A-Za-z0-9]+)/);
      if (!m) return toast(tr('链接不对', "That link doesn't work"));
      location.href = `/manage/${saleId}?k=${m[1]}`;
  };
}

function manage(saleId) {
  let key = sellerKey(saleId);
  const params = new URLSearchParams(location.search);
  let data = null;
  // Opens on what is still to sell (for sale or reserved); sold items have a tab of their own.
  let tab = 'open';
  let sort = store.get('manageSort', 'no');
  let checkedThisOpen = false;
  let translatedThisOpen = false;
  let hiddenAt = 0;
  const S = { saleId, key };

  const reload = async () => {
    const soldBefore = data?.soldCents;
    data = await api(`/sale/${saleId}/manage`, { key });
    if (soldBefore != null && data.soldCents > soldBefore) S.recPending = true;
    if (data.sale.key && data.sale.key !== key) S.key = key = data.sale.key;
    if (!new URLSearchParams(location.search).has('new')) showManageLinkInUrl(saleId, key);
    mergeSales([{ id: saleId, key, title: data.sale.title }]);
    render();
    S.tryRecommend();
    // The page shows names in the UI language; ones not translated yet are, quietly, once per open.
    if (!translatedThisOpen && untranslated(data, LANG)) {
      translatedThisOpen = true;
      api(`/sale/${saleId}/translate`, { method: 'POST', key, body: {} }).then(reload).catch(() => {});
    }
  };
  S.reload = reload;
  // A sale made inside a sheet waits for that sheet to close.
  S.tryRecommend = () => {
    if (!S.recPending || document.querySelector('.mask')) return;
    S.recPending = false;
    soldRecommendSheet(S);
  };
  S.data = () => data;

  const render = () => {
    const { sale, items, soldCents } = data;
    const count = (st) => items.filter((i) => i.status === st).length;
    const list = sortItems(manageOrder(items, tab), sort);
    const ended = sale.status === 'ended';
    // Title, place and item names in the UI language (the original stays in the item sheet).
    const st = saleText(sale, LANG);
    // WeChat's ··· → 发送给朋友 titles the card with this; same warning as the card the server renders.
    document.title = tr(`⛔勿转发｜卖家管理入口｜${st.title}`, `⛔ Don't forward | Seller's manage link | ${st.title}`);
    document.querySelector('.lang-bar')?.remove();
    $app.innerHTML = `
      <div class="topbar"><button class="btn fit" data-act="lists"><span>${tr('我的清单', 'Lists')} (${store.get('mySales', []).length})</span>▾</button><a class="btn fit" href="/s/${sale.id}#preview"><span>${tr('买家视角', 'Buyer view')}</span></a><button class="btn" data-act="settings" aria-label="${tr('设置', 'Settings')}">⚙</button><button class="btn rec-btn" data-recommend>🎁 ${tr('推荐朋友', 'Invite')}</button></div>
      <div class="head" style="padding-top:8px"><div class="head-row"><h1>${esc(st.title)}</h1>${langSegHtml()}</div><div class="meta">📍 ${esc(st.location)}</div>
        <div class="meta">${tr('已收回', 'Earned')} <b class="earned-tag">${esc(soldCents ? money(soldCents, sale.currency) : CURRENCIES[sale.currency].trim() + '0')}</b></div></div>
      ${ended ? `<div class="banner">${tr('这份清单已结束：买家打开链接会看到「清单已经不见了」。', 'This list has ended: buyers opening the link see that it is gone.')}<br><button class="btn small primary" style="margin-top:8px" data-act="reopen">${tr('重新公开', 'Reopen')}</button></div>` : ''}
      ${ended ? '' : renewBannerHtml(sale, data.now)}
      ${linkSaved(saleId) ? '' : `<div class="banner">${tr('还没把管理入口发给自己：换手机或在微信里打开时，没有它就管理不了这份清单。', "You haven't sent yourself the management link yet: on a new phone or another app, you can't manage this list without it.")}<br><button class="btn small primary" style="margin-top:8px" data-act="savelink">${tr('发给自己', 'Send it to myself')}</button></div>`}
      <div class="stats">
        ${['available', 'reserved', 'sold', 'removed'].map((st) => `<button class="stat ${tab === st || (tab === 'open' && (st === 'available' || st === 'reserved')) ? 'on' : ''}" data-tab="${tab === st ? 'open' : st}"><b>${count(st)}</b><span>${statusText[st]}</span></button>`).join('')}
      </div>
      ${items.length ? `<div class="list-bar">${tab === 'open'
        ? `<div class="hint">${tr(`未出：${statusText.available} + ${statusText.reserved}`, `Open: ${statusText.available.toLowerCase()} + ${statusText.reserved.toLowerCase()}`)}</div>`
        : `<div class="hint">${tr(`只看${statusText[tab]}`, `${statusText[tab]} only`)} · <button class="link-btn" data-tab="open">${tr('看全部未出', 'Show all open')}</button></div>`}${list.length > 1 ? sortSegHtml(sort) : ''}</div>` : ''}
      ${items.length === 0 ? `<div class="empty">${tr('拍张照、填个价格，就上架了。', 'Snap a photo, add a price, and it is listed.')}<br><br><button class="btn primary" data-act="compose">${tr('选照片', 'Choose photos')}</button></div>`
        : list.length === 0 ? `<div class="empty">${tr('这里没有东西', 'Nothing here')}</div>`
        : `<div class="section">${list.map((it) => `
          <div class="row-item" data-item="${it.id}">
            <span class="no row-no">${it.no}</span>
            <img src="${img(it.photos[0])}" alt="" loading="lazy">
            <div class="grow">
              <div class="ellipsis">${esc(itemText(it, LANG).name)}</div>
              <div class="small">${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)} · <span class="st ${it.status}">${statusText[it.status]}</span>${it.queueCount ? ` · ${tr(`${it.queueCount} 人排队`, `${it.queueCount} in line`)}${it.queue[0] ? tr(`（第 1 位：${esc(it.queue[0].nickname)}）`, ` (first: ${esc(it.queue[0].nickname)})`) : ''}` : ''}</div>
            </div>
            <span class="muted">›</span>
          </div>`).join('')}</div>`}
      ${ended ? '' : `<div class="bottom-bar"><div class="inner"><button class="btn big" data-act="compose">${tr('上架', 'Add items')}</button><button class="btn primary big" data-act="share">${tr('预览并分享', 'Preview & share')}</button></div></div>`}`;
  };

  $app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      return render();
    }
    const so = e.target.closest('[data-sort]');
    if (so) {
      sort = so.dataset.sort;
      store.set('manageSort', sort);
      return render();
    }
    const row = e.target.closest('[data-item]');
    if (row) return itemSheet(S, row.dataset.item);
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'compose') composer(S);
    if (a.dataset.act === 'reopen') reopenSale(S);
    if (a.dataset.act === 'renew') renewSale(S);
    if (a.dataset.act === 'savelink') sendSelfSheet(S, { onDone: render });
    // Sharing starts from the buyer page: forwarding this page would send the 管理入口 card, key included.
    if (a.dataset.act === 'share') {
      if (data.sale.paused) return toast(tr('清单已暂停，先点上面的「重新上架」', 'The list is paused: tap Reopen above first'));
      maybeCheck(S, true, () => (location.href = `/s/${saleId}#preview`));
    }
    if (a.dataset.act === 'settings') settingsSheet(S);
    if (a.dataset.act === 'lists') listsSheet(S);
  });

  // 6.5: ask "卖掉了吗" once per open; returning from background after a while counts as a new open.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) checkedThisOpen = false;
    if (!hiddenAt || Date.now() - hiddenAt > 30 * 1000) {
      await reload().catch(() => {});
      if (!checkedThisOpen) {
        checkedThisOpen = true;
        maybeCheck(S, false);
      }
    }
  });

  $app.innerHTML = `<div class="empty">${tr('加载中…', 'Loading…')}</div>`;
  reload().then(() => {
    if (params.get('new') === '1') {
      showManageLinkInUrl(saleId, key);
      newSaleSheet(S);
    } else if (params.get('saved') === '1' && !linkSaved(saleId)) {
      // Opened from the card in 文件传输助手: the entry is saved, carry on uploading.
      markLinkSaved(saleId);
      toast(tr('管理入口存好了', 'Management link saved'));
      if (!data.items.length) composer(S);
    } else {
      checkedThisOpen = true;
      maybeCheck(S, false);
    }
  }).catch((e) => {
    if (e.code === 'FORBIDDEN') return noAccess(saleId);
    $app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  });
}

// Shown from 7 days before the list pauses; once paused, buyers can't queue until the seller renews.
function renewBannerHtml(sale, now) {
  const left = sale.expiresAt - now;
  if (left > RENEW_WARN_MS) return '';
  const days = Math.max(1, Math.ceil(left / (24 * HOUR)));
  const text = sale.paused
    ? tr('清单已暂停：买家还能打开，但不能排队，也不会出现在「附近的二手」。', 'The list is paused: buyers can open it but not reserve, and it is out of "Nearby".')
    : tr(`清单还有 ${days} 天自动暂停：到时买家不能排队。还在卖的话点一下续期。`, `The list pauses in ${days} ${days === 1 ? 'day' : 'days'}, then nobody can reserve. Still selling? Renew it.`);
  return `<div class="banner">${text}<br><button class="btn small primary" style="margin-top:8px" data-act="renew">${sale.paused ? tr('重新上架（续 30 天）', 'Reopen for 30 days') : tr('续 30 天', 'Renew for 30 days')}</button></div>`;
}

async function renewSale(S) {
  try {
    await api(`/sale/${S.saleId}/renew`, { method: 'POST', key: S.key, body: {} });
    toast(tr('已续期 30 天', 'Renewed for 30 days'));
    S.reload();
  } catch (err) {
    toast(err.message);
  }
}

async function reopenSale(S) {
  try {
    await api(`/sale/${S.saleId}/reopen`, { method: 'POST', key: S.key, body: {} });
    toast(tr('已重新公开', 'Reopened'));
    S.reload();
  } catch (err) {
    toast(err.message);
  }
}

function forgetSale(saleId) {
  store.set('mySales', store.get('mySales', []).filter((s) => s.id !== saleId));
  const saved = store.get('linkSaved', {});
  delete saved[saleId];
  store.set('linkSaved', saved);
}

function linkSaved(saleId) {
  return !!store.get('linkSaved', {})[saleId];
}

function markLinkSaved(saleId) {
  const saved = store.get('linkSaved', {});
  saved[saleId] = true;
  store.set('linkSaved', saved);
}

// Arrow pointing at WeChat's ··· menu while the send-to-self sheet is open.
function wxMenuArrow() {
  const el = document.createElement('div');
  el.className = 'wx-arrow';
  el.innerHTML = `<span>⤴</span><b>${tr('点这里', 'Tap here')}</b>`;
  document.body.appendChild(el);
  return () => el.remove();
}

// Send this management page to yourself (文件传输助手) without leaving it.
// In WeChat: ··· → 发送给朋友 shares the current URL, which carries the key (plus saved=1, so opening
// the card back from 文件传输助手 proves it was saved). Elsewhere: the system share sheet.
// The continue button stays disabled until we have a sign the link was actually sent.
function sendSelfSheet(S, { locked = false, doneText = tr('我发好了', 'Sent it'), onDone } = {}) {
  const title = S.data()?.sale.title || TITLE_PICKS[0];
  const link = manageLink(S.saleId, S.key);
  let sent = false;
  let wentAway = false;
  const removeArrow = isWeChat ? wxMenuArrow() : () => {};
  if (isWeChat) history.replaceState(null, '', `/manage/${S.saleId}?k=${S.key}&saved=1`);
  // WeChat's chat picker (or Telegram's share screen) covers the page; coming back from it is our signal that it was sent.
  const onVisible = () => {
    if (document.hidden) wentAway = true;
    else if (wentAway && !sent) {
      sent = true;
      sh.refresh();
    }
  };
  if (isWeChat || isTelegram) document.addEventListener('visibilitychange', onVisible);
  const text = tr(`【⛔勿转发 · 二手清单卖家管理入口】${title}\n点开就能管理：上架、改价、看谁预订了。只发给自己，别转发给买家、别发到群里。`, `[⛔ Don't forward · Secondhand List seller's manage link] ${title}\nTap to manage: add items, change prices, see who reserved. Keep it to yourself, never forward it to buyers or post it in a group.`);
  const sh = openSheet(() => `<h2>${tr('先把管理入口发给自己', 'First, send yourself the management link')}</h2>
    <div class="hint">${tr('这个页面就是你的<b>管理入口</b>：上架、改价、看谁预订了都在这里。发给自己存好，以后点一下就能回来。', 'This page is where you <b>manage</b> the list: add items, change prices, see who reserved. Send it to yourself so one tap brings you back.')}</div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">
      ${isWeChat
        ? tr(`1. 点右上角 <b>···</b> →「<b>发送给朋友</b>」<br>2. 选一个<b>你记得住的地方</b>，发送<br>3. 去那里<b>点开刚发的卡片</b>，就会接着上架`, `1. Tap <b>···</b> at the top right → <b>Send to Chat</b><br>2. Pick <b>a chat you will remember</b> and send<br>3. <b>Open the card</b> you just sent there to carry on`)
        : isTelegram
          ? tr(`1. 点下面的「发到 Saved Messages」<br>2. 选「<b>Saved Messages</b>」，发送`, `1. Tap "Send to Saved Messages" below<br>2. Choose <b>Saved Messages</b> and send`)
          : tr(`1. 点下面的「发给自己」<br>2. 选微信或 Telegram，再选一个<b>你记得住的地方</b>，发送`, `1. Tap "Send it to myself" below<br>2. Pick Telegram, WeChat or email, then <b>a chat you will remember</b>, and send`)}
    </div></div>
    <div class="hint" style="padding-top:0">${tr('比如：Telegram 的 <b>Saved Messages</b>、微信的<b>文件传输助手</b>、和<b>自己</b>的聊天窗口，或者存到微信<b>收藏</b>。', 'For example Telegram <b>Saved Messages</b>, WeChat <b>File Transfer</b>, or a chat with <b>yourself</b>.')}</div>
    <div class="hint" style="padding-top:0">${tr('只发给自己，<b>别发到群里</b>：拿到它的人都能改你的清单。', 'Only to yourself, <b>never to a group</b>: anyone with it can change your list.')}</div>
    <div class="actions">
      ${isTelegram ? `<a class="btn primary block" href="${esc(tgShareUrl(link, text))}" data-act="sendtg">${tr('发到 Saved Messages', 'Send to Saved Messages')}</a>` : ''}
      ${isWeChat || isTelegram ? '' : `<button class="btn primary block" data-act="sendself">${tr('发给自己', 'Send it to myself')}</button>`}
      <button class="btn ${sent ? 'primary' : ''} block" data-act="done" ${sent ? '' : 'disabled'}>${sent ? esc(doneText) : tr('发送以后才能继续', 'Send it first to carry on')}</button>
      ${locked ? '' : `<button class="link-btn small" data-act="close" style="margin:4px auto 0">${tr('关闭', 'Close')}</button>`}
    </div>`, async (act, el, s) => {
    // Telegram's share screen covers this page; coming back from it counts as sent (onVisible).
    if (act === 'sendtg') wentAway = false;
    if (act === 'sendself') {
      try {
        if (navigator.share) await navigator.share({ title: tr(`⛔勿转发｜卖家管理入口｜${title}`, `⛔ Don't forward | Seller's manage link | ${title}`), text, url: link });
        else await copy(`${text}\n${link}`, tr('已复制，发到文件传输助手或自己的窗口', 'Copied: paste it into Saved Messages or a chat with yourself'));
      } catch {
        return;
      }
      sent = true;
      s.refresh();
    }
    if (act === 'close') s.close();
    if (act === 'done' && sent) {
      markLinkSaved(S.saleId);
      s.close();
      onDone?.();
    }
  }, {
    locked,
    onClose: () => {
      removeArrow();
      document.removeEventListener('visibilitychange', onVisible);
      showManageLinkInUrl(S.saleId, S.key);
    },
  });
  return sh;
}

// Right after creating a sale: send the management entry to yourself before uploading.
function newSaleSheet(S) {
  sendSelfSheet(S, {
    locked: true,
    doneText: tr('我发好了，开始上架', 'Sent it, start listing'),
    onDone: () => {
      composer(S);
      S.reload();
    },
  });
}

// ---------- 6.5 "这几件卖掉了吗？" ----------

function pendingChecks(data) {
  return data.items
    .filter((i) => i.status === 'reserved' && data.now - i.statusCheckedAt > CHECK_AFTER_MS)
    .slice(0, 5);
}

function maybeCheck(S, beforeShare, then) {
  const data = S.data();
  const list = data ? pendingChecks(data) : [];
  if (!list.length) return then?.();
  const answered = {};
  let changed = false;
  const sh = openSheet(() => `
    <h2>${tr('这几件卖掉了吗？', 'Did these sell?')}</h2>
    ${beforeShare ? `<div class="hint center" style="padding-top:0">${tr('先确认一下，发出去的就是最新的', 'A quick check so what you share is up to date')}</div>` : ''}
    ${list.map((it) => `
      <div class="check-row ${answered[it.id] ? 'answered' : ''}">
        <div class="row">
          <img src="${img(it.photos[0])}" alt="">
          <div class="grow"><div class="ellipsis"><span class="no">${it.no}</span> ${esc(itemText(it, LANG).name)}</div><div class="small muted">${tr('第 1 位：', 'First: ')}${esc(it.queue[0]?.nickname || '')}</div></div>
          ${answered[it.id] ? `<span class="small">${answered[it.id]}</span>` : ''}
        </div>
        <div class="btns">
          <button class="btn primary" data-act="sell" data-id="${it.id}">${tr('卖掉了', 'Sold')}</button>
          <button class="btn" data-act="still" data-id="${it.id}">${tr('还没', 'Not yet')}</button>
          <button class="btn" data-act="decline" data-id="${it.id}">${tr('他不要了', 'Backed out')}</button>
        </div>
      </div>`).join('')}
    <div class="actions"><button class="btn block" data-act="later">${beforeShare ? tr('稍后再说，先分享', 'Later, share now') : tr('稍后再说', 'Later')}</button></div>`,
  async (act, el, s) => {
    if (act === 'later') return s.close();
    const it = list.find((i) => i.id === el.dataset.id);
    if (!it) return;
    el.disabled = true;
    try {
      const body = act === 'decline' ? { action: 'decline', seq: it.queue[0]?.seq } : { action: act };
      await api(`/item/${it.id}/action`, { method: 'POST', key: S.key, body });
      answered[it.id] = tr({ sell: '已出', still: '还没', decline: '下一位顶上' }, { sell: 'Sold', still: 'Not yet', decline: 'Next in line moves up' })[act];
      changed = true;
      if (list.every((i) => answered[i.id])) {
        s.close();
        toast(tr('已更新，群里看到的就是最新的', 'Updated: the groups see the latest'));
      } else s.refresh();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  }, {
    onClose: async () => {
      if (changed) await S.reload().catch(() => {});
      then?.();
    },
  });
  return sh;
}

// ---------- 6.3 composer (like sending WeChat messages) ----------

const NAME_HINT = tr('名字，例：宜家台灯', 'Name, e.g. IKEA desk lamp');
const NOTE_HINT = tr('详情（选填）：型号、尺寸、用了多久、有没有瑕疵…', 'Details (optional): model, size, how old, any flaws…');

// An AI answer in the seller's language, keeping the other language as the item's translation.
function aiPick(r) {
  const price = r.price == null ? '' : String(r.price);
  if (LANG === 'en' && r.nameEn) return { name: r.nameEn, note: r.noteEn || '', nameAlt: r.name, noteAlt: r.note || '', retail: r.retail, price };
  return { name: r.name, note: r.note || '', nameAlt: r.nameEn || '', noteAlt: r.noteEn || '', retail: r.retail, price };
}

function composer(S) {
  const sale = S.data().sale;
  const sym = CURRENCIES[sale.currency].trim();
  let cards = [];
  let busy = false;
  let aiStopped = !aiAutoOn();
  const el = document.createElement('div');
  el.className = 'composer';
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';

  const close = () => {
    for (const c of cards) c.files.forEach((f) => URL.revokeObjectURL(f.url));
    el.remove();
    document.body.style.overflow = '';
    S.reload().catch(() => {});
  };

  // Price box: a number ("5", "5.5", "5,50"); 0 means free.
  const priceCents = (c) => {
    const n = parsePrice(c.price);
    return Number.isNaN(n) ? null : n;
  };
  const valid = (c) => !!c.name.trim() && priceCents(c) != null && !Number.isNaN(parsePrice(c.orig));

  // AI's guess at the new price, shown next to the price box; the seller still sets the price.
  const retailHtml = (c) => {
    if (!c.retail) return `<div class="cretail"></div>`;
    const { low, high, generic } = c.retail;
    return `<div class="cretail">${generic ? tr('同类新品约', 'Similar new: about ') : tr('新品原价约', 'New: about ')}${esc(sym)}${low}${high > low ? `–${high}` : ''}</div>`;
  };

  const statusHtml = (c) => {
    if (c.error) return `<div class="cstatus err">${esc(c.error)}</div>`;
    if (c.aiBusy) return `<div class="cstatus">✨ ${tr('AI 正在认这是什么…', 'The AI is working out what this is…')}</div>`;
    if (c.touched && !c.name.trim()) return `<div class="cstatus err">${tr('还没填名字', 'Name missing')}</div>`;
    if (c.touched && priceCents(c) == null) return `<div class="cstatus err">${tr('还没填价格', 'Price missing')}</div>`;
    if (c.touched && Number.isNaN(parsePrice(c.orig))) return `<div class="cstatus err">${tr('原价填数字，不填也行', 'Original price: a number, or leave it empty')}</div>`;
    return `<div class="cstatus"></div>`;
  };

  // Manual AI run: after adding photos, or when auto-recognition was off / stopped.
  const aiBtnHtml = (c) => `<button class="ai-btn cai" data-act="reai" ${c.aiBusy ? 'disabled' : ''}>${c.aiBusy ? tr('识别中…', 'Working…') : c.aiDone ? tr('AI 重新识别', 'AI again') : tr('AI 识别', 'AI name it')}</button>`;

  const cardHtml = (c, idx) => `
    <div class="ccard ${c.error || (c.touched && !valid(c)) ? 'bad' : ''}" data-idx="${idx}">
      <div class="crow">
        <div class="thumbs">
          ${c.files.map((f, j) => `<div class="t"><img src="${f.url}" alt="" data-act="photo" data-j="${j}">${c.files.length > 1 ? `<button class="x" data-act="rmph" data-j="${j}">✕</button>` : ''}</div>`).join('')}
          ${c.files.length < MAX_PHOTOS ? `<button class="addph" data-act="addph" title="${tr('给这件东西再加图', 'Add a photo of this item')}">＋</button>` : ''}
        </div>
        <div class="cside">
          <button class="link-btn small cdel" data-act="del">${tr('删除', 'Delete')}</button>
          ${idx > 0 && cards[idx - 1].files.length + c.files.length <= MAX_PHOTOS ? `<button class="link-btn small" data-act="merge">${tr('并到上一件', 'Merge with previous')}</button>` : ''}
          ${aiBtnHtml(c)}
        </div>
      </div>
      <div class="cfields">
        <input class="inp boxed" type="text" maxlength="60" enterkeyhint="next" placeholder="${c.aiBusy ? tr('AI 识别中…', 'AI working…') : NAME_HINT}" value="${esc(c.name)}" data-in="name">
        <label class="price-in"><span>${esc(sym)}</span><input type="text" inputmode="decimal" maxlength="9" enterkeyhint="next" placeholder="${tr('价格', 'Price')}" value="${esc(c.price)}" data-in="price"></label>
      </div>
      <div class="corig">
        ${retailHtml(c)}
        <label class="price-in"><span>${tr('原价', 'New')}${esc(sym)}</span><input type="text" inputmode="decimal" maxlength="9" enterkeyhint="next" placeholder="${tr('选填', 'optional')}" value="${esc(c.orig)}" data-in="orig"></label>
      </div>
      <textarea class="inp boxed cnote" rows="2" maxlength="200" placeholder="${NOTE_HINT}" data-in="note">${esc(c.note)}</textarea>
      ${statusHtml(c)}
    </div>`;

  const footerHtml = () => {
    const n = cards.filter(valid).length;
    return `
      <button class="btn big" data-act="pick">${tr('＋ 新物品', '+ New item')}</button>
      <button class="btn primary big" data-act="submit" ${n && !busy ? '' : 'disabled'}>${busy ? tr('上架中…', 'Listing…') : tr(`全部上架（${n} 件）`, `List all (${n})`)}</button>`;
  };

  const render = () => {
    el.innerHTML = `
      <div class="inner">
        <div class="bar"><button class="link-btn" data-act="close">‹ ${tr('返回', 'Back')}</button><b>${tr('上架', 'Add items')}</b><span style="width:48px"></span></div>
        <div class="hint" style="padding-bottom:0">${aiAutoOn() ? tr('同一件东西的几张照片会自动归到一张卡片里；分错了，点照片拆开，或点「并到上一件」。', 'Photos of the same thing go onto one card; if one lands wrong, tap the photo to split it, or "Merge with previous".') : tr('每张照片是一件新物品；同一件东西的多张图，点卡片里的「＋」加，或点「并到上一件」。', 'Each photo is a new item; for more photos of one thing, tap ＋ on its card or "Merge with previous".')}${tr('价格填 0 就是免费送。<br>详情填得越详细，群里来回问的就越少。', ' A price of 0 means free.<br>The more details, the fewer questions in the group.')}</div>
        ${cards.length ? cards.map(cardHtml).join('') : `<div class="empty">${tr('点下面的「＋ 新物品」选照片。<br>可以一次选很多张，同一件的几张会自动放在一起。', 'Tap "+ New item" below to pick photos.<br>Pick many at once; shots of the same thing are grouped.')}</div>`}
        <div class="footer"><div class="inner">${footerHtml()}</div></div>
      </div>`;
  };

  // Update one card and the footer without re-rendering inputs the seller may be typing in.
  const refreshCard = (c) => {
    const card = el.querySelector(`[data-idx="${cards.indexOf(c)}"]`);
    if (!card) return;
    const nameIn = card.querySelector('[data-in=name]');
    if (document.activeElement !== nameIn) nameIn.value = c.name;
    const noteIn = card.querySelector('[data-in=note]');
    if (document.activeElement !== noteIn) noteIn.value = c.note;
    const priceIn = card.querySelector('[data-in=price]');
    if (document.activeElement !== priceIn) priceIn.value = c.price;
    nameIn.placeholder = c.aiBusy ? tr('AI 识别中…', 'AI working…') : NAME_HINT;
    card.classList.toggle('bad', !!(c.error || (c.touched && !valid(c))));
    card.querySelector('.cstatus').outerHTML = statusHtml(c);
    card.querySelector('.cretail').outerHTML = retailHtml(c);
    card.querySelector('.cai').outerHTML = aiBtnHtml(c);
    el.querySelector('.footer .inner').innerHTML = footerHtml();
  };

  // Automatic runs only fill empty fields; a manual re-run (force) replaces name and details.
  const applyAi = (c, r, force) => {
    c.aiDone = true;
    c.retail = r.retail || null;
    if (force || !c.name.trim()) c.name = r.name;
    if ((force || !c.note.trim()) && r.note) c.note = r.note;
    // A price written on the photo (a seller's own listing picture) only fills an empty box.
    if (!c.price.trim() && r.price) c.price = r.price;
    c.ai = r;
  };

  // Ask the AI about one card using all its photos. Returns false on a quota/busy answer.
  const aiFill = async (c, force, onRegain) => {
    c.aiBusy = true;
    refreshCard(c);
    try {
      applyAi(c, aiPick(await aiRecognize(c.files.map((f) => f.file), sale.currency)), force);
      return true;
    } catch (err) {
      if (err.code === 'LIMIT') aiLimitSheet(onRegain);
      else if (err.code === 'AI_BUSY') aiBusySheet();
      else if (force) toast(err.message);
      return err.code !== 'LIMIT' && err.code !== 'AI_BUSY';
    } finally {
      c.aiBusy = false;
      refreshCard(c);
    }
  };

  // The AI button: this card and every card the AI hasn't named yet, all photos at once,
  // the seller's grouping kept. Only the tapped card has its name and details replaced.
  const aiFillAll = async (c) => {
    const list = cards.filter((d) => d === c || (!d.aiDone && !d.aiBusy && d.files.length));
    if (list.length === 1) return aiFill(c, true, () => cards.includes(c) && el.isConnected && aiFill(c, true));
    const chunks = [];
    for (const d of list) {
      const last = chunks[chunks.length - 1];
      if (last && last.reduce((s, x) => s + x.files.length, 0) + d.files.length <= AI_BATCH_MAX) last.push(d);
      else chunks.push([d]);
    }
    list.forEach((d) => {
      d.aiBusy = true;
      refreshCard(d);
    });
    let sheet = null;
    try {
      for (const chunk of chunks) {
        const files = [];
        const groups = [];
        chunk.forEach((d, k) => d.files.forEach((f) => (files.push(f.file), groups.push(k))));
        try {
          const r = await aiBatch(files, sale.currency, groups);
          for (const it of r.items) {
            const d = chunk[groups[it.photos[0]]];
            if (it.name && d && cards.includes(d)) applyAi(d, aiPick(it), d === c);
          }
          if (r.limited) sheet = 'limit';
        } catch (err) {
          if (err.code === 'LIMIT') sheet = 'limit';
          else if (err.code === 'AI_BUSY') sheet = 'busy';
          else return toast(err.message);
        }
        if (sheet) break;
      }
    } finally {
      list.forEach((d) => {
        d.aiBusy = false;
        refreshCard(d);
      });
    }
    if (sheet === 'limit') aiLimitSheet(() => cards.includes(c) && el.isConnected && aiFillAll(c));
    else if (sheet === 'busy') aiBusySheet();
  };

  // Quota regained via survey or invite: pick up where we stopped (named cards are skipped).
  const regain = () => {
    if (!el.isConnected || !aiAutoOn()) return;
    aiStopped = false;
    recognise(cards);
  };

  // Recognise new photos one by one in the background; stop after the first quota/busy answer.
  const recognise = async (list) => {
    for (const c of list) {
      if (aiStopped) return;
      if (c.name.trim() || !cards.includes(c)) continue;
      const ok = await aiFill(c, false, regain);
      if (!ok) aiStopped = true;
    }
  };

  // A photo on a card, shrunk in the background from now on; photoId is set once it is uploaded.
  const entry = (file) => {
    shrinkPhoto(file).catch(() => {});
    return { file, url: URL.createObjectURL(file) };
  };
  const newCard = (files) => ({ files: files.map(entry), name: '', price: '', orig: '', note: '', touched: false, error: '' });

  // Several photos picked at once: one AI call per batch puts shots of the same thing on one
  // card and names each card. A single photo, or AI off / stopped: one card per photo, as before.
  const addFiles = async () => {
    const files = await pickFiles();
    if (!files.length) return;
    if (files.length === 1 || aiStopped) {
      const added = files.map((f) => newCard([f]));
      cards.push(...added);
      render();
      return recognise(added);
    }
    const stop = loading(tr('AI 正在整理照片…', 'The AI is sorting your photos…'));
    const added = [];
    let dropped = 0;
    let sheet = null;
    for (let i = 0; i < files.length; i += AI_BATCH_MAX) {
      const batch = files.slice(i, i + AI_BATCH_MAX);
      let items = batch.map((_, j) => ({ photos: [j] }));
      if (!aiStopped) {
        try {
          const r = await aiBatch(batch, sale.currency);
          items = r.items;
          if (r.limited) sheet = 'limit';
        } catch (err) {
          if (err.code === 'LIMIT') sheet = 'limit';
          else if (err.code === 'AI_BUSY') sheet = 'busy';
        }
        if (sheet) aiStopped = true;
      }
      for (const it of items) {
        dropped += Math.max(0, it.photos.length - MAX_PHOTOS);
        const c = newCard(it.photos.slice(0, MAX_PHOTOS).map((j) => batch[j]));
        if (it.name) {
          const r = aiPick(it);
          Object.assign(c, { name: r.name, note: r.note, price: r.price, retail: it.retail || null, aiDone: true, ai: r });
        }
        added.push(c);
      }
    }
    stop();
    cards.push(...added);
    render();
    if (dropped) toast(tr(`每件最多 ${MAX_PHOTOS} 张，多出的 ${dropped} 张没放进去`, `Up to ${MAX_PHOTOS} photos per item; ${dropped} left out`), 3000);
    if (sheet === 'limit') aiLimitSheet(regain);
    else if (sheet === 'busy') aiBusySheet();
  };

  // Tapping a photo: crop or mosaic part of it; on a card with several, also move it to its own card or drop it.
  const photoSheet = (c, j) => openSheet(() => `
    <div class="actions">
      <button class="btn block" data-act="crop">${tr('裁剪（比如从截图里抠出商品图）', 'Crop (e.g. the item out of a screenshot)')}</button>
      <button class="btn block" data-act="mosaic">${tr('打码（遮住门牌、快递单、人脸）', 'Blur parts (door numbers, labels, faces)')}</button>
      ${c.files.length > 1 ? `<button class="btn block" data-act="split">${tr('拆成单独一件', 'Make it a separate item')}</button>
      <button class="btn danger block" data-act="rm">${tr('删掉这张', 'Delete this photo')}</button>` : ''}
      <button class="btn block" data-act="cancel">${tr('取消', 'Cancel')}</button>
    </div>`, async (act, _el, s) => {
    s.close();
    if (!cards.includes(c) || !c.files[j]) return;
    if (act === 'mosaic' || act === 'crop') {
      const old = c.files[j];
      const file = await (act === 'crop' ? cropEditor : mosaicEditor)(old.file);
      if (!file || c.files[j] !== old) return;
      URL.revokeObjectURL(old.url);
      // A new entry has no photoId, so the edited photo is uploaded even if the original was.
      c.files[j] = entry(file);
      return render();
    }
    if (act === 'rm') {
      URL.revokeObjectURL(c.files[j].url);
      c.files.splice(j, 1);
      return render();
    }
    if (act === 'split') {
      const one = { ...newCard([]), files: c.files.splice(j, 1) };
      cards.splice(cards.indexOf(c) + 1, 0, one);
      render();
      recognise([one]);
    }
  });

  el.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-in]');
    if (!inp) return;
    const c = cards[Number(inp.closest('[data-idx]').dataset.idx)];
    c[inp.dataset.in] = inp.value;
    c.error = '';
    refreshCard(c);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input[data-in]')) return;
    e.preventDefault();
    const inputs = [...el.querySelectorAll('[data-in]')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else e.target.blur();
  });
  el.addEventListener('focusout', (e) => {
    const inp = e.target.closest('[data-in]');
    if (!inp) return;
    const c = cards[Number(inp.closest('[data-idx]').dataset.idx)];
    if (c && (c.name.trim() || c.price.trim())) {
      c.touched = true;
      refreshCard(c);
    }
  });

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a || busy) return;
    const cardEl = a.closest('[data-idx]');
    const c = cardEl ? cards[Number(cardEl.dataset.idx)] : null;
    switch (a.dataset.act) {
      case 'close':
        if (cards.length && !(await ask({ title: tr('还有没上架的物品', 'Some items are not listed yet'), text: tr('离开的话，这些不会保存。', 'If you leave, they are not saved.'), ok: tr('离开', 'Leave'), danger: true }))) return;
        return close();
      case 'pick':
        return addFiles();
      case 'reai':
        if (c.aiBusy) return;
        return aiFillAll(c);
      case 'del':
        c.files.forEach((f) => URL.revokeObjectURL(f.url));
        cards.splice(cards.indexOf(c), 1);
        return render();
      case 'rmph':
        URL.revokeObjectURL(c.files[Number(a.dataset.j)].url);
        c.files.splice(Number(a.dataset.j), 1);
        return render();
      case 'photo':
        return photoSheet(c, Number(a.dataset.j));
      case 'merge': {
        if (c.aiBusy) return;
        const prev = cards[cards.indexOf(c) - 1];
        prev.files.push(...c.files);
        // Keep whatever the seller typed on the card that goes away.
        if (!prev.name.trim()) prev.name = c.name;
        if (!prev.price.trim()) prev.price = c.price;
        if (!prev.note.trim()) prev.note = c.note;
        cards.splice(cards.indexOf(c), 1);
        return render();
      }
      case 'addph': {
        const fs = await pickFiles();
        for (const f of fs.slice(0, MAX_PHOTOS - c.files.length)) c.files.push(entry(f));
        return render();
      }
      case 'submit':
        return submit();
    }
  });

  // Leaving mid-way loses the items not sent yet, so the browser asks first.
  const holdPage = (e) => e.preventDefault();
  const submit = async () => {
    cards.forEach((c) => (c.touched = true));
    busy = true;
    render();
    const todo = cards.filter(valid);
    const stop = loading('');
    window.addEventListener('beforeunload', holdPage);
    let done = 0;
    let failed = 0;
    for (const c of todo) {
      const k = done + failed + 1;
      stop.say(tr(`正在上架第 ${k}/${todo.length} 件，先别关页面…`, `Listing ${k} of ${todo.length}, keep this page open…`));
      try {
        // A card's photos go up together; ones an earlier failed try already sent keep their id.
        await Promise.all(c.files.map(async (f) => (f.photoId ||= await uploadPhoto(S.saleId, S.key, f.file))));
        const body = { name: c.name.trim(), priceCents: priceCents(c), origPriceCents: parsePrice(c.orig), condition: '', note: c.note.trim(), photos: c.files.map((f) => f.photoId) };
        // The AI's other-language name goes along while the seller kept its wording; otherwise the server translates.
        if (c.ai?.nameAlt && body.name === c.ai.name && body.note === c.ai.note && (c.ai.noteAlt || !body.note)) Object.assign(body, { nameAlt: c.ai.nameAlt, noteAlt: c.ai.noteAlt });
        await api(`/sale/${S.saleId}/items`, { method: 'POST', key: S.key, body });
        c.files.forEach((f) => URL.revokeObjectURL(f.url));
        cards.splice(cards.indexOf(c), 1);
        done++;
      } catch (err) {
        c.error = err.code === 'NETWORK' ? tr('没保存成功，网络恢复后再点一次', 'Not saved. Tap again once you are back online') : err.message;
        failed++;
      }
      render();
    }
    window.removeEventListener('beforeunload', holdPage);
    stop();
    busy = false;
    render();
    if (done) toast(tr(`上架了 ${done} 件${failed ? `，${failed} 件没成功` : ''}`, `Listed ${done}${failed ? `, ${failed} failed` : ''}`));
    else if (failed) toast(tr('没保存成功，网络恢复后再点一次', 'Not saved. Tap again once you are back online'));
    if (!cards.length) close();
  };

  render();
  addFiles();
}

// ---------- 6.4 item sheet (seller view) ----------

// The seller sees the item as written (the original, Chinese or English, whatever the UI language)
// with the machine translation into the other language beside it. English is what Telegram and
// English-speaking buyers read, so a Chinese original is nudged when it has none.
const LANG_NAME = { zh: tr('中文', 'Chinese'), en: tr('英文', 'English') };
const otherLang = (s) => (textLang(s) === 'zh' ? 'en' : 'zh');
const altTag = (orig) => `${LANG_NAME[otherLang(orig)]} · ${tr('自动翻译', 'auto-translated')}`;

function itemSheet(S, itemId) {
  const { sale } = S.data();
  let it = S.data().items.find((i) => i.id === itemId);
  let edit = null;
  let adding = false; // the add-someone row is open as a name field

  const refreshItem = async () => {
    await S.reload();
    it = S.data().items.find((i) => i.id === itemId);
    if (!it) sh.close();
    else sh.refresh();
  };

  const sh = openSheet(() => {
    const open = it.status === 'available' || it.status === 'reserved';
    if (edit) {
      return `<h2>${tr(`编辑 ${it.no} 号`, `Edit #${it.no}`)}</h2>
        <div class="group" style="padding:12px">
          <div class="photo-strip">
            ${edit.photos.map((p, j) => `<div class="t"><img src="${img(p)}" alt="" data-act="eph" data-j="${j}">${edit.photos.length > 1 ? `<button class="x" data-act="eph-rm" data-j="${j}">✕</button>` : ''}</div>`).join('')}
            ${edit.photos.length < MAX_PHOTOS ? `<button class="addph" data-act="eph-add">＋</button>` : ''}
          </div>
        </div>
        <div class="group">
          <div class="field"><span>${tr('名字', 'Name')} <small class="muted">${tr('原文', 'original')}</small></span><input class="inp" name="name" maxlength="60" value="${esc(edit.name)}">
            <div class="alt-line"><span data-tag-of="name">${altTag(edit.name)}</span><input class="inp" name="name2" maxlength="60" value="${esc(edit.name2)}" placeholder="${tr('保存后自动翻译', 'Translated after saving')}"></div>
          </div>
          <label class="field"><span>${tr(`价格（${esc(CURRENCIES[sale.currency].trim())}，0 = 免费送）`, `Price (${esc(CURRENCIES[sale.currency].trim())}, 0 = free)`)}</span><input class="inp" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${edit.priceCents / 100}"></label>
          <label class="field"><span>${tr('原价（选填，会划掉显示在价格旁边）', 'Original price (optional, shown struck through)')}</span><input class="inp" name="orig" type="text" inputmode="decimal" maxlength="9" value="${edit.origPriceCents == null || Number.isNaN(edit.origPriceCents) ? '' : edit.origPriceCents / 100}"></label>
          <div class="field"><span>${tr('详情（选填）', 'Details (optional)')} <small class="muted">${tr('原文', 'original')}</small></span><textarea class="inp" name="note" rows="3" maxlength="200" placeholder="${NOTE_HINT}">${esc(edit.note)}</textarea>
            <div class="alt-line"><span data-tag-of="note">${altTag(edit.note || edit.name)}</span><textarea class="inp" name="note2" rows="2" maxlength="200">${esc(edit.note2)}</textarea></div>
          </div>
          <div class="cell"><span class="small muted grow">${tr('翻译不对可以直接改', 'Fix a translation by editing it')}</span><button class="link-btn small" data-act="retranslate">↻ ${tr('重新翻译', 'Re-translate')}</button></div>
        </div>
        <div class="actions"><button class="btn primary block" data-act="save">${tr('保存', 'Save')}</button><button class="btn block" data-act="cancel-edit">${tr('取消', 'Cancel')}</button></div>`;
    }
    const q = it.queue;
    const missing = !it.nameAlt && textLang(it.name) === 'zh';
    return `
      <div class="row" style="margin-bottom:12px">
        <img src="${img(it.photos[0])}" style="width:72px;height:72px;border-radius:8px;object-fit:cover" alt="">
        <div class="grow">
          <div><span class="no">${it.no}</span> <b>${esc(it.name)}</b></div>
          <div>${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)} · <span class="st ${it.status}">${statusText[it.status]}</span>${it.condition ? ` · ${conditionText(it.condition, LANG)}` : ''}</div>
          ${it.note ? `<div class="small muted">${esc(it.note)}</div>` : ''}
        </div>
        ${open ? `<button class="btn small" data-act="share-item">${tr('分享', 'Share')}</button><button class="btn small" data-act="edit">${tr('编辑', 'Edit')}</button>` : ''}
      </div>
      <div class="alt-box ${missing ? 'missing' : ''}">
        <div class="small muted">${altTag(it.name)}</div>
        ${it.nameAlt ? `<div>${esc(it.nameAlt)}</div>${it.noteAlt ? `<div class="small muted">${esc(it.noteAlt)}</div>` : ''}`
          : `<div class="small">${missing ? tr('还没有英文名：Telegram 群和英文买家会看到中文', 'No English name yet: Telegram groups and English-speaking buyers see the Chinese') : tr('还没有，选填', 'None yet, optional')}</div>`}
        ${open ? `<button class="link-btn small" data-act="retranslate">↻ ${it.nameAlt ? tr('重新翻译', 'Re-translate') : tr(`翻译成${LANG_NAME[otherLang(it.name)]}`, `Translate to ${LANG_NAME[otherLang(it.name)]}`)}</button>` : ''}
      </div>
      ${open ? `
        <div class="small muted" style="margin:0 4px 6px">${tr(`排队名单（${q.length} 人）`, `In line (${q.length})`)}</div>
        <div class="group">
          ${q.length ? q.map((r, i) => `
            <div class="qrow ${i === 0 ? 'head' : ''}">
              <span class="pos">${i + 1}</span>
              <div class="grow">
                <div>${r.telegram ? '<span class="kind-tag tg">TG</span> ' : r.facebook ? '<span class="kind-tag fb">FB</span> ' : r.wechat ? `<span class="kind-tag wx">${tr('微信', 'WeChat')}</span> ` : ''}<b>${esc(r.nickname)}</b>${r.addedBy === 'seller' ? ` <span class="small muted">${tr('（手动加）', '(added by you)')}</span>` : ''}
                  ${r.telegram ? ` <a class="link-btn small" href="${esc(tgChatUrl(r.telegram))}" target="_blank" rel="noopener">${tr('Telegram 发消息', 'Message')}</a>`
                    : r.facebook && fbProfileUrl(r.facebook) ? ` <a class="link-btn small" href="${esc(fbProfileUrl(r.facebook))}" target="_blank" rel="noopener">${tr('打开 Facebook 主页', 'Facebook profile')}</a>`
                    : r.facebook ? ` <span class="small muted">${tr('会在 Facebook 私信你', 'will DM you on Facebook')}</span>`
                    : r.wechat ? ` <button class="link-btn small" data-copy="${esc(r.wechat)}">${tr('复制微信号', 'Copy WeChat ID')}</button>` : ''}</div>
                <div class="small muted">${new Date(r.createdAt).toLocaleString(tr('zh-CN', 'en-GB'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                ${i === 0 ? `<div class="acts"><button class="btn primary" data-act="sell">${tr('卖给他了', 'Sold')}</button><button class="btn" data-act="decline" data-seq="${r.seq}">${tr('他不要了', 'Backed out')}</button></div>` : ''}
              </div>
              ${i > 0 ? `<button class="btn small" data-act="rmq" data-seq="${r.seq}">${tr('移除', 'Remove')}</button>` : ''}
            </div>`).join('') : `<div class="cell muted small">${tr('还没人排队', 'Nobody in line yet')}</div>`}
        </div>
        <div class="small muted" style="margin:0 4px 6px">${tr('处理这件', 'Do something with it')}</div>
        <div class="group act-list">
          ${q.length ? '' : `<button class="cell go" data-act="sell">✓ ${tr('已经卖掉了', 'Already sold')}</button>`}
          ${adding
            ? `<div class="cell"><input class="inp grow" name="manual" maxlength="20" placeholder="${tr('称呼，加到队尾', 'Their name, added at the end')}"><button class="btn small primary" data-act="manual">${tr('加入', 'Add')}</button></div>`
            : `<button class="cell" data-act="add-open"><div class="grow">＋ ${tr('手动加人到队列', 'Add someone to the line')}<div class="small muted">${tr('微信里约好、没在这里排队的人', "Someone who reserved by chat, not here")}</div></div><span class="muted">›</span></button>`}
          <button class="cell danger" data-act="remove">↓ ${tr('下架', 'Take down')}</button>
        </div>` : it.status === 'sold'
        ? `<div class="sold-done">
            <b>${tr('卖出去了！🎉', 'Sold! 🎉')}</b>
            ${tipOn() ? `<div class="small">${tr('觉得好用？', 'Was it handy?')}</div><button class="btn block" data-act="tip">☕ ${tr('请开发者喝杯咖啡', 'Buy the developer a coffee')}</button>` : ''}
          </div>
          <div class="actions"><button class="btn block" data-act="relist">${tr('点错了？重新上架', 'Not sold after all? Put it back up')}</button></div>`
        : `<div class="hint center">${tr(`这件${statusText[it.status]}了`, `This item is ${statusText[it.status].toLowerCase()}`)}</div>
          <div class="actions"><button class="btn block" data-act="relist">${tr('重新上架', 'Put it back up')}</button></div>`}`;
  }, async (act, el, s) => {
    const run = async (body, msg) => {
      el.disabled = true;
      try {
        await api(`/item/${it.id}/action`, { method: 'POST', key: S.key, body });
        if (msg) toast(msg);
        await refreshItem();
      } catch (err) {
        toast(err.message);
        el.disabled = false;
      }
    };
    switch (act) {
      case 'sell':
        return run({ action: 'sell' }, tr('已标记为已出', 'Marked as sold'));
      case 'relist':
        if (!(await ask({
          title: tr(`把 ${it.no} 号重新上架？`, `Put #${it.no} back up?`),
          text: it.status === 'sold' ? tr('标已出时排队的人会回到队里。', 'Whoever was in line when you marked it sold is back in line.') : tr('下架时排队的人会回到队里。', 'Whoever was in line when you took it down is back in line.'),
          ok: tr('重新上架', 'Put back up'),
        }))) return;
        return run({ action: 'relist' }, tr('已重新上架', 'Back up for sale'));
      case 'decline':
        return run({ action: 'decline', seq: Number(el.dataset.seq) }, it.queue.length > 1 ? tr('下一位顶上了', 'Next in line moves up') : tr('回到在售', 'Back on sale'));
      case 'rmq':
        if (!(await ask({ title: tr('把这个人移出队列？', 'Remove this person from the line?'), ok: tr('移出', 'Remove'), danger: true }))) return;
        return run({ action: 'removeQueue', seq: Number(el.dataset.seq) });
      case 'manual': {
        const nickname = s.el.querySelector('[name=manual]').value.trim();
        if (!nickname) return toast(tr('填个称呼', 'Add a name'));
        adding = false;
        return run({ action: 'addManual', nickname }, tr('已加到队尾', 'Added at the end'));
      }
      case 'add-open':
        adding = true;
        s.refresh();
        return s.el.querySelector('[name=manual]')?.focus();
      case 'remove':
        if (!(await ask({ title: tr(`下架 ${it.no} 号？`, `Take down #${it.no}?`), text: tr('排队的人会被移出。', 'Everyone in line is removed.'), ok: tr('下架', 'Take down'), danger: true }))) return;
        await run({ action: 'remove' }, tr('已下架', 'Taken down'));
        return s.close();
      case 'share-item':
        return shareItem(S, it);
      case 'tip':
        return tipSheet();
      case 'edit':
        edit = { name: it.name, note: it.note, name2: it.nameAlt || '', note2: it.noteAlt || '', priceCents: it.priceCents, origPriceCents: it.origPriceCents ?? null, condition: it.condition, photos: [...it.photos] };
        return s.refresh();
      case 'retranslate': {
        // Only the saved text is translated (the server takes no text from here), so an edited
        // name is saved first and translated with the save.
        if (edit) {
          syncEdit(s);
          if (edit.name !== it.name || edit.note !== it.note) return toast(tr('先保存，保存后会自动重新翻译', 'Save first: the new text is translated when saved'));
        }
        el.disabled = true;
        const stop = loading(tr('正在翻译…', 'Translating…'));
        try {
          const r = await api(`/item/${it.id}/translate`, { method: 'POST', key: S.key, body: {} });
          await S.reload();
          it = S.data().items.find((i) => i.id === itemId) || it;
          if (edit) Object.assign(edit, { name2: it.nameAlt || '', note2: it.noteAlt || '' });
          toast(r.nameAlt ? tr('已重新翻译', 'Re-translated') : tr('没翻译出来', 'Nothing came back'));
        } catch (err) {
          toast(err.message);
        } finally {
          stop();
        }
        return s.refresh();
      }
      case 'cancel-edit':
        edit = null;
        return s.refresh();
      case 'eph':
        syncEdit(s);
        return editPhotoSheet(s, Number(el.dataset.j));
      case 'eph-rm':
        syncEdit(s);
        edit.photos.splice(Number(el.dataset.j), 1);
        return s.refresh();
      case 'eph-add': {
        syncEdit(s);
        const fs = await pickFiles({ multiple: true });
        const stop = loading(tr('上传照片…', 'Uploading photos…'));
        try {
          for (const f of fs.slice(0, MAX_PHOTOS - edit.photos.length)) edit.photos.push(await uploadPhoto(S.saleId, S.key, f));
        } catch (err) {
          toast(err.message);
        } finally {
          stop();
        }
        return s.refresh();
      }
      case 'save': {
        syncEdit(s);
        if (!edit.name) return toast(tr('名字不能为空', 'The name is required'));
        if (!Number.isFinite(edit.priceCents) || edit.priceCents < 0) return toast(tr('价格不对', 'Invalid price'));
        if (Number.isNaN(edit.origPriceCents)) return toast(tr('原价填数字，不填也行', 'Original price: a number, or leave it empty'));
        el.disabled = true;
        const { name, note, name2, note2, ...body } = edit;
        // An untouched translation is left to the server, which keeps it, or redoes it when the text changed.
        if (name2 !== (it.nameAlt || '') || note2 !== (it.noteAlt || '')) Object.assign(body, { name, note, nameAlt: name2, noteAlt: note2 });
        else if (name !== it.name || note !== it.note) Object.assign(body, { name, note });
        try {
          await api(`/item/${it.id}`, { method: 'PATCH', key: S.key, body });
          edit = null;
          toast(tr('已保存', 'Saved'));
          await refreshItem();
        } catch (err) {
          toast(err.message);
          el.disabled = false;
        }
      }
    }
  }, { onClose: () => S.tryRecommend?.() });
  bindCopy(sh.el);
  // The translation's language follows the original as it is typed.
  sh.el.addEventListener('input', (e) => {
    const n = e.target.name;
    if (n !== 'name' && n !== 'note') return;
    const v = (k) => sh.el.querySelector(`[name=${k}]`).value;
    sh.el.querySelector('[data-tag-of=name]').textContent = altTag(v('name'));
    sh.el.querySelector('[data-tag-of=note]').textContent = altTag(v('note') || v('name'));
  });

  // Tapping a saved photo while editing: swap it for another, crop or blur it, make it the cover, or drop it.
  // Every change uploads a new photo; the item keeps the old one until Save.
  function editPhotoSheet(s, j) {
    openSheet(() => `
      <div class="actions">
        <button class="btn block" data-act="replace">${tr('换一张（重拍或从相册选）', 'Replace (take a new one or pick)')}</button>
        <button class="btn block" data-act="crop">${tr('裁剪', 'Crop')}</button>
        <button class="btn block" data-act="mosaic">${tr('打码（遮住门牌、快递单、人脸）', 'Blur parts (door numbers, labels, faces)')}</button>
        ${j > 0 ? `<button class="btn block" data-act="cover">${tr('设为第一张', 'Make it the first photo')}</button>` : ''}
        ${edit.photos.length > 1 ? `<button class="btn danger block" data-act="rm">${tr('删掉这张', 'Delete this photo')}</button>` : ''}
        <button class="btn block" data-act="cancel">${tr('取消', 'Cancel')}</button>
      </div>`, async (act, _el, ps) => {
      ps.close();
      const p = edit?.photos[j];
      if (!p) return;
      if (act === 'cover') {
        edit.photos.unshift(...edit.photos.splice(j, 1));
        return s.refresh();
      }
      if (act === 'rm') {
        edit.photos.splice(j, 1);
        return s.refresh();
      }
      let file = null;
      if (act === 'replace') file = (await pickFiles({ multiple: false }))[0];
      else if (act === 'crop' || act === 'mosaic') {
        const stop = loading(tr('打开照片…', 'Opening the photo…'));
        let orig;
        try {
          const r = await fetch(img(p, false));
          if (!r.ok) throw new Error();
          orig = new File([await r.blob()], 'photo.jpg', { type: 'image/jpeg' });
        } catch {
          toast(tr('这张照片打不开', "Can't open this photo"));
        } finally {
          stop();
        }
        if (orig) file = await (act === 'crop' ? cropEditor : mosaicEditor)(orig);
      }
      if (!file) return;
      const stop = loading(tr('上传照片…', 'Uploading photos…'));
      try {
        const id = await uploadPhoto(S.saleId, S.key, file);
        if (edit?.photos[j] !== p) return;
        edit.photos[j] = id;
        s.refresh();
      } catch (err) {
        toast(err.message);
      } finally {
        stop();
      }
    });
  }

  function syncEdit(s) {
    const v = (n) => s.el.querySelector(`[name=${n}]`)?.value ?? '';
    edit.name = v('name').trim();
    edit.priceCents = Math.round(parseFloat(v('price') || '0') * 100);
    edit.origPriceCents = parsePrice(v('orig'));
    edit.note = v('note').trim();
    edit.name2 = v('name2').trim();
    edit.note2 = v('note2').trim();
  }
}

// ---------- settings ----------

function settingsSheet(S) {
  const { sale } = S.data();
  // The list's title and place in the other language, as buyers in that language see them.
  const otherLang = textLang(sale.title) === 'zh' ? 'en' : 'zh';
  const shown = saleText(sale, otherLang);
  const altHtml = `<div class="group">
      <div class="small muted" style="margin:8px 4px 0">${otherLang === 'en' ? tr('英文买家看到的（自动翻译，不对可以改）', 'What English-speaking buyers see (auto-translated, fix it if wrong)') : tr('中文买家看到的（自动翻译，不对可以改）', 'What Chinese-speaking buyers see (auto-translated, fix it if wrong)')}</div>
      <label class="field"><span>${tr('标题', 'Title')}</span><input class="inp" name="altTitle" maxlength="60" value="${esc(sale.alt ? shown.title : '')}" placeholder="${tr('保存后自动翻译', 'Translated after saving')}"></label>
      <label class="field"><span>${tr('取货地点', 'Pick-up place')}</span><input class="inp" name="altLocation" maxlength="60" value="${esc(sale.alt ? shown.location : '')}"></label>
    </div>`;
  const sh = openSheet(() => `<h2>${tr('设置', 'Settings')}</h2>
    <div class="settings-form">${saleFormHtml({ ...sale, wechatId: sale.wechatId })}</div>
    ${altHtml}
    <div class="actions">
      <button class="btn primary block" data-act="save">${tr('保存', 'Save')}</button>
      <button class="btn block" data-act="link">${tr('把管理入口发给自己（换手机、换浏览器用）', 'Send myself the management link (for a new phone or browser)')}</button>
      <button class="btn block" data-act="feedback">${tr('反馈问题 / 提建议', 'Feedback / ideas')}</button>
      ${tipOn() ? `<button class="btn block" data-act="tip">☕ ${tr('打赏开发者', 'Tip the developer')}</button>` : ''}
      ${sale.status === 'active'
        ? `<button class="btn danger block" data-act="end">${tr('结束清单（对买家隐藏）', 'End the list (hide it from buyers)')}</button>`
        : `<button class="btn block" data-act="reopen">${tr('重新公开', 'Reopen')}</button>`}
      <button class="btn danger block" data-act="delete">${tr('永久删除清单', 'Delete the list for good')}</button>
    </div>
    <label class="nearby-row" style="margin:16px 4px 6px"><input type="checkbox" data-act="aiauto" ${aiAutoOn() ? 'checked' : ''}><span>${tr('上架时自动用 AI 认出照片里是什么', 'Let the AI name photos when adding items')}</span></label>
    <div class="small muted" style="margin:0 4px 6px">${tr('AI 识别照片', 'AI photo naming')} · <span class="ai-status">${tr('查询中…', 'checking…')}</span></div>
    ${inviteRowHtml()}`, async (act, el, s) => {
    if (act === 'invite') return useInvite(s);
    if (act === 'aiauto') {
      store.set('aiAuto', el.checked);
      return toast(el.checked ? tr('上架时会自动识别照片', 'New photos will be named by the AI') : tr('已关闭 AI 自动识别', 'AI naming is off'));
    }
    if (act === 'feedback') {
      s.close();
      return feedbackSheet();
    }
    if (act === 'tip') {
      s.close();
      return tipSheet();
    }
    if (act === 'link') {
      s.close();
      return sendSelfSheet(S, { onDone: () => S.reload() });
    }
    if (act === 'save') {
      const f = readSaleForm(s.el);
      if (!f.title || !f.location) return toast(tr('标题和取货地点不能为空', 'Title and pick-up place are required'));
      const bad = contactError(f);
      if (bad) return toast(bad, 2600);
      const altTitle = s.el.querySelector('[name=altTitle]').value.trim();
      const altLocation = s.el.querySelector('[name=altLocation]').value.trim();
      // Sent only when the seller corrected it; otherwise the server translates the new text.
      if (altTitle && (altTitle !== shown.title || altLocation !== shown.location || !sale.alt)) f.alt = { title: altTitle, location: altLocation };
      el.disabled = true;
      if (f.nearby && !sale.hasLocation) {
        const loc = await getLocation();
        if (loc) Object.assign(f, loc);
      }
      try {
        await api(`/sale/${S.saleId}`, { method: 'PATCH', key: S.key, body: f });
        toast(tr('已保存', 'Saved'));
        s.close();
        S.reload();
      } catch (err) {
        toast(err.message);
        el.disabled = false;
      }
    }
    if (act === 'reopen') {
      s.close();
      return reopenSale(S);
    }
    if (act === 'delete') {
      const yes = await ask({
        title: tr('永久删除这份清单？', 'Delete this list for good?'),
        text: tr('所有物品、照片和排队记录都会被删掉，不能恢复。\n只想先不让买家看到的话，用「结束清单」就行。', 'All items, photos and reservations are deleted and cannot be recovered.\nTo just hide it from buyers, use "End the list".'),
        ok: tr('永久删除', 'Delete for good'),
        danger: true,
        word: tr('删除', 'delete'),
      });
      if (!yes) return;
      try {
        await api(`/sale/${S.saleId}`, { method: 'DELETE', key: S.key });
        forgetSale(S.saleId);
        location.href = '/?deleted=1';
      } catch (err) {
        toast(err.message);
      }
    }
    if (act === 'end') {
      s.close();
      return endSheet(S);
    }
  });
  bindNearbyTip(sh.el);
  buyerToken(true);
  api('/ai/quota').then((q) => {
    const el = sh.el.querySelector('.ai-status');
    if (el) el.textContent = q.unlimited ? tr('已用邀请码，不限次数', 'Invite code: unlimited') : tr(`这台手机还剩 ${q.left} 次`, `${q.left} left on this phone`);
  }).catch(() => {});
}

// Ending a list: a short summary of how it went, then the confirm.
function endSheet(S) {
  const { sale, items, soldCents } = S.data();
  const sold = items.filter((i) => i.status === 'sold').length;
  const days = Math.max(1, Math.ceil((Date.now() - sale.createdAt) / (24 * HOUR)));
  openSheet(() => `<h2>${tr('结束这份清单？', 'End this list?')}</h2>
    <div class="end-summary">
      <div class="small muted">${tr('这次清仓', 'This sale')}</div>
      <div class="end-big">${sold ? tr(`卖出 ${sold} 件，收回 ${esc(money(soldCents, sale.currency))}`, `${sold} sold, ${esc(money(soldCents, sale.currency))} earned`) : tr('还没有卖出的东西', 'Nothing sold yet')}</div>
      <div class="small muted">${tr(`上架 ${items.length} 件 · 用了 ${days} 天`, `${items.length} listed · ${days} ${days === 1 ? 'day' : 'days'}`)}</div>
    </div>
    <div class="hint" style="padding:0 2px 10px">${tr('结束后，买家打开链接会看到「已经结束」和附近还在卖的东西，所有排队会被取消。你还能在这里看到它，随时可以重新公开。', 'Buyers opening the link will see that it ended, plus things still for sale nearby, and every reservation is cancelled. You still see it here and can reopen it any time.')}</div>
    <div class="highlight keep-block"><b>${tr('下次还要用？', 'Need it again?')}</b> ${tr('搬家、帮朋友出东西时，打开二手清单首页就能新建一份。', 'Next move, or helping a friend sell, start a new list from the home page.')}${store.get('kept', false) ? '' : `<br><a href="/keep?save=1">☆ ${tr('收藏「二手清单」', 'Keep Secondhand List')}</a>`}</div>
    <div class="actions">
      <button class="btn danger-solid big block" data-act="end">${tr('结束清单', 'End the list')}</button>
      <button class="btn block" data-act="close">${tr('先不结束', 'Keep it open')}</button>
    </div>`, async (act, el, s) => {
    if (act === 'close') return s.close();
    if (act !== 'end') return;
    el.disabled = true;
    try {
      await api(`/sale/${S.saleId}/end`, { method: 'POST', key: S.key, body: {} });
      s.close();
      S.reload();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  });
}

// ---------- 6.6 / 9 share ----------

function publicUrl(S) {
  return `${location.origin}/s/${S.saleId}`;
}

// A page opened in WeChat from a QR code or a card forwards as a card itself, so when that
// page is the one being shared, no QR code is needed.
function isCardHere(url) {
  return isWeChat && cardSession() && new URL(url).pathname === location.pathname;
}

// Where the seller is posting: WeChat groups (card + text, two messages) or Telegram groups
// (one message whose link Telegram turns into a preview). Remembered per phone.
// Facebook groups: one "Sell something" listing with several pictures, copied in by hand.
function shareTarget() {
  return store.get('shareTarget', '') || (isFacebook ? 'facebook' : isTelegram || (LANG === 'en' && !isWeChat) ? 'telegram' : 'wechat');
}

// Language of what goes out to a group, which can differ from the seller's own UI:
// a Chinese seller posting in an English Telegram group writes Chinese and shares English.
function shareLang(target) {
  if (target === 'facebook') return store.get('shareLangFb', 'en');
  return target === 'telegram' ? store.get('shareLangTg', 'en') : store.get('shareLangWx', LANG);
}

// The link in a Facebook listing: src=fb makes the preview English and the page offer a Facebook
// contact first; cl=zh keeps the preview Chinese.
function fbLink(url, lang) {
  return `${url}?src=fb${lang === 'zh' ? '&cl=zh' : ''}`;
}

// The link a Telegram group gets: src=tg makes the preview English, large and the page default to
// Telegram contacts; cl=zh keeps the preview Chinese for a Chinese group. v makes each share a new
// address: Telegram caches a link's preview, and an old one would show old counts and picture.
function tgLink(url, lang, v = '') {
  return `${url}?src=tg${lang === 'zh' ? '&cl=zh' : ''}${v ? `&v=${v}` : ''}`;
}

// Posting to an app the seller left no contact for: asked for before any way to post shows, so a
// buyer from that group who can't find the seller there still has a way to reach them.
function contactGateHtml(sale, target) {
  const tg = target === 'telegram';
  const fb = target === 'facebook';
  if (fb ? sale.hasFacebook : tg ? sale.hasTelegram : sale.hasWechat) return '';
  return `<div class="share-nudge">
      <div class="small">${fb
        ? tr('发到 Facebook 群之前，先填你的 Facebook 主页链接（Facebook 里点进自己的主页 → ··· →「复制主页链接」），不然从别处看到清单的买家没法私信你。', "Before posting to Facebook groups, add your Facebook profile link (open your profile → ··· → Copy profile link), so buyers who find the list elsewhere can still DM you.")
        : tg
        ? tr('发到 Telegram 群之前，先填你的 Telegram 用户名，不然在群里找不到你的买家没法联系你。', "Before posting to Telegram groups, add your Telegram username, so buyers who can't find you in the group can still reach you.")
        : tr('发到微信群之前，先填你的微信号，不然在群里找不到你的买家没法加你。', "Before posting to WeChat groups, add your WeChat ID, so buyers who can't find you in the group can still add you.")}</div>
      <div class="share-nudge-row"><input class="inp boxed grow" name="nudge" placeholder="${fb ? 'https://www.facebook.com/…' : tg ? '@username' : tr('你的微信号', 'Your WeChat ID')}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn small primary" data-act="nudgesave">${tr('保存', 'Save')}</button></div>
    </div>`;
}

function shareSheet(S) {
  const { sale } = S.data();
  const here = isCardHere(publicUrl(S));
  let target = shareTarget();
  const sh = openSheet(() => {
    const seg = `<div class="seg share-target">${[['wechat', tr('微信群', 'WeChat')], ['telegram', 'Telegram'], ['facebook', 'Facebook']]
      .map(([k, l]) => `<button class="${target === k ? 'on' : ''}" data-act="target" data-t="${k}">${l}</button>`).join('')}</div>`;
    const gate = contactGateHtml(sale, target);
    if (gate) return `<h2>${tr('分享到群', 'Share to groups')}</h2>${seg}${gate}`;
    const multi = `<div class="small muted" style="margin:10px 4px 0">${tr('可以发到好几个群（微信、Telegram、Facebook 都行）：大家排的是同一个队，先到先得，不会撞单。', 'Post it to as many groups as you like, WeChat, Telegram and Facebook alike: everyone joins the same line, first come first served, no double-selling.')}</div>`;
    if (target === 'facebook') {
      return `<h2>${tr('分享到群', 'Share to groups')}</h2>${seg}
      <div class="share-step">
        <button class="btn primary big block" data-act="fbpost">${tr('准备 Facebook 帖子', 'Make the Facebook post')}</button>
        <div class="small muted step-why">${tr('在群里点 Sell something 发一条：几张图、标题、价格和描述都准备好了，复制粘贴就行。帖子里写明了：想要的点链接排队，有问题直接私信你。', 'One Sell something post in the group: the pictures, title, price and description are ready to copy in. The post tells buyers to reserve at the link, or just DM you with questions.')}</div>
      </div>
      ${multi}`;
    }
    if (target === 'telegram') {
      return `<h2>${tr('分享到群', 'Share to groups')}</h2>${seg}
      <div class="share-step">
        <button class="btn primary big block" data-act="post">${tr('发长图（推荐）', 'Post the long picture (recommended)')}</button>
        <div class="small muted step-why">${tr('一条消息就够：一张长图，照片、每件的价格和二维码都在上面；下面配两三行字和预订链接。', 'One message does it: a long picture with the photos, every price and a QR code, and two or three lines with the link under it.')}</div>
        <button class="btn big block" data-act="tgtext">${tr('只发文字和链接', 'Text and link only')}</button>
        <div class="small muted step-why">${tr('一条消息：开头一句、链接、物品清单，Telegram 会显示带图的预览。', 'One message with a line, the link and the item list; Telegram shows a preview with a picture.')}</div>
      </div>
      ${multi}`;
    }
    return `<h2>${tr('分享到群', 'Share to groups')}</h2>${seg}
    <div class="share-step">
      <div class="small muted">${tr('两种发法，点一个就行', 'Two ways, one is enough')}</div>
      <button class="btn primary big block" data-act="card">${tr('发卡片', 'Send the card')}</button>
      <div class="small muted step-why">${tr('群友点卡片就能看照片、预订。要先扫一次二维码，在打开的页面里转发。', 'People tap the card to see photos and reserve. You scan a QR code once and forward the page it opens.')}</div>
      <div class="share-or"><b>${tr('或者', 'or')}</b></div>
      <button class="btn primary big block" data-act="post">${tr('发长图', 'Send the long picture')}</button>
      <div class="small muted step-why">${tr('一张图：照片、每件的价格和二维码。群友长按识别二维码就能打开预订，不用扫码转卡片。', 'One picture with the photos, every price and a QR code. People long-press the QR code to open the list and reserve.')}</div>
    </div>
    <div class="actions" style="margin-top:4px">
      <button class="link-btn small" data-act="image" style="margin:4px auto 0">${tr('东西很多？发整份清单图（每件一张照片）', 'Lots of items? Post the full list picture (a photo for each)')}</button>
    </div>
    ${multi}
    <div class="share-help">
      <div class="survey-title">${tr('怎么分享图文卡片出去？', 'How do I send a card in WeChat?')}</div>
      <div class="group"><div class="cell small" style="display:block;line-height:1.9">
        ${here ? tr(`这个页面转发出去就是卡片，可以直接转发：<br>
        点右上角 <b>···</b> →「发送给朋友」→ 选群，发出去就是卡片`, `This page already forwards as a card:<br>
        tap <b>···</b> at the top right → Send to Chat → pick the group`) : tr(`
        1. 点上面的「发卡片」，会出现一个二维码<br>
        2. ${isWeChat ? '<b>长按二维码</b> →「识别图中二维码」' : '保存二维码图片，发到微信「文件传输助手」，在微信里<b>长按这张图</b> →「识别图中二维码」'}<br>
        3. 页面打开后，按箭头点右上角 <b>···</b> →「发送给朋友」→ 选群，发出去就是卡片`, `
        1. Tap "Send the card" above; a QR code appears<br>
        2. ${isWeChat ? '<b>Long-press the QR code</b> → Scan QR Code in Image' : 'Save the QR picture and send it to WeChat File Transfer; in WeChat, <b>long-press it</b> → Scan QR Code in Image'}<br>
        3. On the page that opens, follow the arrow to <b>···</b> at the top right → Send to Chat → pick the group: it goes as a card`)}
      </div></div>
      ${here ? '' : `<div class="small muted" style="margin:0 4px">${tr('别直接点链接打开再转发，那样微信只会发出一串网址。群里有了卡片以后，别人从卡片点进去再转发，也是卡片。', "Don't open the link directly and forward it: WeChat would only send a bare URL. Once a card is in a group, anyone opening it can forward it as a card too.")}</div>`}
    </div>`;
  }, async (act, el, s) => {
    if (act === 'target') {
      target = el.dataset.t;
      store.set('shareTarget', target);
      return s.refresh();
    }
    if (act === 'nudgesave') {
      const v = s.el.querySelector('[name=nudge]').value.trim();
      const tg = target === 'telegram';
      const fb = target === 'facebook';
      const bad = fb ? contactError({ facebook: v }) : tg ? contactError({ telegram: v }) : contactError({ wechatId: v });
      if (!v || bad) return toast(!v ? tr('先填一下', 'Fill it in first') : bad, 2600);
      el.disabled = true;
      try {
        await api(`/sale/${S.saleId}`, { method: 'PATCH', key: S.key, body: fb ? { facebook: v } : tg ? { telegram: v } : { wechatId: v } });
        if (fb) store.set('sellerFacebook', fbProfileUrl(v));
        else if (tg) store.set('sellerTelegram', normTelegram(v));
        else store.set('sellerWechat', v);
        sale[fb ? 'hasFacebook' : tg ? 'hasTelegram' : 'hasWechat'] = true;
        toast(tr('已保存', 'Saved'));
        s.refresh();
        S.reload?.();
      } catch (err) {
        toast(err.message);
        el.disabled = false;
      }
      return;
    }
    if (act === 'tgtext') {
      s.close();
      return textSheet(S, target);
    }
    if (act === 'fbpost') {
      s.close();
      return fbSheet(S);
    }
    if (act === 'post') {
      s.close();
      return postSheet(S, target);
    }
    if (act === 'image') {
      s.close();
      return saveSaleImage(S, shareLang(target));
    }
    if (act === 'card') {
      s.close();
      const stop = loading(tr('正在生成卡片图…', 'Making the card picture…'));
      try {
        await uploadCover(S, shareLang('wechat'));
      } catch {
        // The card still works with the first item photo as fallback.
      } finally {
        stop();
      }
      return sendCard(publicUrl(S), sale.title);
    }
  });
  return sh;
}

// The list with its open items in lang: names not yet translated (an older list, a just-added item)
// are translated first, so what goes out has no leftovers in the other language. d: the data so far.
function untranslated(d, lang) {
  return (textLang(d.sale.title) !== lang && !d.sale.alt)
    || d.items.some((i) => (i.status === 'available' || i.status === 'reserved') && textLang(i.name) !== lang && !i.nameAlt);
}

async function translatedData(S, lang, d = S.data()) {
  if (!untranslated(d, lang)) return d;
  const stop = loading(tr('正在翻译物品名…', 'Translating item names…'));
  try {
    await api(`/sale/${S.saleId}/translate`, { method: 'POST', key: S.key, body: {} });
    return await api(`/sale/${S.saleId}/manage`, { key: S.key });
  } catch {
    // Untranslated names stay in their original language.
    return d;
  } finally {
    stop();
  }
}

// Editable group text. The opening line is the seller's own (remembered per list, app and language);
// the item list below the list mark is regenerated every time so it is never stale.
// For Telegram the link goes right under the opening line, and the card picture is refreshed in the
// background so the preview shows what is for sale now.
async function textSheet(S, target = 'wechat') {
  let { sale, items } = S.data();
  const tg = target === 'telegram';
  let lang = shareLang(target);
  const optsKey = tg ? 'shareTextOptsTg' : 'shareTextOpts';
  const opts = { prices: tg, compact: false, ...store.get(optsKey, {}) };
  const introKey = () => (!tg && lang === 'zh' ? S.saleId : `${S.saleId}:${target}:${lang}`);
  const ver = Date.now().toString(36).slice(-5);
  const link = () => (tg ? tgLink(publicUrl(S), lang, ver) : '');
  const ensure = async () => ({ sale, items } = await translatedData(S, lang, { sale, items }));
  await ensure();
  const def = () => defaultIntro(sale, { lang, target });
  const build = (intro) => shareText(sale, items, { ...opts, lang, target, link: link(), intro: intro || def() });
  const introOf = (t) => stripLinks(t.split(listMark(lang))[0]).trim();
  const canShare = !isWeChat && !isTelegram && !!navigator.share;
  if (tg) uploadCover(S, lang, true).catch(() => {});
  const remember = (t) => {
    const intro = introOf(t);
    const all = store.get('shareIntro', {});
    if (intro && intro !== def()) all[introKey()] = intro;
    else delete all[introKey()];
    store.set('shareIntro', all);
  };
  const text = () => build(stripLinks(store.get('shareIntro', {})[introKey()]));
  const sh = openSheet(() => `<h2>${tg ? tr('Telegram 群文字', 'Telegram post') : tr('群文字', 'Group text')}</h2>
    <div class="seg small share-lang">${[['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button class="${lang === k ? 'on' : ''}" data-act="lang" data-l="${k}">${l}</button>`).join('')}</div>
    <div class="hint" style="padding-top:0">${tr(`开头那段可以随便改，下次会记住；${esc(listMark(lang))}下面每次按最新状态重新生成。`, `Rewrite the opening as you like, it is remembered; everything under ${esc(listMark(lang))} is rebuilt from the latest list.`)}${lang !== textLang(sale.title) ? tr('物品名用的是自动翻译，不对的话在物品里改。', ' Item names are auto-translated; fix any in the item itself.') : ''}</div>
    <textarea class="inp boxed share-text" rows="12">${esc(text())}</textarea>
    <div class="share-opts">
      <label class="nearby-row"><input type="checkbox" data-act="prices" ${opts.prices ? 'checked' : ''}><span>${tr('带价格', 'With prices')}</span></label>
      <label class="nearby-row"><input type="checkbox" data-act="compact" ${opts.compact ? 'checked' : ''}><span>${tr('紧凑（用 · 隔开，不换行）', 'Compact (one line, separated by ·)')}</span></label>
    </div>
    <div class="actions" style="margin-top:12px">
      ${tg ? `<button class="btn primary block" data-act="tgsend">${tr('在 Telegram 里选群发送', 'Pick a Telegram group and send')}</button>
      <button class="btn block" data-act="copy">${tr('复制，去群里粘贴', 'Copy, then paste in the group')}</button>`
        : `<button class="btn primary block" data-act="copy">${tr('复制，去群里粘贴', 'Copy, then paste in the group')}</button>`}
      ${canShare && !tg ? `<button class="btn block" data-act="share">${tr('分享到微信', 'Share…')}</button>` : ''}
      <button class="link-btn small" data-act="reset" style="margin:4px auto 0">${tr('恢复默认开头', 'Reset the opening')}</button>
    </div>
    ${tg ? `<div class="small muted" style="margin:8px 4px 0">${tr('Telegram 的预览图是发送那一刻的样子；卖掉的东西在页面上会实时更新。', 'The Telegram preview shows the list as it was when sent; the page itself is always live.')}</div>` : ''}`,
  async (act, el, s) => {
    const box = s.el.querySelector('.share-text');
    const t = box.value;
    if (act === 'lang') {
      remember(t);
      lang = el.dataset.l;
      store.set(tg ? 'shareLangTg' : 'shareLangWx', lang);
      await ensure();
      if (tg) uploadCover(S, lang, true).catch(() => {});
      return s.refresh();
    }
    if (act === 'prices' || act === 'compact') {
      opts[act] = el.checked;
      store.set(optsKey, opts);
      box.value = build(introOf(t));
    }
    if (act === 'copy') {
      remember(t);
      copy(t, tr('已复制，去群里粘贴', 'Copied, paste it in the group'));
    }
    if (act === 'tgsend') {
      remember(t);
      // Telegram's share page puts the link first and the text under it, so the text goes without it.
      location.href = tgShareUrl(link(), t.replace(link(), '').replace(/\n{3,}/g, '\n\n').trim());
    }
    if (act === 'share') {
      remember(t);
      try {
        await navigator.share({ text: t });
      } catch {}
    }
    if (act === 'reset') {
      const all = store.get('shareIntro', {});
      delete all[introKey()];
      store.set('shareIntro', all);
      box.value = build('');
    }
  });
  return sh;
}

// One item: a WeChat card (QR code first), or its link for Telegram.
function shareItem(S, it) {
  const url = `${publicUrl(S)}/i/${it.no}`;
  if (isWeChat) return sendCard(url, it.name);
  const lang = shareLang('telegram');
  const t = itemText(it, lang);
  openSheet(() => `<h2>${tr('发这件', 'Share this item')}</h2>
    <div class="actions">
      <a class="btn primary block" href="${esc(tgShareUrl(tgLink(url, lang), `${t.name} ${moneyIn(it.priceCents, S.data().sale.currency, lang)}`))}">${tr('发到 Telegram', 'Send to Telegram')}</a>
      <button class="btn block" data-act="wechat">${tr('发微信卡片', 'Send a WeChat card')}</button>
    </div>`, (act, el, s) => {
    if (act !== 'wechat') return;
    s.close();
    sendCard(url, it.name);
  });
}

// WeChat forwards a page opened from a chat link as a bare URL, but a page opened by scanning
// a QR code as a card. So every card starts from a QR code; once one card is in the group,
// anyone who opens it and forwards it sends a card too.
async function sendCard(url, what) {
  if (isCardHere(url)) {
    return openSheet(() => `<h2>${tr('发卡片', 'Send the card')}</h2>
      <div class="group"><div class="cell small" style="display:block;line-height:1.9">
        ${tr('这个页面转发出去就是卡片，不用再扫码：<br>点右上角 <b>···</b> →「发送给朋友」→ 选群，发出去就是卡片', 'This page forwards as a card, no QR code needed:<br>tap <b>···</b> at the top right → Send to Chat → pick the group')}
      </div></div>
      <div class="actions">
        <button class="btn block" data-act="close">${tr('好了', 'Done')}</button>
        <button class="link-btn small" data-act="not-card" style="margin:4px auto 0">${tr('发出去只是一串网址？改用二维码', 'Only a bare link got sent? Use the QR code')}</button>
      </div>`, (act, el, s) => {
      if (act === 'close') s.close();
      if (act === 'not-card') {
        setCardSession(false);
        s.close();
        sendCard(url, what);
      }
    });
  }
  const stop = loading(tr('正在生成二维码…', 'Making the QR code…'));
  let src;
  try {
    const qrUrl = new URL(url);
    qrUrl.searchParams.set('c', '1');
    qrUrl.searchParams.set('fw', '1');
    src = await qrImage(qrUrl.href);
  } finally {
    stop();
  }
  if (!src) return toast(tr('二维码没生成出来，检查网络再试', "The QR code didn't load; check your connection and try again"));
  openSheet(() => `<h2>${tr('发卡片', 'Send the card')}</h2>
    <div class="qr-card"><img src="${src}" alt="${esc(what)} QR"><div class="small muted">${esc(what)}</div></div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">
      ${isWeChat
        ? tr(`1. <b>长按上面的二维码</b> →「识别图中二维码」<br>2. 打开后点右上角 <b>···</b> →「发送给朋友」→ 选群`, `1. <b>Long-press the QR code</b> → Scan QR Code in Image<br>2. On the page that opens, tap <b>···</b> → Send to Chat → pick the group`)
        : tr(`1. 长按二维码保存图片（或截图），发到微信「文件传输助手」<br>2. 在微信里长按这张图 →「识别图中二维码」<br>3. 打开后点右上角 <b>···</b> →「发送给朋友」→ 选群`, `1. Save the QR picture (or screenshot it) and send it to WeChat File Transfer<br>2. In WeChat, long-press it → Scan QR Code in Image<br>3. On the page that opens, tap <b>···</b> → Send to Chat → pick the group`)}
    </div></div>
    <div class="hint" style="padding-top:0">${tr('要从二维码打开再转发：直接点链接打开的页面，微信只会转发成一串网址。群里有了卡片，别人从卡片点进去再转发，也都是卡片。', 'Open it from the QR code before forwarding: a page opened from a plain link forwards as a bare URL in WeChat. Once a card is in a group, anyone opening it forwards a card too.')}</div>
    <div class="actions">
      ${isWeChat ? '' : `<a class="btn block" download="qr.png" href="${src}">${tr('下载二维码图片', 'Download the QR picture')}</a>`}
      <button class="btn block" data-act="close">${tr('好了', 'Done')}</button>
      ${isWeChat && new URL(url).pathname === location.pathname ? `<button class="link-btn small" data-act="is-card" style="margin:4px auto 0">${tr('这页转发出去已经是卡片了？不用扫码', 'This page already forwards as a card? Skip the QR code')}</button>` : ''}
    </div>`, (act, el, s) => {
    if (act === 'close') s.close();
    if (act === 'is-card') {
      setCardSession(true);
      s.close();
      sendCard(url, what);
    }
  });
}

// A plain QR code image (PNG data URL) with a white quiet zone; null if the QR library can't load.
async function qrImage(text) {
  const qr = await qrMatrix(text);
  if (!qr) return null;
  const m = Math.ceil(480 / qr.n);
  const pad = m * 4;
  const size = qr.n * m + pad * 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#111';
  for (let r = 0; r < qr.n; r++) for (let col = 0; col < qr.n; col++) if (qr.dark(r, col)) g.fillRect(pad + col * m, pad + r * m, m, m);
  return c.toDataURL('image/png');
}

// ---------- canvas drawing ----------

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function drawCover(g, im, x, y, w, h) {
  const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const BLUE = '#0058a3';
const YELLOW = '#ffdb00';

function drawBadge(g, text, x, y, size) {
  g.font = `800 ${size}px ${FONT}`;
  const w = Math.max(size * 1.3, g.measureText(text).width + size * 0.7);
  const h = size * 1.4;
  g.fillStyle = BLUE;
  g.fillRect(x, y, w, h);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2 + 1);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}

// Yellow price label anchored at its bottom-right corner (rx, by).
function drawPriceTag(g, text, rx, by, size) {
  g.font = `900 ${size}px ${FONT}`;
  const w = g.measureText(text).width + size * 0.6;
  const h = size * 1.3;
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(rx - w + 3, by - h + 3, w, h);
  g.fillStyle = YELLOW;
  g.fillRect(rx - w, by - h, w, h);
  g.fillStyle = '#111';
  g.textBaseline = 'middle';
  g.fillText(text, rx - w + size * 0.3, by - h / 2 + 1);
  g.textBaseline = 'alphabetic';
}

// Original price in small grey type with a line through it; left out when it would overflow maxX.
function drawStruck(g, text, x, cy, maxX) {
  g.font = `400 24px ${FONT}`;
  const w = g.measureText(text).width;
  if (x + w > maxX) return;
  g.fillStyle = '#888';
  g.textBaseline = 'middle';
  g.fillText(text, x, cy);
  g.textBaseline = 'alphabetic';
  g.fillRect(x - 1, cy - 1, w + 2, 2);
}

// sub: a smaller second line, e.g. "可排候补" under "已预订" so a reserved item doesn't read as gone.
function drawStamp(g, text, cx, cy, size, color, sub = '') {
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.24);
  const subSize = Math.max(18, Math.round(size * 0.55));
  g.font = `700 ${subSize}px ${FONT}`;
  const subW = sub ? g.measureText(sub).width : 0;
  g.font = `800 ${size}px ${FONT}`;
  const w = Math.max(g.measureText(text).width, subW) + size;
  const h = size * 1.5 + (sub ? subSize * 1.2 : 0);
  g.fillStyle = YELLOW;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.lineWidth = size / 10;
  g.strokeStyle = color;
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (!sub) g.fillText(text, 0, 2);
  else {
    g.fillText(text, 0, -subSize * 0.55);
    g.font = `700 ${subSize}px ${FONT}`;
    g.fillText(sub, 0, size * 0.55 + 2);
  }
  g.restore();
}

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  const chars = [...text];
  while (chars.length && g.measureText(chars.join('') + '…').width > maxW) chars.pop();
  return chars.join('') + '…';
}

// Sets the largest font up to `size` (down to 60% of it) in which the text fits, so a whole
// sentence shows instead of being cut; still too long, it is cut.
function fitFont(g, text, maxW, size, weight) {
  let px = size;
  g.font = `${weight} ${px}px ${FONT}`;
  while (px > size * 0.6 && g.measureText(text).width > maxW) {
    px -= 2;
    g.font = `${weight} ${px}px ${FONT}`;
  }
  return fitText(g, text, maxW);
}

async function loadAll(ids) {
  return Promise.all(ids.map((id) => loadImage(img(id)).catch(() => null)));
}

// 9.1: square 2×2 grid of the first 4 available items — WeChat crops card thumbnails to a square.
// wide: the 1200×630 card for Telegram, where a landscape picture shows large under the message;
// up to four photos side by side. Otherwise the square WeChat card, a 2×2 grid.
async function uploadCover(S, lang = LANG, wide = false) {
  const { sale, items } = S.data();
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const pick = openItems(items).slice(0, 4);
  if (!pick.length) return;
  const W = wide ? 1200 : 600;
  const H = wide ? 630 : 600;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const ims = await loadAll(pick.map((i) => i.photos[0]));
  // Photos fill the area above a band carrying the live count and the product name.
  const band = wide ? 96 : 86;
  const ph = H - band;
  const n = pick.length;
  const cells = wide ? pick.map((_, k) => [(W / n) * k, 0, W / n, ph])
    : n === 1 ? [[0, 0, W, ph]]
    : n === 2 ? [[0, 0, W / 2, ph], [W / 2, 0, W / 2, ph]]
    : [[0, 0, W / 2, ph / 2], [W / 2, 0, W / 2, ph / 2], [0, ph / 2, W / 2, ph / 2], [W / 2, ph / 2, W / 2, ph / 2]];
  pick.forEach((it, k) => {
    if (!cells[k]) return;
    const [x, y, w, h] = cells[k];
    if (ims[k]) drawCover(g, ims[k], x + 2, y + 2, w - 4, h - 4);
    drawPriceTag(g, moneyIn(it.priceCents, sale.currency, lang), x + w - 12, y + h - 12, wide ? 36 : 30);
  });
  g.fillStyle = BLUE;
  g.fillRect(0, ph, W, band);
  g.fillStyle = YELLOW;
  g.font = `900 ${wide ? 46 : 40}px ${FONT}`;
  const avail = items.filter((i) => i.status === 'available').length;
  g.fillText(L(`在售 ${avail} 件`, `${avail} for sale`), wide ? 32 : 22, H - (wide ? 30 : 28));
  g.textAlign = 'right';
  g.fillStyle = '#fff';
  g.font = `700 ${wide ? 34 : lang === 'en' ? 26 : 32}px ${FONT}`;
  g.fillText(L('二手清单', 'Secondhand List'), W - (wide ? 32 : 22), H - (wide ? 34 : 30));
  g.textAlign = 'left';
  const blob = await canvasBlob(c, 0.85);
  const form = new FormData();
  form.append('full', blob, 'cover.jpg');
  await api(`/sale/${S.saleId}/cover${wide ? '?wide=1' : ''}`, { method: 'POST', key: S.key, form });
}

async function qrMatrix(text) {
  try {
    // Self-hosted: jsDelivr is unreliable from mainland China.
    const { default: qrcode } = await import('/vendor/qrcode-generator.mjs');
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    return { n, dark: (r, c) => qr.isDark(r, c) };
  } catch {
    return null;
  }
}

// 9.2: 1080px wide, 3 columns, available + reserved items, max 30 per image, QR at the bottom.
async function saveSaleImage(S, lang = LANG) {
  const stop = loading(tr('正在生成清单图…', 'Making the list picture…'));
  try {
    const { sale, items } = S.data();
    const list = openItems(items);
    if (!list.length) {
      toast(tr('还没有在售的东西', 'Nothing for sale yet'));
      return;
    }
    const url = shareTarget() === 'telegram' ? tgLink(publicUrl(S), lang) : publicUrl(S);
    const qr = await qrMatrix(url);
    const pages = [];
    for (let i = 0; i < list.length; i += 30) pages.push(list.slice(i, i + 30));
    const out = [];
    const counts = Object.fromEntries(['available', 'reserved', 'sold'].map((st) => [st, items.filter((i) => i.status === st).length]));
    for (let pi = 0; pi < pages.length; pi++) out.push(await drawSalePage(sale, pages[pi], qr, url, pi, pages.length, counts, lang));
    showImages(out);
  } finally {
    stop();
  }
}

async function drawSalePage(sale, list, qr, url, pi, pn, counts, lang = LANG) {
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const st = saleText(sale, lang);
  const W = 1080;
  const pad = 30;
  const gap = 15;
  const cell = (W - pad * 2 - gap * 2) / 3;
  const cap = 96;
  const headH = 290;
  const rows = Math.ceil(list.length / 3);
  const footH = 400;
  const H = headH + rows * (cell + cap + gap) + footH;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = BLUE;
  g.fillRect(0, 0, W, 14);
  g.fillStyle = YELLOW;
  g.fillRect(0, 14, W, 8);

  g.fillStyle = '#111';
  g.font = `800 56px ${FONT}`;
  g.fillText(fitText(g, st.title + (pn > 1 ? ` (${pi + 1}/${pn})` : ''), W - pad * 2), pad, 90);
  g.font = `400 34px ${FONT}`;
  g.fillStyle = '#484848';
  const until = sale.leaveDate ? L(` · ${dateText(sale.leaveDate, lang)}前出完`, ` · until ${dateText(sale.leaveDate, lang)}`) : '';
  g.fillText(fitText(g, '📍 ' + st.location + until, W - pad * 2), pad, 145);
  if (st.rules.length) {
    g.font = `400 28px ${FONT}`;
    g.fillStyle = '#888';
    g.fillText(fitText(g, st.rules.join(' · '), W - pad * 2), pad, 190);
  }
  // Status line + bar: blue = sold, yellow = reserved.
  const total = counts.available + counts.reserved + counts.sold;
  g.font = `800 32px ${FONT}`;
  g.fillStyle = '#111';
  g.fillText(L(`在售 ${counts.available} · 已预订 ${counts.reserved} · 已出 ${counts.sold}`, `${counts.available} for sale · ${counts.reserved} reserved · ${counts.sold} sold`), pad, 240);
  g.fillStyle = '#e6e6e6';
  g.fillRect(pad, 256, W - pad * 2, 16);
  g.fillStyle = YELLOW;
  g.fillRect(pad, 256, ((W - pad * 2) * (counts.sold + counts.reserved)) / total, 16);
  g.fillStyle = BLUE;
  g.fillRect(pad, 256, ((W - pad * 2) * counts.sold) / total, 16);

  const ims = await loadAll(list.map((i) => i.photos[0]));
  list.forEach((it, k) => {
    const x = pad + (k % 3) * (cell + gap);
    const y = headH + Math.floor(k / 3) * (cell + cap + gap);
    g.fillStyle = '#f5f5f5';
    g.fillRect(x, y, cell, cell);
    if (ims[k]) drawCover(g, ims[k], x, y, cell, cell);
    if (it.status === 'reserved') drawStamp(g, L('已预订', 'Reserved'), x + cell / 2, y + cell / 2, 40, '#111', L('可排候补', 'Waitlist open'));
    g.fillStyle = '#111';
    g.font = `800 30px ${FONT}`;
    g.fillText(fitText(g, itemText(it, lang).name, cell - 8), x + 2, y + cell + 40);
    const price = moneyIn(it.priceCents, sale.currency, lang);
    g.font = `900 30px ${FONT}`;
    const tagRight = x + 2 + g.measureText(price).width + 18;
    drawPriceTag(g, price, tagRight, y + cell + 90, 30);
    if (it.origPriceCents > it.priceCents) drawStruck(g, moneyIn(it.origPriceCents, sale.currency, lang), tagRight + 12, y + cell + 71, x + cell);
  });

  const fy = H - footH + 30;
  g.fillStyle = BLUE;
  g.fillRect(pad, fy, W - pad * 2, 240);
  g.fillStyle = '#fff';
  g.fillRect(pad + 20, fy + 10, 220, 220);
  const qs = 200;
  const qx = pad + 30;
  const qy = fy + 20;
  if (qr) {
    const m = qs / qr.n;
    g.fillStyle = '#111';
    for (let r = 0; r < qr.n; r++) for (let col = 0; col < qr.n; col++) if (qr.dark(r, col)) g.fillRect(qx + col * m, qy + r * m, Math.ceil(m), Math.ceil(m));
  }
  g.fillStyle = YELLOW;
  g.font = `800 40px ${FONT}`;
  g.fillText(qr ? L('长按识别 · 先到先得', 'Scan to reserve · first come') : L('打开链接排队', 'Open the link to reserve'), qx + qs + 36, qy + 80);
  g.font = `400 30px ${FONT}`;
  g.fillStyle = '#fff';
  g.fillText(fitText(g, L('页面实时更新，已预订的也能排候补', 'Live page: reserved items take a waitlist'), W - pad * 2 - qs - 100), qx + qs + 36, qy + 130);
  g.font = `400 24px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(fitText(g, url, W - pad * 2 - qs - 100), qx + qs + 36, qy + 175);

  // Brand strip: people who are not selling today still learn what made this.
  const by = fy + 240;
  g.fillStyle = YELLOW;
  g.fillRect(pad, by, W - pad * 2, 96);
  g.fillStyle = BLUE;
  g.fillRect(pad + 24, by + 22, 170, 52);
  g.fillStyle = YELLOW;
  g.font = `900 34px ${FONT}`;
  g.font = `900 ${lang === 'en' ? 22 : 34}px ${FONT}`;
  g.fillText(L('二手清单', 'Secondhand List'), pad + 40, by + (lang === 'en' ? 57 : 61));
  g.fillStyle = '#111';
  g.font = `700 31px ${FONT}`;
  g.fillText(fitText(g, L('搬家出闲置：拍照上架，群友自己排队', 'Moving out? Snap, list, buyers line up'), W - pad * 2 - 230), pad + 220, by + 60);
  return c.toDataURL('image/jpeg', 0.86);
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// name: the download file name; 清单图 for list pictures.
function showImages(urls, name = tr('清单图', 'list')) {
  const el = document.createElement('div');
  el.className = 'imgview';
  el.innerHTML = `
    <div class="tip">${isWeChat ? tr('长按图片 → 保存图片', 'Long-press the picture → Save') : tr('长按图片保存到相册（电脑上点下面的按钮下载）', 'Long-press to save to your photos (on a computer, use the download button)')}</div>
    ${urls.map((u, i) => `<img src="${u}" alt="${tr('清单图', 'List picture')} ${i + 1}"><div class="center" style="margin:-6px 0 18px"><a class="btn small" download="${name}-${i + 1}.jpg" href="${u}">${tr(`下载第 ${i + 1} 张`, `Download picture ${i + 1}`)}</a></div>`).join('')}
    <div class="bottom-bar" style="background:#111;border-top-color:#333"><div class="inner"><button class="btn big">${tr('关闭', 'Close')}</button></div></div>`;
  el.querySelector('.bottom-bar button').onclick = () => el.remove();
  document.body.appendChild(el);
}

// ---------- The long picture: photos, every price and a QR code in one picture ----------
// Telegram posts it with a short caption carrying the link; WeChat groups get it on its own, and
// long-pressing the QR code there opens the list (as a page that forwards as a card).

// Telegram's caption limit.
const CAPTION_MAX = 1024;
const POST_W = 1080;

// The post text: the intro and the link, then as many items as fit in a caption ("…and N more"),
// or no items at all when the seller leaves the list out.
function postCaption(sale, items, { withItems, ...opts }) {
  if (!withItems) return [opts.intro ?? defaultIntro(sale, opts), opts.link].filter(Boolean).join('\n').slice(0, CAPTION_MAX);
  for (let n = 30; n >= 0; n--) {
    const t = shareText(sale, items, { ...opts, maxListed: n });
    if (t.length <= CAPTION_MAX) return t;
  }
  return shareText(sale, items, { ...opts, maxListed: 0 }).slice(0, CAPTION_MAX);
}

// Mosaics on a 6×5 grid: [column, row, width, height] in grid units, larger tiles first. Many
// small photos of mixed sizes rather than a few big ones: enough to see what's there, small
// enough that people open the link for the real photos.
const MOSAICS = [
  [[0, 0, 6, 5]],
  [[0, 0, 3, 5], [3, 0, 3, 5]],
  [[0, 0, 4, 5], [4, 0, 2, 3], [4, 3, 2, 2]],
  [[0, 0, 4, 3], [4, 0, 2, 3], [0, 3, 3, 2], [3, 3, 3, 2]],
  [[0, 0, 4, 3], [0, 3, 3, 2], [3, 3, 3, 2], [4, 0, 2, 2], [4, 2, 2, 1]],
  [[0, 0, 3, 3], [3, 0, 2, 2], [0, 3, 2, 2], [2, 3, 2, 2], [4, 3, 2, 2], [3, 2, 3, 1], [5, 0, 1, 1], [5, 1, 1, 1]],
  [
    [0, 0, 2, 2], [4, 0, 2, 2], [2, 2, 2, 2], [0, 3, 2, 2], [4, 3, 2, 2], [2, 1, 2, 1],
    [2, 0, 1, 1], [3, 0, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [4, 2, 1, 1], [5, 2, 1, 1], [2, 4, 1, 1], [3, 4, 1, 1],
  ],
];

// The tiles for n items, in pixels: the largest mosaic with no more tiles than items. The last
// (a small one) becomes "+N" when items are left over.
function collageCells(n, y, w, h) {
  const m = [...MOSAICS].reverse().find((t) => t.length <= n) || MOSAICS[0];
  const uw = w / 6;
  const uh = h / 5;
  return m.map(([cx, cy, cw, ch]) => [cx * uw, y + cy * uh, cw * uw, ch * uh]);
}

// The picture, top to bottom: title and place, the photo mosaic with prices, every item by name
// and price in two columns, and a footer with the QR code (link) telling people to reserve there.
// Every item is listed, so nobody has to open the link just to see what's there; the height
// follows the number of items: about 1080×1600 for a few, 1080×2200 for twenty, 1080×3400 for sixty.
async function drawPoster(sale, items, lang, { link, target }) {
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const st = saleText(sale, lang);
  const list = openItems(items);
  const pad = 40;
  const head = 180;
  const mosaic = POST_W * (5 / 6); // square grid units
  const rowH = 62;
  const rows = Math.ceil(list.length / 2);
  const listH = 40 + rows * rowH + 24;
  const foot = 420;
  const H = head + mosaic + listH + foot;
  const qr = await qrMatrix(link);
  const c = document.createElement('canvas');
  c.width = POST_W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, POST_W, H);
  g.fillStyle = BLUE;
  g.fillRect(0, 0, POST_W, head);
  g.fillStyle = '#fff';
  g.fillText(fitFont(g, st.title, POST_W - pad * 2, 60, 800), pad, 88);
  g.fillStyle = YELLOW;
  const until = sale.leaveDate ? L(` · ${dateText(sale.leaveDate, lang)}前出完`, ` · until ${dateText(sale.leaveDate, lang)}`) : '';
  g.fillText(fitFont(g, `📍 ${st.location}${until}`, POST_W - pad * 2, 34, 700), pad, 146);

  const cells = collageCells(list.length, head, POST_W, mosaic);
  const extra = list.length - cells.length;
  // The dearest items get the larger tiles; a "+N" tile takes the last, smallest place.
  const shown = list.slice(0, extra > 0 ? cells.length - 1 : cells.length).sort((a, b) => b.priceCents - a.priceCents);
  const ims = await Promise.all(shown.map((it) => loadImage(img(it.photos[0], false)).catch(() => null)));
  cells.forEach(([x, y, w, h], k) => {
    const it = shown[k];
    const side = Math.min(w, h);
    g.fillStyle = '#f2f2f2';
    g.fillRect(x + 3, y + 3, w - 6, h - 6);
    if (!it) {
      g.fillStyle = BLUE;
      g.fillRect(x + 3, y + 3, w - 6, h - 6);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = `900 ${Math.round(side * 0.34)}px ${FONT}`;
      g.fillText(`+${extra + 1}`, x + w / 2, y + h / 2 + side * 0.06);
      g.font = `700 ${Math.round(side * 0.12)}px ${FONT}`;
      g.fillText(L('见下方', 'see below'), x + w / 2, y + h / 2 + side * 0.26);
      g.textAlign = 'left';
      return;
    }
    if (ims[k]) drawCover(g, ims[k], x + 3, y + 3, w - 6, h - 6);
    const tag = Math.max(26, Math.min(44, Math.round(side * 0.15)));
    if (it.status === 'reserved') drawStamp(g, L('已预订', 'Reserved'), x + w / 2, y + h / 2, tag, '#111', L('可排候补', 'Waitlist open'));
    drawPriceTag(g, moneyIn(it.priceCents, sale.currency, lang), x + w - 10, y + h - 10, tag);
  });

  // Names and prices, down the left column first; reserved items in grey, still priced, marked waitlist.
  const y0 = head + mosaic + 40;
  const gap = 48;
  const colW = (POST_W - pad * 2 - gap) / 2;
  list.forEach((it, k) => {
    const x = pad + (k < rows ? 0 : colW + gap);
    const y = y0 + (k % rows) * rowH;
    const reserved = it.status === 'reserved';
    const money = moneyIn(it.priceCents, sale.currency, lang);
    const price = reserved ? L(`可候补 ${money}`, `waitlist ${money}`) : money;
    g.font = `800 30px ${FONT}`;
    const pw = g.measureText(price).width;
    g.textAlign = 'right';
    g.fillStyle = reserved ? '#999' : '#111';
    g.fillText(price, x + colW, y + 40);
    g.textAlign = 'left';
    g.font = `400 30px ${FONT}`;
    g.fillStyle = reserved ? '#999' : '#111';
    g.fillText(fitText(g, itemText(it, lang).name, colW - pw - 20), x, y + 40);
    g.fillStyle = '#ececec';
    g.fillRect(x, y + rowH - 2, colW, 2);
  });

  const top = H - foot;
  g.fillStyle = YELLOW;
  g.fillRect(0, top, POST_W, foot);
  const qs = 300;
  let tx = pad;
  if (qr) {
    g.fillStyle = '#fff';
    g.fillRect(pad, top + 40, qs + 40, qs + 40);
    const m = qs / qr.n;
    g.fillStyle = '#111';
    for (let r = 0; r < qr.n; r++) for (let col = 0; col < qr.n; col++) if (qr.dark(r, col)) g.fillRect(pad + 20 + col * m, top + 60 + r * m, Math.ceil(m), Math.ceil(m));
    tx = pad + qs + 40 + 36;
  }
  const tw = POST_W - tx - pad;
  const n = items.filter((i) => i.status === 'available').length;
  g.fillStyle = '#111';
  g.fillText(fitFont(g, !qr ? L('点链接预订', 'Reserve at the link') : target === 'telegram' ? L('扫码或点链接', 'Scan or tap the link') : L('长按识别二维码', 'Long-press the QR code'), tw, 54, 900), tx, top + 112);
  g.fillText(fitFont(g, L('预订 · 先到先得', 'to reserve, first come'), tw, 54, 900), tx, top + 178);
  g.fillText(fitFont(g, L('回复不算占位，几个群排同一个队', "Replies don't hold a spot"), tw, 30, 700), tx, top + 240);
  g.fillText(fitFont(g, L(`在售 ${n} 件 · 页面实时更新`, `${n} for sale · the page is always live`), tw, 28, 400), tx, top + 286);
  g.fillStyle = BLUE;
  g.font = `800 30px ${FONT}`;
  g.textAlign = 'right';
  g.fillText(L('二手清单', 'Secondhand List'), POST_W - pad, H - 36);
  g.textAlign = 'left';
  return canvasBlob(c, 0.9);
}

// The post sheet: the long picture made on the phone, then for Telegram an editable caption and the
// system share sheet (picture and caption go together) or save + copy + post by hand; for WeChat,
// save the picture and send it to the group.
async function postSheet(S, target = 'telegram') {
  const tg = target === 'telegram';
  let lang = shareLang(target);
  let withItems = tg && store.get('tgPostItems', false);
  let d = await translatedData(S, lang);
  const ver = Date.now().toString(36).slice(-5);
  // WeChat: c=1 marks a page opened from our QR code, which forwards as a card.
  const link = () => (tg ? tgLink(publicUrl(S), lang, ver) : `${publicUrl(S)}?c=1`);
  let file = null;
  let url = '';
  let caption = '';
  const introKey = () => `${S.saleId}:telegram:${lang}`;
  const writeCaption = () => {
    if (!tg) return;
    const intro = stripLinks(store.get('shareIntro', {})[introKey()]) || defaultIntro(d.sale, { lang, target: 'telegram' });
    caption = postCaption(d.sale, d.items, { withItems, prices: true, lang, target: 'telegram', link: link(), intro });
  };
  const make = async () => {
    if (!openItems(d.items).length) {
      toast(tr('还没有在售的东西', 'Nothing for sale yet'));
      return false;
    }
    const stop = loading(tr('正在生成长图…', 'Making the picture…'));
    try {
      const blob = await drawPoster(d.sale, d.items, lang, { link: link(), target });
      file = new File([blob], `${tr('二手清单', 'secondhand-list')}.jpg`, { type: 'image/jpeg' });
      // A data: URL, not blob:, so long-pressing the preview saves or forwards it in WeChat too.
      url = await fileDataUrl(file);
      writeCaption();
      return true;
    } finally {
      stop();
    }
  };
  if (!(await make())) return;
  const canShareFile = () => {
    try {
      return !!navigator.canShare?.({ files: [file] });
    } catch {
      return false;
    }
  };
  const tgBody = () => `
    <label class="switch-row"><input type="checkbox" data-act="items" ${withItems ? 'checked' : ''}><span>${tr('配文也带物品清单和价格', 'Put the item list and prices in the caption too')}</span></label>
    <textarea class="inp boxed share-text" rows="${withItems ? 8 : 4}">${esc(caption)}</textarea>
    <div class="actions" style="margin-top:12px">
      ${canShareFile() ? `<button class="btn primary block" data-act="share">${tr('发到 Telegram（图和配文一起）', 'Send to Telegram (picture and caption)')}</button>` : ''}
      <button class="btn ${canShareFile() ? '' : 'primary'} block" data-act="save">${tr('保存图片', 'Save the picture')}</button>
      <button class="btn block" data-act="copy">${tr('复制配文', 'Copy the caption')}</button>
    </div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">${tr(
      `${canShareFile() ? '不能直接发的话：' : ''}1. 保存图片<br>2. 复制配文<br>3. 在 Telegram 群里点 📎，选这张图，粘贴配文，发送`,
      `${canShareFile() ? "If sending directly doesn't work: " : ''}1. Save the picture<br>2. Copy the caption<br>3. In the Telegram group, tap 📎, pick the picture, paste the caption, send`,
    )}</div></div>`;
  const wxBody = () => `
    <div class="actions">
      ${isWeChat ? '' : `<button class="btn primary block" data-act="save">${tr('保存图片', 'Save the picture')}</button>`}
      ${canShareFile() && !isWeChat ? `<button class="btn block" data-act="share">${tr('分享图片到微信', 'Share the picture…')}</button>` : ''}
    </div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">${isWeChat
      ? tr('1. <b>长按上面的图</b> →「发送给朋友」→ 选群（或者「保存图片」，再到群里发）<br>2. 群友长按图里的二维码 →「识别图中二维码」，就打开了预订页', '1. <b>Long-press the picture above</b> → Send to Chat → pick the group (or Save, then post it in the group)<br>2. People long-press the QR code in it → Scan QR Code in Image to open the list')
      : tr('1. 长按上面的图保存，或点「保存图片」<br>2. 在微信群里点 ＋ →「相册」，选这张图发送<br>3. 群友长按图里的二维码 →「识别图中二维码」，就打开了预订页', '1. Long-press the picture above to save it, or tap "Save the picture"<br>2. In the WeChat group, tap ＋ → Album and send it<br>3. People long-press the QR code in it → Scan QR Code in Image to open the list')}</div></div>
    ${isWeChat ? `<button class="link-btn small" data-act="save" style="margin:8px auto 0">${tr('长按没反应？打开大图', "Long-press does nothing? Open it full size")}</button>` : ''}`;
  const sh = openSheet(() => `<h2>${tg ? tr('发到 Telegram 群', 'Post to a Telegram group') : tr('发长图到微信群', 'Post the picture to a WeChat group')}</h2>
    <div class="seg small share-lang">${[['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button class="${lang === k ? 'on' : ''}" data-act="lang" data-l="${k}">${l}</button>`).join('')}</div>
    <img class="post-preview" src="${url}" alt="${tr('要发的图', 'The picture to post')}">
    ${tg ? tgBody() : wxBody()}`, async (act, el, s) => {
    const t = s.el.querySelector('.share-text')?.value ?? caption;
    const remember = () => {
      if (!tg) return;
      const intro = stripLinks(t.split(listMark(lang))[0]).trim();
      const all = store.get('shareIntro', {});
      if (intro && intro !== defaultIntro(d.sale, { lang, target: 'telegram' })) all[introKey()] = intro;
      else delete all[introKey()];
      store.set('shareIntro', all);
    };
    if (act === 'items') {
      remember();
      withItems = el.checked;
      store.set('tgPostItems', withItems);
      writeCaption();
      return s.refresh();
    }
    if (act === 'lang') {
      remember();
      lang = el.dataset.l;
      store.set(tg ? 'shareLangTg' : 'shareLangWx', lang);
      d = await translatedData(S, lang, d);
      if (await make()) s.refresh();
    }
    if (act === 'share') {
      remember();
      // Copied as well, for apps that drop the text when given a picture.
      if (tg) navigator.clipboard?.writeText(t).catch(() => {});
      try {
        await navigator.share(tg ? { files: [file], text: t } : { files: [file] });
      } catch {}
    }
    if (act === 'copy') {
      remember();
      copy(t, tr('已复制，发图时粘贴', 'Copied, paste it as the caption'));
    }
    if (act === 'save') showImages([url], tr('二手清单', 'secondhand-list'));
  });
  return sh;
}

// ---------- Facebook groups: one Sell something listing ----------
// Facebook's form takes one title, one price, a description and several photos, and the post shows
// the first few photos as a grid. So instead of one long picture: square pictures, an overview first
// (what's for sale, how to reserve, DM for questions), then the items, each with its price on it.

const FB_SIDE = 1080;
// Facebook listings take about ten photos; past nine items, four go on each picture.
const FB_MAX_PICS = 10;

async function drawFbSet(sale, items, lang) {
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const list = openItems(items);
  const per = list.length <= FB_MAX_PICS - 1 ? 1 : 4;
  const pages = [];
  for (let k = 0; k < list.length && pages.length < FB_MAX_PICS - 1; k += per) pages.push(list.slice(k, k + per));
  const left = list.length - pages.flat().length;
  const ims = await Promise.all(list.map((it) => (it.photos?.[0] ? loadImage(img(it.photos[0], false)).catch(() => null) : null)));
  const imOf = new Map(list.map((it, k) => [it, ims[k]]));
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = FB_SIDE;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, FB_SIDE, FB_SIDE);
    return [c, g];
  };
  // One item in a square: photo, name on a dark band, price tag above it, a stamp when reserved.
  const tile = (g, it, x, y, s) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(x, y, s, s);
    const im = imOf.get(it);
    if (im) drawCover(g, im, x, y, s, s);
    const band = Math.round(s * 0.14);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x, y + s - band, s, band);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(fitFont(g, itemText(it, lang).name, s - band * 0.6, Math.round(band * 0.46), 700), x + band * 0.3, y + s - band / 2 + 1);
    g.textBaseline = 'alphabetic';
    const tag = Math.round(s * 0.065);
    if (it.status === 'reserved') drawStamp(g, L('已预订', 'Reserved'), x + s / 2, y + s * 0.42, tag, '#111', L('可排候补', 'Waitlist open'));
    drawPriceTag(g, moneyIn(it.priceCents, sale.currency, lang), x + s - 14, y + s - band - 14, tag);
  };

  // The overview: title and place, a mosaic of what's there, and how to reserve.
  const st = saleText(sale, lang);
  const [c0, g0] = canvas();
  const head = 190;
  const foot = 250;
  g0.fillStyle = BLUE;
  g0.fillRect(0, 0, FB_SIDE, head);
  g0.fillStyle = '#fff';
  g0.fillText(fitFont(g0, st.title, FB_SIDE - 80, 62, 800), 40, 92);
  g0.fillStyle = YELLOW;
  const until = sale.leaveDate ? L(` · ${dateText(sale.leaveDate, lang)}前出完`, ` · until ${dateText(sale.leaveDate, lang)}`) : '';
  g0.fillText(fitFont(g0, `📍 ${st.location}${until}`, FB_SIDE - 80, 36, 700), 40, 150);
  const mosaicH = FB_SIDE - head - foot;
  const cells = collageCells(list.length, head, FB_SIDE, mosaicH);
  const shown = [...list].sort((a, b) => b.priceCents - a.priceCents).slice(0, cells.length);
  cells.forEach(([x, y, w, h], k) => {
    const it = shown[k];
    g0.fillStyle = '#f2f2f2';
    g0.fillRect(x + 3, y + 3, w - 6, h - 6);
    if (imOf.get(it)) drawCover(g0, imOf.get(it), x + 3, y + 3, w - 6, h - 6);
    const tag = Math.max(30, Math.min(44, Math.round(Math.min(w, h) * 0.16)));
    drawPriceTag(g0, moneyIn(it.priceCents, sale.currency, lang), x + w - 10, y + h - 10, tag);
  });
  const top = FB_SIDE - foot;
  g0.fillStyle = YELLOW;
  g0.fillRect(0, top, FB_SIDE, foot);
  g0.fillStyle = '#111';
  g0.fillText(fitFont(g0, L('点帖子里的链接排队 · 先到先得', 'Reserve at the link in the post'), FB_SIDE - 80, 52, 900), 40, top + 78);
  g0.fillText(fitFont(g0, L('有问题直接私信我', 'Questions? Just DM me'), FB_SIDE - 80, 40, 800), 40, top + 140);
  const n = list.filter((i) => i.status === 'available').length;
  g0.fillText(fitFont(g0, L(`在售 ${n} 件，价格都在图上${left > 0 ? `，还有 ${left} 件在链接里` : ''}`, `${n} for sale, prices on the pictures${left > 0 ? `, ${left} more at the link` : ''}`), FB_SIDE - 340, 28, 400), 40, top + 198);
  g0.fillStyle = BLUE;
  g0.font = `800 30px ${FONT}`;
  g0.textAlign = 'right';
  g0.fillText(L('二手清单', 'Secondhand List'), FB_SIDE - 40, top + 198);
  g0.textAlign = 'left';

  const out = [await canvasBlob(c0, 0.9)];
  for (const page of pages) {
    const [c, g] = canvas();
    if (per === 1) tile(g, page[0], 0, 0, FB_SIDE);
    else page.forEach((it, k) => tile(g, it, (k % 2) * (FB_SIDE / 2) + 3, Math.floor(k / 2) * (FB_SIDE / 2) + 3, FB_SIDE / 2 - 6));
    out.push(await canvasBlob(c, 0.88));
  }
  return out;
}

// The Facebook sheet: the pictures to save, then each field of the Sell something form ready to copy.
// Reserved items stay out of the pictures and the description unless the seller ticks them in
// (remembered): a Facebook post can't be edited live, and buyers there skip what looks taken.
async function fbSheet(S) {
  let lang = shareLang('facebook');
  let d = await translatedData(S, lang);
  let withReserved = store.get('fbWithReserved', false);
  let files = [];
  let urls = [];
  let f = null;
  const name = tr('二手清单', 'secondhand-list');
  const reservedCount = () => d.items.filter((i) => i.status === 'reserved').length;
  const make = async () => {
    if (!openItems(d.items).length) {
      toast(tr('还没有在售的东西', 'Nothing for sale yet'));
      return false;
    }
    // Everything left is reserved: post those rather than nothing.
    const onlyReserved = !d.items.some((i) => i.status === 'available');
    const items = withReserved || onlyReserved ? d.items : d.items.filter((i) => i.status !== 'reserved');
    const stop = loading(tr('正在生成图片…', 'Making the pictures…'));
    try {
      const blobs = await drawFbSet(d.sale, items, lang);
      files = blobs.map((b, k) => new File([b], `${name}-${k + 1}.jpg`, { type: 'image/jpeg' }));
      urls = await Promise.all(files.map(fileDataUrl));
      f = fbListing(d.sale, items, { lang, link: fbLink(publicUrl(S), lang) });
      // The link preview, should Facebook show one, uses the landscape card.
      uploadCover(S, lang, true).catch(() => {});
      return true;
    } finally {
      stop();
    }
  };
  if (!(await make())) return;
  const canShareFiles = () => {
    try {
      return !!navigator.canShare?.({ files });
    } catch {
      return false;
    }
  };
  const field = (k, label, v, help = '') => `<div class="cell fb-field"><div class="grow"><div class="small muted">${label}</div><div class="fb-v">${esc(v)}</div>${help ? `<div class="small muted">${help}</div>` : ''}</div><button class="btn small" data-act="copy" data-k="${k}">${tr('复制', 'Copy')}</button></div>`;
  const sh = openSheet(() => `<h2>${tr('发到 Facebook 群', 'Post to a Facebook group')}</h2>
    <div class="seg small share-lang">${[['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button class="${lang === k ? 'on' : ''}" data-act="lang" data-l="${k}">${l}</button>`).join('')}</div>
    ${reservedCount() && d.items.some((i) => i.status === 'available') ? `<div class="share-opts"><label class="nearby-row"><input type="checkbox" data-act="reserved" ${withReserved ? 'checked' : ''}><span>${tr(`带上已预订的 ${reservedCount()} 件（标成可排候补）`, `Include the ${reservedCount()} reserved (marked waitlist open)`)}</span></label></div>` : ''}
    <div class="fb-pics">${urls.map((u, k) => `<img src="${u}" alt="${tr(`第 ${k + 1} 张`, `Picture ${k + 1}`)}">`).join('')}</div>
    <div class="actions">
      <button class="btn primary block" data-act="save">${tr(`保存这 ${urls.length} 张图`, `Save the ${urls.length} pictures`)}</button>
      ${canShareFiles() ? `<button class="btn block" data-act="share">${tr('分享图片…', 'Share the pictures…')}</button>` : ''}
    </div>
    <div class="group" style="margin-top:12px">
      ${field('title', tr('标题（What are you selling?）', 'Title (What are you selling?)'), f.title)}
      ${field('price', tr('价格（Price）', 'Price'), f.price, tr('只能填一个价，这里是最便宜那件的；每件的价格在图上和描述里。', 'Only one price fits: this is the cheapest item; every price is on the pictures and in the description.'))}
      ${field('location', tr('地点（Location）', 'Location'), f.location, tr('Facebook 一般会自动填城市。', 'Facebook usually fills in your city.'))}
    </div>
    <div class="small muted" style="margin:12px 4px 4px">${tr('描述（Description），可以改', 'Description, edit as you like')}</div>
    <textarea class="inp boxed share-text" rows="10">${esc(f.description)}</textarea>
    <div class="actions" style="margin-top:8px"><button class="btn block" data-act="copy" data-k="description">${tr('复制描述', 'Copy the description')}</button></div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">${tr(
      '1. 保存上面的图<br>2. 在 Facebook 群里点 <b>Sell something</b>（卖东西）<br>3. <b>Add photos</b>，按顺序选这几张图<br>4. 标题、价格、描述一项项复制粘贴，点 <b>Post</b><br>买家可以点描述里的链接排队，也可以直接私信你；卖掉的东西在链接里实时更新。',
      '1. Save the pictures above<br>2. In the Facebook group, tap <b>Sell something</b><br>3. <b>Add photos</b> and pick these, in order<br>4. Copy the title, price and description in one by one, then <b>Post</b><br>Buyers can reserve at the link in the description, or just DM you; what you sell updates at the link.',
    )}</div></div>`, async (act, el, s) => {
    if (act === 'lang') {
      lang = el.dataset.l;
      store.set('shareLangFb', lang);
      d = await translatedData(S, lang, d);
      if (await make()) s.refresh();
    }
    if (act === 'reserved') {
      withReserved = el.checked;
      store.set('fbWithReserved', withReserved);
      if (await make()) s.refresh();
    }
    if (act === 'copy') {
      const k = el.dataset.k;
      const v = k === 'description' ? s.el.querySelector('.share-text').value : f[k];
      copy(v, tr('已复制，去 Facebook 粘贴', 'Copied, paste it in Facebook'));
    }
    if (act === 'save') showImages(urls, name);
    if (act === 'share') {
      navigator.clipboard?.writeText(s.el.querySelector('.share-text').value).catch(() => {});
      try {
        await navigator.share({ files });
      } catch {}
    }
  });
  return sh;
}

// ---------- AI photo recognition ----------

const SURVEY = tr([
  {
    key: 'slowest',
    q: '上一次出二手（搬家、毕业、回国），最花时间的是哪一步？',
    options: ['拍照、写介绍', '回复问价和「还在吗」', '记谁要了、谁先来', '约时间地点取货', '其他'],
  },
  {
    key: 'hours',
    q: '那次前后，大概花了多少时间在这些事上？',
    options: ['不到 1 小时', '1–3 小时', '3–10 小时', '10 小时以上', '记不清了'],
  },
  {
    // Decides the business model: small one-off payment vs ads vs free-only.
    key: 'pay',
    q: 'AI 识别每次都有成本。如果以后要分担一点，哪种你最能接受？',
    options: ['出一份清单付一次，1–2 块钱', '看一段 15 秒广告，换几次识别', '都不想要，我自己打字就行', '别的方式（写在下面）'],
  },
], [
  {
    key: 'slowest',
    q: 'Last time you sold your stuff (moving, graduating, leaving), which step took the most time?',
    options: ['Photos and descriptions', 'Answering "still available?" and price questions', 'Tracking who wants what, who was first', 'Arranging pick-up times', 'Something else'],
  },
  {
    key: 'hours',
    q: 'Roughly how much time did those things take, all in all?',
    options: ['Under 1 hour', '1–3 hours', '3–10 hours', 'Over 10 hours', "Can't remember"],
  },
  {
    key: 'pay',
    q: 'Every AI recognition costs money. If you chipped in later, which would you accept most?',
    options: ['Pay once per list, 1–2 euros', 'Watch a 15-second ad for a few tries', "Neither, I'll type", 'Something else (write below)'],
  },
]);

function inviteRowHtml() {
  return `<div class="group"><div class="cell"><input class="inp grow" name="invite" maxlength="20" placeholder="${tr('有邀请码？填在这里', 'Invite code?')}" autocapitalize="characters"><button class="btn small" data-act="invite">${tr('使用', 'Use')}</button></div></div>`;
}

async function useInvite(s, onDone) {
  const code = s.el.querySelector('[name=invite]')?.value.trim();
  if (!code) return toast(tr('填一下邀请码', 'Enter the code'));
  buyerToken(true);
  try {
    await api('/ai/invite', { method: 'POST', body: { code } });
    toast(tr('邀请码有效，AI 识别不限次数', 'Code accepted: unlimited AI naming'));
    s.close();
    onDone?.();
  } catch (err) {
    toast(err.message);
  }
}

async function nudge(el) {
  buyerToken(true);
  el.disabled = true;
  try {
    const { total } = await api('/ai/nudge', { method: 'POST', body: {} });
    el.textContent = tr(`已催！开发者已经被 ${total} 个人催着充钱了`, `Nagged! ${total} people are now on the developer's case to top up`);
  } catch (err) {
    toast(err.message);
    el.disabled = false;
  }
}

// Feedback goes into our own table: mailto does nothing inside WeChat. The page path and role ride along
// so a report like "this button doesn't work" can be traced.
const FEEDBACK_MAX_SHOTS = 3;

function feedbackSheet() {
  const path = location.pathname;
  const role = path.startsWith('/manage/') ? 'seller' : path.startsWith('/s/') || path === '/my' ? 'buyer' : '';
  const shots = []; // { url } object URLs of picked screenshots
  let text = '';
  let contact = store.get('buyerTelegram', '') ? `@${store.get('buyerTelegram', '')}` : store.get('buyerWechat', '');
  // Typed text lives here: refresh() re-renders the sheet when screenshots change.
  const sync = (s) => {
    text = s.el.querySelector('[name=fb]').value;
    contact = s.el.querySelector('[name=fbc]').value;
  };
  const sh = openSheet(() => `<h2>${tr('反馈问题 / 提建议', 'Feedback / ideas')}</h2>
    <div class="group">
      <label class="field"><span>${tr('想说什么', 'What would you like to say?')}</span><textarea class="inp" name="fb" rows="4" maxlength="1000" placeholder="${tr('哪里不好用、出了什么错、想要什么功能，都可以说', "What's awkward, what broke, what you wish it did")}">${esc(text)}</textarea></label>
      <div class="field"><span>${tr(`截图（选填，最多 ${FEEDBACK_MAX_SHOTS} 张）`, `Screenshots (optional, up to ${FEEDBACK_MAX_SHOTS})`)}</span>
        <div class="photo-strip" style="margin-top:6px">
          ${shots.map((p, j) => `<div class="t"><img src="${p.url}" alt=""><button class="x" data-act="rm" data-j="${j}">✕</button></div>`).join('')}
          ${shots.length < FEEDBACK_MAX_SHOTS ? `<button class="addph" data-act="add">＋</button>` : ''}
        </div>
      </div>
      <label class="field"><span>${tr('你的微信号或 Telegram（选填）', 'Your Telegram or WeChat (optional)')}</span><input class="inp" type="text" name="fbc" maxlength="60" value="${esc(contact)}"></label>
    </div>
    <div class="hint" style="padding-top:0">${tr('一张截图比一段话说得清楚。留个联系方式，开发者需要细问时能找到你。会自动附上你在哪个页面、用的什么手机。', 'A screenshot says more than a paragraph. Leave a contact so the developer can ask follow-ups. The page you are on and your phone model are attached.')}</div>
    <div class="actions"><button class="btn primary big block" data-act="send">${tr('发送', 'Send')}</button></div>`, async (act, el, s) => {
    sync(s);
    if (act === 'add') {
      const fs = await pickFiles({ multiple: true });
      for (const f of fs.slice(0, FEEDBACK_MAX_SHOTS - shots.length)) shots.push({ url: URL.createObjectURL(f) });
      return s.refresh();
    }
    if (act === 'rm') {
      URL.revokeObjectURL(shots.splice(Number(el.dataset.j), 1)[0].url);
      return s.refresh();
    }
    if (act !== 'send') return;
    if (!text.trim() && !shots.length) return toast(tr('写一句或者传张截图吧', 'Write a line or add a screenshot'));
    buyerToken(true);
    el.disabled = true;
    try {
      const form = new FormData();
      Object.entries({ text: text.trim(), contact: contact.trim(), page: path, role, width: innerWidth }).forEach(([k, v]) => form.append(k, v));
      // Screenshots are mostly text: a larger long edge than item photos keeps them readable.
      for (const p of shots) form.append('shot', await resize(await loadImage(p.url), 1600, 0.8), 'shot.jpg');
      await api('/feedback', { method: 'POST', form });
      toast(tr('收到了，谢谢！', 'Got it, thanks!'));
      s.close();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  }, { onClose: () => shots.forEach((p) => URL.revokeObjectURL(p.url)) });
  setTimeout(() => sh.el.querySelector('[name=fb]')?.focus(), 250);
}

// Two ways to tip: the WeChat 赞赏码 for Chinese users, and a web tip page (TIP_URL, e.g. Ko-fi or
// PayPal.me) for everyone else, Telegram users included. We can't see payments, so "我打赏了" is
// taken on trust (the server grants the bonus once per device).
const TIP_QR = '/tip-qr.png';
const tipUrl = () => CFG.tipUrl || '';
const wechatTipOn = () => LANG === 'zh' || isWeChat;
// Whether this viewer has any way to tip; without one, tip buttons are left out.
const tipOn = () => wechatTipOn() || !!tipUrl();

async function tipSheet(onRegain) {
  buyerToken(true);
  let q = { tipped: false };
  try {
    q = await api('/ai/quota');
  } catch {}
  openSheet(() => `<h2>${tr('打赏开发者', 'Tip the developer')}</h2>
    <div class="hint center" style="padding-top:0">${tr('AI 识别是开发者自掏腰包付的。你打赏，他充 AI，大家接着薅。', 'The AI runs on the developer\'s own money. You tip, the developer tops it up, everyone keeps freeloading.')}</div>
    ${tipUrl() ? `<div class="actions"><a class="btn ${wechatTipOn() ? '' : 'primary big'} block" href="${esc(tipUrl())}" target="_blank" rel="noopener">☕ ${tr('请开发者喝杯咖啡（Ko-fi，银行卡）', 'Buy the developer a coffee (Ko-fi, card)')}</a></div>` : ''}
    ${wechatTipOn() ? `<img class="tip-qr" src="${TIP_QR}" alt="${tr('微信赞赏码', 'WeChat tip code')}">
    <div class="hint center">${isWeChat ? tr('长按二维码，选「识别图中二维码」', 'Long-press the QR code → Scan QR Code in Image') : tr('截图，在微信「扫一扫」里从相册选这张图', 'Screenshot it, then pick it from your album in WeChat Scan')}</div>` : ''}
    <div class="actions"><button class="btn ${wechatTipOn() ? 'primary big' : ''} block" data-act="tipped">${q.tipped ? tr('我打赏了', 'I tipped') : tr('我打赏了，送我 100 次 AI 识别', 'I tipped, give me 100 AI tries')}</button></div>`, async (act, el, s) => {
    if (act !== 'tipped') return;
    el.disabled = true;
    try {
      const r = await api('/ai/tip', { method: 'POST', body: {} });
      toast(r.granted ? tr(`谢谢打赏！送你 ${r.bonus} 次 AI 识别`, `Thank you! ${r.bonus} AI tries added`) : tr('谢谢打赏！', 'Thank you!'));
      s.close();
      if (r.granted) onRegain?.();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  });
}

// Global cap reached (or the free model allowance is used up).
function aiBusySheet() {
  openSheet(() => `<h2>${tr('今天的 AI 额度被薅完了', "Today's free AI got freeloaded dry")}</h2>
    <div class="hint" style="padding-top:0">${tr('AI 识别是开发者自掏腰包付的，今天的额度已经被大家用光了，明天会恢复。自己填名字也很快。<br>想让开发者赶紧加钱？点下面催一下，催的人越多，他越不好意思不充。', "The AI runs on the developer's own money and today's share is gone; it's back tomorrow. Typing a name is quick too.<br>Want the developer to cough up more? Nag below: the more people nag, the more embarrassing it gets not to.")}</div>
    <div class="actions">
      <button class="btn primary big block" data-act="nudge">${tr('催开发者充钱', 'Nag the developer to pay up')}</button>
      ${tipOn() ? `<button class="btn big block" data-act="tip">${tr('打赏开发者，帮他充钱', 'Tip so the developer can top up')}</button>` : ''}
    </div>
    <div style="margin-top:12px">${inviteRowHtml()}</div>`, (act, el, s) => {
    if (act === 'nudge') nudge(el);
    if (act === 'tip') {
      s.close();
      tipSheet();
    }
    if (act === 'invite') useInvite(s);
  });
}

// This device used its free tries: survey for 10 more, otherwise an "it is useful to me" vote / invite code.
async function aiLimitSheet(onRegain) {
  let q = { surveyDone: true };
  try {
    q = await api('/ai/quota');
  } catch {}
  if (!q.surveyDone) return surveySheet(onRegain);
  const tipBtn = !q.tipped && tipOn();
  openSheet(() => `<h2>${tr('你的免费次数薅完了', "You've freeloaded all your free tries")}</h2>
    <div class="hint" style="padding-top:0">${tr('AI 识别是开发者自掏腰包付的，每人先送这么多次。自己填名字也很快。<br>还想接着用？催开发者加预算吧，催的人多了他就会加。', "The AI runs on the developer's own money, so everyone gets this many to start. Typing a name is quick too.<br>Want more? Nag the developer to raise the budget; enough nagging and it happens.")}</div>
    <div class="actions">
      ${tipBtn ? `<button class="btn primary big block" data-act="tip">${tr('打赏开发者，送你 100 次', 'Tip the developer, get 100 tries')}</button>` : ''}
      <button class="btn ${tipBtn ? '' : 'primary '}big block" data-act="nudge">${tr('催开发者加预算', 'Nag the developer for more budget')}</button>
    </div>
    <div style="margin-top:12px">${inviteRowHtml()}</div>`, (act, el, s) => {
    if (act === 'nudge') nudge(el);
    if (act === 'tip') {
      s.close();
      tipSheet(onRegain);
    }
    if (act === 'invite') useInvite(s, onRegain);
  });
}

// Three Mom-Test style questions about what actually happened last time, not opinions.
function surveySheet(onRegain) {
  const a = { slowest: '', hours: '', pay: '', detail: '', contact: '' };
  const sh = openSheet(() => `<div class="quota-out">${tr('送你的 3 次 AI 识图用完啦', 'Your 3 free AI tries are used up')}</div>
    <h2>${tr('想听听你的真实想法', "We'd love your honest take")}</h2>
    <div class="hint" style="padding-top:0">${tr('这是我们自己做的小工具，还在摸索怎么做才真正好用。AI 识别每用一次，开发者都要自掏腰包付一点钱，所以先送了 3 次。<br>想请你花半分钟，按真实情况回答 3 个问题。你的回答会直接影响我们接下来做什么。作为感谢，<b>再送你 10 次</b>。', 'This is a small tool we made ourselves, still figuring out what makes it truly useful. Every AI recognition costs the developer a little, so you got 3 to start.<br>Could you spend half a minute answering 3 questions about what actually happened? Your answers shape what we build next. As thanks, <b>10 more tries</b>.')}</div>
    ${SURVEY.map((s, i) => `
      <div class="survey-q">
        <div class="survey-title">${i + 1}. ${esc(s.q)}</div>
        <div class="seg">${s.options.map((o) => `<button class="${a[s.key] === o ? 'on' : ''}" data-act="pick" data-k="${s.key}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      </div>`).join('')}
    <div class="group" style="margin-top:12px">
      <label class="field"><span>${tr('为什么这么选？或者任何想法（选填）', 'Why? Or any thoughts (optional)')}</span><input class="inp" name="detail" maxlength="200" value="${esc(a.detail)}"></label>
      <label class="field"><span>${tr('愿意让我们再问你两句的话，留个微信或 Telegram（选填）', 'Happy to answer a follow-up? Leave your Telegram or WeChat (optional)')}</span><input class="inp" name="contact" maxlength="60" value="${esc(a.contact)}"></label>
    </div>
    <div class="actions">
      <button class="btn primary big block" data-act="submit">${tr('提交，再送 10 次', 'Send, get 10 more')}</button>
    </div>
    <div style="margin-top:12px">${inviteRowHtml()}</div>`, async (act, el, s) => {
    const sync = () => {
      a.detail = s.el.querySelector('[name=detail]').value.trim();
      a.contact = s.el.querySelector('[name=contact]').value.trim();
    };
    if (act === 'pick') {
      sync();
      a[el.dataset.k] = el.dataset.v;
      const y = s.el.scrollTop;
      s.refresh();
      s.el.scrollTop = y;
    }
    if (act === 'invite') useInvite(s, onRegain);
    if (act === 'submit') {
      sync();
      if (!a.slowest || !a.hours || !a.pay) return toast(tr('三道题都选一下就好', 'Please answer all three'));
      buyerToken(true);
      el.disabled = true;
      try {
        const q = await api('/ai/survey', { method: 'POST', body: a });
        s.close();
        toast(tr(`谢谢你！又送了 10 次，现在还剩 ${q.left ?? '不限'} 次`, `Thank you! 10 more added, ${q.left ?? 'unlimited'} left`));
        onRegain?.();
      } catch (err) {
        toast(err.message);
        el.disabled = false;
      }
    }
  });
  return sh;
}

// Automatic AI naming of new photos; on by default, switch off in settings (per phone).
function aiAutoOn() {
  return store.get('aiAuto', true) !== false;
}

// Photos per batch call; a bigger pick is sent in several batches.
const AI_BATCH_MAX = 8;

// Sort photos picked together into items and recognise each one, in one call.
// Returns { items: [{ photos: [indices into files], name, note, retail }], limited }.
// groups: the card each file is on, when the seller already sorted them; the AI then keeps that.
async function aiBatch(files, currency, groups) {
  buyerToken(true);
  const form = new FormData();
  // Smaller than a single recognition (1024) to keep a batch cheap; big print still reads.
  for (const file of files) form.append('image', await aiImage(file, 768, 0.72), 'photo.jpg');
  if (currency) form.append('currency', currency);
  if (groups) form.append('groups', groups.join(','));
  return api('/ai/batch', { method: 'POST', form });
}

// Recognise one item from its photos (all shots of the same thing). Throws { code: 'LIMIT' | 'AI_BUSY' | ... }.
async function aiRecognize(files, currency) {
  buyerToken(true);
  const form = new FormData();
  // Large enough to read printed brand / model text.
  for (const file of files.slice(0, MAX_PHOTOS)) form.append('image', await aiImage(file, 1024, 0.75), 'photo.jpg');
  if (currency) form.append('currency', currency);
  return api('/ai/identify', { method: 'POST', form });
}

// ---------- 附近的二手 ----------

// Placeholder for the feed at the bottom of a page; mountNearbyFeeds() fills it in after render.
// Under a list, pass its id so the feed shows other people's things only.
function nearbyEntryHtml(excludeSaleId = '') {
  return `<div class="nearby-feed" data-exclude="${esc(excludeSaleId)}"></div>`;
}

// Feed responses by query, so pages that re-render (sorting, live refresh) don't refetch or flash.
const nearbyCache = {};

function kmText(km) {
  if (km == null) return '';
  const n = km < 10 ? km.toFixed(1) : Math.round(km);
  return km < 1 ? tr('1 公里内', 'within 1 km') : tr(`约 ${n} 公里`, `about ${n} km`);
}

// "附近的二手" as an inline feed: newest first, or by distance once the viewer shares a location.
function mountNearbyFeed(root) {
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = '1';
  let loc = store.get('nearbyLoc', null);
  let scope = store.get('nearbyScope', 'city') === 'near' && loc ? 'near' : 'city';
  let data = null;
  const load = async () => {
    const q = scope === 'near' ? `?scope=near&lat=${loc.lat.toFixed(2)}&lng=${loc.lng.toFixed(2)}` : '?scope=city';
    data = nearbyCache[q] || null;
    render();
    if (data) return;
    data = nearbyCache[q] = await api(`/nearby${q}`);
    render();
  };
  const render = () => {
    const items = (data?.items || []).filter((it) => it.saleId !== root.dataset.exclude);
    // Under a list, an empty feed is just noise.
    if (root.dataset.exclude && data && !items.length && scope === 'city') {
      root.innerHTML = '';
      return;
    }
    const cityName = data?.city || '';
    const empty = scope === 'near' ? tr('10 公里内还没有公开的东西。', 'Nothing listed within 10 km yet.') : tr(`${cityName ? esc(cityName) + ' ' : ''}还没有公开的东西。`, `Nothing listed${cityName ? ` in ${esc(cityName)}` : ''} yet.`);
    root.innerHTML = `
      <div class="feed-head">
        <b>${tr('附近的二手', 'Secondhand nearby')}</b>
        <div class="chips feed-tabs">
          <button class="chip ${scope === 'city' ? 'on' : ''}" data-scope="city">${tr('同城', 'This city')}${cityName && scope === 'city' ? ` · ${esc(cityName)}` : ''}</button>
          <button class="chip ${scope === 'near' ? 'on' : ''}" data-scope="near">${tr('附近 10 公里', 'Within 10 km')}</button>
        </div>
      </div>
      ${!data ? `<div class="empty">${tr('加载中…', 'Loading…')}</div>`
        : items.length ? `<div class="grid">${items.map((it) => `
          <a class="tile nearby-tile" href="/s/${esc(it.saleId)}/i/${it.no}">
            <div class="ph"><div class="track"><span><img src="${img(it.photo)}" loading="lazy" alt=""></span></div></div>
            <div class="info">
              <div class="sub">${moneyHtml(it.priceCents, it.currency, it.origPriceCents)}</div>
              <div class="name">${esc(itemT(it).name)}</div>
              <div class="extra">📍 ${esc(it.locationAlt && textLang(it.location) !== LANG ? it.locationAlt : it.location)}${it.km != null ? ` · ${kmText(it.km)}` : ''}</div>
            </div>
          </a>`).join('')}</div>`
        : `<div class="empty">${empty}<br>${tr('你要出二手的话，发一份清单，这里就能看到。', 'Selling something? Post a list and it shows up here.')}</div>`}`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b || b.dataset.scope === scope) return;
    if (b.dataset.scope === 'near' && !loc) {
      b.disabled = true;
      b.textContent = tr('定位中…', 'Locating…');
      const p = await getLocation();
      if (!p) {
        toast(tr('没拿到位置，可以在手机设置里允许浏览器使用位置', 'No location: allow the browser to use it in your phone settings'));
        return render();
      }
      // Only the rounded position is kept, and only on this phone.
      loc = { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 };
      store.set('nearbyLoc', loc);
    }
    scope = b.dataset.scope;
    store.set('nearbyScope', scope);
    load().catch((err) => toast(err.message));
  });
  render();
  load().catch(() => {
    root.innerHTML = '';
  });
}

function mountNearbyFeeds() {
  document.querySelectorAll('.nearby-feed').forEach(mountNearbyFeed);
}

function nearbyPage() {
  $app.innerHTML = `${nearbyEntryHtml()}
    <div style="padding:24px 16px 8px;display:flex;gap:10px;justify-content:center">
      <a class="btn small" href="/my">${tr('我的排队', 'My reservations')}</a>
      <a class="btn small" href="${tr('/', '/en')}">${tr('我也要发清单', 'Make my own list')}</a>
    </div>`;
  mountNearbyFeeds();
}

boot();
