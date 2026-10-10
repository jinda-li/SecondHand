import { money, shareText, defaultIntro, stripLinks, LIST_MARK, CONDITIONS, CURRENCIES } from './lib.js';

const $app = document.getElementById('app');
const UI = new URLSearchParams(location.search).get('ui');
if (UI) document.documentElement.dataset.ui = UI;
const BOOT = window.__DATA__ || {};
const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
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
const HOUR = 3600 * 1000;
const CHECK_AFTER_MS = 12 * HOUR;
const MAX_PHOTOS = 3;
// Title = "<name>" + one of these; the first is the default.
const TITLE_SUFFIXES = ['的二手清单', '的搬家甩卖', '的毕业清仓', '回国前出闲置', '的闲置转让'];
const TITLE_PICKS = ['我的二手清单'];
const DEFAULT_RULES = ['价格固定不议价', '先到先得', '多件打包可优惠'];

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
    throw { code: 'NETWORK', message: '没保存成功，网络恢复后再点一次' };
  }
  let j;
  try {
    j = await res.json();
  } catch {
    throw { code: 'NETWORK', message: '网络出错了，再点一次' };
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

function loading(msg = '请稍候…') {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div>${esc(msg)}</div>`;
  document.body.appendChild(el);
  return () => el.remove();
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
function ask({ title, text = '', ok = '确定', danger = false, word = '' }) {
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
      ${word ? `<div class="group"><div class="cell"><input class="inp grow" name="askword" placeholder="输入「${esc(word)}」确认" autocomplete="off"></div></div>` : ''}
      <div class="actions">
        <button class="btn ${danger ? 'danger-solid' : 'primary'} big block" data-act="ok">${esc(ok)}</button>
        <button class="btn block" data-act="cancel">取消</button>
      </div>`, (act, el, s) => {
      if (act === 'cancel') return finish(false, s);
      if (act !== 'ok') return;
      if (word && s.el.querySelector('[name=askword]').value.trim() !== word) return toast(`请输入「${word}」`);
      finish(true, s);
    }, { onClose: () => finish(false) });
  });
}

async function copy(text, okMsg = '已复制') {
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
  if (m < 60) return m <= 1 ? '刚刚' : `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function dateText(d) {
  if (!d) return '';
  const [, mm, dd] = d.split('-').map(Number);
  return `${mm}月${dd}日`;
}

const statusText = { available: '在售', reserved: '已预订', sold: '已出', removed: '已下架' };

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

async function uploadPhoto(saleId, key, file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url);
    const [full, thumb] = await Promise.all([resize(im, 1280, 0.75), resize(im, 600, 0.72)]);
    const form = new FormData();
    form.append('full', full, 'full.jpg');
    form.append('thumb', thumb, 'thumb.jpg');
    const { photoId } = await api(`/sale/${saleId}/photo`, { method: 'POST', key, form });
    return photoId;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Google sign-in (sales follow the account) ----------

const CFG = window.__CFG__ || {};
const googleOn = () => !!CFG.googleClientId;
let gisLoading = null;

function loadGis() {
  gisLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('load'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

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

async function fetchMe() {
  if (!googleOn()) return { user: null, sales: [] };
  try {
    const d = await api('/me');
    store.set('signedIn', !!d.user);
    if (d.sales.length) mergeSales(d.sales);
    return d;
  } catch {
    return { user: null, sales: [] };
  }
}

// Renders the official Google button into el. Google blocks sign-in inside WeChat's browser.
async function googleButton(el, onDone) {
  if (!el) return;
  if (isWeChat) {
    el.innerHTML = `<div class="small muted">微信里不能用 Google 登录：点右上角 ··· 选「在浏览器打开」再登录。</div>`;
    return;
  }
  try {
    await loadGis();
  } catch {
    el.innerHTML = `<div class="small muted">Google 登录加载失败，检查一下网络</div>`;
    return;
  }
  google.accounts.id.initialize({
    client_id: CFG.googleClientId,
    callback: async (r) => {
      try {
        const claims = store.get('mySales', []).map((s) => ({ id: s.id, key: s.key }));
        const d = await api('/auth/google', { method: 'POST', body: { credential: r.credential, claims } });
        mergeSales(d.sales);
        store.set('signedIn', true);
        toast(`已登录 ${d.user.email || ''}`);
        onDone?.(d);
      } catch (e) {
        toast(e.message);
      }
    },
  });
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'zh-CN', width: Math.min(320, el.clientWidth || 300) });
}

function loginCardHtml(text) {
  return `<div class="login-card"><div class="small">${text}</div><div class="gbtn"></div></div>`;
}

// ---------- routing ----------

function boot() {
  // Any page that renders a .nearby-feed placeholder gets the live feed filled in.
  new MutationObserver(mountNearbyFeeds).observe($app, { childList: true, subtree: true });
  const path = location.pathname;
  let m;
  if (BOOT.notFound) return notFound();
  if ((m = path.match(/^\/s\/([A-Za-z0-9]+)\/i\/(\d+)/))) return buyerItem(m[1], Number(m[2]));
  if ((m = path.match(/^\/s\/([A-Za-z0-9]+)/))) return buyerSale(m[1]);
  if ((m = path.match(/^\/manage\/([A-Za-z0-9]+)/))) return manage(m[1]);
  if (path === '/my') return myQueues();
  if (path === '/nearby') return nearbyPage();
  if (path === '/new') return new URLSearchParams(location.search).has('go') ? createSale() : intro();
  return home();
}

// The seller's own key for this sale, if this browser has one.
function localKey(saleId) {
  return store.get('mySales', []).find((s) => s.id === saleId)?.key || null;
}


function ownerBanner(sale) {
  return `<div class="banner">这是买家看到的样子。你是卖家，不能预订自己的东西。</div>`;
}

// Seller previewing their own list sees buyer buttons; tapping one points them to the management page.
async function ownerTap(sale) {
  if (await ask({ title: '这是你自己的东西', text: '买家点这里会排队预订。\n要改价格、标已出，去管理页。', ok: '去管理' })) location.href = `/manage/${sale.id}`;
}

// Ended and deleted lists look the same to buyers.
function notFound() {
  const item = BOOT.item;
  $app.innerHTML = `<div class="empty">
    <div style="font-size:20px;font-weight:800;color:var(--text)">${item ? '这件东西已经不见了' : '这份清单已经不见了'}</div>
    <div style="margin-top:8px">${item ? '可能已经被卖家下架。' : '卖家已经结束或删除了这份清单。'}</div>
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:center"><a class="btn small" href="/my">我的排队</a><a class="btn small" href="/">回首页</a></div>
  </div>
  ${nearbyEntryHtml()}`;
}

// ---------- entry ----------

async function home() {
  const meData = await fetchMe();
  const mine = store.get('mySales', []);
  $app.innerHTML = `
    <div class="appbar">${LOGO}</div>
    <div class="head"><h1>我的二手</h1><div class="meta">拍照就上架，别人点开就能排队</div></div>
    ${!googleOn() ? '' : meData.user
      ? `<div class="hint">已登录 ${esc(meData.user.email)} · 清单跟着账号走 · <button class="link-btn small" id="logout">退出</button></div>`
      : loginCardHtml('用 Google 登录，清单跟着账号走，换手机也能管理')}
    ${mine.length ? `<div class="hint" style="padding-bottom:4px">我的清单（${mine.length}）</div><div class="section">${mine.map((s) => `
      <a class="cell" href="/manage/${esc(s.id)}"><div class="grow"><div>${esc(s.title)}</div><div class="muted small">管理我的清单</div></div><span class="muted">›</span></a>`).join('')}
    </div>` : ''}
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <a class="btn primary big block" href="${mine.length ? '/new?go=1' : '/new'}">${mine.length ? '再发一份新清单' : '发布我的二手清单'}</a>
      <a class="btn big block" href="/my">我的排队</a>
    </div>
    ${nearbyEntryHtml()}
    <div class="hint center"><a href="/privacy">隐私政策</a> · <a href="/terms">服务条款</a></div>`;
  googleButton($app.querySelector('.gbtn'), () => home());
  const lo = $app.querySelector('#logout');
  if (lo) {
    lo.onclick = async () => {
      await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      store.set('signedIn', false);
      home();
    };
  }
}

// ---------- 6.1 create sale ----------

function rulesEditor(rules) {
  const all = [...rules, ...DEFAULT_RULES.filter((r) => !rules.includes(r))].slice(0, 5);
  return all.map((r) => `
    <div class="rule-row"><input type="checkbox" ${rules.includes(r) ? 'checked' : ''}><input class="inp" type="text" maxlength="20" value="${esc(r)}"></div>`).join('');
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
    ? `<label class="field"><span>你的名字 <b class="req">*</b></span><input type="text" name="owner" maxlength="12" value="${esc(s.owner)}" placeholder="别人怎么称呼你" autocomplete="nickname"></label>
      <div class="field">
        <span>清单标题</span>
        <div class="seg">${TITLE_SUFFIXES.map((t, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-suffix="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="help">标题：<b class="title-preview"></b></div>
        <input type="hidden" name="title">
      </div>`
    : `<label class="field"><span>标题</span><input type="text" name="title" maxlength="30" value="${esc(s.title)}"></label>`;
  const contact = `<label class="field"><span>联系方式 <b class="req">*</b>${create ? '' : '（只给排第 1 位的人看）'}</span><input type="text" name="wechatId" maxlength="60" value="${esc(s.wechatId)}" placeholder="微信号、手机号都行" autocomplete="off">${create ? '<div class="help">只给排第 1 位的人看</div>' : ''}</label>
      <label class="field"><span>取货地点 <b class="req">*</b></span><input type="text" name="location" maxlength="40" value="${esc(s.location)}" placeholder="例：地铁站附近自提"></label>`;
  const more = `<label class="field"><span>货币</span><select name="currency">${Object.keys(CURRENCIES).map((c) => `<option value="${c}" ${c === s.currency ? 'selected' : ''}>${c} ${CURRENCIES[c].trim()}</option>`).join('')}</select></label>
      <div class="field"><span>规则</span><div class="rules">${rulesEditor(s.rules)}</div></div>
      <label class="field"><span>截止日期（选填）</span><input type="date" name="leaveDate" value="${esc(s.leaveDate)}"></label>`;
  const nearby = `<label class="field nearby-row"><input type="checkbox" name="nearby" ${s.publicNearby === false ? '' : 'checked'}>
        <span style="margin:0;color:var(--text)">公开到「附近的二手」，让附近的人也能看到<br><span class="small muted">会用到你的大概位置（约 1 公里范围），不会显示具体地址</span></span></label>`;
  // Creating: the three required fields up front, the rest folded away with their defaults.
  if (create) {
    return `
    <div class="form ik">
      ${titleHtml}
      ${contact}
      <details class="ik-more">
        <summary><span><b>更多设置</b><span class="help">货币 ${esc(s.currency)} · 规则 · 截止日期，都有默认值</span></span></summary>
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

// Keeps the hidden title in sync with "<name><suffix>" in the create form.
function syncTitle(form) {
  const name = form.querySelector('[name=owner]').value.trim();
  const suffix = form.querySelector('[data-suffix].on')?.dataset.suffix || TITLE_SUFFIXES[0];
  const title = (name || '我') + suffix;
  form.querySelector('[name=title]').value = title;
  form.querySelector('.title-preview').textContent = title;
}

function readSaleForm(root) {
  const v = (n) => root.querySelector(`[name=${n}]`).value.trim();
  return {
    title: v('title'),
    wechatId: v('wechatId'),
    location: v('location'),
    currency: v('currency'),
    leaveDate: v('leaveDate'),
    rules: readRules(root),
    nearby: root.querySelector('[name=nearby]').checked,
  };
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

// What this is and how it works, before the publish form.
function intro() {
  // A tiny picture of the product: what buyers see in the group link.
  const mock = [
    ['🪑', '€20', '预订'],
    ['💡', '€5', '已预订'],
    ['🍳', '€6', '预订'],
    ['🚲', '€80', '预订'],
  ];
  const steps = [
    ['📷', '拍照，填个价格', 'AI 自动认出是什么，名字不用打'],
    ['💬', '一个链接，发几个群都行', '群友点开就能看图、预订'],
    ['🙋', '自动排队，不撞单', '第 1 位才看到你的联系方式'],
  ];
  $app.innerHTML = `
    <div class="appbar">${LOGO}</div>
    <div class="intro">
      <h1 class="intro-title">出二手，<br>不用一个个回消息</h1>
      <div class="intro-sub">拍照上架，发到群里，想要的人自己排队</div>
      <div class="intro-mock">${mock.map(([e, p, b]) => `
        <div class="mock-tile">
          <div class="mock-ph">${e}${b === '已预订' ? '<span class="mock-stamp">已预订</span>' : ''}</div>
          <span class="mock-price">${p}</span>
          <span class="mock-btn ${b === '已预订' ? 'off' : ''}">${b === '已预订' ? '排候补' : b}</span>
        </div>`).join('')}
      </div>
      <div class="intro-steps2">${steps.map(([i, t, d]) => `
        <div class="intro-step2"><span class="intro-icon">${i}</span><div><b>${t}</b><div class="small muted">${d}</div></div></div>`).join('')}
      </div>
      <div class="intro-free">免费 · 不用注册 · 不用下载</div>
    </div>
    <div class="save-entry" id="save">
      <div class="save-t">${ICON_STAR}收藏这个页面</div>
      <div class="save-s">现在不发也没关系，以后想出二手，从${isWeChat ? '微信收藏' : '书签'}里打开就能用。</div>
      <div class="save-btns">
        <button class="pill dark" data-save="fav">${ICON_STAR}去收藏</button>
        <button class="pill" data-save="send">分享给朋友</button>
      </div>
    </div>
    <div class="bottom-bar"><div class="inner"><a class="btn primary big" href="/new?go=1">开始发布</a></div></div>`;
  // 收藏 on a buyer page's strip lands here; the card is rendered after load, so scroll by hand.
  if (location.hash === '#save') $app.querySelector('#save').scrollIntoView({ block: 'center' });
  $app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-save]');
    if (!b) return;
    const fav = b.dataset.save === 'fav';
    if (isWeChat) return menuGuide(fav ? '收藏' : '发送给朋友');
    const url = `${location.origin}/new`;
    if (!fav && navigator.share) {
      try {
        await navigator.share({ title: '二手清单｜出二手，不用一个个回消息', url });
      } catch {}
      return;
    }
    if (fav) return toast(/Mobi/i.test(navigator.userAgent) ? '在浏览器菜单里选「添加书签」或「添加到主屏幕」' : '按 Ctrl+D（Mac 上 ⌘+D）加到书签');
    copy(url, '链接已复制，发给朋友吧');
  });
}

const ICON_STAR = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

// WeChat gives pages no way to bookmark or share themselves, so point at its ··· menu instead.
function menuGuide(item) {
  const el = document.createElement('div');
  el.className = 'menu-guide';
  el.innerHTML = `
    <svg class="mg-arrow" viewBox="0 0 120 120" aria-hidden="true"><path d="M20 110 C 30 60, 60 30, 100 18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/><path d="M84 10 L104 16 L94 34" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="mg-steps">
      <div class="mg-step"><span class="mg-no">1</span>点右上角 <b class="mg-dots">···</b></div>
      <div class="mg-step"><span class="mg-no">2</span>选「<b>${esc(item)}</b>」</div>
      ${item === '收藏' ? `<div class="mg-tip">以后在微信「我 → 收藏」里就能找到</div>` : ''}
    </div>
    <button class="pill mg-ok">知道了</button>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

async function createSale() {
  const meData = await fetchMe();
  $app.innerHTML = `
    <div class="ik-head">${LOGO}<h1>发布二手清单</h1><div class="ik-sub">填 3 项就能开始上架，其他都有默认值。</div></div>
    ${googleOn() && !meData.user ? loginCardHtml('可以先用 Google 登录（可跳过）：清单跟着账号走，换手机也能管理') : ''}
    ${saleFormHtml({ owner: store.get('ownerName', '') || meData.user?.name || '', wechatId: '', location: '', currency: guessCurrency(), rules: DEFAULT_RULES, leaveDate: '' }, { create: true })}
    <div class="bottom-bar"><div class="inner"><button class="btn primary big" id="go">开始上架</button></div></div>`;
  const form = $app.querySelector('.form');
  syncTitle(form);
  form.addEventListener('input', () => syncTitle(form));
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-suffix]');
    if (!b) return;
    form.querySelectorAll('[data-suffix]').forEach((x) => x.classList.toggle('on', x === b));
    syncTitle(form);
  });
  googleButton($app.querySelector('.gbtn'), () => $app.querySelector('.login-card')?.remove());
  $app.querySelector('#go').onclick = async (e) => {
    const owner = $app.querySelector('[name=owner]').value.trim();
    if (!owner) return toast('填一下你的名字');
    const f = readSaleForm($app);
    if (!f.wechatId) return toast('填一下联系方式');
    if (!f.location) return toast('填一下取货地点');
    store.set('ownerName', owner);
    e.target.disabled = true;
    if (f.nearby) {
      e.target.textContent = '正在获取大概位置…';
      const loc = await getLocation();
      if (loc) Object.assign(f, loc);
      else toast('没拿到位置，清单还是会出现在「附近的二手」的最新列表里');
      e.target.textContent = '开始上架';
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
function tileHtml(sale, it, mine) {
  const my = mine?.[it.id];
  const ended = sale.status === 'ended';
  let stamp = '';
  if (it.status === 'reserved') stamp = `<div class="stamp reserved">${it.maybeSold ? '可能已出' : '已预订'}</div>`;
  else if (it.status === 'sold') stamp = `<div class="stamp sold">已出</div>`;
  let btn;
  if (my) btn = `<button class="btn small mine-btn" data-cancel-item="${it.id}"><b>第 ${my.position} 位</b><span class="s"> · 取消</span></button>`;
  else if (it.status === 'sold' || ended) btn = `<button class="btn small" disabled>${ended ? '已结束' : '已出'}</button>`;
  else if (it.queueCount === 0) btn = `<button class="btn small primary" data-join="${it.id}">预订</button>`;
  else btn = `<button class="btn small primary ghost" data-join="${it.id}"><b>排候补</b><span class="s"> · 前面 ${it.queueCount} 人</span></button>`;
  const extra = [it.condition ? CONDITIONS[it.condition] : '', it.note].filter(Boolean).join(' · ');
  return `
    <div class="tile ${it.status}">
      <div class="ph">
        <div class="track">${it.photos.map((p, k) => `<a href="/s/${sale.id}/i/${it.no}"><img src="${img(p)}" ${k ? 'loading="lazy"' : ''} alt=""></a>`).join('')}</div>
        <span class="ph-price${it.priceCents === 0 ? ' free' : ''}">${esc(money(it.priceCents, sale.currency))}</span>
        ${it.photos.length > 1 ? `<span class="dots">${it.photos.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</span>` : ''}
        ${stamp}
      </div>
      <div class="info">
        <div class="sub">${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)}${it.status === 'reserved' && it.queueCount > 1 ? `<span class="muted">${it.queueCount - 1} 人候补</span>` : ''}</div>
        <a class="name" href="/s/${sale.id}/i/${it.no}">${esc(it.name)}</a>
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

function contactHtml(c) {
  return `
    <div class="contact">
      <div class="contact-title">你排第 1 位，去微信加卖家吧</div>
      <div class="row"><div class="grow"><div class="k">卖家联系方式</div><div class="v">${esc(c.wechat)}</div></div><button class="btn small primary" data-copy="${esc(c.wechat)}">复制</button></div>
      <div class="row"><div class="grow"><div class="k">好友申请里写这句</div><div class="v">${esc(c.note)}</div></div><button class="btn small primary" data-copy="${esc(c.note)}">复制</button></div>
      <ol class="contact-steps">
        <li>复制卖家联系方式</li>
        <li>回到微信 → 右上角「＋」→「添加朋友」→ 粘贴搜索</li>
        <li>好友申请里粘贴上面那句，卖家一看就知道你是谁、要哪件</li>
        <li>加上后，时间地点和卖家直接约</li>
      </ol>
    </div>`;
}

function bindCopy(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copy(b.dataset.copy);
  });
}

// Display order only: item numbers stay with their items. Items without a price go last.
const SORTS = [['no', '默认'], ['asc', '价格↑'], ['desc', '价格↓']];
function sortItems(items, sort) {
  if (sort !== 'asc' && sort !== 'desc') return items;
  const dir = sort === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => (a.priceCents == null) - (b.priceCents == null) || dir * (a.priceCents - b.priceCents) || a.no - b.no);
}

// Brand mark: the tag icon with the name, so people remember (and can search for) 二手清单.
const LOGO = `<a class="logo" href="/"><img src="/icon.svg" alt="" width="34" height="34"><span class="logo-txt"><b>二手清单</b><small>AI识别 · 多群同步</small></span></a>`;

// Buyers arrive from a group card without knowing what this is: a slim dismissible strip
// (like a store's "get the app" bar) above a bar with the name and 我的二手.
function appBarHtml(isOwner) {
  const promo = !isOwner && !store.get('promoHidden', false);
  return `
    ${promo ? `<div class="promo">
      <button class="promo-x" data-promo-x aria-label="关闭">✕</button>
      <div class="promo-txt"><b>我也有二手要出</b><span>免登录·免安装·多群同步·免费</span></div>
      <a class="promo-fav" href="/new#save">收藏</a>
      <a class="promo-cta" href="/new">去发布</a>
    </div>` : ''}
    <div class="appbar">
      ${LOGO}
      <a class="appbar-my" href="/">我的二手 ›</a>
    </div>`;
}

function sortSegHtml(sort) {
  return `<div class="seg small">${SORTS.map(([k, t]) => `<button class="${sort === k ? 'on' : ''}" data-sort="${k}">${t}</button>`).join('')}</div>`;
}

function buyerSale(saleId) {
  // Assume seller view right away if this browser holds the key; the refetch below confirms it.
  let data = BOOT.sale ? { ...BOOT, isOwner: !!localKey(saleId) } : null;
  let showSold = false;
  let sort = store.get('buyerSort', 'no');

  const render = () => {
    if (!data) {
      $app.innerHTML = `<div class="empty">加载中…</div>`;
      return;
    }
    const { sale, items, now, mine, contact, isOwner } = data;
    const avail = items.filter((i) => i.status === 'available');
    const reserved = items.filter((i) => i.status === 'reserved');
    const sold = items.filter((i) => i.status === 'sold');
    const ended = sale.status === 'ended';
    const list = [...sortItems(avail, sort), ...sortItems(reserved, sort)];
    document.title = `${sale.title}｜在售 ${avail.length} 件`;
    $app.innerHTML = `
      ${appBarHtml(isOwner)}
      <div class="head">
        <h1>${esc(sale.title)}</h1>
        <div class="meta">📍 ${esc(sale.location)}${sale.leaveDate ? ` · ${dateText(sale.leaveDate)}前出完` : ''} · 卖家 ${agoText(sale.sellerActiveAt, now)}更新</div>
        ${sale.rules.length ? `<div class="tags">${sale.rules.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}</div>` : ''}
      </div>
      ${ended ? `<div class="banner">这份清单已结束</div>` : ''}
      ${isOwner ? ownerBanner(sale) : ''}${contact || ended ? '' : `<div class="how-line">点「预订」排队，排到第 1 位就能看到卖家微信。显示「预订」的都还在。</div>`}
      ${contact ? contactHtml(contact) : ''}
      <div class="list-bar"><div class="hint">在售 ${avail.length} · 已预订 ${reserved.length} · 已出 ${sold.length}</div>
        ${list.length > 1 ? sortSegHtml(sort) : ''}</div>
      ${list.length ? `<div class="grid">${list.map((it) => tileHtml(sale, it, mine)).join('')}</div>`
        : `<div class="empty">${items.length ? '都卖完了' : '卖家还没上架东西'}</div>`}
      ${sold.length ? (showSold
        ? `<div class="hint">已出 ${sold.length} 件</div><div class="grid">${sold.map((it) => tileHtml(sale, it, mine)).join('')}</div>`
        : `<button class="link-btn fold" data-sold>已出 ${sold.length} 件（展开）</button>`) : ''}
      ${isOwner ? `<div class="bottom-bar"><div class="inner">
        <a class="btn big" href="/manage/${sale.id}">回到管理</a>
        ${ended ? '' : `<button class="btn primary big" data-owner-share>分享到群</button>`}
      </div></div>` : ''}
      <div style="padding:28px 16px 8px;display:flex;gap:10px;justify-content:center">
        <a class="btn small" href="/my">我的排队</a>
      </div>`;
  };

  $app.addEventListener('click', (e) => {
    if (e.target.closest('[data-sold]')) {
      showSold = true;
      render();
    }
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
    data = d;
    render();
    window.scrollTo(0, y);
  });

  async function cancelMine(seq, btn) {
    if (!(await ask({ title: '确定取消排队？', text: '取消后你的位置会让给后面的人。', ok: '取消排队', danger: true }))) return;
    btn.disabled = true;
    try {
      await api(`/queue/${seq}/cancel`, { method: 'POST', body: {} });
      toast('已取消');
      await reload();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  render();
  // Always ask the server: it knows whether this viewer is the seller or already in line.
  reload().catch((e) => (e.code === 'NOT_FOUND' ? notFound() : toast(e.message)));
}

// ---------- 7.3 buyer item page ----------

function buyerItem(saleId, no) {
  // Assume seller view right away if this browser holds the key; the refetch below confirms it.
  let data = BOOT.sale ? { ...BOOT, isOwner: !!localKey(saleId) } : null;

  const render = () => {
    if (!data) {
      $app.innerHTML = `<div class="empty">加载中…</div>`;
      return;
    }
    const { sale, items, mine, contact } = data;
    const it = items.find((i) => i.no === no);
    if (!it) return notFound();
    const my = mine?.[it.id];
    const ended = sale.status === 'ended';
    const closed = it.status === 'sold' || ended;
    let btn;
    if (my) btn = `<button class="btn big" data-act="cancel">你排在第 ${my.position} 位 · 取消</button>`;
    else if (closed) btn = `<button class="btn big" disabled>${ended ? '清单已结束' : '已出'}</button>`;
    else if (it.queueCount === 0) btn = `<button class="btn primary big" data-act="join">预订（排第 1 位）</button>`;
    else btn = `<button class="btn primary big" data-act="join">排候补（前面 ${it.queueCount} 人）</button>`;

    const stamp = it.status === 'sold' ? `<div class="stamp sold">已出</div>`
      : it.status === 'reserved' ? `<div class="stamp reserved">${it.maybeSold ? '可能已出' : '已预订'}</div>` : '';
    document.title = `${it.name} ${money(it.priceCents, sale.currency)}`;
    $app.innerHTML = `
      <a class="back" href="/s/${sale.id}">‹ ${esc(sale.title)}（全部物品）</a>
      <div class="gallery">
        <div class="track">${it.photos.map((p) => `<img src="${img(p, false)}" alt="">`).join('')}</div>
        ${it.photos.length > 1 ? `<span class="count">1/${it.photos.length}</span>` : ''}
        ${stamp}
      </div>
      <div class="item-info">
        <div class="row">${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)}</div>
        <h1>${esc(it.name)}</h1>
        ${it.condition ? `<div class="meta">${esc(CONDITIONS[it.condition])}</div>` : ''}
        ${it.note ? `<div style="margin-top:6px;white-space:pre-line">${esc(it.note)}</div>` : ''}
        <div class="meta" style="margin-top:10px">${it.status === 'reserved'
          ? it.maybeSold ? '预订中，可能已出' : `已预订 · ${it.queueCount} 人在排`
          : statusText[it.status]} · 📍 ${esc(sale.location)}</div>
      </div>
      ${!my && !closed ? `<div class="how-to" style="margin-top:10px">点「预订」排队，排到第 1 位这里会显示卖家联系方式，再去微信加卖家。页面是实时的，能预订就是还在。</div>` : ''}
      ${my && my.position > 1 ? `<div class="hint">前面的人不要了，你会自动升到第 1 位，到时回来这里看卖家联系方式。</div>` : ''}
      ${my && my.position === 1 && contact ? contactHtml(contact) : ''}
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
    data = d;
    render();
  });

  $app.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const it = data.items.find((i) => i.no === no);
    if (a.dataset.act === 'join') data.isOwner ? ownerTap(data.sale) : joinSheet(data.sale, it, reload);
    if (a.dataset.act === 'cancel') {
      if (!(await ask({ title: '确定取消排队？', text: '取消后你的位置会让给后面的人。', ok: '取消排队', danger: true }))) return;
      try {
        await api(`/queue/${data.mine[it.id].seq}/cancel`, { method: 'POST', body: {} });
        toast('已取消');
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

function joinSheet(sale, it, reload) {
  let result = null;
  const sh = openSheet(() => {
    if (result) {
      if (result.position === 1) {
        return `<h2>预订成功</h2>${contactHtml(result.contact)}
          <div class="actions"><button class="btn block" data-act="close">好的</button></div>`;
      }
      return `<h2>排上了，你排第 ${result.position} 位</h2>
        <div class="hint center">前面的人不要了，你会自动升到第 1 位。<br>到时回来这里或「我的排队」看卖家联系方式，现在不用联系卖家。</div>
        <div class="actions"><button class="btn block" data-act="close">好的</button></div>`;
    }
    return `<h2>${esc(it.name)}</h2>
      <div class="group">
        <label class="field"><span>称呼 <b class="req">*</b></span><input class="inp" type="text" name="nick" maxlength="20" value="${esc(store.get('nickname', ''))}" placeholder="卖家怎么称呼你"></label>
        <label class="field"><span>备注（选填）</span><input class="inp" type="text" name="note" maxlength="30" placeholder="例：能送到 Aalto 吗"></label>
      </div>
      <div class="actions"><button class="btn primary big block" data-act="go">排上</button></div>`;
  }, async (act, el, s) => {
    if (act === 'close') return s.close();
    if (act !== 'go') return;
    const nickname = s.el.querySelector('[name=nick]').value.trim();
    const note = s.el.querySelector('[name=note]').value.trim();
    if (!nickname) return toast('填一个称呼');
    store.set('nickname', nickname);
    buyerToken(true);
    el.disabled = true;
    try {
      result = await api(`/item/${it.id}/join`, { method: 'POST', body: { nickname, note } });
      s.refresh();
      reload();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  });
  bindCopy(sh.el);
  setTimeout(() => sh.el.querySelector('[name=nick]')?.focus(), 250);
}

// ---------- 7.4 my queues ----------

async function myQueues() {
  $app.innerHTML = `<div class="head"><h1>我的排队</h1></div><div class="empty">加载中…</div>`;
  let data;
  try {
    data = await api('/my');
  } catch (e) {
    $app.querySelector('.empty').textContent = e.message;
    return;
  }
  const label = { sold: '买到了', declined: '卖家标记你不要了', cancelled: '你取消了', removed: '已出或已下架' };
  const render = () => {
    const qs = data.queues;
    $app.innerHTML = `<div class="head"><h1>我的排队</h1><div class="meta">只记在这台手机的这个浏览器里</div></div>
      ${qs.length ? qs.map((q) => `
        <div class="section">
          <a class="row-item" href="/s/${esc(q.saleId)}/i/${q.no}">
            ${q.photo ? `<img src="${img(q.photo)}" alt="">` : '<div class="noimg"></div>'}
            <div class="grow">
              <div class="ellipsis"><span class="no">${q.no}</span> ${esc(q.name)}</div>
              <div class="small muted ellipsis">${esc(q.saleTitle)} · ${esc(money(q.priceCents, q.currency))}</div>
              <div class="small">${q.status === 'waiting' ? (q.position === 1 ? '<b style="color:var(--green)">轮到你了，第 1 位</b>' : `第 ${q.position} 位`) : esc(label[q.status] || q.status)}</div>
            </div>
          </a>
          ${q.contact ? contactHtml(q.contact) : ''}
          ${q.status === 'waiting' ? `<div style="padding:0 16px 12px;text-align:right"><button class="btn small" data-cancel="${q.seq}">取消排队</button></div>` : ''}
        </div>`).join('') : `<div class="empty">还没有排队。<br>在清单页点「预订」就排上了。</div>`}
      ${nearbyEntryHtml()}`;
  };
  render();
  bindCopy($app);
  $app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b || !(await ask({ title: '确定取消排队？', text: '取消后你的位置会让给后面的人。', ok: '取消排队', danger: true }))) return;
    try {
      await api(`/queue/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      data = await api('/my');
      render();
      toast('已取消');
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
  $app.innerHTML = `<div class="head"><h1>需要管理权限</h1><div class="meta">这台手机的浏览器里没有这份清单的管理权限。</div></div>
    ${googleOn() ? `<div style="padding:0 16px">${loginCardHtml('清单绑定过 Google 账号的话，登录就能管理')}</div>` : ''}
    <div style="padding:16px"><div class="small muted" style="margin-bottom:6px">或者打开你保存的「管理链接」：</div><input class="inp boxed" id="lk" placeholder="粘贴管理链接"><br><br><button class="btn primary block" id="go">打开</button></div>`;
  googleButton($app.querySelector('.gbtn'), () => location.reload());
  $app.querySelector('#go').onclick = () => {
      const v = $app.querySelector('#lk').value.trim();
      const m = v.match(/[#?&]k=([A-Za-z0-9]+)/);
      if (!m) return toast('链接不对');
      location.href = `/manage/${saleId}?k=${m[1]}`;
  };
}

function manage(saleId) {
  let key = sellerKey(saleId);
  const params = new URLSearchParams(location.search);
  let data = null;
  let tab = 'all';
  let sort = store.get('manageSort', 'no');
  let checkedThisOpen = false;
  let hiddenAt = 0;
  const S = { saleId, key };

  const reload = async () => {
    data = await api(`/sale/${saleId}/manage`, { key });
    if (data.sale.key && data.sale.key !== key) S.key = key = data.sale.key;
    if (!new URLSearchParams(location.search).has('new')) showManageLinkInUrl(saleId, key);
    mergeSales([{ id: saleId, key, title: data.sale.title }]);
    render();
  };
  S.reload = reload;
  S.data = () => data;
  S.afterUpload = () => loginPrompt(S);

  const render = () => {
    const { sale, items, soldCents } = data;
    const count = (st) => items.filter((i) => i.status === st).length;
    const list = sortItems(tab === 'all' ? items : items.filter((i) => i.status === tab), sort);
    const ended = sale.status === 'ended';
    document.title = `管理｜${sale.title}`;
    $app.innerHTML = `
      <div class="topbar"><a class="btn" href="/s/${sale.id}">看买家看到的页面</a><button class="btn" data-act="settings">设置</button></div>
      <div class="head" style="padding-top:8px"><h1>${esc(sale.title)}</h1><div class="meta">📍 ${esc(sale.location)}</div></div>
      ${ended ? `<div class="banner">这份清单已结束：买家打开链接会看到「清单已经不见了」。<br><button class="btn small primary" style="margin-top:8px" data-act="reopen">重新公开</button></div>` : ''}
      ${linkSaved(saleId) ? '' : `<div class="banner">还没把管理入口发给自己：换手机或在微信里打开时，没有它就管理不了这份清单。<br><button class="btn small primary" style="margin-top:8px" data-act="savelink">发给自己</button></div>`}
      <div class="stats">
        <div><b>${count('available')}</b><span>在售</span></div>
        <div><b>${count('reserved')}</b><span>已预订</span></div>
        <div><b>${count('sold')}</b><span>已出</span></div>
      </div>
      <div class="earned">已卖出 <b>${esc(soldCents ? money(soldCents, sale.currency) : CURRENCIES[sale.currency].trim() + '0')}</b></div>
      <div class="chips">
        ${[['all', '全部'], ['available', '在售'], ['reserved', '已预订'], ['sold', '已出']].map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
      ${list.length > 1 ? `<div class="list-bar end">${sortSegHtml(sort)}</div>` : ''}
      ${items.length === 0 ? `<div class="empty">拍张照、填个价格，就上架了。<br><br><button class="btn primary" data-act="compose">选照片</button></div>`
        : list.length === 0 ? `<div class="empty">这里没有东西</div>`
        : `<div class="section">${list.map((it) => `
          <div class="row-item" data-item="${it.id}">
            <span class="no row-no">${it.no}</span>
            <img src="${img(it.photos[0])}" alt="" loading="lazy">
            <div class="grow">
              <div class="ellipsis">${esc(it.name)}</div>
              <div class="small">${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)} · <span class="st ${it.status}">${statusText[it.status]}</span>${it.queueCount ? ` · ${it.queueCount} 人排队${it.queue[0] ? `（第 1 位：${esc(it.queue[0].nickname)}）` : ''}` : ''}</div>
            </div>
            <span class="muted">›</span>
          </div>`).join('')}</div>`}
      ${ended ? '' : `<div class="bottom-bar"><div class="inner"><button class="btn big" data-act="compose">上架</button><button class="btn primary big" data-act="share">预览并分享</button></div></div>`}`;
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
    if (a.dataset.act === 'savelink') sendSelfSheet(S, { onDone: render });
    // Sharing starts from the buyer page: forwarding this page would send the 管理入口 card, key included.
    if (a.dataset.act === 'share') maybeCheck(S, true, () => (location.href = `/s/${saleId}`));
    if (a.dataset.act === 'settings') settingsSheet(S);
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

  $app.innerHTML = `<div class="empty">加载中…</div>`;
  reload().then(() => {
    if (params.get('new') === '1') {
      showManageLinkInUrl(saleId, key);
      newSaleSheet(S);
    } else if (params.get('saved') === '1' && !linkSaved(saleId)) {
      // Opened from the card in 文件传输助手: the entry is saved, carry on uploading.
      markLinkSaved(saleId);
      toast('管理入口存好了');
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

async function reopenSale(S) {
  try {
    await api(`/sale/${S.saleId}/reopen`, { method: 'POST', key: S.key, body: {} });
    toast('已重新公开');
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

// Ask to sign in once the seller has something worth keeping: after the first upload,
// and once more when the list reaches 10 items. Never inside WeChat, where Google sign-in can't work.
function loginPrompt(S) {
  const d = S.data();
  if (!googleOn() || isWeChat || !d || d.sale.ownerEmail) return;
  const asked = store.get('loginAsked', {});
  const n = asked[S.saleId] || 0;
  if (n >= 2 || (n === 1 && d.items.length < 10)) return;
  asked[S.saleId] = n + 1;
  store.set('loginAsked', asked);
  const sh = openSheet(() => `<h2>用 Google 登录？</h2>
    <div class="hint center" style="padding-top:0">清单跟着账号走：换手机、换浏览器、清了缓存，登录就能继续管理</div>
    <div class="gbtn" style="display:flex;justify-content:center;margin:8px 0 14px"></div>
    <div class="actions"><button class="btn block" data-act="later">先不用</button></div>`, (act, el, s) => s.close());
  googleButton(sh.el.querySelector('.gbtn'), () => {
    sh.close();
    S.reload();
  });
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
  el.innerHTML = `<span>⤴</span><b>点这里</b>`;
  document.body.appendChild(el);
  return () => el.remove();
}

// Send this management page to yourself (文件传输助手) without leaving it.
// In WeChat: ··· → 发送给朋友 shares the current URL, which carries the key (plus saved=1, so opening
// the card back from 文件传输助手 proves it was saved). Elsewhere: the system share sheet.
// The continue button stays disabled until we have a sign the link was actually sent.
function sendSelfSheet(S, { locked = false, doneText = '我发好了', onDone } = {}) {
  const title = S.data()?.sale.title || '我的二手清单';
  const link = manageLink(S.saleId, S.key);
  let sent = false;
  let wentAway = false;
  const removeArrow = isWeChat ? wxMenuArrow() : () => {};
  if (isWeChat) history.replaceState(null, '', `/manage/${S.saleId}?k=${S.key}&saved=1`);
  // WeChat's chat picker covers the page; coming back from it is our signal that it was sent.
  const onVisible = () => {
    if (document.hidden) wentAway = true;
    else if (wentAway && !sent) {
      sent = true;
      sh.refresh();
    }
  };
  if (isWeChat) document.addEventListener('visibilitychange', onVisible);
  const sh = openSheet(() => `<h2>先把管理入口发给自己</h2>
    <div class="hint">这个页面就是你的<b>管理入口</b>：上架、改价、看谁预订了都在这里。发给自己存好，以后在微信里点一下就能回来。</div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">
      ${isWeChat
        ? `1. 点右上角 <b>···</b> →「<b>发送给朋友</b>」<br>2. 选一个<b>你记得住的地方</b>，发送<br>3. 去那里<b>点开刚发的卡片</b>，就会接着上架`
        : `1. 点下面的「发给自己」<br>2. 选微信，再选一个<b>你记得住的地方</b>，发送`}
    </div></div>
    <div class="hint" style="padding-top:0">比如：<b>文件传输助手</b>、和<b>自己</b>的聊天窗口、只有你一个人的群，或者存到微信<b>收藏</b>。</div>
    <div class="hint" style="padding-top:0">只发给自己，<b>别发到群里</b>：拿到它的人都能改你的清单。</div>
    <div class="actions">
      ${isWeChat ? '' : `<button class="btn primary block" data-act="sendself">发给自己</button>`}
      <button class="btn ${sent ? 'primary' : ''} block" data-act="done" ${sent ? '' : 'disabled'}>${sent ? esc(doneText) : '发送以后才能继续'}</button>
      ${locked ? '' : `<button class="link-btn small" data-act="close" style="margin:4px auto 0">关闭</button>`}
    </div>`, async (act, el, s) => {
    if (act === 'sendself') {
      const text = `【二手清单 · 管理入口】${title}\n点开就能管理：上架、改价、看谁预订了。只发给自己，别发到群里。`;
      try {
        if (navigator.share) await navigator.share({ title: `管理入口｜${title}`, text, url: link });
        else await copy(`${text}\n${link}`, '已复制，发到文件传输助手或自己的窗口');
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
    doneText: '我发好了，开始上架',
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
    <h2>这几件卖掉了吗？</h2>
    ${beforeShare ? `<div class="hint center" style="padding-top:0">先确认一下，发出去的就是最新的</div>` : ''}
    ${list.map((it) => `
      <div class="check-row ${answered[it.id] ? 'answered' : ''}">
        <div class="row">
          <img src="${img(it.photos[0])}" alt="">
          <div class="grow"><div class="ellipsis"><span class="no">${it.no}</span> ${esc(it.name)}</div><div class="small muted">第 1 位：${esc(it.queue[0]?.nickname || '')}</div></div>
          ${answered[it.id] ? `<span class="small">${answered[it.id]}</span>` : ''}
        </div>
        <div class="btns">
          <button class="btn primary" data-act="sell" data-id="${it.id}">卖掉了</button>
          <button class="btn" data-act="still" data-id="${it.id}">还没</button>
          <button class="btn" data-act="decline" data-id="${it.id}">他不要了</button>
        </div>
      </div>`).join('')}
    <div class="actions"><button class="btn block" data-act="later">${beforeShare ? '稍后再说，先分享' : '稍后再说'}</button></div>`,
  async (act, el, s) => {
    if (act === 'later') return s.close();
    const it = list.find((i) => i.id === el.dataset.id);
    if (!it) return;
    el.disabled = true;
    try {
      const body = act === 'decline' ? { action: 'decline', seq: it.queue[0]?.seq } : { action: act };
      await api(`/item/${it.id}/action`, { method: 'POST', key: S.key, body });
      answered[it.id] = { sell: '已出', still: '还没', decline: '下一位顶上' }[act];
      changed = true;
      if (list.every((i) => answered[i.id])) {
        s.close();
        toast('已更新，群里看到的就是最新的');
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
    return `<div class="cretail">${generic ? '同类新品约' : '新品原价约'}${esc(sym)}${low}${high > low ? `–${high}` : ''}</div>`;
  };

  const statusHtml = (c) => {
    if (c.error) return `<div class="cstatus err">${esc(c.error)}</div>`;
    if (c.aiBusy) return `<div class="cstatus">✨ AI 正在认这是什么…</div>`;
    if (c.touched && !c.name.trim()) return `<div class="cstatus err">还没填名字</div>`;
    if (c.touched && priceCents(c) == null) return `<div class="cstatus err">还没填价格</div>`;
    if (c.touched && Number.isNaN(parsePrice(c.orig))) return `<div class="cstatus err">原价填数字，不填也行</div>`;
    return `<div class="cstatus"></div>`;
  };

  // Manual AI run: after adding photos, or when auto-recognition was off / stopped.
  const aiBtnHtml = (c) => `<button class="ai-btn cai" data-act="reai" ${c.aiBusy ? 'disabled' : ''}>${c.aiBusy ? '识别中…' : c.aiDone ? 'AI 重新识别' : 'AI 识别'}</button>`;

  const cardHtml = (c, idx) => `
    <div class="ccard ${c.error || (c.touched && !valid(c)) ? 'bad' : ''}" data-idx="${idx}">
      <div class="crow">
        <div class="thumbs">
          ${c.files.map((f, j) => `<div class="t"><img src="${f.url}" alt="" ${c.files.length > 1 ? `data-act="photo" data-j="${j}"` : ''}>${c.files.length > 1 ? `<button class="x" data-act="rmph" data-j="${j}">✕</button>` : ''}</div>`).join('')}
          ${c.files.length < MAX_PHOTOS ? `<button class="addph" data-act="addph" title="给这件东西再加图">＋</button>` : ''}
        </div>
        <div class="cside">
          <button class="link-btn small cdel" data-act="del">删除</button>
          ${idx > 0 && cards[idx - 1].files.length + c.files.length <= MAX_PHOTOS ? `<button class="link-btn small" data-act="merge">并到上一件</button>` : ''}
          ${aiBtnHtml(c)}
        </div>
      </div>
      <div class="cfields">
        <input class="inp boxed" type="text" maxlength="30" enterkeyhint="next" placeholder="${c.aiBusy ? 'AI 识别中…' : '名字，例：宜家台灯'}" value="${esc(c.name)}" data-in="name">
        <label class="price-in"><span>${esc(sym)}</span><input type="text" inputmode="decimal" maxlength="9" enterkeyhint="next" placeholder="价格" value="${esc(c.price)}" data-in="price"></label>
      </div>
      <div class="corig">
        ${retailHtml(c)}
        <label class="price-in"><span>原价${esc(sym)}</span><input type="text" inputmode="decimal" maxlength="9" enterkeyhint="next" placeholder="选填" value="${esc(c.orig)}" data-in="orig"></label>
      </div>
      <textarea class="inp boxed cnote" rows="2" maxlength="100" placeholder="详情（选填）：型号、尺寸、用了多久、有没有瑕疵…" data-in="note">${esc(c.note)}</textarea>
      ${statusHtml(c)}
    </div>`;

  const footerHtml = () => {
    const n = cards.filter(valid).length;
    return `
      <button class="btn big" data-act="pick">＋ 新物品</button>
      <button class="btn primary big" data-act="submit" ${n && !busy ? '' : 'disabled'}>${busy ? '上架中…' : `全部上架（${n} 件）`}</button>`;
  };

  const render = () => {
    el.innerHTML = `
      <div class="inner">
        <div class="bar"><button class="link-btn" data-act="close">‹ 返回</button><b>上架</b><span style="width:48px"></span></div>
        <div class="hint" style="padding-bottom:0">${aiAutoOn() ? '同一件东西的几张照片会自动归到一张卡片里；分错了，点照片拆开，或点「并到上一件」。' : '每张照片是一件新物品；同一件东西的多张图，点卡片里的「＋」加，或点「并到上一件」。'}价格填 0 就是免费送。</div>
        ${cards.length ? cards.map(cardHtml).join('') : `<div class="empty">点下面的「＋ 新物品」选照片。<br>可以一次选很多张，同一件的几张会自动放在一起。</div>`}
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
    nameIn.placeholder = c.aiBusy ? 'AI 识别中…' : '名字，例：宜家台灯';
    card.classList.toggle('bad', !!(c.error || (c.touched && !valid(c))));
    card.querySelector('.cstatus').outerHTML = statusHtml(c);
    card.querySelector('.cretail').outerHTML = retailHtml(c);
    card.querySelector('.cai').outerHTML = aiBtnHtml(c);
    el.querySelector('.footer .inner').innerHTML = footerHtml();
  };

  // Ask the AI about one card using all its photos. Automatic runs only fill empty fields;
  // a manual re-run (force) replaces name and details. Returns false on a quota/busy answer.
  const aiFill = async (c, force, onRegain) => {
    c.aiBusy = true;
    refreshCard(c);
    try {
      const r = await aiRecognize(c.files.map((f) => f.file), sale.currency);
      c.aiDone = true;
      c.retail = r.retail || null;
      if (force || !c.name.trim()) c.name = r.name;
      if ((force || !c.note.trim()) && r.note) c.note = r.note;
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

  const newCard = (files) => ({ files: files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), name: '', price: '', orig: '', note: '', touched: false, error: '' });

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
    const stop = loading('AI 正在整理照片…');
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
        if (it.name) Object.assign(c, { name: it.name, note: it.note || '', retail: it.retail || null, aiDone: true });
        added.push(c);
      }
    }
    stop();
    cards.push(...added);
    render();
    if (dropped) toast(`每件最多 ${MAX_PHOTOS} 张，多出的 ${dropped} 张没放进去`, 3000);
    if (sheet === 'limit') aiLimitSheet(regain);
    else if (sheet === 'busy') aiBusySheet();
  };

  // Tapping a photo on a card with several: move it to its own card, or drop it.
  const photoSheet = (c, j) => openSheet(() => `
    <div class="actions">
      <button class="btn block" data-act="split">拆成单独一件</button>
      <button class="btn danger block" data-act="rm">删掉这张</button>
      <button class="btn block" data-act="cancel">取消</button>
    </div>`, (act, _el, s) => {
    s.close();
    if (!cards.includes(c) || !c.files[j]) return;
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
        if (cards.length && !(await ask({ title: '还有没上架的物品', text: '离开的话，这些不会保存。', ok: '离开', danger: true }))) return;
        return close();
      case 'pick':
        return addFiles();
      case 'reai':
        if (c.aiBusy) return;
        return aiFill(c, true, () => cards.includes(c) && el.isConnected && aiFill(c, true));
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
        for (const f of fs.slice(0, MAX_PHOTOS - c.files.length)) c.files.push({ file: f, url: URL.createObjectURL(f) });
        return render();
      }
      case 'submit':
        return submit();
    }
  });

  const submit = async () => {
    cards.forEach((c) => (c.touched = true));
    busy = true;
    render();
    let done = 0;
    let failed = 0;
    for (const c of [...cards]) {
      if (!valid(c)) continue;
      try {
        c.photoIds ||= [];
        for (let j = c.photoIds.length; j < c.files.length; j++) c.photoIds.push(await uploadPhoto(S.saleId, S.key, c.files[j].file));
        await api(`/sale/${S.saleId}/items`, {
          method: 'POST',
          key: S.key,
          body: { name: c.name.trim(), priceCents: priceCents(c), origPriceCents: parsePrice(c.orig), condition: '', note: c.note.trim(), photos: c.photoIds },
        });
        c.files.forEach((f) => URL.revokeObjectURL(f.url));
        cards.splice(cards.indexOf(c), 1);
        done++;
      } catch (err) {
        c.error = err.code === 'NETWORK' ? '没保存成功，网络恢复后再点一次' : err.message;
        failed++;
      }
      render();
    }
    busy = false;
    render();
    if (done) toast(`上架了 ${done} 件${failed ? `，${failed} 件没成功` : ''}`);
    else if (failed) toast('没保存成功，网络恢复后再点一次');
    if (!cards.length) close();
    if (done) setTimeout(() => S.afterUpload?.(), 600);
  };

  render();
  addFiles();
}

// ---------- 6.4 item sheet (seller view) ----------

function itemSheet(S, itemId) {
  const { sale } = S.data();
  let it = S.data().items.find((i) => i.id === itemId);
  let edit = null;

  const refreshItem = async () => {
    await S.reload();
    it = S.data().items.find((i) => i.id === itemId);
    if (!it) sh.close();
    else sh.refresh();
  };

  const sh = openSheet(() => {
    const open = it.status === 'available' || it.status === 'reserved';
    if (edit) {
      return `<h2>编辑 ${it.no} 号</h2>
        <div class="group" style="padding:12px">
          <div class="photo-strip">
            ${edit.photos.map((p, j) => `<div class="t"><img src="${img(p)}" alt="">${edit.photos.length > 1 ? `<button class="x" data-act="eph-rm" data-j="${j}">✕</button>` : ''}</div>`).join('')}
            ${edit.photos.length < MAX_PHOTOS ? `<button class="addph" data-act="eph-add">＋</button>` : ''}
          </div>
        </div>
        <div class="group">
          <label class="field"><span>名字</span><input class="inp" name="name" maxlength="30" value="${esc(edit.name)}"></label>
          <label class="field"><span>价格（${esc(CURRENCIES[sale.currency].trim())}，0 = 免费送）</span><input class="inp" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${edit.priceCents / 100}"></label>
          <label class="field"><span>原价（选填，会划掉显示在价格旁边）</span><input class="inp" name="orig" type="text" inputmode="decimal" maxlength="9" value="${edit.origPriceCents == null || Number.isNaN(edit.origPriceCents) ? '' : edit.origPriceCents / 100}"></label>
          <label class="field"><span>详情（选填）</span><textarea class="inp" name="note" rows="3" maxlength="100" placeholder="型号、尺寸、用了多久、有没有瑕疵…">${esc(edit.note)}</textarea></label>
        </div>
        <div class="actions"><button class="btn primary block" data-act="save">保存</button><button class="btn block" data-act="cancel-edit">取消</button></div>`;
    }
    const q = it.queue;
    return `
      <div class="row" style="margin-bottom:12px">
        <img src="${img(it.photos[0])}" style="width:72px;height:72px;border-radius:8px;object-fit:cover" alt="">
        <div class="grow">
          <div><span class="no">${it.no}</span> <b>${esc(it.name)}</b></div>
          <div>${moneyHtml(it.priceCents, sale.currency, it.origPriceCents)} · <span class="st ${it.status}">${statusText[it.status]}</span>${it.condition ? ` · ${CONDITIONS[it.condition]}` : ''}</div>
          ${it.note ? `<div class="small muted">${esc(it.note)}</div>` : ''}
        </div>
        ${open ? `<button class="btn small" data-act="edit">编辑</button>` : ''}
      </div>
      ${open ? `
        <div class="small muted" style="margin:0 4px 6px">排队名单（${q.length} 人）</div>
        <div class="group">
          ${q.length ? q.map((r, i) => `
            <div class="qrow ${i === 0 ? 'head' : ''}">
              <span class="pos">${i + 1}</span>
              <div class="grow">
                <div><b>${esc(r.nickname)}</b>${r.addedBy === 'seller' ? ' <span class="small muted">（手动加）</span>' : ''}</div>
                ${r.note ? `<div class="small">${esc(r.note)}</div>` : ''}
                <div class="small muted">${new Date(r.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                ${i === 0 ? `<div class="acts"><button class="btn primary" data-act="sell">卖给他了</button><button class="btn" data-act="decline" data-seq="${r.seq}">他不要了</button></div>` : ''}
              </div>
              ${i > 0 ? `<button class="btn small" data-act="rmq" data-seq="${r.seq}">移除</button>` : ''}
            </div>`).join('') : `<div class="cell muted small">还没人排队</div>`}
        </div>
        <div class="group"><div class="cell"><input class="inp grow" name="manual" maxlength="20" placeholder="没在这里排队的人，填称呼加到队尾"><button class="btn small" data-act="manual">手动加人</button></div></div>
        <div class="actions">
          ${q.length ? '' : `<button class="btn primary block" data-act="sell">已经卖掉了</button>`}
          <button class="btn block" data-act="share-item">发这件的卡片</button>
          <button class="btn danger block" data-act="remove">下架</button>
        </div>` : `<div class="hint center">这件${statusText[it.status]}了</div>`}`;
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
        return run({ action: 'sell' }, '已标记为已出');
      case 'decline':
        return run({ action: 'decline', seq: Number(el.dataset.seq) }, it.queue.length > 1 ? '下一位顶上了' : '回到在售');
      case 'rmq':
        if (!(await ask({ title: '把这个人移出队列？', ok: '移出', danger: true }))) return;
        return run({ action: 'removeQueue', seq: Number(el.dataset.seq) });
      case 'manual': {
        const nickname = s.el.querySelector('[name=manual]').value.trim();
        if (!nickname) return toast('填个称呼');
        return run({ action: 'addManual', nickname }, '已加到队尾');
      }
      case 'remove':
        if (!(await ask({ title: `下架 ${it.no} 号？`, text: '排队的人会被移出。', ok: '下架', danger: true }))) return;
        await run({ action: 'remove' }, '已下架');
        return s.close();
      case 'share-item':
        return shareItem(S, it);
      case 'edit':
        edit = { name: it.name, priceCents: it.priceCents, origPriceCents: it.origPriceCents ?? null, condition: it.condition, note: it.note, photos: [...it.photos] };
        return s.refresh();
      case 'cancel-edit':
        edit = null;
        return s.refresh();
      case 'eph-rm':
        syncEdit(s);
        edit.photos.splice(Number(el.dataset.j), 1);
        return s.refresh();
      case 'eph-add': {
        syncEdit(s);
        const fs = await pickFiles({ multiple: true });
        const stop = loading('上传照片…');
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
        if (!edit.name) return toast('名字不能为空');
        if (!Number.isFinite(edit.priceCents) || edit.priceCents < 0) return toast('价格不对');
        if (Number.isNaN(edit.origPriceCents)) return toast('原价填数字，不填也行');
        el.disabled = true;
        try {
          await api(`/item/${it.id}`, { method: 'PATCH', key: S.key, body: edit });
          edit = null;
          toast('已保存');
          await refreshItem();
        } catch (err) {
          toast(err.message);
          el.disabled = false;
        }
      }
    }
  });

  function syncEdit(s) {
    const v = (n) => s.el.querySelector(`[name=${n}]`)?.value ?? '';
    edit.name = v('name').trim();
    edit.priceCents = Math.round(parseFloat(v('price') || '0') * 100);
    edit.origPriceCents = parsePrice(v('orig'));
    edit.note = v('note').trim();
  }
}

// ---------- settings ----------

function settingsSheet(S) {
  const { sale } = S.data();
  const sh = openSheet(() => `<h2>设置</h2>
    <div class="settings-form">${saleFormHtml({ ...sale, wechatId: sale.wechatId })}</div>
    <div class="actions">
      <button class="btn primary block" data-act="save">保存</button>
      ${googleOn() ? (sale.ownerEmail
        ? `<div class="hint center">已绑定 Google 账号 ${esc(sale.ownerEmail)}，换设备登录就能管理</div>`
        : `<div class="login-card"><div class="small">用 Google 登录，清单跟着账号走</div><div class="gbtn"></div></div>`) : ''}
      <button class="btn block" data-act="link">把管理入口发给自己（换手机、换浏览器用）</button>
      ${sale.status === 'active'
        ? `<button class="btn danger block" data-act="end">结束清单（对买家隐藏）</button>`
        : `<button class="btn block" data-act="reopen">重新公开</button>`}
      <button class="btn danger block" data-act="delete">永久删除清单</button>
    </div>
    <label class="nearby-row" style="margin:16px 4px 6px"><input type="checkbox" data-act="aiauto" ${aiAutoOn() ? 'checked' : ''}><span>上架时自动用 AI 认出照片里是什么</span></label>
    <div class="small muted" style="margin:0 4px 6px">AI 识别照片 · <span class="ai-status">查询中…</span></div>
    ${inviteRowHtml()}`, async (act, el, s) => {
    if (act === 'invite') return useInvite(s);
    if (act === 'aiauto') {
      store.set('aiAuto', el.checked);
      return toast(el.checked ? '上架时会自动识别照片' : '已关闭 AI 自动识别');
    }
    if (act === 'link') {
      s.close();
      return sendSelfSheet(S, { onDone: () => S.reload() });
    }
    if (act === 'save') {
      const f = readSaleForm(s.el);
      if (!f.title || !f.wechatId || !f.location) return toast('标题、联系方式、取货地点不能为空');
      el.disabled = true;
      if (f.nearby && !sale.hasLocation) {
        const loc = await getLocation();
        if (loc) Object.assign(f, loc);
      }
      try {
        await api(`/sale/${S.saleId}`, { method: 'PATCH', key: S.key, body: f });
        toast('已保存');
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
        title: '永久删除这份清单？',
        text: '所有物品、照片和排队记录都会被删掉，不能恢复。\n只想先不让买家看到的话，用「结束清单」就行。',
        ok: '永久删除',
        danger: true,
        word: '删除',
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
      const yes = await ask({
        title: '结束这份清单？',
        text: '买家打开链接会看到「清单已经不见了」，所有排队会被取消。\n你还能在这里看到它，随时可以重新公开。',
        ok: '结束清单',
        danger: true,
      });
      if (!yes) return;
      try {
        await api(`/sale/${S.saleId}/end`, { method: 'POST', key: S.key, body: {} });
        s.close();
        S.reload();
      } catch (err) {
        toast(err.message);
      }
    }
  });
  googleButton(sh.el.querySelector('.gbtn'), () => {
    sh.close();
    S.reload();
  });
  buyerToken(true);
  api('/ai/quota').then((q) => {
    const el = sh.el.querySelector('.ai-status');
    if (el) el.textContent = q.unlimited ? '已用邀请码，不限次数' : `这台手机还剩 ${q.left} 次`;
  }).catch(() => {});
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

function shareSheet(S) {
  const { sale } = S.data();
  const here = isCardHere(publicUrl(S));
  openSheet(() => `<h2>分享到群</h2>
    <div class="share-step">
      <div class="small muted">推荐：按顺序发两条</div>
      <button class="btn primary big block" data-act="card"><span class="step-no">1</span>发卡片</button>
      <div class="small muted step-why">群友点卡片就能看大图、预订</div>
      <button class="btn primary big block" data-act="text"><span class="step-no">2</span>发文字</button>
      <div class="small muted step-why">接着粘贴物品清单，不点开也知道有什么、多少钱</div>
    </div>
    <div class="small muted" style="margin:10px 4px 0">可以发到好几个群：大家排的是同一个队，先到先得，不会撞单。</div>
    <div class="share-or"><span>或者</span></div>
    <div class="actions">
      <button class="btn big block" data-act="image">直接发清单图</button>
      <div class="small muted center">一张长图，所有东西和价格都在上面，扫码进来预订</div>
    </div>
    <div class="share-help">
      <div class="survey-title">怎么分享图文卡片出去？</div>
      <div class="group"><div class="cell small" style="display:block;line-height:1.9">
        ${here ? `这个页面转发出去就是卡片，可以直接转发：<br>
        1. 点右上角 <b>···</b> →「发送给朋友」→ 选群，发出去就是卡片<br>
        2. 回来点「发文字」，复制后粘贴到同一个群` : `
        1. 点上面的「发卡片」，会出现一个二维码<br>
        2. ${isWeChat ? '<b>长按二维码</b> →「识别图中二维码」' : '保存二维码图片，发到微信「文件传输助手」，在微信里<b>长按这张图</b> →「识别图中二维码」'}<br>
        3. 页面打开后，点右上角 <b>···</b> →「发送给朋友」→ 选群，发出去就是卡片<br>
        4. 回来点「发文字」，复制后粘贴到同一个群`}
      </div></div>
      ${here ? '' : `<div class="small muted" style="margin:0 4px">别直接点链接打开再转发，那样微信只会发出一串网址。群里有了卡片以后，别人从卡片点进去再转发，也是卡片。</div>`}
    </div>`, async (act, el, s) => {
    if (act === 'text') {
      s.close();
      return textSheet(S);
    }
    if (act === 'image') {
      s.close();
      return saveSaleImage(S);
    }
    if (act === 'card') {
      s.close();
      const stop = loading('正在生成卡片图…');
      try {
        await uploadCover(S);
      } catch {
        // The card still works with the first item photo as fallback.
      } finally {
        stop();
      }
      return sendCard(publicUrl(S), sale.title);
    }
  });
}

// Editable group text. The opening line is the seller's own (remembered per list);
// the item list below 【物品清单】 is regenerated every time so it is never stale.
function textSheet(S) {
  const { sale, items } = S.data();
  const intros = store.get('shareIntro', {});
  const opts = { prices: false, compact: false, ...store.get('shareTextOpts', {}) };
  const text = shareText(sale, items, { ...opts, intro: stripLinks(intros[S.saleId]) || defaultIntro(sale) });
  const canShare = !isWeChat && !!navigator.share;
  const remember = (t) => {
    const intro = t.split(LIST_MARK)[0].trim();
    const all = store.get('shareIntro', {});
    if (intro && intro !== defaultIntro(sale)) all[S.saleId] = intro;
    else delete all[S.saleId];
    store.set('shareIntro', all);
  };
  const sh = openSheet(() => `<h2>群文字</h2>
    <div class="hint" style="padding-top:0">开头那段可以随便改，下次会记住；${LIST_MARK}下面每次按最新状态重新生成。</div>
    <textarea class="inp boxed share-text" rows="12">${esc(text)}</textarea>
    <div class="share-opts">
      <label class="nearby-row"><input type="checkbox" data-act="prices" ${opts.prices ? 'checked' : ''}><span>带价格</span></label>
      <label class="nearby-row"><input type="checkbox" data-act="compact" ${opts.compact ? 'checked' : ''}><span>紧凑（用 · 隔开，不换行）</span></label>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary block" data-act="copy">复制，去群里粘贴</button>
      ${canShare ? `<button class="btn block" data-act="share">分享到微信</button>` : ''}
      <button class="link-btn small" data-act="reset" style="margin:4px auto 0">恢复默认开头</button>
    </div>`, async (act, el, s) => {
    const box = s.el.querySelector('.share-text');
    const t = box.value;
    if (act === 'prices' || act === 'compact') {
      opts[act] = el.checked;
      store.set('shareTextOpts', opts);
      box.value = shareText(sale, items, { ...opts, intro: t.split(LIST_MARK)[0].trim() || defaultIntro(sale) });
    }
    if (act === 'copy') {
      remember(t);
      copy(t, '已复制，去群里粘贴');
    }
    if (act === 'share') {
      remember(t);
      try {
        await navigator.share({ text: t });
      } catch {}
    }
    if (act === 'reset') {
      const all = store.get('shareIntro', {});
      delete all[S.saleId];
      store.set('shareIntro', all);
      box.value = shareText(sale, items, opts);
    }
  });
  return sh;
}

function shareItem(S, it) {
  return sendCard(`${publicUrl(S)}/i/${it.no}`, it.name);
}

// WeChat forwards a page opened from a chat link as a bare URL, but a page opened by scanning
// a QR code as a card. So every card starts from a QR code; once one card is in the group,
// anyone who opens it and forwards it sends a card too.
async function sendCard(url, what) {
  if (isCardHere(url)) {
    return openSheet(() => `<h2>发卡片</h2>
      <div class="group"><div class="cell small" style="display:block;line-height:1.9">
        这个页面转发出去就是卡片，不用再扫码：<br>
        点右上角 <b>···</b> →「发送给朋友」→ 选群，发出去就是卡片
      </div></div>
      <div class="actions">
        <button class="btn block" data-act="close">好了</button>
        <button class="link-btn small" data-act="not-card" style="margin:4px auto 0">发出去只是一串网址？改用二维码</button>
      </div>`, (act, el, s) => {
      if (act === 'close') s.close();
      if (act === 'not-card') {
        setCardSession(false);
        s.close();
        sendCard(url, what);
      }
    });
  }
  const stop = loading('正在生成二维码…');
  let src;
  try {
    const qrUrl = new URL(url);
    qrUrl.searchParams.set('c', '1');
    src = await qrImage(qrUrl.href);
  } finally {
    stop();
  }
  if (!src) return toast('二维码没生成出来，检查网络再试');
  openSheet(() => `<h2>发卡片</h2>
    <div class="qr-card"><img src="${src}" alt="${esc(what)} 的二维码"><div class="small muted">${esc(what)}</div></div>
    <div class="group"><div class="cell small" style="display:block;line-height:1.9">
      ${isWeChat
        ? `1. <b>长按上面的二维码</b> →「识别图中二维码」<br>2. 打开后点右上角 <b>···</b> →「发送给朋友」→ 选群`
        : `1. 长按二维码保存图片（或截图），发到微信「文件传输助手」<br>2. 在微信里长按这张图 →「识别图中二维码」<br>3. 打开后点右上角 <b>···</b> →「发送给朋友」→ 选群`}
    </div></div>
    <div class="hint" style="padding-top:0">要从二维码打开再转发：直接点链接打开的页面，微信只会转发成一串网址。群里有了卡片，别人从卡片点进去再转发，也都是卡片。</div>
    <div class="actions">
      ${isWeChat ? '' : `<a class="btn block" download="二维码.png" href="${src}">下载二维码图片</a>`}
      <button class="btn block" data-act="close">好了</button>
      ${isWeChat && new URL(url).pathname === location.pathname ? `<button class="link-btn small" data-act="is-card" style="margin:4px auto 0">这页转发出去已经是卡片了？不用扫码</button>` : ''}
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

function drawStamp(g, text, cx, cy, size, color) {
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.24);
  g.font = `800 ${size}px ${FONT}`;
  const w = g.measureText(text).width + size;
  const h = size * 1.5;
  g.fillStyle = YELLOW;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.lineWidth = size / 10;
  g.strokeStyle = color;
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 2);
  g.restore();
}

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  const chars = [...text];
  while (chars.length && g.measureText(chars.join('') + '…').width > maxW) chars.pop();
  return chars.join('') + '…';
}

async function loadAll(ids) {
  return Promise.all(ids.map((id) => loadImage(img(id)).catch(() => null)));
}

// 9.1: square 2×2 grid of the first 4 available items — WeChat crops card thumbnails to a square.
async function uploadCover(S) {
  const { sale, items } = S.data();
  const pick = [...items.filter((i) => i.status === 'available'), ...items.filter((i) => i.status === 'reserved')].slice(0, 4);
  if (!pick.length) return;
  const size = 600;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  const ims = await loadAll(pick.map((i) => i.photos[0]));
  const cells = pick.length === 1 ? [[0, 0, size, size]]
    : pick.length === 2 ? [[0, 0, size / 2, size], [size / 2, 0, size / 2, size]]
    : [[0, 0, size / 2, size / 2], [size / 2, 0, size / 2, size / 2], [0, size / 2, size / 2, size / 2], [size / 2, size / 2, size / 2, size / 2]];
  pick.forEach((it, k) => {
    const [x, y, w, h] = cells[k] || cells[cells.length - 1];
    if (!cells[k]) return;
    if (ims[k]) drawCover(g, ims[k], x + 2, y + 2, w - 4, h - 4);
    drawPriceTag(g, money(it.priceCents, sale.currency), x + w - 12, y + h - 12, 30);
  });
  const blob = await canvasBlob(c, 0.85);
  const form = new FormData();
  form.append('full', blob, 'cover.jpg');
  await api(`/sale/${S.saleId}/cover`, { method: 'POST', key: S.key, form });
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
async function saveSaleImage(S) {
  const stop = loading('正在生成清单图…');
  try {
    const { sale, items } = S.data();
    const list = [...items.filter((i) => i.status === 'available'), ...items.filter((i) => i.status === 'reserved')];
    if (!list.length) {
      toast('还没有在售的东西');
      return;
    }
    const url = publicUrl(S);
    const qr = await qrMatrix(url);
    const pages = [];
    for (let i = 0; i < list.length; i += 30) pages.push(list.slice(i, i + 30));
    const out = [];
    for (let pi = 0; pi < pages.length; pi++) out.push(await drawSalePage(sale, pages[pi], qr, url, pi, pages.length));
    showImages(out);
  } finally {
    stop();
  }
}

async function drawSalePage(sale, list, qr, url, pi, pn) {
  const W = 1080;
  const pad = 30;
  const gap = 15;
  const cell = (W - pad * 2 - gap * 2) / 3;
  const cap = 96;
  const headH = 210;
  const rows = Math.ceil(list.length / 3);
  const footH = 300;
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
  g.fillText(fitText(g, sale.title + (pn > 1 ? `（${pi + 1}/${pn}）` : ''), W - pad * 2), pad, 90);
  g.font = `400 34px ${FONT}`;
  g.fillStyle = '#484848';
  g.fillText(fitText(g, '📍 ' + sale.location + (sale.leaveDate ? ` · ${dateText(sale.leaveDate)}前出完` : ''), W - pad * 2), pad, 145);
  if (sale.rules.length) {
    g.font = `400 28px ${FONT}`;
    g.fillStyle = '#888';
    g.fillText(fitText(g, sale.rules.join(' · '), W - pad * 2), pad, 190);
  }

  const ims = await loadAll(list.map((i) => i.photos[0]));
  list.forEach((it, k) => {
    const x = pad + (k % 3) * (cell + gap);
    const y = headH + Math.floor(k / 3) * (cell + cap + gap);
    g.fillStyle = '#f5f5f5';
    g.fillRect(x, y, cell, cell);
    if (ims[k]) drawCover(g, ims[k], x, y, cell, cell);
    if (it.status === 'reserved') drawStamp(g, '已预订', x + cell / 2, y + cell / 2, 40, '#111');
    g.fillStyle = '#111';
    g.font = `800 30px ${FONT}`;
    g.fillText(fitText(g, it.name, cell - 8), x + 2, y + cell + 40);
    const price = money(it.priceCents, sale.currency);
    g.font = `900 30px ${FONT}`;
    const tagRight = x + 2 + g.measureText(price).width + 18;
    drawPriceTag(g, price, tagRight, y + cell + 90, 30);
    if (it.origPriceCents > it.priceCents) drawStruck(g, money(it.origPriceCents, sale.currency), tagRight + 12, y + cell + 71, x + cell);
  });

  const fy = H - footH + 30;
  g.fillStyle = BLUE;
  g.fillRect(pad, fy, W - pad * 2, footH - 60);
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
  g.fillText(qr ? '长按识别二维码' : '打开链接', qx + qs + 36, qy + 80);
  g.font = `400 32px ${FONT}`;
  g.fillStyle = '#fff';
  g.fillText('看最新状态、排队', qx + qs + 36, qy + 130);
  g.font = `400 24px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(fitText(g, url, W - pad * 2 - qs - 100), qx + qs + 36, qy + 175);
  return c.toDataURL('image/jpeg', 0.86);
}

function showImages(urls) {
  const el = document.createElement('div');
  el.className = 'imgview';
  el.innerHTML = `
    <div class="tip">${isWeChat ? '长按图片 → 保存图片' : '长按图片保存到相册（电脑上点下面的按钮下载）'}</div>
    ${urls.map((u, i) => `<img src="${u}" alt="清单图 ${i + 1}"><div class="center" style="margin:-6px 0 18px"><a class="btn small" download="清单图-${i + 1}.jpg" href="${u}">下载第 ${i + 1} 张</a></div>`).join('')}
    <div class="bottom-bar" style="background:#111;border-top-color:#333"><div class="inner"><button class="btn big">关闭</button></div></div>`;
  el.querySelector('.bottom-bar button').onclick = () => el.remove();
  document.body.appendChild(el);
}

// ---------- AI photo recognition ----------

const SURVEY = [
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
];

function inviteRowHtml() {
  return `<div class="group"><div class="cell"><input class="inp grow" name="invite" maxlength="20" placeholder="有邀请码？填在这里" autocapitalize="characters"><button class="btn small" data-act="invite">使用</button></div></div>`;
}

async function useInvite(s, onDone) {
  const code = s.el.querySelector('[name=invite]')?.value.trim();
  if (!code) return toast('填一下邀请码');
  buyerToken(true);
  try {
    await api('/ai/invite', { method: 'POST', body: { code } });
    toast('邀请码有效，AI 识别不限次数');
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
    el.textContent = `已催！开发者已经被 ${total} 个人催着充钱了`;
  } catch (err) {
    toast(err.message);
    el.disabled = false;
  }
}

// Global cap reached (or the free model allowance is used up).
function aiBusySheet() {
  openSheet(() => `<h2>今天的 AI 额度被薅完了</h2>
    <div class="hint" style="padding-top:0">AI 识别是开发者自掏腰包付的，今天的额度已经被大家用光了，明天会恢复。自己填名字也很快。<br>想让开发者赶紧加钱？点下面催一下，催的人越多，他越不好意思不充。</div>
    <div class="actions">
      <button class="btn primary big block" data-act="nudge">催开发者充钱</button>
    </div>
    <div style="margin-top:12px">${inviteRowHtml()}</div>`, (act, el, s) => {
    if (act === 'nudge') nudge(el);
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
  openSheet(() => `<h2>你的免费次数薅完了</h2>
    <div class="hint" style="padding-top:0">AI 识别是开发者自掏腰包付的，每人先送这么多次。自己填名字也很快。<br>还想接着用？催开发者加预算吧，催的人多了他就会加。</div>
    <div class="actions"><button class="btn primary big block" data-act="nudge">催开发者加预算</button></div>
    <div style="margin-top:12px">${inviteRowHtml()}</div>`, (act, el, s) => {
    if (act === 'nudge') nudge(el);
    if (act === 'invite') useInvite(s, onRegain);
  });
}

// Three Mom-Test style questions about what actually happened last time, not opinions.
function surveySheet(onRegain) {
  const a = { slowest: '', hours: '', pay: '', detail: '', contact: '' };
  const sh = openSheet(() => `<div class="quota-out">送你的 3 次 AI 识图用完啦</div>
    <h2>想听听你的真实想法</h2>
    <div class="hint" style="padding-top:0">这是我们自己做的小工具，还在摸索怎么做才真正好用。AI 识别每用一次，开发者都要自掏腰包付一点钱，所以先送了 3 次。<br>想请你花半分钟，按真实情况回答 3 个问题。你的回答会直接影响我们接下来做什么。作为感谢，<b>再送你 10 次</b>。</div>
    ${SURVEY.map((s, i) => `
      <div class="survey-q">
        <div class="survey-title">${i + 1}. ${esc(s.q)}</div>
        <div class="seg">${s.options.map((o) => `<button class="${a[s.key] === o ? 'on' : ''}" data-act="pick" data-k="${s.key}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      </div>`).join('')}
    <div class="group" style="margin-top:12px">
      <label class="field"><span>为什么这么选？或者任何想法（选填）</span><input class="inp" name="detail" maxlength="200" value="${esc(a.detail)}"></label>
      <label class="field"><span>愿意让我们再问你两句的话，留个微信（选填）</span><input class="inp" name="contact" maxlength="60" value="${esc(a.contact)}"></label>
    </div>
    <div class="actions">
      <button class="btn primary big block" data-act="submit">提交，再送 10 次</button>
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
      if (!a.slowest || !a.hours || !a.pay) return toast('三道题都选一下就好');
      buyerToken(true);
      el.disabled = true;
      try {
        const q = await api('/ai/survey', { method: 'POST', body: a });
        s.close();
        toast(`谢谢你！又送了 10 次，现在还剩 ${q.left ?? '不限'} 次`);
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
async function aiBatch(files, currency) {
  buyerToken(true);
  const form = new FormData();
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      // Smaller than a single recognition (1024) to keep a batch cheap; big print still reads.
      form.append('image', await resize(await loadImage(url), 768, 0.72), 'photo.jpg');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (currency) form.append('currency', currency);
  return api('/ai/batch', { method: 'POST', form });
}

// Recognise one item from its photos (all shots of the same thing). Throws { code: 'LIMIT' | 'AI_BUSY' | ... }.
async function aiRecognize(files, currency) {
  buyerToken(true);
  const form = new FormData();
  for (const file of files.slice(0, MAX_PHOTOS)) {
    const url = URL.createObjectURL(file);
    try {
      // Large enough to read printed brand / model text.
      form.append('image', await resize(await loadImage(url), 1024, 0.75), 'photo.jpg');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (currency) form.append('currency', currency);
  return api('/ai/identify', { method: 'POST', form });
}

// ---------- 附近的二手 ----------

// Placeholder for the feed at the bottom of a page; mountNearbyFeeds() fills it in after render.
function nearbyEntryHtml() {
  return `<div class="nearby-feed"></div>`;
}

function kmText(km) {
  if (km == null) return '';
  return km < 1 ? '1 公里内' : `约 ${km < 10 ? km.toFixed(1) : Math.round(km)} 公里`;
}

// "附近的二手" as an inline feed: newest first, or by distance once the viewer shares a location.
function mountNearbyFeed(root) {
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = '1';
  let loc = store.get('nearbyLoc', null);
  let scope = store.get('nearbyScope', 'city') === 'near' && loc ? 'near' : 'city';
  let data = null;
  const load = async () => {
    data = null;
    render();
    const q = scope === 'near' ? `?scope=near&lat=${loc.lat.toFixed(2)}&lng=${loc.lng.toFixed(2)}` : '?scope=city';
    data = await api(`/nearby${q}`);
    render();
  };
  const render = () => {
    const items = data?.items || [];
    const cityName = data?.city || '';
    const empty = scope === 'near' ? '10 公里内还没有公开的东西。' : `${cityName ? esc(cityName) + ' ' : ''}还没有公开的东西。`;
    root.innerHTML = `
      <div class="feed-head">
        <b>附近的二手</b>
        <div class="chips feed-tabs">
          <button class="chip ${scope === 'city' ? 'on' : ''}" data-scope="city">同城${cityName && scope === 'city' ? ` · ${esc(cityName)}` : ''}</button>
          <button class="chip ${scope === 'near' ? 'on' : ''}" data-scope="near">附近 10 公里</button>
        </div>
      </div>
      ${!data ? `<div class="empty">加载中…</div>`
        : items.length ? `<div class="grid">${items.map((it) => `
          <a class="tile nearby-tile" href="/s/${esc(it.saleId)}/i/${it.no}">
            <div class="ph"><div class="track"><span><img src="${img(it.photo)}" loading="lazy" alt=""></span></div></div>
            <div class="info">
              <div class="sub">${moneyHtml(it.priceCents, it.currency, it.origPriceCents)}</div>
              <div class="name">${esc(it.name)}</div>
              <div class="extra">📍 ${esc(it.location)}${it.km != null ? ` · ${kmText(it.km)}` : ''}</div>
            </div>
          </a>`).join('')}</div>`
        : `<div class="empty">${empty}<br>你要出二手的话，发一份清单，这里就能看到。</div>`}`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b || b.dataset.scope === scope) return;
    if (b.dataset.scope === 'near' && !loc) {
      b.disabled = true;
      b.textContent = '定位中…';
      const p = await getLocation();
      if (!p) {
        toast('没拿到位置，可以在手机设置里允许浏览器使用位置');
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
      <a class="btn small" href="/my">我的排队</a>
      <a class="btn small" href="/new">我也要发清单</a>
    </div>`;
  mountNearbyFeeds();
}

boot();
