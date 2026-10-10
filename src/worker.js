import { money, contactNote } from '../public/lib.js';

const VERSION = '33';
const HOUR = 3600 * 1000;
const MAYBE_SOLD_MS = 72 * HOUR;
const MAX_QUEUE_PER_SALE = 10;
const MAX_PHOTO_BYTES = 1_800_000;
const MAX_THUMB_BYTES = 400_000;
const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CNY', 'SEK'];
const CONDITION_CODES = ['', 'new', 'like_new', 'good', 'worn'];

class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => {
  throw new ApiError(code, message, status);
};

const now = () => Date.now();

function rid(n = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
const ok = (data) => json({ ok: true, data });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function str(v, { max, min = 0, name }) {
  const s = String(v ?? '').trim();
  if ([...s].length < min) fail('INVALID', `${name}不能为空`);
  if ([...s].length > max) fail('INVALID', `${name}最多 ${max} 字`);
  return s;
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ ok: false, code: e.code, message: e.message }, e.status);
      console.error(e?.stack || e);
      return json({ ok: false, code: 'INTERNAL', message: '服务器出错了，再试一次' }, 500);
    }
  },
};

// Public client config, the same for every request in this isolate.
let CLIENT_CFG = {};

async function route(req, env, ctx) {
  CLIENT_CFG = { googleClientId: env.GOOGLE_CLIENT_ID || '' };
  const url = new URL(req.url);
  const p = url.pathname;
  let m;
  if (p.startsWith('/api/')) return api(req, env, url);
  if ((m = p.match(/^\/img\/([A-Za-z0-9]+)(\/t)?$/))) return image(req, env, ctx, m[1], !!m[2]);
  if ((m = p.match(/^\/s\/([A-Za-z0-9]+)\/i\/(\d+)\/?$/))) return itemPage(env, url, m[1], Number(m[2]));
  if ((m = p.match(/^\/s\/([A-Za-z0-9]+)\/?$/))) return salePage(env, url, m[1]);
  if ((m = p.match(/^\/manage\/([A-Za-z0-9]+)\/?$/))) return managePage(env, url, m[1]);
  if (p === '/' || p === '/new' || p === '/my' || p === '/nearby') {
    return page({ title: '二手清单', desc: '拍照就上架，别人点开就能排队', url });
  }
  return page({ title: '找不到这个页面', url, status: 404, data: { notFound: true } });
}

// ---------- HTML shell with per-link share card meta ----------

function page({ title, desc = '', image = '', url, data = {}, status = 200, robots = false, keepQuery = false }) {
  const canonical = url.origin + url.pathname + (keepQuery ? url.search : '');
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="zh-CN" data-ui="nordic dense">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${robots ? '<meta name="robots" content="noindex"><meta name="referrer" content="same-origin">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="二手清单">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="600">
<meta property="og:image:height" content="600">
<meta itemprop="image" content="${esc(image)}">
<meta name="twitter:image" content="${esc(image)}">` : ''}
<meta itemprop="name" content="${esc(title)}">
<meta itemprop="description" content="${esc(desc)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="theme-color" content="#0058a3">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%A6%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/app.css?v=${VERSION}">
<link rel="stylesheet" href="/theme.css?v=${VERSION}">
</head>
<body>
${image ? `<div class="wx-thumb" aria-hidden="true"><img src="${esc(image)}" width="300" height="300" alt=""></div>` : ''}
<div id="app"></div>
<script>window.__DATA__=${dataJson};window.__CFG__=${JSON.stringify(CLIENT_CFG)}</script>
<script type="module" src="/app.js?v=${VERSION}"></script>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

// With the right ?k=, the management page shares as a "管理入口" card, so a seller can
// send it to 文件传输助手 from WeChat's ··· menu and tap back in later.
async function managePage(env, url, saleId) {
  const k = url.searchParams.get('k') || '';
  const sale = k ? await env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(saleId).first() : null;
  if (!sale || sale.admin_key !== k) return page({ title: '管理我的清单', url, robots: true });
  const first = await env.DB.prepare("SELECT photos FROM items WHERE sale_id = ? AND status != 'removed' ORDER BY no LIMIT 1").bind(saleId).first();
  const photo = sale.cover_photo ? `/img/${sale.cover_photo}` : first ? `/img/${JSON.parse(first.photos)[0]}/t` : '';
  return page({
    title: `管理入口｜${sale.title}`,
    desc: '点开直接管理：上架、改价、看谁预订了。只发给自己，别发到群里。',
    image: photo ? url.origin + photo : '',
    url,
    keepQuery: true,
    robots: true,
  });
}

// Ended (hidden) and deleted lists look the same to buyers.
function gonePage(url) {
  return page({ title: '这份清单已经不见了', desc: '卖家已经结束或删除了这份清单', url, status: 404, data: { notFound: true } });
}

async function salePage(env, url, saleId) {
  const data = await loadPublic(env, saleId, null);
  if (!data || data.sale.status !== 'active') return gonePage(url);
  const { sale, items } = data;
  const avail = items.filter((i) => i.status === 'available');
  const ended = sale.status === 'ended';
  const title = ended ? `${sale.title}｜已结束` : `${sale.title}｜在售 ${avail.length} 件`;
  const sample = avail.slice(0, 4).map((i) => i.name).join(' · ');
  const desc = ended
    ? '这份清单已结束'
    : `${sale.location}${sale.leaveDate ? ` · ${fmtDate(sale.leaveDate)}前出完` : ''} · ${sample || '点开看图、排队'}`;
  const firstPhoto = (avail[0] || items[0])?.photos?.[0];
  const image = sale.coverPhoto
    ? `${url.origin}/img/${sale.coverPhoto}`
    : firstPhoto ? `${url.origin}/img/${firstPhoto}/t` : '';
  return page({ title, desc, image, url, data });
}

async function itemPage(env, url, saleId, no) {
  const data = await loadPublic(env, saleId, null);
  if (!data || data.sale.status !== 'active') return gonePage(url);
  const item = data.items.find((i) => i.no === no);
  if (!item) return page({ title: '找不到这件东西', url, status: 404, data: { notFound: true, item: true } });
  const { sale } = data;
  const state = { available: '', reserved: '（已预订，可排候补）', sold: '（已出）' }[item.status] ?? '';
  const title = `${item.name} ${money(item.priceCents, sale.currency)}${state}`;
  const desc = `${sale.title} · ${sale.location}${item.note ? ` · ${item.note.replace(/\s+/g, ' ')}` : ''}`;
  const image = item.photos[0] ? `${url.origin}/img/${item.photos[0]}/t` : '';
  return page({ title, desc, image, url, data: { ...data, itemNo: no } });
}

function fmtDate(d) {
  const [, mm, dd] = d.split('-').map(Number);
  return `${mm}月${dd}日`;
}

// ---------- images ----------

async function image(req, env, ctx, id, thumb) {
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) return hit;
  const row = await env.DB.prepare('SELECT full, thumb FROM photos WHERE id = ?').bind(id).first();
  if (!row) return new Response('not found', { status: 404 });
  const blob = (thumb && row.thumb) || row.full;
  const bytes = blob instanceof ArrayBuffer ? blob : new Uint8Array(blob);
  const res = new Response(bytes, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
  });
  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}

// ---------- data loading ----------

function mapSale(r) {
  return {
    id: r.id,
    title: r.title,
    location: r.location,
    currency: r.currency,
    rules: JSON.parse(r.rules || '[]'),
    leaveDate: r.leave_date || '',
    status: r.status,
    nextNo: r.next_no,
    coverPhoto: r.cover_photo || '',
    sellerActiveAt: r.seller_active_at,
    createdAt: r.created_at,
    publicNearby: !!r.public_nearby,
    hasLocation: r.lat != null,
  };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const NEARBY_KM = 10;

// City of the request from Cloudflare's IP geolocation (no permission prompt). `?city=` overrides it,
// which is also how local dev (no cf data) can be tested.
function requestCity(req, url) {
  return (url.searchParams.get('city') || req.cf?.city || '').trim().slice(0, 60);
}

// "附近的二手": available items from lists whose sellers opted in.
//   scope=city: same city as the viewer, newest first.
//   scope=near: within NEARBY_KM of the viewer's (rounded) position, nearest first.
async function nearby(env, req, url) {
  const scope = url.searchParams.get('scope') === 'near' ? 'near' : 'city';
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const hasLoc = url.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lng);
  const city = requestCity(req, url);
  if (scope === 'near' && !hasLoc) fail('INVALID', '需要你的大概位置');
  const cityFilter = scope === 'city' && city ? 'AND s.city = ?' : '';
  const { results } = await env.DB.prepare(
    `SELECT i.no, i.name, i.price_cents, i.orig_price_cents, i.photos, i.created_at, s.id AS sale_id, s.location, s.currency, s.lat, s.lng, s.city
     FROM items i JOIN sales s ON s.id = i.sale_id
     WHERE s.public_nearby = 1 AND s.status = 'active' AND i.status = 'available' ${cityFilter}
     ORDER BY i.created_at DESC LIMIT 400`,
  ).bind(...(cityFilter ? [city] : [])).all();
  const items = results.map((r) => ({
    saleId: r.sale_id,
    no: r.no,
    name: r.name,
    priceCents: r.price_cents,
    origPriceCents: r.orig_price_cents ?? null,
    currency: r.currency,
    photo: JSON.parse(r.photos || '[]')[0] || '',
    location: r.location,
    createdAt: r.created_at,
    km: hasLoc && r.lat != null ? Math.round(distanceKm(lat, lng, r.lat, r.lng) * 10) / 10 : null,
  }));
  let list = items;
  if (scope === 'near') {
    list = items.filter((i) => i.km != null && i.km <= NEARBY_KM).sort((a, b) => a.km - b.km || b.createdAt - a.createdAt);
  }
  return ok({ items: list.slice(0, 60), scope, city, radiusKm: NEARBY_KM });
}

function mapItem(r, t) {
  return {
    id: r.id,
    no: r.no,
    name: r.name,
    priceCents: r.price_cents,
    origPriceCents: r.orig_price_cents ?? null,
    condition: r.condition,
    note: r.note,
    photos: JSON.parse(r.photos || '[]'),
    status: r.status,
    statusCheckedAt: r.status_checked_at,
    maybeSold: r.status === 'reserved' && t - r.status_checked_at > MAYBE_SOLD_MS,
  };
}

async function getSale(env, saleId) {
  const r = await env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(saleId).first();
  if (!r) fail('NOT_FOUND', '这份清单不存在', 404);
  return r;
}

async function loadPublic(env, saleId, buyerToken) {
  const t = now();
  const [saleRes, itemsRes, countsRes] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(saleId),
    env.DB.prepare("SELECT * FROM items WHERE sale_id = ? AND status != 'removed' ORDER BY no").bind(saleId),
    env.DB.prepare("SELECT item_id, COUNT(*) AS c FROM queues WHERE sale_id = ? AND status = 'waiting' GROUP BY item_id").bind(saleId),
  ]);
  const saleRow = saleRes.results[0];
  if (!saleRow) return null;
  const counts = Object.fromEntries(countsRes.results.map((r) => [r.item_id, r.c]));
  const items = itemsRes.results.map((r) => ({ ...mapItem(r, t), queueCount: counts[r.id] || 0 }));
  const data = { sale: mapSale(saleRow), items, now: t };
  if (buyerToken) {
    const { results } = await env.DB.prepare(
      `SELECT q.seq, q.item_id,
        (SELECT COUNT(*) FROM queues q2 WHERE q2.item_id = q.item_id AND q2.status = 'waiting' AND q2.seq <= q.seq) AS position
       FROM queues q WHERE q.sale_id = ? AND q.buyer_token = ? AND q.status = 'waiting'`,
    ).bind(saleId, buyerToken).all();
    data.mine = Object.fromEntries(results.map((r) => [r.item_id, { seq: r.seq, position: r.position }]));
    data.contact = await buyerContact(env, saleRow, buyerToken);
  }
  return data;
}

// Seller WeChat ID + merged friend-request note, only for a buyer who is first in line somewhere.
async function buyerContact(env, saleRow, buyerToken) {
  const { results } = await env.DB.prepare(
    `SELECT i.no, i.name, q.nickname FROM queues q JOIN items i ON i.id = q.item_id
     WHERE q.sale_id = ? AND q.buyer_token = ? AND q.status = 'waiting'
       AND NOT EXISTS (SELECT 1 FROM queues q2 WHERE q2.item_id = q.item_id AND q2.status = 'waiting' AND q2.seq < q.seq)
     ORDER BY q.seq`,
  ).bind(saleRow.id, buyerToken).all();
  if (!results.length) return null;
  const nickname = results[results.length - 1].nickname;
  return { wechat: saleRow.wechat_id, note: contactNote(results, nickname), nos: results.map((r) => r.no) };
}

// ---------- API ----------

async function body(req) {
  try {
    return await req.json();
  } catch {
    fail('INVALID', '请求格式不对');
  }
}

// The seller is whoever holds the sale's key, or the Google account that owns it.
async function requireSeller(req, env, saleId) {
  const sale = await getSale(env, saleId);
  const key = req.headers.get('x-key') || '';
  if (key && key === sale.admin_key) return sale;
  if (sale.owner_sub) {
    const user = await currentUser(req, env);
    if (user && user.sub === sale.owner_sub) return sale;
  }
  fail('FORBIDDEN', '没有管理权限', 403);
}

// Same check as requireSeller, but answers yes/no instead of failing.
async function isSeller(req, env, saleId) {
  try {
    await requireSeller(req, env, saleId);
    return true;
  } catch {
    return false;
  }
}

// ---------- Google sign-in ----------

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

async function currentUser(req, env) {
  const token = cookie(req, 'sid');
  if (!token || !/^[A-Za-z0-9]{32}$/.test(token)) return null;
  return env.DB.prepare('SELECT sub, email, name FROM sessions WHERE token = ?').bind(token).first();
}

async function verifyGoogle(env, credential) {
  if (!env.GOOGLE_CLIENT_ID) fail('INVALID', 'Google 登录还没配置');
  if (typeof credential !== 'string' || credential.length > 4096) fail('INVALID', '登录凭证不对');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) fail('FORBIDDEN', 'Google 登录失败，再试一次', 403);
  const t = await r.json();
  const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (t.aud !== env.GOOGLE_CLIENT_ID || !issOk || Number(t.exp) * 1000 < now() || !t.sub) {
    fail('FORBIDDEN', 'Google 登录失败，再试一次', 403);
  }
  return { sub: t.sub, email: t.email_verified === 'true' || t.email_verified === true ? t.email : '', name: t.name || '' };
}

async function ownedSales(env, sub) {
  const { results } = await env.DB.prepare(
    'SELECT id, admin_key, title, status, created_at FROM sales WHERE owner_sub = ? ORDER BY created_at DESC LIMIT 50',
  ).bind(sub).all();
  return results.map((r) => ({ id: r.id, key: r.admin_key, title: r.title, status: r.status }));
}

// Signing in also claims every sale whose key this browser already holds, so sales follow the account.
async function googleLogin(env, b) {
  const g = await verifyGoogle(env, b.credential);
  const token = rid(32);
  const t = now();
  const stmts = [
    env.DB.prepare('INSERT INTO sessions (token, sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)').bind(token, g.sub, g.email, g.name, t),
  ];
  for (const c of (Array.isArray(b.claims) ? b.claims : []).slice(0, 20)) {
    if (typeof c?.id !== 'string' || typeof c?.key !== 'string') continue;
    stmts.push(env.DB.prepare(
      'UPDATE sales SET owner_sub = ?, owner_email = ?, updated_at = ? WHERE id = ? AND admin_key = ? AND (owner_sub IS NULL OR owner_sub = ?)',
    ).bind(g.sub, g.email, t, c.id, c.key, g.sub));
  }
  await env.DB.batch(stmts);
  const res = ok({ user: { email: g.email, name: g.name }, sales: await ownedSales(env, g.sub) });
  res.headers.append('set-cookie', `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
  return res;
}

async function me(req, env) {
  const user = await currentUser(req, env);
  if (!user) return ok({ user: null, sales: [] });
  return ok({ user: { email: user.email, name: user.name }, sales: await ownedSales(env, user.sub) });
}

async function logout(req, env) {
  const token = cookie(req, 'sid');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  const res = ok({});
  res.headers.append('set-cookie', 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res;
}

function buyerTokenOf(req) {
  const t = req.headers.get('x-buyer') || '';
  return /^[A-Za-z0-9]{16,64}$/.test(t) ? t : null;
}

function touchSale(env, saleId, t) {
  return env.DB.prepare('UPDATE sales SET seller_active_at = ?1, updated_at = ?1 WHERE id = ?2').bind(t, saleId);
}

async function api(req, env, url) {
  const p = url.pathname.slice(4);
  const M = req.method;
  let m;

  if (p === '/nearby' && M === 'GET') return nearby(env, req, url);
  if (p === '/ai/quota' && M === 'GET') return ok(await aiQuota(env, requireClient(req)));
  if (p === '/ai/identify' && M === 'POST') return aiIdentify(env, req);
  if (p === '/ai/batch' && M === 'POST') return aiBatch(env, req);
  if (p === '/ai/survey' && M === 'POST') return aiSurvey(env, req);
  if (p === '/ai/invite' && M === 'POST') return aiInvite(env, req);
  if (p === '/ai/nudge' && M === 'POST') return aiNudge(env, req);
  if (p === '/auth/google' && M === 'POST') return googleLogin(env, await body(req));
  if (p === '/auth/logout' && M === 'POST') return logout(req, env);
  if (p === '/me' && M === 'GET') return me(req, env);
  if (p === '/sale' && M === 'POST') return createSale(env, await body(req), await currentUser(req, env), requestCity(req, url));
  if ((m = p.match(/^\/sale\/(\w+)$/))) {
    if (M === 'GET') {
      const data = await loadPublic(env, m[1], buyerTokenOf(req));
      if (!data) fail('NOT_FOUND', '这份清单已经不见了', 404);
      data.isOwner = await isSeller(req, env, m[1]);
      if (data.sale.status !== 'active' && !data.isOwner) fail('NOT_FOUND', '这份清单已经不见了', 404);
      return ok(data);
    }
    if (M === 'PATCH') return updateSale(env, await requireSeller(req, env, m[1]), await body(req), requestCity(req, url));
    if (M === 'DELETE') return deleteSale(env, await requireSeller(req, env, m[1]));
  }
  if ((m = p.match(/^\/sale\/(\w+)\/manage$/)) && M === 'GET') return manageData(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/end$/)) && M === 'POST') return endSale(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/reopen$/)) && M === 'POST') return reopenSale(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/photo$/)) && M === 'POST') return uploadPhoto(env, await requireSeller(req, env, m[1]), req, false);
  if ((m = p.match(/^\/sale\/(\w+)\/cover$/)) && M === 'POST') return uploadPhoto(env, await requireSeller(req, env, m[1]), req, true);
  if ((m = p.match(/^\/sale\/(\w+)\/items$/)) && M === 'POST') return createItem(env, await requireSeller(req, env, m[1]), await body(req));
  if ((m = p.match(/^\/item\/(\w+)$/)) && M === 'PATCH') {
    const item = await getItem(env, m[1]);
    return updateItem(env, await requireSeller(req, env, item.sale_id), item, await body(req));
  }
  if ((m = p.match(/^\/item\/(\w+)\/action$/)) && M === 'POST') {
    const item = await getItem(env, m[1]);
    return itemAction(env, await requireSeller(req, env, item.sale_id), item, await body(req));
  }
  if ((m = p.match(/^\/item\/(\w+)\/join$/)) && M === 'POST') return joinQueue(env, req, await getItem(env, m[1]), await body(req));
  if ((m = p.match(/^\/queue\/(\d+)\/cancel$/)) && M === 'POST') return cancelQueue(env, req, Number(m[1]));
  if (p === '/my' && M === 'GET') return myQueues(env, req);
  fail('NOT_FOUND', '接口不存在', 404);
}

function saleFields(b, partial) {
  const out = {};
  if (!partial || 'title' in b) out.title = str(b.title, { max: 30, min: 1, name: '标题' });
  if (!partial || 'wechatId' in b) out.wechat_id = str(b.wechatId, { max: 60, min: 1, name: '联系方式' });
  if (!partial || 'location' in b) out.location = str(b.location, { max: 40, min: 1, name: '取货地点' });
  if (!partial || 'currency' in b) {
    out.currency = CURRENCY_CODES.includes(b.currency) ? b.currency : fail('INVALID', '货币不支持');
  }
  if (!partial || 'rules' in b) {
    const rules = Array.isArray(b.rules) ? b.rules : [];
    if (rules.length > 5) fail('INVALID', '规则最多 5 条');
    out.rules = JSON.stringify(rules.map((r) => str(r, { max: 20, min: 1, name: '规则' })));
  }
  if (!partial || 'leaveDate' in b) {
    const d = String(b.leaveDate ?? '');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('INVALID', '截止日期格式不对');
    out.leave_date = d || null;
  }
  if (!partial || 'nearby' in b) out.public_nearby = b.nearby ? 1 : 0;
  if ('lat' in b || 'lng' in b) {
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    const valid = b.lat != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    // Rounded to ~1 km: enough for "附近", never a precise address.
    out.lat = valid ? Math.round(lat * 100) / 100 : null;
    out.lng = valid ? Math.round(lng * 100) / 100 : null;
  }
  return out;
}

async function createSale(env, b, user, city) {
  const f = saleFields(b, false);
  const t = now();
  const id = rid(8);
  const key = rid(24);
  await env.DB.prepare(
    `INSERT INTO sales (id, admin_key, title, wechat_id, location, currency, rules, leave_date, public_nearby, lat, lng, city, owner_sub, owner_email, seller_active_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, key, f.title, f.wechat_id, f.location, f.currency, f.rules, f.leave_date, f.public_nearby, f.lat ?? null, f.lng ?? null, city || null, user?.sub ?? null, user?.email ?? null, t, t, t).run();
  return ok({ id, key });
}

async function updateSale(env, sale, b, city) {
  const f = saleFields(b, true);
  if (f.public_nearby && !sale.city && city) f.city = city;
  const cols = Object.keys(f);
  if (!cols.length) return ok({});
  const t = now();
  await env.DB.prepare(
    `UPDATE sales SET ${cols.map((c) => `${c} = ?`).join(', ')}, seller_active_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(...cols.map((c) => f[c]), t, t, sale.id).run();
  return ok({});
}

async function reopenSale(env, sale) {
  const t = now();
  await env.DB.prepare("UPDATE sales SET status = 'active', seller_active_at = ?1, updated_at = ?1 WHERE id = ?2").bind(t, sale.id).run();
  return ok({});
}

// Permanent: the list, its items, queue records and photos are all removed.
async function deleteSale(env, sale) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM queues WHERE sale_id = ?').bind(sale.id),
    env.DB.prepare('DELETE FROM items WHERE sale_id = ?').bind(sale.id),
    env.DB.prepare('DELETE FROM photos WHERE sale_id = ?').bind(sale.id),
    env.DB.prepare('DELETE FROM sales WHERE id = ?').bind(sale.id),
  ]);
  return ok({});
}

async function endSale(env, sale) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE queues SET status = 'removed', closed_at = ? WHERE sale_id = ? AND status = 'waiting'").bind(t, sale.id),
    env.DB.prepare("UPDATE sales SET status = 'ended', seller_active_at = ?1, updated_at = ?1 WHERE id = ?2").bind(t, sale.id),
  ]);
  return ok({});
}

async function manageData(env, sale) {
  const t = now();
  const [itemsRes, queuesRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM items WHERE sale_id = ? AND status != 'removed' ORDER BY no").bind(sale.id),
    env.DB.prepare("SELECT seq, item_id, nickname, note, added_by, created_at FROM queues WHERE sale_id = ? AND status = 'waiting' ORDER BY seq").bind(sale.id),
  ]);
  const queues = {};
  for (const q of queuesRes.results) {
    (queues[q.item_id] ||= []).push({ seq: q.seq, nickname: q.nickname, note: q.note, addedBy: q.added_by, createdAt: q.created_at });
  }
  const soldCents = itemsRes.results.filter((r) => r.status === 'sold').reduce((s, r) => s + r.price_cents, 0);
  return ok({
    sale: { ...mapSale(sale), wechatId: sale.wechat_id, key: sale.admin_key, ownerEmail: sale.owner_email || '' },
    items: itemsRes.results.map((r) => ({ ...mapItem(r, t), queue: queues[r.id] || [], queueCount: (queues[r.id] || []).length })),
    soldCents,
    now: t,
  });
}

async function uploadPhoto(env, sale, req, isCover) {
  let form;
  try {
    form = await req.formData();
  } catch {
    fail('INVALID', '照片上传格式不对');
  }
  const full = form.get('full');
  const thumb = form.get('thumb');
  if (!full || typeof full === 'string') fail('INVALID', '没有收到照片');
  if (full.size > MAX_PHOTO_BYTES) fail('INVALID', '照片太大了');
  if (thumb && typeof thumb !== 'string' && thumb.size > MAX_THUMB_BYTES) fail('INVALID', '缩略图太大了');
  const fullBuf = await full.arrayBuffer();
  const thumbBuf = thumb && typeof thumb !== 'string' ? await thumb.arrayBuffer() : null;
  const id = rid(12);
  const t = now();
  const stmts = [
    env.DB.prepare('INSERT INTO photos (id, sale_id, full, thumb, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, sale.id, fullBuf, thumbBuf, t),
  ];
  if (isCover) {
    if (sale.cover_photo) stmts.push(env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(sale.cover_photo));
    stmts.push(env.DB.prepare('UPDATE sales SET cover_photo = ?, updated_at = ? WHERE id = ?').bind(id, t, sale.id));
  }
  await env.DB.batch(stmts);
  return ok({ photoId: id });
}

async function checkPhotos(env, saleId, photos) {
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 3) fail('INVALID', '每件 1 到 3 张照片');
  const marks = photos.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT id FROM photos WHERE sale_id = ? AND id IN (${marks})`).bind(saleId, ...photos).all();
  if (results.length !== new Set(photos).size) fail('INVALID', '照片不存在');
  return JSON.stringify(photos);
}

function itemFields(b, partial) {
  const out = {};
  if (!partial || 'name' in b) out.name = str(b.name, { max: 30, min: 1, name: '名字' });
  if (!partial || 'priceCents' in b) {
    const c = b.priceCents;
    if (!Number.isInteger(c) || c < 0 || c > 100_000_000) fail('INVALID', '价格不对');
    out.price_cents = c;
  }
  if (!partial || 'origPriceCents' in b) {
    const c = b.origPriceCents ?? null;
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > 100_000_000)) fail('INVALID', '原价不对');
    out.orig_price_cents = c;
  }
  if (!partial || 'condition' in b) {
    out.condition = CONDITION_CODES.includes(b.condition ?? '') ? b.condition ?? '' : fail('INVALID', '成色不对');
  }
  if (!partial || 'note' in b) out.note = str(b.note, { max: 100, name: '详情' });
  return out;
}

async function createItem(env, sale, b) {
  if (sale.status !== 'active') fail('CONFLICT', '这份清单已结束');
  const f = itemFields(b, false);
  const photos = await checkPhotos(env, sale.id, b.photos);
  const t = now();
  const id = rid(10);
  // Number allocation and the counter bump run in one transaction; numbers are never reused.
  const [, , got] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO items (id, sale_id, no, name, price_cents, orig_price_cents, condition, note, photos, status, status_checked_at, status_changed_at, created_at, updated_at)
       VALUES (?1, ?2, (SELECT next_no FROM sales WHERE id = ?2), ?3, ?4, ?9, ?5, ?6, ?7, 'available', ?8, ?8, ?8, ?8)`,
    ).bind(id, sale.id, f.name, f.price_cents, f.condition, f.note, photos, t, f.orig_price_cents),
    env.DB.prepare('UPDATE sales SET next_no = next_no + 1, seller_active_at = ?1, updated_at = ?1 WHERE id = ?2').bind(t, sale.id),
    env.DB.prepare('SELECT no FROM items WHERE id = ?').bind(id),
  ]);
  return ok({ id, no: got.results[0].no });
}

async function getItem(env, itemId) {
  const r = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!r) fail('NOT_FOUND', '这件东西不存在', 404);
  return r;
}

async function updateItem(env, sale, item, b) {
  const f = itemFields(b, true);
  if ('photos' in b) f.photos = await checkPhotos(env, sale.id, b.photos);
  const t = now();
  if ('price_cents' in f && f.price_cents !== item.price_cents) f.price_changed_at = t;
  f.status_checked_at = t;
  f.updated_at = t;
  const cols = Object.keys(f);
  await env.DB.batch([
    env.DB.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => f[c]), item.id),
    touchSale(env, sale.id, t),
  ]);
  return ok({});
}

// Item becomes available again when nobody is left waiting.
function releaseIfEmpty(env, itemId, t) {
  return env.DB.prepare(
    `UPDATE items SET status = 'available', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1
     WHERE id = ?2 AND status = 'reserved' AND NOT EXISTS (SELECT 1 FROM queues WHERE item_id = ?2 AND status = 'waiting')`,
  ).bind(t, itemId);
}

async function itemAction(env, sale, item, b) {
  const t = now();
  const db = env.DB;
  const head = await db.prepare("SELECT * FROM queues WHERE item_id = ? AND status = 'waiting' ORDER BY seq LIMIT 1").bind(item.id).first();
  const stmts = [];
  const open = item.status === 'available' || item.status === 'reserved';

  switch (b.action) {
    case 'sell': {
      if (!open) fail('CONFLICT', '这件已经处理过了');
      if (head) {
        stmts.push(db.prepare("UPDATE queues SET status = 'sold', closed_at = ? WHERE seq = ?").bind(t, head.seq));
        stmts.push(db.prepare("UPDATE queues SET status = 'removed', closed_at = ? WHERE item_id = ? AND status = 'waiting' AND seq != ?").bind(t, item.id, head.seq));
      }
      stmts.push(db.prepare("UPDATE items SET status = 'sold', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2").bind(t, item.id));
      break;
    }
    case 'still': {
      stmts.push(db.prepare('UPDATE items SET status_checked_at = ? WHERE id = ?').bind(t, item.id));
      break;
    }
    case 'remove': {
      stmts.push(db.prepare("UPDATE queues SET status = 'removed', closed_at = ? WHERE item_id = ? AND status = 'waiting'").bind(t, item.id));
      stmts.push(db.prepare("UPDATE items SET status = 'removed', status_changed_at = ?1, updated_at = ?1 WHERE id = ?2").bind(t, item.id));
      break;
    }
    case 'decline': {
      if (!head || head.seq !== b.seq) fail('CONFLICT', '排第 1 位的人变了，刷新一下');
      stmts.push(db.prepare("UPDATE queues SET status = 'declined', closed_at = ? WHERE seq = ?").bind(t, head.seq));
      stmts.push(db.prepare('UPDATE items SET status_checked_at = ? WHERE id = ?').bind(t, item.id));
      stmts.push(releaseIfEmpty(env, item.id, t));
      break;
    }
    case 'removeQueue': {
      const q = await db.prepare("SELECT seq FROM queues WHERE seq = ? AND item_id = ? AND status = 'waiting'").bind(b.seq ?? -1, item.id).first();
      if (!q) fail('CONFLICT', '这个人已经不在队里了');
      stmts.push(db.prepare("UPDATE queues SET status = 'removed', closed_at = ? WHERE seq = ?").bind(t, q.seq));
      stmts.push(db.prepare('UPDATE items SET status_checked_at = ? WHERE id = ?').bind(t, item.id));
      stmts.push(releaseIfEmpty(env, item.id, t));
      break;
    }
    case 'addManual': {
      if (!open) fail('CONFLICT', '这件已经出了');
      const nickname = str(b.nickname, { max: 20, min: 1, name: '称呼' });
      stmts.push(db.prepare(
        "INSERT INTO queues (sale_id, item_id, buyer_token, nickname, note, status, added_by, created_at) VALUES (?, ?, NULL, ?, '', 'waiting', 'seller', ?)",
      ).bind(sale.id, item.id, nickname, t));
      stmts.push(db.prepare(
        "UPDATE items SET status = 'reserved', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'available'",
      ).bind(t, item.id));
      break;
    }
    default:
      fail('INVALID', '未知操作');
  }
  stmts.push(touchSale(env, sale.id, t));
  await db.batch(stmts);
  return ok({});
}

async function joinQueue(env, req, item, b) {
  const token = buyerTokenOf(req);
  if (!token) fail('INVALID', '缺少买家标识');
  const sale = await getSale(env, item.sale_id);
  if (sale.status !== 'active') fail('CONFLICT', '这份清单已结束');
  if (item.status !== 'available' && item.status !== 'reserved') fail('CONFLICT', '这件已经出了');
  if (await isSeller(req, env, sale.id)) fail('CONFLICT', '这是你自己的清单，不能预订自己的东西');
  const nickname = str(b.nickname, { max: 20, min: 1, name: '称呼' });
  const note = str(b.note, { max: 30, name: '备注' });
  const db = env.DB;
  const mine = await db.prepare("SELECT item_id FROM queues WHERE sale_id = ? AND buyer_token = ? AND status = 'waiting'").bind(sale.id, token).all();
  if (mine.results.some((r) => r.item_id === item.id)) fail('CONFLICT', '你已经在这件的队里了');
  if (mine.results.length >= MAX_QUEUE_PER_SALE) fail('LIMIT', `同一份清单最多同时排 ${MAX_QUEUE_PER_SALE} 件`);
  const t = now();
  try {
    await db.batch([
      db.prepare(
        "INSERT INTO queues (sale_id, item_id, buyer_token, nickname, note, status, added_by, created_at) VALUES (?, ?, ?, ?, ?, 'waiting', 'buyer', ?)",
      ).bind(sale.id, item.id, token, nickname, note, t),
      db.prepare(
        "UPDATE items SET status = 'reserved', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'available'",
      ).bind(t, item.id),
    ]);
  } catch (e) {
    if (String(e?.message).includes('UNIQUE')) fail('CONFLICT', '你已经在这件的队里了');
    throw e;
  }
  const pos = await db.prepare(
    `SELECT q.seq, (SELECT COUNT(*) FROM queues q2 WHERE q2.item_id = q.item_id AND q2.status = 'waiting' AND q2.seq <= q.seq) AS position
     FROM queues q WHERE q.item_id = ? AND q.buyer_token = ? AND q.status = 'waiting'`,
  ).bind(item.id, token).first();
  return ok({ seq: pos.seq, position: pos.position, contact: pos.position === 1 ? await buyerContact(env, sale, token) : null });
}

async function cancelQueue(env, req, seq) {
  const token = buyerTokenOf(req);
  const q = await env.DB.prepare("SELECT * FROM queues WHERE seq = ? AND status = 'waiting'").bind(seq).first();
  if (!q || !token || q.buyer_token !== token) fail('NOT_FOUND', '找不到这条排队', 404);
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE queues SET status = 'cancelled', closed_at = ? WHERE seq = ?").bind(t, seq),
    releaseIfEmpty(env, q.item_id, t),
  ]);
  return ok({});
}

async function myQueues(env, req) {
  const token = buyerTokenOf(req);
  if (!token) return ok({ queues: [] });
  const since = now() - 14 * 24 * HOUR;
  const { results } = await env.DB.prepare(
    `SELECT q.seq, q.status, q.nickname, q.sale_id, q.item_id, q.created_at,
       i.no, i.name, i.price_cents, i.photos, i.status AS item_status,
       s.title, s.currency, s.wechat_id,
       (SELECT COUNT(*) FROM queues q2 WHERE q2.item_id = q.item_id AND q2.status = 'waiting' AND q2.seq <= q.seq) AS position
     FROM queues q JOIN items i ON i.id = q.item_id JOIN sales s ON s.id = q.sale_id
     WHERE q.buyer_token = ? AND (q.status = 'waiting' OR q.closed_at > ?)
     ORDER BY q.status = 'waiting' DESC, q.seq DESC LIMIT 100`,
  ).bind(token, since).all();
  const notes = {};
  for (const r of results) {
    if (r.status === 'waiting' && r.position === 1) (notes[r.sale_id] ||= { items: [], nickname: r.nickname }).items.push({ no: r.no, name: r.name });
  }
  const queues = results.map((r) => {
    const head = r.status === 'waiting' && r.position === 1;
    return {
      seq: r.seq,
      status: r.status,
      saleId: r.sale_id,
      saleTitle: r.title,
      no: r.no,
      name: r.name,
      priceCents: r.price_cents,
      currency: r.currency,
      photo: JSON.parse(r.photos || '[]')[0] || '',
      itemStatus: r.item_status,
      position: r.status === 'waiting' ? r.position : null,
      contact: head ? { wechat: r.wechat_id, note: contactNote(notes[r.sale_id].items, notes[r.sale_id].nickname) } : null,
    };
  });
  return ok({ queues });
}

// ---------- AI photo recognition (Workers AI) ----------

// Gemma 4 with thinking off: ~1s, best Chinese item names in our test, cheapest per token.
const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const AI_FREE_USES = 3;
const AI_SURVEY_BONUS = 10;
// Our own cap, well inside the Workers AI free daily allocation (~10 neurons per call).
const AI_DAILY_CAP = 400;
const AI_MAX_IMAGE_BYTES = 400_000;
const AI_MAX_IMAGES = 3;
// Several photos picked at once: sorted into items and recognised in one call.
const AI_BATCH_MAX_IMAGES = 8;
const AI_BATCH_MAX_IMAGE_BYTES = 250_000;

const AI_FIELDS = '"brand":"品牌","model":"型号","name":"物品叫法","detail":"详情","retail":"原价范围"';
const aiFieldRules = (currency) => `- brand：看 logo、印的字或很有辨识度的外观认出的品牌，用中国人常用的叫法（例如「宜家」「戴森」「苹果」「无印良品」）；认不出就写空字符串。
- model：型号或系列名，保持原文（例如「MALM」「Supersonic」「AirPods Pro」）。只在照片上印着、或外观独一无二、你非常确定时才写；同品牌有好几款长得像的，就写空字符串，写错比不写更糟。
- name：2 到 8 个字，大家常用的叫法，不带品牌（例如「台灯」「吹风机」「抽屉柜」）。
- detail：不超过 30 个字，写照片里看不出来、但买家想知道的信息：这一款的用途、功能、用法或关键规格（例如「1600W，三档风速，带负离子」「适合 140×200 床垫」「可放 13 寸笔记本」）。照片已经给买家看了，不要再描述颜色、外观、数量这些看得见的东西，也不要评价新旧成色。只写你有把握的；一看就懂的普通东西（杯子、衣架）写空字符串。
- retail：全新时的大概零售价范围，单位 ${currency}，只写数字，格式「30-40」。认出了品牌就估这一款的价；没认出品牌就估这类东西普通新品的常见价（例如无牌平板支架「10-20」）。范围尽量窄，完全没把握才写空字符串。`;

const aiPrompt = (currency, n = 1) => `${n > 1 ? `这是 ${n} 张同一件物品的照片，准备在留学生二手群里出售。请结合所有照片识别这件物品` : '这是一张准备在留学生二手群里出售的物品照片。请识别照片里的主要物品'}，用简体中文回答。
只输出一行 JSON，不要任何别的文字：{${AI_FIELDS}}
${aiFieldRules(currency)}`;

const aiBatchPrompt = (currency, n) => `下面是同一个人准备在留学生二手群里出售的 ${n} 张照片，每张前面标了编号。有的东西拍了好几张（不同角度、细节、标签、包装），有的只拍了一张。
第一步：按编号顺序一张一张看，给每张照片标上它拍的是哪件物品，用字母 A、B、C… 表示，同一件物品用同一个字母。同类但不是同一件的东西（例如两个不同的杯子）用不同字母；一套东西（例如一套餐具）算一件。
第二步：结合每件物品的所有照片识别它，用简体中文回答。
只输出一行 JSON，不要任何别的文字。photos 按编号顺序正好 ${n} 个字母：{"photos":["A","B","A"],"items":[{"id":"A",${AI_FIELDS}}]}
每件物品的字段：
${aiFieldRules(currency)}`;

async function aiQuota(env, clientId) {
  const row = await env.DB.prepare('SELECT * FROM ai_quota WHERE client_id = ?').bind(clientId).first();
  const used = row?.used ?? 0;
  const bonus = row?.bonus ?? 0;
  const unlimited = !!row?.unlimited;
  return { left: unlimited ? null : Math.max(0, AI_FREE_USES + bonus - used), unlimited, surveyDone: !!row?.survey_done };
}

// Two statements: make sure the row exists, then apply the change (works for new and existing rows).
function upsertQuota(env, clientId, set) {
  const t = now();
  return [
    env.DB.prepare('INSERT OR IGNORE INTO ai_quota (client_id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(clientId, t),
    env.DB.prepare(`UPDATE ai_quota SET ${set}, updated_at = ?2 WHERE client_id = ?1`).bind(clientId, t),
  ];
}

function requireClient(req) {
  const id = buyerTokenOf(req);
  if (!id) fail('INVALID', '缺少设备标识，刷新一下再试');
  return id;
}

// The reply may already be parsed JSON, or text containing it; keep only short, clean fields.
function parseAiReply(reply) {
  let out = {};
  if (reply && typeof reply === 'object') out = reply;
  else {
    const m = String(reply || '').match(/\{[\s\S]*?\}/);
    try {
      out = m ? JSON.parse(m[0]) : {};
    } catch {}
  }
  const clean = (v, n) => [...String(v ?? '').replace(/[\r\n"{}]/g, ' ').trim()].slice(0, n).join('');
  const brand = clean(out.brand, 12);
  const model = clean(out.model, 20);
  const what = clean(out.name, 10);
  if (!what) return { name: '', brand, model, note: '', retail: null };
  // 宜家台灯 / 戴森 Supersonic 吹风机: a Latin model name needs spaces around it.
  const name = model ? `${brand}${brand ? ' ' : ''}${model} ${what}` : `${brand}${what}`;
  // Brand and model also go into the details, where buyers look for them.
  const which = [brand && `品牌：${brand}`, model && `型号：${model}`].filter(Boolean).join('，');
  const note = [which, clean(out.detail ?? out.note, 50)].filter(Boolean).join('。');
  // Without a brand the range is for the kind of item in general, and the UI says so.
  const retail = parseRetail(out.retail);
  return { name: clean(name, 30), brand, model, note: clean(note, 100), retail: retail && { ...retail, generic: !brand } };
}

// "30-40" / "30~40" / "35" -> { low, high } in whole currency units; anything odd -> null.
function parseRetail(v) {
  const nums = String(v ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  const low = Math.min(...nums.slice(0, 2));
  const high = Math.max(...nums.slice(0, 2));
  if (!(low > 0) || high > 100000 || high > low * 5) return null;
  return { low: Math.round(low), high: Math.round(high) };
}

async function imagePart(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${btoa(bin)}` } };
}

// Quota and daily-cap checks shared by single and batch recognition.
async function aiGate(env, clientId) {
  const q = await aiQuota(env, clientId);
  if (!q.unlimited && q.left <= 0) fail('LIMIT', q.surveyDone ? '送的次数用完了' : '送的 3 次用完了', 429);
  const day = new Date().toISOString().slice(0, 10);
  const daily = await env.DB.prepare('SELECT count FROM ai_daily WHERE day = ?').bind(day).first();
  if (!q.unlimited && (daily?.count ?? 0) >= AI_DAILY_CAP) fail('AI_BUSY', '今天的 AI 免费额度用完了，先打字也很快', 503);
  return { q, day };
}

async function aiImages(req, max, maxBytes) {
  let form;
  try {
    form = await req.formData();
  } catch {
    fail('INVALID', '照片格式不对');
  }
  const files = form.getAll('image').filter((f) => f && typeof f !== 'string').slice(0, max);
  if (!files.length) fail('INVALID', '没有收到照片');
  if (files.some((f) => f.size > maxBytes)) fail('INVALID', '照片太大了');
  const currency = /^[A-Z]{3}$/.test(form.get('currency') || '') ? form.get('currency') : 'EUR';
  return { images: await Promise.all(files.map(imagePart)), currency };
}

// Workers AI returns either { response } or an OpenAI-style { choices: [{ message }] }.
async function runAi(env, content, maxTokens) {
  let reply;
  try {
    reply = await env.AI.run(AI_MODEL, {
      messages: [{ role: 'user', content }],
      max_tokens: maxTokens,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },
    });
  } catch (e) {
    console.error('ai error', e?.message || e);
    // Free daily allocation used up (or plan limit): same message as our own cap.
    if (/neuron|quota|limit|free plan|4006|5035/i.test(String(e?.message))) fail('AI_BUSY', '今天的 AI 免费额度用完了，先打字也很快', 503);
    fail('AI_ERROR', 'AI 暂时识别不了，直接打字也行', 502);
  }
  return reply?.response || reply?.choices?.[0]?.message?.content;
}

// uses: recognised items, charged to the seller; calls: rough work done, for our daily cap.
function chargeAi(env, clientId, day, uses, calls) {
  return env.DB.batch([
    ...(uses ? upsertQuota(env, clientId, `used = used + ${uses}`) : []),
    env.DB.prepare('INSERT INTO ai_daily (day, count) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET count = count + ?2').bind(day, calls),
  ]);
}

async function aiIdentify(env, req) {
  const clientId = requireClient(req);
  const { day } = await aiGate(env, clientId);
  // Up to AI_MAX_IMAGES shots of the same item; one call, one use of the quota.
  const { images, currency } = await aiImages(req, AI_MAX_IMAGES, AI_MAX_IMAGE_BYTES);
  const result = parseAiReply(await runAi(env, [{ type: 'text', text: aiPrompt(currency, images.length) }, ...images], 250));
  if (!result.name) fail('AI_ERROR', '没认出来是什么，直接打字吧', 502);

  // Only successful recognitions count against the quota.
  await chargeAi(env, clientId, day, 1, 1);
  const after = await aiQuota(env, clientId);
  return ok({ ...result, left: after.left, unlimited: after.unlimited });
}

// The reply labels each photo, in order, with the letter of the item it shows. Photos with
// the same letter become one item; a missing or unknown label makes a photo its own,
// unrecognised item. Items come back ordered by their first photo, photos counted from 0.
function parseBatch(reply, n) {
  let out = {};
  if (reply && typeof reply === 'object') out = reply;
  else {
    const m = String(reply || '').match(/\{[\s\S]*\}/);
    try {
      out = m ? JSON.parse(m[0]) : {};
    } catch {}
  }
  const info = new Map();
  for (const it of Array.isArray(out.items) ? out.items : []) if (it && typeof it === 'object') info.set(String(it.id ?? '').trim(), it);
  const labels = Array.isArray(out.photos) ? out.photos : [];
  const byLabel = new Map();
  const items = [];
  for (let i = 0; i < n; i++) {
    const label = String(labels[i] ?? '').trim();
    const known = label && info.has(label);
    if (known && byLabel.has(label)) byLabel.get(label).photos.push(i);
    else {
      const item = { photos: [i], ...parseAiReply(known ? info.get(label) : {}) };
      if (known) byLabel.set(label, item);
      items.push(item);
    }
  }
  return items;
}

// One call for a batch of photos: which ones show the same item, and what each item is.
// Each recognised item uses one of the seller's uses; past what is left, items come back
// grouped but unnamed, with limited set.
async function aiBatch(env, req) {
  const clientId = requireClient(req);
  const { q, day } = await aiGate(env, clientId);
  const { images, currency } = await aiImages(req, AI_BATCH_MAX_IMAGES, AI_BATCH_MAX_IMAGE_BYTES);
  const content = [{ type: 'text', text: aiBatchPrompt(currency, images.length) }];
  images.forEach((im, i) => content.push({ type: 'text', text: `第 ${i + 1} 张：` }, im));
  const items = parseBatch(await runAi(env, content, 120 + 110 * images.length), images.length);

  let uses = 0;
  let limited = false;
  for (const it of items) {
    if (!it.name) continue;
    if (q.unlimited || uses < q.left) uses++;
    else {
      Object.assign(it, parseAiReply({}));
      limited = true;
    }
  }
  await chargeAi(env, clientId, day, uses, Math.max(uses, Math.ceil(images.length / 3)));
  const after = await aiQuota(env, clientId);
  return ok({ items, limited, left: after.left, unlimited: after.unlimited });
}

const SURVEY_FIELDS = ['slowest', 'hours', 'pay', 'detail', 'contact'];

async function aiSurvey(env, req) {
  const clientId = requireClient(req);
  const b = await body(req);
  const answers = {};
  for (const k of SURVEY_FIELDS) answers[k] = str(b[k], { max: 300, name: '回答' });
  if (!answers.slowest || !answers.hours || !answers.pay) fail('INVALID', '三道题都选一下就好');
  const q = await aiQuota(env, clientId);
  const stmts = [env.DB.prepare('INSERT INTO survey_responses (client_id, answers, created_at) VALUES (?, ?, ?)').bind(clientId, JSON.stringify(answers), now())];
  if (!q.surveyDone) stmts.push(...upsertQuota(env, clientId, `bonus = bonus + ${AI_SURVEY_BONUS}, survey_done = 1`));
  await env.DB.batch(stmts);
  return ok(await aiQuota(env, clientId));
}

async function aiNudge(env, req) {
  const clientId = requireClient(req);
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('INSERT OR IGNORE INTO ai_nudges (client_id, day, created_at) VALUES (?, ?, ?)').bind(clientId, day, now()).run();
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT client_id) AS n FROM ai_nudges').first();
  return ok({ total: total.n });
}

async function aiInvite(env, req) {
  const clientId = requireClient(req);
  const code = String((await body(req)).code ?? '').trim().toUpperCase();
  if (!env.INVITE_CODE || code !== env.INVITE_CODE.toUpperCase()) fail('INVALID', '邀请码不对');
  await env.DB.batch(upsertQuota(env, clientId, 'unlimited = 1'));
  return ok(await aiQuota(env, clientId));
}
