import { money, contactNote, byRecent, itemText, saleText, textLang, normTelegram, looksLikeTelegram, RULES } from '../public/lib.js';

const VERSION = '57';
const HOUR = 3600 * 1000;
const MAYBE_SOLD_MS = 72 * HOUR;
// An open list pauses this long after its last renewal: buyers can look but not queue,
// and it leaves 附近的二手, until the seller renews it on the management page.
const LIST_TTL_MS = 30 * 24 * HOUR;
const MAX_QUEUE_PER_SALE = 10;
const MAX_PHOTO_BYTES = 1_800_000;
const MAX_THUMB_BYTES = 400_000;
const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CNY', 'SEK'];
const CONDITION_CODES = ['', 'new', 'like_new', 'good', 'worn'];

// message: [Chinese, English]; the response carries the one the client asked for.
class ApiError extends Error {
  constructor(code, message, status = 400) {
    const [zh, en] = Array.isArray(message) ? message : [message, message];
    super(zh);
    this.en = en;
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => {
  throw new ApiError(code, message, status);
};

// The client's UI language, from the app's X-Lang header. Clients from before English support send
// none and show Chinese, whatever the phone's language.
function reqLang(req) {
  return req.headers.get('x-lang') === 'en' ? 'en' : 'zh';
}

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
const textFile = (body, type) => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=3600' } });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function str(v, { max, min = 0, name }) {
  const s = String(v ?? '').trim();
  const [zh, en] = Array.isArray(name) ? name : [name, name];
  if ([...s].length < min) fail('INVALID', [`${zh}不能为空`, `${en} is required`]);
  if ([...s].length > max) fail('INVALID', [`${zh}最多 ${max} 字`, `${en}: ${max} characters at most`]);
  return s;
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      const en = reqLang(req) === 'en';
      if (e instanceof ApiError) return json({ ok: false, code: e.code, message: en ? e.en : e.message }, e.status);
      console.error(e?.stack || e);
      return json({ ok: false, code: 'INTERNAL', message: en ? 'Server error, try again' : '服务器出错了，再试一次' }, 500);
    }
  },
};

// Browser storage belongs to one address, and it holds each seller's list keys and each buyer's
// place in line. So a person's browser copies it into the link it follows to the new address,
// in the #fragment, which never reaches a server (i18n.js takes it in). The fragment goes along
// even with nothing stored, so the new address knows to ask for a new bookmark. Crawlers and link
// previews get a plain 301.
function moved(req, to) {
  if (/bot[/ (-]|crawler|spider|facebookexternalhit|WhatsApp/i.test(req.headers.get('user-agent') || '')) return Response.redirect(to, 301);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><link rel="canonical" href="${esc(to)}"><title>二手清单 Secondhand List</title>
<p style="font:16px sans-serif;text-align:center;margin-top:40vh">二手清单搬到新网址了 · Secondhand List has moved<br><a href="${esc(to)}">${esc(to)}</a></p>
<script>
var data = {};
try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); data[k] = localStorage.getItem(k); } } catch (e) {}
var to = ${JSON.stringify(to).replace(/</g, '\\u003c')};
location.replace(to + '#migrate=' + encodeURIComponent(JSON.stringify({ data: data, hash: location.hash })));
</script>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

// Public client config, the same for every request in this isolate.
let CLIENT_CFG = {};

// Language of a page's share card (what WeChat or Telegram shows before anyone opens it).
// Links shared to Telegram carry src=tg; WeChat cards stay Chinese unless ?lang=en.
// fallback: the language the list itself is written in, for list and item pages.
function pageLang(url, fallback = 'zh') {
  // cl: the card language of a link shared to a Chinese-speaking Telegram group.
  const l = url.searchParams.get('cl') || url.searchParams.get('lang');
  if (l === 'zh' || l === 'en') return l;
  if (url.searchParams.get('src') === 'tg') return 'en';
  return fallback;
}

async function route(req, env, ctx) {
  CLIENT_CFG = { googleClientId: env.GOOGLE_CLIENT_ID || '', keepGiftUses: KEEP_GIFT_USES, tipUrl: env.TIP_URL || '' };
  const url = new URL(req.url);
  const p = url.pathname;
  let m;
  // Pages on the old workers.dev address (and www) move to SITE_ORIGIN. The API and photos stay
  // reachable there for pages that are already open.
  if (env.SITE_ORIGIN && url.origin !== env.SITE_ORIGIN && /\.workers\.dev$|^www\./.test(url.hostname)
    && !p.startsWith('/api/') && !p.startsWith('/img/') && (req.method === 'GET' || req.method === 'HEAD')) {
    return moved(req, env.SITE_ORIGIN + p + url.search);
  }
  if (p.startsWith('/api/')) return api(req, env, url, ctx);
  if ((m = p.match(/^\/img\/([A-Za-z0-9]+)(\/t)?$/))) return image(req, env, ctx, m[1], !!m[2]);
  if ((m = p.match(/^\/s\/([A-Za-z0-9]+)\/i\/(\d+)\/?$/))) {
    ctx.waitUntil(backfillTranslations(env, m[1]));
    return itemPage(env, url, m[1], Number(m[2]));
  }
  if ((m = p.match(/^\/s\/([A-Za-z0-9]+)\/?$/))) {
    ctx.waitUntil(backfillTranslations(env, m[1]));
    return salePage(env, url, m[1]);
  }
  if ((m = p.match(/^\/manage\/([A-Za-z0-9]+)\/?$/))) return managePage(env, url, m[1]);
  if (p === '/robots.txt') return textFile(`User-agent: *\nDisallow: /manage/\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`, 'text/plain');
  if (p === '/sitemap.xml') {
    return textFile(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${url.origin}/</loc></url>
  <url><loc>${url.origin}/en</loc></url>
</urlset>
`, 'application/xml');
  }
  // The landing page: / in Chinese, /en in English, rendered here so search engines read it.
  // People who already have lists get their home over it (app.js).
  if (p === '/' || p === '/en') {
    const l = p === '/en' ? 'en' : 'zh';
    return page({
      title: APP_TITLE[l],
      desc: APP_DESC[l],
      image: `${url.origin}/icon-300.png`,
      imageSize: 300,
      url,
      lang: l,
      jsonLd: { '@context': 'https://schema.org', '@graph': [appJsonLd(url, l), faqJsonLd(l)] },
      alternates: { 'zh-CN': `${url.origin}/`, en: `${url.origin}/en`, 'x-default': `${url.origin}/` },
      body: landingHtml(l),
      data: { landing: l },
    });
  }
  const lang = pageLang(url);
  const T = (zh, en) => (lang === 'en' ? en : zh);
  // /new is the public "what is this" page buyers reach from 我也有二手要出, and the one people
  // save or forward, so its card says what the app does.
  if (p === '/new') {
    return page({ title: APP_TITLE[lang], desc: APP_DESC[lang], image: `${url.origin}/icon-300.png`, imageSize: 300, url, lang, jsonLd: appJsonLd(url, lang) });
  }
  if (p === '/my' || p === '/nearby') {
    return page({ title: APP_NAME[lang], desc: T('拍照就上架，别人点开就能排队', 'Snap a photo to list it; people tap the link and get in line'), url, lang });
  }
  // A seller's lists in one page; the link carries each list's key, so it is never indexed.
  if (p === '/lists') {
    return page({
      title: T('我的清单｜二手清单 管理入口', 'My lists | Secondhand List'),
      desc: T('所有清单一个入口。只收藏，别发到群里。', 'All your lists in one place. Keep it to yourself, never post it in a group.'),
      image: url.origin + '/keep-icon.png',
      url,
      lang,
      robots: true,
    });
  }
  // The page buyers save to WeChat 收藏 for later. Its title is what they will see and search for,
  // so a saved gift link says what is waiting inside.
  if (p === '/keep') {
    const gift = url.searchParams.has('save') || url.searchParams.has('gift');
    const friend = await friendGift(env, url.searchParams.get('gift'));
    if (friend) {
      return page({
        title: T(`${friend.name || '朋友'}送你 ${KEEP_GIFT_USES} 次 AI 识图｜二手清单`, `${friend.name || 'A friend'} sent you ${KEEP_GIFT_USES} AI photo tries | Secondhand List`),
        desc: T(
          `我用它出过闲置，挺好用。拍照就上架，发到群里，群友点开自己排队。打开就到账，收藏起来搬家时用。`,
          `I sold my stuff with it and it worked well. Snap a photo to list it, post one link, people get in line themselves. Open to claim, keep it for moving day.`,
        ),
        image: url.origin + '/keep-icon.png',
        url,
        lang,
        robots: true,
        data: { friendGift: friend },
      });
    }
    return page({
      title: gift
        ? T(`二手清单｜送你 ${KEEP_GIFT_USES} 次 AI 识图，搬家时用`, `Secondhand List | ${KEEP_GIFT_USES} free AI photo tries for moving day`)
        : T('二手清单｜搬家、毕业、回国出闲置', 'Secondhand List | Sell your stuff when you move out'),
      desc: gift
        ? T(
          `这个链接里存着送你的 ${KEEP_GIFT_USES} 次 AI 识图：拍照就认出是什么，不用打字。搬家、毕业、回国出闲置时打开。`,
          `This link holds ${KEEP_GIFT_USES} AI photo tries for you: snap a photo and it knows what it is, no typing. Open it when you move out.`,
        )
        : T('拍照就上架，发到群里，群友点开自己排队', 'Snap a photo to list it, post one link, people get in line themselves'),
      image: url.origin + '/keep-icon.png',
      url,
      lang,
      robots: gift,
    });
  }
  return page({ title: T('找不到这个页面', 'Page not found'), url, lang, status: 404, data: { notFound: true } });
}

// ---------- HTML shell with per-link share card meta ----------

const APP_NAME = { zh: '二手清单', en: 'Secondhand List' };
// What people searching for 二手清单 should land on: the home and /new pages.
const APP_TITLE = {
  zh: '二手清单｜出二手，不用一个个回消息',
  en: 'Secondhand List | Sell your stuff without answering every message',
};
const APP_DESC = {
  zh: '二手清单：拍照上架，AI 识别物品，一个链接发到多个群，想要的人自己排队预订。免费 · 不用注册 · 不用下载。',
  en: 'Secondhand List: snap photos, AI names the items, post one link to any group, and buyers reserve in line themselves. Free, no sign-up, no app.',
};
const appJsonLd = (url, lang) => ({
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: APP_NAME[lang],
  url: `${url.origin}/`,
  description: APP_DESC[lang],
  applicationCategory: 'ShoppingApplication',
  operatingSystem: 'Web',
  inLanguage: lang === 'en' ? 'en' : 'zh-CN',
  image: `${url.origin}/icon-300.png`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
});

const REPO_URL = 'https://github.com/jinda-li/SecondHand';

// Questions people ask before trying it; shown on the landing page and given to search engines as FAQPage.
const FAQ = {
  zh: [
    ['要钱吗？', '完全免费，没有广告，也不抽成。服务器和域名是开发者自己掏钱，靠大家打赏撑着。'],
    ['要下载 App 或者注册吗？', '都不用。在微信、Telegram 或者任何浏览器里打开就能用。卖家的管理权限存在这台手机上，把「我的清单」页面收藏起来，换手机也能找回。'],
    ['买家怎么联系我？', '买家点「预订」排队，留下微信号或 Telegram 用户名。只有排第 1 位的人能看到你的联系方式；他不要了，下一位自动顶上，不会两个人约同一件。'],
    ['AI 识图是什么？', '拍一张照片，AI 认出这是什么，帮你写好名字。每人有免费次数，用完了自己打字也一样能上架。'],
    ['在哪些城市能用？', '任何城市都能用，价格可以用欧元、美元、英镑、人民币或瑞典克朗。打开「附近的二手」，同城的人也能刷到你的东西。'],
    ['外国同学能看懂吗？', '能。页面有中文和英文，物品名和说明会自动翻译，卖家可以修改译文。'],
    ['我的信息安全吗？', '只收集让清单运转需要的最少信息，不卖给任何人，也不经手付款。代码在 GitHub 上开源，谁都可以查。'],
  ],
  en: [
    ['Does it cost anything?', 'No. It is free, with no ads and no commission. The developer pays for the server and the domain, and tips keep it running.'],
    ['Do I need an app or an account?', 'Neither. It opens in WeChat, Telegram or any browser. Your management access lives on your phone: bookmark the "My lists" page to get it back on a new phone.'],
    ['How do buyers reach me?', 'Buyers tap Reserve and leave a WeChat ID or Telegram username. Only the first in line sees your contact; if they drop out, the next in line moves up, so two people never come for the same thing.'],
    ['What is the AI photo recognition?', 'Snap a photo and the AI works out what it is and names it for you. Everyone gets free tries, and once they run out you can still type the name yourself.'],
    ['Which cities does it work in?', 'Any city. Prices can be in euros, US dollars, pounds, yuan or Swedish kronor. Turn on "Nearby" and people in your city see your things too.'],
    ['Can people who don\'t read Chinese use it?', 'Yes. Every page is in English and Chinese, and item names and details are translated automatically; the seller can edit the translation.'],
    ['Is my information safe?', 'It keeps only what a list needs to work, sells nothing to anyone and never handles payments. The code is open source on GitHub for anyone to check.'],
  ],
};

const faqJsonLd = (lang) => ({
  '@type': 'FAQPage',
  inLanguage: lang === 'en' ? 'en' : 'zh-CN',
  mainEntity: FAQ[lang].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

// The landing page body (/ and /en). Plain HTML so it reads without JavaScript; app.js wires the
// feedback and tip buttons, and swaps in the seller's home for people who already have lists.
function landingHtml(lang) {
  const T = (zh, en) => (lang === 'en' ? en : zh);
  const home = T('/', '/en');
  const mock = [['🪑', '€20', false], ['💡', '€5', true], ['🍳', '€6', false], ['🚲', '€80', false]];
  const steps = T([
    ['📷', '拍照，填个价格', 'AI 自动认出是什么，名字不用打'],
    ['💬', '一个链接，发几个群都行', '群友点开就能看图、预订'],
    ['🙋', '自动排队，不撞单', '第 1 位才看到你的联系方式'],
    ['📍', '附近的人也能刷到', '也会出现在附近别人的清单下面，卖得更快'],
  ], [
    ['📷', 'Snap a photo, add a price', 'The AI names the item, no typing'],
    ['💬', 'One link, as many groups as you like', 'People tap it to see photos and reserve'],
    ['🙋', 'A queue, no double-selling', 'Only the first in line sees your contact'],
    ['📍', 'People nearby see it too', 'Your things also show under lists nearby'],
  ]);
  const who = T([
    '搬家、毕业、回国、换城市，走之前要清一屋子闲置',
    '在海外的留学生、交换生、上班族，东西卖给同城的华人和外国同学',
    '在微信群、Telegram 群里出二手，懒得一条条回消息',
  ], [
    'Moving out, graduating, going home or changing cities, with a flat to clear first',
    'Students and workers abroad selling to people in the same city',
    'Anyone selling in WeChat or Telegram groups who is tired of answering one message at a time',
  ]);
  const why = T([
    ['不用一遍遍回「还在吗」', '卖了没卖、几个人在排，链接里都写着'],
    ['不会两个人约同一件', '先到先得，排第 1 的人才拿到你的联系方式'],
    ['一处改，所有群都更新', '改价、标已出只在一个地方，发出去的链接自动是最新的'],
    ['中英文自动翻译', '外国同学、室友也看得懂'],
  ], [
    ['No more "is this still available?"', 'The link shows what is sold and how many are in line'],
    ['Nobody double-books', 'First come, first served: only the first in line gets your contact'],
    ['Change it once, every group sees it', 'Edit a price or mark it sold in one place; every link you posted is up to date'],
    ['Translated automatically', 'Chinese and English, so flatmates and classmates can read it'],
  ]);
  return `
<header class="appbar lp-bar"><a class="logo" href="${home}"><img src="/icon.svg" alt="" width="34" height="34"><span class="logo-txt"><b>${APP_NAME[lang]}</b><small>${T('AI识别 · 多群同步', 'AI photos · all your groups')}</small></span></a><a class="appbar-my" href="/my">${T('我的排队', 'My reservations')}</a></header>
<main class="lp">
  <section class="intro">
    <h1 class="intro-title">${T('出二手，<br>不用一个个回消息', 'Sell your stuff<br>without answering every message')}</h1>
    <p class="intro-sub">${T('拍照上架，发一个链接到群里，想要的人自己排队预订', 'List it with a photo, post one link to your groups, and buyers line up themselves')}</p>
    <div class="intro-mock" aria-hidden="true">${mock.map(([e, price, reserved]) => `
      <div class="mock-tile"><div class="mock-ph">${e}${reserved ? `<span class="mock-stamp">${T('已预订', 'Reserved')}</span>` : ''}</div><span class="mock-price">${price}</span><span class="mock-btn ${reserved ? 'off' : ''}">${reserved ? T('排候补', 'Waitlist') : T('预订', 'Reserve')}</span></div>`).join('')}
    </div>
    <a class="btn primary big lp-cta" href="/new?go=1">${T('免费发布我的清单', 'Post my list, free')}</a>
    <div class="intro-free">${T('免费 · 不用注册 · 不用下载 App', 'Free · no sign-up · no app')}</div>
  </section>
  <section class="lp-sec" id="how">
    <h2>${T('怎么用', 'How it works')}</h2>
    <div class="intro-steps2">${steps.map(([i, t, d]) => `
      <div class="intro-step2"><span class="intro-icon">${i}</span><div><b>${t}</b><div class="small muted">${d}</div></div></div>`).join('')}
    </div>
  </section>
  <section class="lp-sec">
    <h2>${T('为什么不直接在群里发', 'Why not just post in the group?')}</h2>
    <dl class="lp-why">${why.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>
  </section>
  <section class="lp-sec">
    <h2>${T('适合谁', 'Who it is for')}</h2>
    <ul class="lp-who">${who.map((w) => `<li>${w}</li>`).join('')}</ul>
  </section>
  <section class="lp-sec" id="faq">
    <h2>${T('常见问题', 'Questions')}</h2>
    <div class="lp-faq">${FAQ[lang].map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
  </section>
  <footer class="lp-foot">
    <p>${T('一个人独立开发的免费小工具，代码开源。', 'A free tool built independently by one developer. The code is open source.')}</p>
    <p><a href="/privacy${T('', '#en')}">${T('隐私政策', 'Privacy')}</a> · <a href="/terms${T('', '#en')}">${T('服务条款', 'Terms')}</a> · <a href="${REPO_URL}" rel="noopener">GitHub</a> · <button class="link-btn small" data-feedback>${T('反馈', 'Feedback')}</button><span data-tip hidden> · <button class="link-btn small">${T('打赏开发者', 'Tip the developer')}</button></span></p>
  </footer>
</main>
<div class="bottom-bar"><div class="inner"><a class="btn primary big" href="/new?go=1">${T('开始发布', 'Get started')}</a></div></div>`;
}

// wide: the image is the 1200×630 Telegram card, shown large under the message.
// body: HTML rendered into #app before app.js runs; alternates: hreflang → URL of each language version.
function page({ title, desc = '', image = '', imageSize = 600, wide = false, url, lang = 'zh', data = {}, status = 200, robots = false, keepQuery = false, jsonLd = null, body = '', alternates = null }) {
  const canonical = url.origin + url.pathname + (keepQuery ? url.search : '');
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}" data-ui="nordic dense">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${robots ? '<meta name="robots" content="noindex"><meta name="referrer" content="same-origin">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${APP_NAME[lang]}">
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'zh_CN'}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
${alternates ? `<link rel="canonical" href="${esc(canonical)}">
${Object.entries(alternates).map(([l, href]) => `<link rel="alternate" hreflang="${l}" href="${esc(href)}">`).join('\n')}` : ''}
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="${wide ? 1200 : imageSize}">
<meta property="og:image:height" content="${wide ? 630 : imageSize}">
<meta itemprop="image" content="${esc(image)}">
<meta name="twitter:image" content="${esc(image)}">` : ''}
<meta itemprop="name" content="${esc(title)}">
<meta itemprop="description" content="${esc(desc)}">
<meta name="twitter:card" content="${wide ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="theme-color" content="#0058a3">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="stylesheet" href="/app.css?v=${VERSION}">
<link rel="stylesheet" href="/theme.css?v=${VERSION}">
</head>
<body>
${image && !wide ? `<div class="wx-thumb" aria-hidden="true"><img src="${esc(image)}" width="300" height="300" alt=""></div>` : ''}
<div id="app">${body}</div>
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
  const lang = pageLang(url, sale ? textLang(sale.title) : 'zh');
  const T = (zh, en) => (lang === 'en' ? en : zh);
  if (!sale || sale.admin_key !== k) return page({ title: T('管理我的清单', 'Manage my list'), url, lang, robots: true });
  const first = await env.DB.prepare("SELECT photos FROM items WHERE sale_id = ? AND status != 'removed' ORDER BY no LIMIT 1").bind(saleId).first();
  const photo = sale.cover_photo ? `/img/${sale.cover_photo}` : first ? `/img/${JSON.parse(first.photos)[0]}/t` : '';
  return page({
    title: T(`管理入口｜${sale.title}`, `Manage | ${sale.title}`),
    desc: T('点开直接管理：上架、改价、看谁预订了。只发给自己，别发到群里。', 'Tap to manage: add items, change prices, see who reserved. Keep it to yourself, never post it in a group.'),
    image: photo ? url.origin + photo : '',
    url,
    lang,
    keepQuery: true,
    robots: true,
  });
}

// Ended (hidden) and deleted lists look the same to buyers, except an ended list still names itself.
function gonePage(url, endedTitle = '') {
  const en = pageLang(url, textLang(endedTitle || '中')) === 'en';
  return page({
    title: en ? 'This list is gone' : '这份清单已经不见了',
    desc: en ? 'The seller ended or deleted this list' : '卖家已经结束或删除了这份清单',
    url,
    lang: en ? 'en' : 'zh',
    status: 404,
    data: { notFound: true, endedTitle },
  });
}

// The card a list link shows in a chat. Its language follows the link (src=tg, lang=) or,
// without either, the language the list is written in; names come from the stored translation.
async function salePage(env, url, saleId) {
  const data = await loadPublic(env, saleId, null);
  if (!data || data.sale.status !== 'active') return gonePage(url, data?.sale.title);
  const { sale, items } = data;
  const lang = pageLang(url, textLang(sale.title));
  const en = lang === 'en';
  const st = saleText(sale, lang);
  // Newest first, as buyers see the list: the card's sample names and fallback picture.
  const avail = items.filter((i) => i.status === 'available').sort(byRecent);
  const title = sale.paused
    ? `${st.title}${en ? ' | paused' : '｜暂停中'}`
    : `${st.title}${en ? ` | ${avail.length} for sale` : `｜在售 ${avail.length} 件`}`;
  const sample = avail.slice(0, 3).map((i) => itemText(i, lang).name).join(' · ');
  const until = sale.leaveDate ? (en ? ` · until ${fmtDate(sale.leaveDate, lang)}` : ` · ${fmtDate(sale.leaveDate)}前出完`) : '';
  const desc = en
    ? `${st.location}${until} · ${sample || 'Tap to see photos and reserve'} · made with Secondhand List`
    : `${st.location}${until} · ${sample || '点开看图、排队'} · 用「二手清单」做的`;
  const firstPhoto = (avail[0] || items[0])?.photos?.[0];
  // Telegram shows a landscape picture large under the message; WeChat crops cards to a square.
  const wide = url.searchParams.get('src') === 'tg' && !!sale.coverWide;
  const image = wide
    ? `${url.origin}/img/${sale.coverWide}`
    : sale.coverPhoto ? `${url.origin}/img/${sale.coverPhoto}`
    : firstPhoto ? `${url.origin}/img/${firstPhoto}/t` : '';
  return page({ title, desc, image, wide, url, lang, data });
}

async function itemPage(env, url, saleId, no) {
  const data = await loadPublic(env, saleId, null);
  if (!data || data.sale.status !== 'active') return gonePage(url, data?.sale.title);
  const { sale } = data;
  const lang = pageLang(url, textLang(sale.title));
  const en = lang === 'en';
  const item = data.items.find((i) => i.no === no);
  if (!item) return page({ title: en ? 'Item not found' : '找不到这件东西', url, lang, status: 404, data: { notFound: true, item: true } });
  const st = saleText(sale, lang);
  const it = itemText(item, lang);
  const state = (en
    ? { reserved: ' (reserved, join the waitlist)', sold: ' (sold)' }
    : { reserved: '（已预订，可排候补）', sold: '（已出）' })[item.status] ?? '';
  const title = `${it.name} ${money(item.priceCents, sale.currency, lang)}${state}`;
  const desc = `${st.title} · ${st.location}${it.note ? ` · ${it.note.replace(/\s+/g, ' ')}` : ''}`;
  const image = item.photos[0] ? `${url.origin}/img/${item.photos[0]}/t` : '';
  return page({ title, desc, image, url, lang, data: { ...data, itemNo: no } });
}

function fmtDate(d, lang = 'zh') {
  const [, mm, dd] = d.split('-').map(Number);
  if (lang === 'en') return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mm - 1]} ${dd}`;
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
    coverWide: r.cover_wide || '',
    sellerActiveAt: r.seller_active_at,
    expiresAt: r.renewed_at + LIST_TTL_MS,
    paused: r.status === 'active' && now() > r.renewed_at + LIST_TTL_MS,
    createdAt: r.created_at,
    publicNearby: !!r.public_nearby,
    hasLocation: r.lat != null,
    // Which apps the seller can be reached on; the values themselves only go to the first in line.
    hasWechat: !!r.wechat_id,
    hasTelegram: !!r.telegram,
    alt: parseAlt(r.alt),
  };
}

function parseAlt(v) {
  try {
    const a = JSON.parse(v || 'null');
    return a && typeof a === 'object' ? { title: a.title || '', location: a.location || '', rules: Array.isArray(a.rules) ? a.rules : [] } : null;
  } catch {
    return null;
  }
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
  if (scope === 'near' && !hasLoc) fail('INVALID', ['需要你的大概位置', 'Needs your approximate location']);
  const cityFilter = scope === 'city' && city ? 'AND s.city = ?' : '';
  const { results } = await env.DB.prepare(
    `SELECT i.no, i.name, i.name_alt, i.price_cents, i.orig_price_cents, i.photos, i.created_at, s.id AS sale_id, s.title, s.location, s.alt, s.currency, s.lat, s.lng, s.city
     FROM items i JOIN sales s ON s.id = i.sale_id
     WHERE s.public_nearby = 1 AND s.status = 'active' AND s.renewed_at > ? AND i.status = 'available' ${cityFilter}
     ORDER BY i.created_at DESC LIMIT 400`,
  ).bind(now() - LIST_TTL_MS, ...(cityFilter ? [city] : [])).all();
  const items = results.map((r) => ({
    saleId: r.sale_id,
    no: r.no,
    name: r.name,
    nameAlt: r.name_alt || '',
    priceCents: r.price_cents,
    origPriceCents: r.orig_price_cents ?? null,
    currency: r.currency,
    photo: JSON.parse(r.photos || '[]')[0] || '',
    location: r.location,
    locationAlt: parseAlt(r.alt)?.location || '',
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
    nameAlt: r.name_alt || '',
    noteAlt: r.note_alt || '',
    photos: JSON.parse(r.photos || '[]'),
    status: r.status,
    statusCheckedAt: r.status_checked_at,
    maybeSold: r.status === 'reserved' && t - r.status_checked_at > MAYBE_SOLD_MS,
    createdAt: r.created_at,
    droppedAt: r.price_dropped_at ?? null,
    changedAt: r.status_changed_at,
  };
}

async function getSale(env, saleId) {
  const r = await env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(saleId).first();
  if (!r) fail('NOT_FOUND', ['这份清单不存在', 'This list does not exist'], 404);
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

// The seller contact for a buyer first in line somewhere. Buyers mostly find the seller in the group
// the list was posted to; this is the fallback: Telegram when the buyer left a Telegram username and
// the seller has one (or the seller has nothing else), else WeChat, and '' when the seller left none.
// wechat + note are what clients from before Telegram support read (they label it 卖家联系方式).
// buyerKind is the app the buyer left; when the seller isn't on it, the seller reaches out there.
function contactFor(sale, buyerOnTelegram, rows) {
  const kind = sale.telegram && (buyerOnTelegram || !sale.wechat_id) ? 'telegram' : 'wechat';
  const value = (kind === 'telegram' ? sale.telegram : sale.wechat_id) || '';
  const items = rows.map((r) => ({ no: r.no, name: r.name, nameAlt: r.name_alt || '' }));
  const old = kind === 'wechat' || !value ? value : `Telegram @${value}`;
  const buyerKind = buyerOnTelegram ? 'telegram' : 'wechat';
  return { kind, value, buyerKind, items, wechat: old, note: contactNote(items), nos: items.map((i) => i.no) };
}

async function buyerContact(env, saleRow, buyerToken) {
  const { results } = await env.DB.prepare(
    `SELECT i.no, i.name, i.name_alt, q.buyer_telegram FROM queues q JOIN items i ON i.id = q.item_id
     WHERE q.sale_id = ? AND q.buyer_token = ? AND q.status = 'waiting'
       AND NOT EXISTS (SELECT 1 FROM queues q2 WHERE q2.item_id = q.item_id AND q2.status = 'waiting' AND q2.seq < q.seq)
     ORDER BY q.seq`,
  ).bind(saleRow.id, buyerToken).all();
  if (!results.length) return null;
  return contactFor(saleRow, results.some((r) => r.buyer_telegram), results);
}

// ---------- API ----------

async function body(req) {
  try {
    return await req.json();
  } catch {
    fail('INVALID', ['请求格式不对', 'Bad request']);
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
  fail('FORBIDDEN', ['没有管理权限', 'You can\’t manage this list'], 403);
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
  if (!env.GOOGLE_CLIENT_ID) fail('INVALID', ['Google 登录还没配置', 'Google sign-in is not set up']);
  if (typeof credential !== 'string' || credential.length > 4096) fail('INVALID', ['登录凭证不对', 'Bad sign-in credential']);
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) fail('FORBIDDEN', ['Google 登录失败，再试一次', 'Google sign-in failed, try again'], 403);
  const t = await r.json();
  const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (t.aud !== env.GOOGLE_CLIENT_ID || !issOk || Number(t.exp) * 1000 < now() || !t.sub) {
    fail('FORBIDDEN', ['Google 登录失败，再试一次', 'Google sign-in failed, try again'], 403);
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

// ---------- abuse limits ----------

// Free D1 databases stop taking writes at 500 MB. New photos stop a little before that, so lists,
// queues and edits keep working when space runs low.
const DB_PHOTO_LIMIT = 400_000_000;
// Uploaded photos and feedback screenshots per day, in KB: everyone together, and per network.
const UPLOAD_KB_DAILY = 150_000;
const UPLOAD_KB_PER_IP = 60_000;
const PHOTOS_PER_SALE = 300;
// Per network per day. Campus networks put many people behind one address, so these are generous.
const SALES_PER_IP = 20;
const FEEDBACK_PER_IP = 20;
const AI_CALLS_PER_IP = 150;

// The visitor's network for today's counters, hashed with the day so no IP address is stored.
async function ipKey(req) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${new Date().toISOString().slice(0, 10)}|${ip}`));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Counts n uses of `what` from this network today; fails past max. Now and then clears earlier days.
async function limitIp(env, req, what, max, n = 1) {
  if (Math.random() < 0.01) {
    await env.DB.prepare("DELETE FROM ai_daily WHERE day LIKE '%:ip:%' AND day < ?").bind(new Date().toISOString().slice(0, 10)).run();
  }
  if (!(await takeQuota(env, `ip:${what}:${await ipKey(req)}`, max, n))) {
    fail('RATE_LIMITED', ['这个网络今天的请求太多了，明天再试吧', 'Too many requests from this network today, try again tomorrow'], 429);
  }
}

// Before storing uploaded bytes: room left in the database, then today's allowance for everyone and for this network.
async function takeUploadRoom(env, req, bytes) {
  const { meta } = await env.DB.prepare('SELECT 1').run();
  if (meta?.size_after > DB_PHOTO_LIMIT) fail('FULL', ['照片存储空间快满了，开发者正在处理。先不传照片也能上架', 'Photo storage is nearly full and the developer is on it. You can list things without photos for now'], 507);
  const kb = Math.ceil(bytes / 1000);
  if (!(await takeQuota(env, 'upload', UPLOAD_KB_DAILY, kb))) fail('RATE_LIMITED', ['今天大家传的照片太多了，明天再传吧', 'Too many photos uploaded today, try again tomorrow'], 429);
  await limitIp(env, req, 'upload', UPLOAD_KB_PER_IP, kb);
}

function touchSale(env, saleId, t) {
  return env.DB.prepare('UPDATE sales SET seller_active_at = ?1, updated_at = ?1 WHERE id = ?2').bind(t, saleId);
}

async function api(req, env, url, ctx) {
  const p = url.pathname.slice(4);
  const M = req.method;
  let m;

  if (p === '/nearby' && M === 'GET') return nearby(env, req, url);
  if (p === '/ai/quota' && M === 'GET') return ok(await aiQuota(env, requireClient(req)));
  if (p === '/ai/identify' && M === 'POST') return aiIdentify(env, req);
  if (p === '/ai/batch' && M === 'POST') return aiBatch(env, req);
  if (p === '/ai/survey' && M === 'POST') return aiSurvey(env, req);
  if (p === '/ai/invite' && M === 'POST') return aiInvite(env, req);
  if (p === '/ai/tip' && M === 'POST') return aiTip(env, req);
  if (p === '/feedback' && M === 'POST') return sendFeedback(env, req);
  if (p === '/ai/nudge' && M === 'POST') return aiNudge(env, req);
  if (p === '/keep/gift' && M === 'POST') return keepGiftCreate(env, req);
  if ((m = p.match(/^\/keep\/gift\/(\w+)$/)) && M === 'POST') return keepGiftRedeem(env, req, m[1]);
  if (p === '/auth/google' && M === 'POST') return googleLogin(env, await body(req));
  if (p === '/auth/logout' && M === 'POST') return logout(req, env);
  if (p === '/me' && M === 'GET') return me(req, env);
  if (p === '/sale' && M === 'POST') {
    await limitIp(env, req, 'sale', SALES_PER_IP);
    return createSale(env, ctx, await body(req), await currentUser(req, env), requestCity(req, url));
  }
  if ((m = p.match(/^\/sale\/(\w+)$/))) {
    if (M === 'GET') {
      const data = await loadPublic(env, m[1], buyerTokenOf(req));
      if (!data) fail('NOT_FOUND', ['这份清单已经不见了', 'This list is gone'], 404);
      data.isOwner = await isSeller(req, env, m[1]);
      if (data.sale.status !== 'active' && !data.isOwner) fail('NOT_FOUND', ['这份清单已经不见了', 'This list is gone'], 404);
      return ok(data);
    }
    if (M === 'PATCH') return updateSale(env, ctx, await requireSeller(req, env, m[1]), await body(req), requestCity(req, url));
    if (M === 'DELETE') return deleteSale(env, await requireSeller(req, env, m[1]));
  }
  if ((m = p.match(/^\/sale\/(\w+)\/manage$/)) && M === 'GET') return manageData(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/end$/)) && M === 'POST') return endSale(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/reopen$/)) && M === 'POST') return reopenSale(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/renew$/)) && M === 'POST') return renewSale(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/photo$/)) && M === 'POST') return uploadPhoto(env, await requireSeller(req, env, m[1]), req, false);
  if ((m = p.match(/^\/sale\/(\w+)\/cover$/)) && M === 'POST') return uploadPhoto(env, await requireSeller(req, env, m[1]), req, url.searchParams.has('wide') ? 'cover_wide' : 'cover_photo');
  if ((m = p.match(/^\/sale\/(\w+)\/translate$/)) && M === 'POST') return translateNow(env, await requireSeller(req, env, m[1]));
  if ((m = p.match(/^\/sale\/(\w+)\/items$/)) && M === 'POST') return createItem(env, ctx, await requireSeller(req, env, m[1]), await body(req));
  if ((m = p.match(/^\/item\/(\w+)$/)) && M === 'PATCH') {
    const item = await getItem(env, m[1]);
    return updateItem(env, ctx, await requireSeller(req, env, item.sale_id), item, await body(req));
  }
  if ((m = p.match(/^\/item\/(\w+)\/translate$/)) && M === 'POST') {
    const item = await getItem(env, m[1]);
    return retranslateItem(env, await requireSeller(req, env, item.sale_id), item);
  }
  if ((m = p.match(/^\/item\/(\w+)\/action$/)) && M === 'POST') {
    const item = await getItem(env, m[1]);
    return itemAction(env, await requireSeller(req, env, item.sale_id), item, await body(req));
  }
  if ((m = p.match(/^\/item\/(\w+)\/join$/)) && M === 'POST') return joinQueue(env, req, await getItem(env, m[1]), await body(req));
  if ((m = p.match(/^\/queue\/(\d+)\/cancel$/)) && M === 'POST') return cancelQueue(env, req, Number(m[1]));
  if (p === '/my' && M === 'GET') return myQueues(env, req);
  fail('NOT_FOUND', ['接口不存在', 'No such endpoint'], 404);
}

function saleFields(b, partial) {
  const out = {};
  if (!partial || 'title' in b) out.title = str(b.title, { max: 60, min: 1, name: ['标题', 'Title'] });
  // Seller contacts: a WeChat ID, a Telegram username, or both. At least one is checked by the caller,
  // which knows what is already stored. Buyers mostly find the seller in the group; only the first in
  // line sees these, for when they can't.
  if (!partial || 'wechatId' in b) {
    out.wechat_id = str(b.wechatId, { max: 60, name: ['微信号', 'WeChat ID'] });
    if (looksLikeTelegram(out.wechat_id)) fail('INVALID', ['微信号那一栏填的像是 Telegram 用户名，请填到 Telegram 那一栏', 'That looks like a Telegram username: put it in the Telegram box']);
  }
  if (!partial || 'telegram' in b) out.telegram = telegramField(b.telegram);
  if (!partial || 'location' in b) out.location = str(b.location, { max: 60, min: 1, name: ['取货地点', 'Pick-up place'] });
  if (!partial || 'currency' in b) {
    out.currency = CURRENCY_CODES.includes(b.currency) ? b.currency : fail('INVALID', ['货币不支持', 'Currency not supported']);
  }
  if (!partial || 'rules' in b) {
    const rules = Array.isArray(b.rules) ? b.rules : [];
    if (rules.length > 5) fail('INVALID', ['规则最多 5 条', 'At most 5 rules']);
    out.rules = JSON.stringify(rules.map((r) => str(r, { max: 40, min: 1, name: ['规则', 'Rule'] })));
  }
  if (!partial || 'leaveDate' in b) {
    const d = String(b.leaveDate ?? '');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('INVALID', ['截止日期格式不对', 'Bad end date']);
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

// '' for none; a username without the @ otherwise.
function telegramField(v) {
  const raw = str(v, { max: 64, name: 'Telegram' });
  if (!raw) return '';
  return normTelegram(raw) ?? fail('INVALID', [
    'Telegram 用户名不对：5 到 32 位字母、数字或下划线，例如 @jinda_li。在 Telegram 的「设置 → 用户名」里能看到',
    'That is not a Telegram username: 5 to 32 letters, digits or underscores, like @jinda_li. Find it under Settings → Username in Telegram',
  ]);
}

const needContact = () => fail('INVALID', ['微信号和 Telegram 用户名至少填一个', 'Add a Telegram username or a WeChat ID']);

async function createSale(env, ctx, b, user, city) {
  const f = saleFields(b, false);
  if (!f.wechat_id && !f.telegram) needContact();
  const t = now();
  const id = rid(8);
  const key = rid(24);
  await env.DB.prepare(
    `INSERT INTO sales (id, admin_key, title, wechat_id, telegram, location, currency, rules, leave_date, public_nearby, lat, lng, city, owner_sub, owner_email, seller_active_at, renewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, key, f.title, f.wechat_id, f.telegram, f.location, f.currency, f.rules, f.leave_date, f.public_nearby, f.lat ?? null, f.lng ?? null, city || null, user?.sub ?? null, user?.email ?? null, t, t, t, t).run();
  ctx.waitUntil(translateSale(env, id).catch((e) => console.error('translate sale', e?.message || e)));
  return ok({ id, key });
}

// b.alt { title, location }: the seller's own correction of the translation.
async function updateSale(env, ctx, sale, b, city) {
  const f = saleFields(b, true);
  const has = (col) => !!(col in f ? f[col] : sale[col]);
  if (!has('wechat_id') && !has('telegram')) needContact();
  if (f.public_nearby && !sale.city && city) f.city = city;
  if (b.alt && typeof b.alt === 'object') {
    // Rule translations follow their rule's text, since the rules themselves may change in this save.
    const old = parseAlt(sale.alt) || { rules: [] };
    const oldRules = JSON.parse(sale.rules || '[]');
    const byText = Object.fromEntries(oldRules.map((r, i) => [r, old.rules[i] || '']));
    f.alt = JSON.stringify({
      title: str(b.alt.title, { max: 60, name: ['翻译的标题', 'Translated title'] }),
      location: str(b.alt.location, { max: 60, name: ['翻译的取货地点', 'Translated pick-up place'] }),
      rules: JSON.parse(f.rules ?? sale.rules ?? '[]').map((r) => byText[r] || ''),
      src: saleSrc({ ...sale, ...f }),
    });
  }
  const cols = Object.keys(f);
  if (!cols.length) return ok({});
  const t = now();
  await env.DB.prepare(
    `UPDATE sales SET ${cols.map((c) => `${c} = ?`).join(', ')}, seller_active_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(...cols.map((c) => f[c]), t, t, sale.id).run();
  ctx.waitUntil(translateSale(env, sale.id).catch((e) => console.error('translate sale', e?.message || e)));
  return ok({});
}

async function reopenSale(env, sale) {
  const t = now();
  await env.DB.prepare("UPDATE sales SET status = 'active', renewed_at = ?1, seller_active_at = ?1, updated_at = ?1 WHERE id = ?2").bind(t, sale.id).run();
  return ok({});
}

async function renewSale(env, sale) {
  if (sale.status !== 'active') fail('CONFLICT', ['这份清单已结束', 'This list has ended']);
  const t = now();
  await env.DB.prepare('UPDATE sales SET renewed_at = ?1, seller_active_at = ?1, updated_at = ?1 WHERE id = ?2').bind(t, sale.id).run();
  return ok({ expiresAt: t + LIST_TTL_MS });
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

// Opening the management page counts as the seller being online (shown to buyers as
// "卖家 N 分钟前在线"); written at most every 5 minutes.
const SELLER_SEEN_EVERY = 5 * 60 * 1000;

async function manageData(env, sale) {
  const t = now();
  if (t - (sale.seller_active_at || 0) > SELLER_SEEN_EVERY) {
    await env.DB.prepare('UPDATE sales SET seller_active_at = ? WHERE id = ?').bind(t, sale.id).run();
  }
  const [itemsRes, queuesRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM items WHERE sale_id = ? AND status != 'removed' ORDER BY no").bind(sale.id),
    env.DB.prepare("SELECT seq, item_id, nickname, buyer_wechat, buyer_telegram, added_by, created_at FROM queues WHERE sale_id = ? AND status = 'waiting' ORDER BY seq").bind(sale.id),
  ]);
  const queues = {};
  for (const q of queuesRes.results) {
    (queues[q.item_id] ||= []).push({ seq: q.seq, nickname: q.nickname, wechat: q.buyer_wechat, telegram: q.buyer_telegram, addedBy: q.added_by, createdAt: q.created_at });
  }
  const soldCents = itemsRes.results.filter((r) => r.status === 'sold').reduce((s, r) => s + r.price_cents, 0);
  return ok({
    sale: { ...mapSale(sale), wechatId: sale.wechat_id, telegram: sale.telegram, key: sale.admin_key, ownerEmail: sale.owner_email || '' },
    items: itemsRes.results.map((r) => ({ ...mapItem(r, t), queue: queues[r.id] || [], queueCount: (queues[r.id] || []).length })),
    soldCents,
    now: t,
  });
}

// cover: the sales column the photo replaces ('cover_photo' or 'cover_wide'), or false for an item photo.
async function uploadPhoto(env, sale, req, cover) {
  let form;
  try {
    form = await req.formData();
  } catch {
    fail('INVALID', ['照片上传格式不对', 'Bad photo upload']);
  }
  const full = form.get('full');
  const thumb = form.get('thumb');
  if (!full || typeof full === 'string') fail('INVALID', ['没有收到照片', 'No photo received']);
  if (full.size > MAX_PHOTO_BYTES) fail('INVALID', ['照片太大了', 'Photo too large']);
  if (thumb && typeof thumb !== 'string' && thumb.size > MAX_THUMB_BYTES) fail('INVALID', ['缩略图太大了', 'Thumbnail too large']);
  // Photos a list keeps, whether on items or uploaded and never used; a replaced cover is deleted.
  const kept = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE sale_id = ?').bind(sale.id).first();
  if (kept.n >= PHOTOS_PER_SALE && !(cover && sale[cover])) fail('LIMIT', [`一份清单最多 ${PHOTOS_PER_SALE} 张照片，删掉一些再传吧`, `A list holds up to ${PHOTOS_PER_SALE} photos. Delete some first`]);
  const fullBuf = await full.arrayBuffer();
  const thumbBuf = thumb && typeof thumb !== 'string' ? await thumb.arrayBuffer() : null;
  await takeUploadRoom(env, req, fullBuf.byteLength + (thumbBuf?.byteLength ?? 0));
  const id = rid(12);
  const t = now();
  const stmts = [
    env.DB.prepare('INSERT INTO photos (id, sale_id, full, thumb, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, sale.id, fullBuf, thumbBuf, t),
  ];
  if (cover) {
    if (sale[cover]) stmts.push(env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(sale[cover]));
    stmts.push(env.DB.prepare(`UPDATE sales SET ${cover} = ?, updated_at = ? WHERE id = ?`).bind(id, t, sale.id));
  }
  await env.DB.batch(stmts);
  return ok({ photoId: id });
}

async function checkPhotos(env, saleId, photos) {
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 3) fail('INVALID', ['每件 1 到 3 张照片', '1 to 3 photos per item']);
  const marks = photos.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT id FROM photos WHERE sale_id = ? AND id IN (${marks})`).bind(saleId, ...photos).all();
  if (results.length !== new Set(photos).size) fail('INVALID', ['照片不存在', 'Photo not found']);
  return JSON.stringify(photos);
}

function itemFields(b, partial) {
  const out = {};
  if (!partial || 'name' in b) out.name = str(b.name, { max: 60, min: 1, name: ['名字', 'Name'] });
  if (!partial || 'priceCents' in b) {
    const c = b.priceCents;
    if (!Number.isInteger(c) || c < 0 || c > 100_000_000) fail('INVALID', ['价格不对', 'Invalid price']);
    out.price_cents = c;
  }
  if (!partial || 'origPriceCents' in b) {
    const c = b.origPriceCents ?? null;
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > 100_000_000)) fail('INVALID', ['原价不对', 'Invalid original price']);
    out.orig_price_cents = c;
  }
  if (!partial || 'condition' in b) {
    out.condition = CONDITION_CODES.includes(b.condition ?? '') ? b.condition ?? '' : fail('INVALID', ['成色不对', 'Invalid condition']);
  }
  if (!partial || 'note' in b) out.note = str(b.note, { max: 200, name: ['详情', 'Details'] });
  // The other language, from the AI or typed by the seller; left out, the server translates.
  if ('nameAlt' in b) {
    out.name_alt = str(b.nameAlt, { max: 60, name: ['翻译的名字', 'Translated name'] }) || null;
    out.note_alt = str(b.noteAlt, { max: 200, name: ['翻译的详情', 'Translated details'] });
  }
  return out;
}

const itemSrc = (name, note) => `${name}\n${note}`;

async function createItem(env, ctx, sale, b) {
  if (sale.status !== 'active') fail('CONFLICT', ['这份清单已结束', 'This list has ended']);
  const f = itemFields(b, false);
  const photos = await checkPhotos(env, sale.id, b.photos);
  const t = now();
  const id = rid(10);
  const alt = f.name_alt ? [f.name_alt, f.note_alt, itemSrc(f.name, f.note)] : [null, null, null];
  // Number allocation and the counter bump run in one transaction; numbers are never reused.
  const [, , got] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO items (id, sale_id, no, name, price_cents, orig_price_cents, condition, note, photos, status, status_checked_at, status_changed_at, created_at, updated_at, name_alt, note_alt, alt_src)
       VALUES (?1, ?2, (SELECT next_no FROM sales WHERE id = ?2), ?3, ?4, ?9, ?5, ?6, ?7, 'available', ?8, ?8, ?8, ?8, ?10, ?11, ?12)`,
    ).bind(id, sale.id, f.name, f.price_cents, f.condition, f.note, photos, t, f.orig_price_cents, ...alt),
    env.DB.prepare('UPDATE sales SET next_no = next_no + 1, seller_active_at = ?1, updated_at = ?1 WHERE id = ?2').bind(t, sale.id),
    env.DB.prepare('SELECT no FROM items WHERE id = ?').bind(id),
  ]);
  if (!f.name_alt) ctx.waitUntil(translateItem(env, id).catch((e) => console.error('translate item', e?.message || e)));
  return ok({ id, no: got.results[0].no });
}

async function getItem(env, itemId) {
  const r = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!r) fail('NOT_FOUND', ['这件东西不存在', 'This item does not exist'], 404);
  return r;
}

async function updateItem(env, ctx, sale, item, b) {
  const f = itemFields(b, true);
  if ('photos' in b) f.photos = await checkPhotos(env, sale.id, b.photos);
  // A translation sent with this edit belongs to the new text. Otherwise a changed text drops
  // the old translation, and a new one is made in the background.
  const src = itemSrc(f.name ?? item.name, f.note ?? item.note);
  let retranslate = false;
  if ('name_alt' in f) {
    f.alt_src = f.name_alt ? src : null;
    // The details changed but their translation was sent back as it was: it no longer fits.
    if (f.note != null && f.note !== item.note && f.note_alt === (item.note_alt || '')) f.note_alt = '';
  }
  else if (src !== itemSrc(item.name, item.note)) {
    Object.assign(f, { name_alt: null, note_alt: null, alt_src: null });
    retranslate = await takeQuota(env, `tre:${sale.id}`, EDIT_TRANSLATE_DAILY);
  } else retranslate = !item.name_alt;
  const t = now();
  if ('price_cents' in f && f.price_cents !== item.price_cents) f.price_changed_at = t;
  if (f.price_cents != null && item.price_cents != null && f.price_cents < item.price_cents) f.price_dropped_at = t;
  f.status_checked_at = t;
  f.updated_at = t;
  const cols = Object.keys(f);
  await env.DB.batch([
    env.DB.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => f[c]), item.id),
    touchSale(env, sale.id, t),
  ]);
  if (retranslate) ctx.waitUntil(translateItem(env, item.id).catch((e) => console.error('translate item', e?.message || e)));
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
      if (!open) fail('CONFLICT', ['这件已经处理过了', 'This item was already handled']);
      if (head) {
        stmts.push(db.prepare("UPDATE queues SET status = 'sold', closed_at = ? WHERE seq = ?").bind(t, head.seq));
        stmts.push(db.prepare("UPDATE queues SET status = 'removed', closed_at = ? WHERE item_id = ? AND status = 'waiting' AND seq != ?").bind(t, item.id, head.seq));
      }
      stmts.push(db.prepare("UPDATE items SET status = 'sold', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2").bind(t, item.id));
      break;
    }
    case 'relist': {
      // Undoes a sale marked by mistake: the line closed by that tap comes back as it was.
      if (item.status !== 'sold') fail('CONFLICT', ['这件不是已出状态', 'This item is not marked sold']);
      stmts.push(db.prepare(
        "UPDATE queues SET status = 'waiting', closed_at = NULL WHERE item_id = ? AND status IN ('sold', 'removed') AND closed_at = ?",
      ).bind(item.id, item.status_changed_at));
      stmts.push(db.prepare(
        `UPDATE items SET status = CASE WHEN EXISTS (SELECT 1 FROM queues WHERE item_id = ?2 AND status = 'waiting') THEN 'reserved' ELSE 'available' END,
         status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2`,
      ).bind(t, item.id));
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
      if (!head || head.seq !== b.seq) fail('CONFLICT', ['排第 1 位的人变了，刷新一下', 'The first in line changed, refresh the page']);
      stmts.push(db.prepare("UPDATE queues SET status = 'declined', closed_at = ? WHERE seq = ?").bind(t, head.seq));
      stmts.push(db.prepare('UPDATE items SET status_checked_at = ? WHERE id = ?').bind(t, item.id));
      stmts.push(releaseIfEmpty(env, item.id, t));
      break;
    }
    case 'removeQueue': {
      const q = await db.prepare("SELECT seq FROM queues WHERE seq = ? AND item_id = ? AND status = 'waiting'").bind(b.seq ?? -1, item.id).first();
      if (!q) fail('CONFLICT', ['这个人已经不在队里了', 'This person is no longer in line']);
      stmts.push(db.prepare("UPDATE queues SET status = 'removed', closed_at = ? WHERE seq = ?").bind(t, q.seq));
      stmts.push(db.prepare('UPDATE items SET status_checked_at = ? WHERE id = ?').bind(t, item.id));
      stmts.push(releaseIfEmpty(env, item.id, t));
      break;
    }
    case 'addManual': {
      if (!open) fail('CONFLICT', ['这件已经出了', 'This item is already gone']);
      const nickname = str(b.nickname, { max: 20, min: 1, name: ['称呼', 'Name'] });
      stmts.push(db.prepare(
        "INSERT INTO queues (sale_id, item_id, buyer_token, nickname, note, status, added_by, created_at) VALUES (?, ?, NULL, ?, '', 'waiting', 'seller', ?)",
      ).bind(sale.id, item.id, nickname, t));
      stmts.push(db.prepare(
        "UPDATE items SET status = 'reserved', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'available'",
      ).bind(t, item.id));
      break;
    }
    default:
      fail('INVALID', ['未知操作', 'Unknown action']);
  }
  stmts.push(touchSale(env, sale.id, t));
  await db.batch(stmts);
  return ok({});
}

async function joinQueue(env, req, item, b) {
  const token = buyerTokenOf(req);
  if (!token) fail('INVALID', ['缺少买家标识', 'Missing buyer token']);
  const sale = await getSale(env, item.sale_id);
  if (sale.status !== 'active') fail('CONFLICT', ['这份清单已结束', 'This list has ended']);
  if (mapSale(sale).paused) fail('CONFLICT', ['卖家暂停了这份清单，暂时不能排队', 'The seller paused this list, reservations are closed for now']);
  if (item.status !== 'available' && item.status !== 'reserved') fail('CONFLICT', ['这件已经出了', 'This item is already gone']);
  if (await isSeller(req, env, sale.id)) fail('CONFLICT', ['这是你自己的清单，不能预订自己的东西', 'This is your own list, you can\’t reserve your own things']);
  // A Telegram username or a WeChat ID; either doubles as the buyer's name in the seller's list.
  // Older clients only send a nickname.
  const telegram = String(b.telegram ?? '').trim() ? telegramField(b.telegram) : '';
  const wechat = telegram ? '' : str(b.wechat ?? b.nickname, { max: 30, min: 1, name: ['微信号', 'WeChat ID'] });
  if (looksLikeTelegram(wechat)) fail('INVALID', ['这像是 Telegram 用户名，请切到 Telegram 再填', 'That looks like a Telegram username: switch to Telegram first']);
  const nickname = telegram ? `@${telegram}` : wechat;
  const db = env.DB;
  const mine = await db.prepare("SELECT item_id FROM queues WHERE sale_id = ? AND buyer_token = ? AND status = 'waiting'").bind(sale.id, token).all();
  if (mine.results.some((r) => r.item_id === item.id)) fail('CONFLICT', ['你已经在这件的队里了', 'You are already in line for this']);
  if (mine.results.length >= MAX_QUEUE_PER_SALE) fail('LIMIT', [`同一份清单最多同时排 ${MAX_QUEUE_PER_SALE} 件`, `At most ${MAX_QUEUE_PER_SALE} reservations per list`]);
  const t = now();
  try {
    await db.batch([
      db.prepare(
        "INSERT INTO queues (sale_id, item_id, buyer_token, nickname, buyer_wechat, buyer_telegram, status, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'waiting', 'buyer', ?)",
      ).bind(sale.id, item.id, token, nickname, wechat, telegram, t),
      db.prepare(
        "UPDATE items SET status = 'reserved', status_changed_at = ?1, status_checked_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'available'",
      ).bind(t, item.id),
    ]);
  } catch (e) {
    if (String(e?.message).includes('UNIQUE')) fail('CONFLICT', ['你已经在这件的队里了', 'You are already in line for this']);
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
  if (!q || !token || q.buyer_token !== token) fail('NOT_FOUND', ['找不到这条排队', 'Reservation not found'], 404);
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
    `SELECT q.seq, q.status, q.sale_id, q.item_id, q.created_at, q.buyer_telegram,
       i.no, i.name, i.name_alt, i.price_cents, i.photos, i.status AS item_status,
       s.title, s.alt, s.currency, s.wechat_id, s.telegram,
       (SELECT COUNT(*) FROM queues q2 WHERE q2.item_id = q.item_id AND q2.status = 'waiting' AND q2.seq <= q.seq) AS position
     FROM queues q JOIN items i ON i.id = q.item_id JOIN sales s ON s.id = q.sale_id
     WHERE q.buyer_token = ? AND (q.status = 'waiting' OR q.closed_at > ?)
     ORDER BY q.status = 'waiting' DESC, q.seq DESC LIMIT 100`,
  ).bind(token, since).all();
  const heads = {};
  for (const r of results) {
    if (r.status === 'waiting' && r.position === 1) (heads[r.sale_id] ||= []).push(r);
  }
  const queues = results.map((r) => {
    const head = r.status === 'waiting' && r.position === 1;
    return {
      seq: r.seq,
      status: r.status,
      saleId: r.sale_id,
      saleTitle: r.title,
      saleTitleAlt: parseAlt(r.alt)?.title || '',
      no: r.no,
      name: r.name,
      nameAlt: r.name_alt || '',
      priceCents: r.price_cents,
      currency: r.currency,
      photo: JSON.parse(r.photos || '[]')[0] || '',
      itemStatus: r.item_status,
      position: r.status === 'waiting' ? r.position : null,
      contact: head ? contactFor(r, heads[r.sale_id].some((h) => h.buyer_telegram), heads[r.sale_id]) : null,
    };
  });
  return ok({ queues });
}

// ---------- machine translation of listings (Chinese <-> English) ----------

const hasCJKText = (s) => textLang(s) === 'zh';
// Text calls cost a fraction of a photo call; this keeps translation from eating the free daily AI allowance.
const TRANSLATE_DAILY_CAP = 800;

// Local names with an agreed translation, which the model would otherwise transliterate
// (大苹果 is the Iso Omena shopping centre in Espoo, never "Da Pingguo"). Add new ones here.
const GLOSSARY = [['大苹果', 'Iso Omena']];

// Short listing texts into `to` ('zh' | 'en'), in one call. Returns an array of the same length,
// or null when the model's answer can't be used. Empty strings stay empty and are not sent.
async function translateTexts(env, texts, to) {
  const idx = texts.map((t, i) => (String(t ?? '').trim() ? i : -1)).filter((i) => i >= 0);
  const out = texts.map(() => '');
  if (!idx.length) return out;
  if (!(await takeQuota(env, 'tr', TRANSLATE_DAILY_CAP))) return null;
  // Glossary names are swapped in before and after the call, so the model can't get them wrong.
  const swap = (t, from, into) => GLOSSARY.reduce((x, g) => x.split(g[from]).join(g[into]), String(t));
  const src = idx.map((i) => (to === 'en' ? swap(texts[i], 0, 1) : texts[i]));
  const prompt = `下面 JSON 数组里是二手物品清单上的短文字：物品名、物品详情、清单标题、取货地点或交易规则。把每一条翻译成${to === 'en' ? '自然、简洁的英文' : '自然、简洁的简体中文'}。
- 品牌、型号保持原文（例如 IKEA、MALM、AirPods Pro）。
- 地名、街道名、车站名保持原文（例如 Otaniemi、Kamppi）。
- 这些叫法固定这样译：${GLOSSARY.map(([zh, en]) => `「${zh}」↔「${en}」`).join('、')}。
- ${to === 'en' ? '物品名用常见叫法，只有第一个词首字母大写，不加引号（例如「Desk lamp」）。人名保持原文，「小王的二手清单」译成「Wang\'s secondhand list」。' : '物品名用国内常用叫法（例如「台灯」「抽屉柜」）。品牌用中国人常用的叫法（例如 IKEA 写「宜家」）。'}
- 只输出一个长度为 ${src.length} 的 JSON 字符串数组，顺序不变，不要任何别的文字。
${JSON.stringify(src)}`;
  const reply = await runAi(env, [{ type: 'text', text: prompt }], 80 + 60 * src.length);
  let arr = reply;
  if (!Array.isArray(arr)) {
    const m = String(reply || '').match(/\[[\s\S]*\]/);
    try {
      arr = m ? JSON.parse(m[0]) : null;
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr) || arr.length !== src.length) return null;
  idx.forEach((i, k) => {
    const t = String(arr[k] ?? '').replace(/[\r\n]+/g, ' ').trim();
    out[i] = to === 'zh' ? swap(t, 1, 0) : t;
  });
  return out;
}

// Each text into the other language than its own (a list can mix: an English name, Chinese details),
// in at most two calls. null when a call fails.
async function translateEach(env, texts) {
  const out = texts.map(() => '');
  for (const to of ['en', 'zh']) {
    const idx = texts.map((t, i) => (String(t ?? '').trim() && textLang(t) !== to ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const r = await translateTexts(env, idx.map((i) => texts[i]), to);
    if (!r) return null;
    idx.forEach((i, k) => (out[i] = r[k]));
  }
  return out;
}

// Name and details of one item into the other language; skipped when already done for this text,
// and dropped if the seller edited the item meanwhile.
async function translateItem(env, itemId) {
  const it = await env.DB.prepare('SELECT name, note, alt_src FROM items WHERE id = ?').bind(itemId).first();
  if (!it) return;
  const src = itemSrc(it.name, it.note);
  if (it.alt_src === src) return;
  const r = await translateEach(env, [it.name, it.note]);
  if (!r || !r[0]) return;
  await env.DB.prepare('UPDATE items SET name_alt = ?, note_alt = ?, alt_src = ? WHERE id = ? AND name = ? AND note = ?')
    .bind([...r[0]].slice(0, 60).join(''), [...r[1]].slice(0, 200).join(''), src, itemId, it.name, it.note).run();
}

// Translations a seller sets off by editing items or with the re-translate button, per list and per
// item a day: enough to fix a list, too few to use the item page as a free translator. The text
// translated is always the item's saved name and details, and the result is shown on the list.
const EDIT_TRANSLATE_DAILY = 40;
const RETRANSLATE_PER_ITEM = 3;

// Counts n uses of `key` today in one atomic step; false once more than `max` were used.
async function takeQuota(env, key, max, n = 1) {
  const day = `${new Date().toISOString().slice(0, 10)}:${key}`;
  const r = await env.DB.prepare('INSERT INTO ai_daily (day, count) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET count = count + ?2 RETURNING count').bind(day, n).first();
  return (r?.count ?? 0) <= max;
}

// The seller's re-translate button: the saved name and details again, whatever was there before.
async function retranslateItem(env, sale, item) {
  if (item.status !== 'available' && item.status !== 'reserved') fail('CONFLICT', ['这件已经不在售了', 'This item is no longer for sale']);
  if (!(await takeQuota(env, `rt:${item.id}`, RETRANSLATE_PER_ITEM)) || !(await takeQuota(env, `tre:${sale.id}`, EDIT_TRANSLATE_DAILY))) {
    fail('RATE_LIMITED', ['今天重新翻译的次数用完了。译得不对的话，直接改就行', "That's enough re-translating for today. If it's still wrong, just edit it."], 429);
  }
  const r = await translateEach(env, [item.name, item.note]);
  if (!r || !r[0]) fail('AI_FAILED', ['翻译没成功，过一会儿再试', "Translation didn't work, try again later"], 503);
  const nameAlt = [...r[0]].slice(0, 60).join('');
  const noteAlt = [...r[1]].slice(0, 200).join('');
  await env.DB.prepare('UPDATE items SET name_alt = ?, note_alt = ?, alt_src = ? WHERE id = ? AND name = ? AND note = ?')
    .bind(nameAlt, noteAlt, itemSrc(item.name, item.note), item.id, item.name, item.note).run();
  return ok({ nameAlt, noteAlt });
}

// What a list's translation was made from: title, place and the rules a table can't translate.
const customRules = (rules) => rules.filter((r) => !RULES.zh.includes(r) && !RULES.en.includes(r));
const saleSrc = (row) => JSON.stringify([row.title, row.location, ...customRules(JSON.parse(row.rules || '[]'))]);

// The list and up to `limit` of its open items that have no translation of their current text.
async function translateMissing(env, saleId, limit) {
  await translateSale(env, saleId);
  const { results } = await env.DB.prepare(
    `SELECT id, name, note, alt_src FROM items WHERE sale_id = ? AND status IN ('available', 'reserved') AND (alt_src IS NULL OR name_alt IS NULL) ORDER BY no LIMIT ${limit}`,
  ).bind(saleId).all();
  const todo = results.filter((r) => r.alt_src !== itemSrc(r.name, r.note));
  if (!todo.length) return;
  const out = await translateEach(env, todo.flatMap((r) => [r.name, r.note]));
  if (!out) return;
  const done = todo.filter((_, k) => out[2 * k]);
  if (!done.length) return;
  await env.DB.batch(done.map((r) => {
    const k = todo.indexOf(r);
    return env.DB.prepare('UPDATE items SET name_alt = ?, note_alt = ?, alt_src = ? WHERE id = ? AND name = ? AND note = ?')
      .bind([...out[2 * k]].slice(0, 60).join(''), [...out[2 * k + 1]].slice(0, 200).join(''), itemSrc(r.name, r.note), r.id, r.name, r.note);
  }));
}

// The seller is about to share the list in the other language: translate what is missing first,
// so the group text has no untranslated names. Failures leave the originals in place.
async function translateNow(env, sale) {
  try {
    await translateMissing(env, sale.id, 60);
  } catch (e) {
    console.error('translate now', sale.id, e?.message || e);
  }
  return ok({});
}

// Lists made before translations existed (or whose translation failed) get them when someone
// opens them: the list itself and up to BACKFILL_ITEMS untranslated items.
// Never throws. An isolate tries a list at most once per BACKFILL_EVERY, so a translation that
// keeps failing doesn't cost an AI call on every page view.
const BACKFILL_ITEMS = 30;
const BACKFILL_EVERY = HOUR;
const backfillTried = new Map();

async function backfillTranslations(env, saleId) {
  const t = now();
  if (t - (backfillTried.get(saleId) || 0) < BACKFILL_EVERY) return;
  backfillTried.set(saleId, t);
  if (backfillTried.size > 2000) backfillTried.clear();
  try {
    const sale = await env.DB.prepare('SELECT status FROM sales WHERE id = ?').bind(saleId).first();
    if (sale?.status !== 'active') return;
    await translateMissing(env, saleId, BACKFILL_ITEMS);
  } catch (e) {
    console.error('backfill', saleId, e?.message || e);
  }
}

async function translateSale(env, saleId) {
  const sale = await env.DB.prepare('SELECT title, location, rules, alt FROM sales WHERE id = ?').bind(saleId).first();
  if (!sale) return;
  const src = saleSrc(sale);
  let old = null;
  try {
    old = JSON.parse(sale.alt || 'null');
  } catch {}
  if (old?.src === src) return;
  const rules = JSON.parse(sale.rules || '[]');
  const custom = customRules(rules);
  const r = await translateEach(env, [sale.title, sale.location, ...custom]);
  if (!r || !r[0]) return;
  // Rules line up with the list's rules; table rules stay empty here (saleText translates them).
  let k = 2;
  const alt = { title: r[0], location: r[1] || sale.location, rules: rules.map((x) => (custom.includes(x) ? r[k++] : '')), src };
  await env.DB.prepare('UPDATE sales SET alt = ? WHERE id = ? AND title = ? AND location = ? AND rules = ?')
    .bind(JSON.stringify(alt), saleId, sale.title, sale.location, sale.rules).run();
}

// ---------- AI photo recognition (Workers AI) ----------

// Gemma 4 with thinking off: ~1s, best Chinese item names in our test, cheapest per token.
const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const AI_FREE_USES = 3;
const AI_SURVEY_BONUS = 10;
// Honor system: we can't see WeChat payments, and the daily cap bounds what a free click can cost.
const AI_TIP_BONUS = 100;
// Our own cap, well inside the Workers AI free daily allocation (~10 neurons per call).
const AI_DAILY_CAP = 400;
const AI_MAX_IMAGE_BYTES = 400_000;
const AI_MAX_IMAGES = 3;
// Several photos picked at once: sorted into items and recognised in one call.
const AI_BATCH_MAX_IMAGES = 8;
const AI_BATCH_MAX_IMAGE_BYTES = 250_000;

const AI_FIELDS = '"brand":"品牌","brand_en":"品牌英文","model":"型号","name":"物品叫法","name_en":"英文叫法","detail":"详情","detail_en":"英文详情","retail":"原价范围","price":"标价"';
const aiFieldRules = (currency) => `- brand：看 logo、印的字或很有辨识度的外观认出的品牌，用中国人常用的叫法（例如「宜家」「戴森」「苹果」「无印良品」）；认不出就写空字符串。
- model：型号或系列名，保持原文（例如「MALM」「Supersonic」「AirPods Pro」）。只在照片上印着、或外观独一无二、你非常确定时才写；同品牌有好几款长得像的，就写空字符串，写错比不写更糟。
- name：2 到 8 个字，大家常用的叫法，不带品牌（例如「台灯」「吹风机」「抽屉柜」）。
- detail：不超过 30 个字，写照片里看不出来、但买家想知道的信息：这一款的用途、功能、用法或关键规格（例如「1600W，三档风速，带负离子」「适合 140×200 床垫」「可放 13 寸笔记本」）。照片已经给买家看了，不要再描述颜色、外观、数量这些看得见的东西，也不要评价新旧成色。只写你有把握的；一看就懂的普通东西（杯子、衣架）写空字符串。
  照片上印着或写着的字（例如卖家做的商品图、吊牌、包装盒上的尺寸、规格、附送的东西）是买家要的信息，优先照着写进 detail，不要编造。
  标题由 brand、model、name 拼成，detail 里不要再出现标题里已有的内容：不写品牌、型号，也不重复物品叫法。
- brand_en：同一个品牌的英文原名（例如「IKEA」「Dyson」「Apple」「MUJI」）；认不出就写空字符串。
- name_en：name 的英文常用叫法，1 到 4 个词，只有第一个词首字母大写，不带品牌（例如「Desk lamp」「Hair dryer」「Chest of drawers」）。
- detail_en：detail 的英文，意思一样；detail 是空的就写空字符串。
- retail：全新时的大概零售价范围，单位 ${currency}，只写数字，格式「30-40」。认出了品牌就估这一款的价；没认出品牌就估这类东西普通新品的常见价（例如无牌平板支架「10-20」）。范围尽量窄，完全没把握才写空字符串。
- price：照片上写明的二手售价（例如「标价：12 欧」「€5」「售价 20」），只写数字，单位 ${currency}；写明这件东西免费（例如「免费」「白送」「free」）就写 0，附送赠品（例如「+送烤签」）不算免费。原价、新品价不算；照片上没写售价，或写的是别的货币，就写空字符串。不要自己估价。`;

const aiPrompt = (currency, n = 1) => `${n > 1 ? `这是 ${n} 张同一件物品的照片，准备在留学生二手群里出售。请结合所有照片识别这件物品` : '这是一张准备在留学生二手群里出售的物品照片。请识别照片里的主要物品'}。带 _en 的字段用英文，其他字段用简体中文。
只输出一行 JSON，不要任何别的文字：{${AI_FIELDS}}
${aiFieldRules(currency)}`;

const aiBatchPrompt = (currency, n) => `下面是同一个人准备在留学生二手群里出售的 ${n} 张照片，每张前面标了编号。有的东西拍了好几张（不同角度、细节、标签、包装），有的只拍了一张。
第一步：按编号顺序一张一张看，给每张照片标上它拍的是哪件物品，用字母 A、B、C… 表示，同一件物品用同一个字母。同类但不是同一件的东西（例如两个不同的杯子）用不同字母；一套东西（例如一套餐具）算一件。
第二步：结合每件物品的所有照片识别它。带 _en 的字段用英文，其他字段用简体中文。
只输出一行 JSON，不要任何别的文字。photos 按编号顺序正好 ${n} 个字母：{"photos":["A","B","A"],"items":[{"id":"A",${AI_FIELDS}}]}
每件物品的字段：
${aiFieldRules(currency)}`;

// The seller already put the photos on cards: name every card, one call for all of them.
const aiGroupedPrompt = (currency, n, ids) => `下面是同一个人准备在留学生二手群里出售的 ${ids.length} 件物品，共 ${n} 张照片，已经按物品分好，每张前面标了它属于哪件物品（${ids.join('、')}）。结合每件物品的所有照片分别识别。带 _en 的字段用英文，其他字段用简体中文。
只输出一行 JSON，不要任何别的文字。items 按 ${ids.join('、')} 的顺序正好 ${ids.length} 件：{"items":[{"id":"A",${AI_FIELDS}}]}
每件物品的字段：
${aiFieldRules(currency)}`;

async function aiQuota(env, clientId) {
  const row = await env.DB.prepare('SELECT * FROM ai_quota WHERE client_id = ?').bind(clientId).first();
  const used = row?.used ?? 0;
  const bonus = row?.bonus ?? 0;
  const unlimited = !!row?.unlimited;
  return { left: unlimited ? null : Math.max(0, AI_FREE_USES + bonus - used), unlimited, surveyDone: !!row?.survey_done, tipped: !!row?.tipped };
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
  if (!id) fail('INVALID', ['缺少设备标识，刷新一下再试', 'Missing device token, refresh and try again']);
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
  const brandEn = clean(out.brand_en, 20);
  const model = clean(out.model, 20);
  const what = clean(out.name, 10);
  const whatEn = clean(out.name_en, 30);
  if (!what) return { name: '', brand, model, note: '', nameEn: '', noteEn: '', retail: null, price: null };
  // 宜家台灯 / 戴森 Supersonic 吹风机: a Latin model name needs spaces around it.
  const name = model ? `${brand}${brand ? ' ' : ''}${model} ${what}` : `${brand}${what}`;
  // Brand and model are in the name already, so the details leave them out.
  const note = clean(out.detail ?? out.note, 50);
  // English: "IKEA MALM Chest of drawers".
  const bEn = brandEn || (brand && !hasCJKText(brand) ? brand : '');
  const nameEn = whatEn ? [bEn, model, whatEn].filter(Boolean).join(' ') : '';
  const noteEn = clean(out.detail_en, 120);
  // Without a brand the range is for the kind of item in general, and the UI says so.
  const retail = parseRetail(out.retail);
  return { name: clean(name, 30), brand, model, note: clean(note, 100), nameEn: clean(nameEn, 60), noteEn: clean(noteEn, 200), retail: retail && { ...retail, generic: !brand }, price: parseAskPrice(out.price) };
}

// The asking price written on the photo ("12", "5.5", "0" for free) -> number, or null.
function parseAskPrice(v) {
  const m = String(v ?? '').replace(',', '.').match(/\d+(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 0 && n < 100000 ? n : null;
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

// Quota check shared by single and batch recognition, then the model calls counted against the
// network's and today's caps before they run, so failed and simultaneous calls count too.
// Invite-code users may go past the daily cap, up to twice it.
async function aiGate(env, req, clientId, calls) {
  const q = await aiQuota(env, clientId);
  if (!q.unlimited && q.left <= 0) fail('LIMIT', q.surveyDone ? ['送的次数用完了', 'Your free tries are used up'] : ['送的 3 次用完了', 'Your 3 free tries are used up'], 429);
  await limitIp(env, req, 'ai', AI_CALLS_PER_IP, calls);
  const day = new Date().toISOString().slice(0, 10);
  const daily = await env.DB.prepare('INSERT INTO ai_daily (day, count) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET count = count + ?2 RETURNING count').bind(day, calls).first();
  if (daily.count > (q.unlimited ? 2 * AI_DAILY_CAP : AI_DAILY_CAP)) fail('AI_BUSY', ['今天的 AI 免费额度用完了，先打字也很快', 'Today\’s free AI budget is used up. Typing is quick too'], 503);
  return q;
}

async function aiImages(req, max, maxBytes) {
  let form;
  try {
    form = await req.formData();
  } catch {
    fail('INVALID', ['照片格式不对', 'Bad photo format']);
  }
  const files = form.getAll('image').filter((f) => f && typeof f !== 'string').slice(0, max);
  if (!files.length) fail('INVALID', ['没有收到照片', 'No photo received']);
  if (files.some((f) => f.size > maxBytes)) fail('INVALID', ['照片太大了', 'Photo too large']);
  const currency = /^[A-Z]{3}$/.test(form.get('currency') || '') ? form.get('currency') : 'EUR';
  // Card numbers 0..25, one per photo, non-decreasing; anything else is ignored.
  const g = form.get('groups') ? String(form.get('groups')).split(',').map(Number) : [];
  const groups = g.length === files.length && g.every((x, i) => Number.isInteger(x) && x >= 0 && x < 26 && (i === 0 || x >= g[i - 1])) ? g : null;
  return { images: await Promise.all(files.map(imagePart)), currency, groups };
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
    if (/neuron|quota|limit|free plan|4006|5035/i.test(String(e?.message))) fail('AI_BUSY', ['今天的 AI 免费额度用完了，先打字也很快', 'Today\’s free AI budget is used up. Typing is quick too'], 503);
    fail('AI_ERROR', ['AI 暂时识别不了，直接打字也行', 'The AI can\’t recognise photos right now, just type it'], 502);
  }
  return reply?.response || reply?.choices?.[0]?.message?.content;
}

// uses: recognised items, charged to the seller (the daily cap was charged in aiGate).
function chargeAi(env, clientId, uses) {
  return uses ? env.DB.batch(upsertQuota(env, clientId, `used = used + ${uses}`)) : null;
}

async function aiIdentify(env, req) {
  const clientId = requireClient(req);
  // Up to AI_MAX_IMAGES shots of the same item; one call, one use of the quota.
  const { images, currency } = await aiImages(req, AI_MAX_IMAGES, AI_MAX_IMAGE_BYTES);
  await aiGate(env, req, clientId, 1);
  const result = parseAiReply(await runAi(env, [{ type: 'text', text: aiPrompt(currency, images.length) }, ...images], 380));
  if (!result.name) fail('AI_ERROR', ['没认出来是什么，直接打字吧', 'Couldn\’t tell what this is, just type it'], 502);

  // Only successful recognitions count against the seller's quota.
  await chargeAi(env, clientId, 1);
  const after = await aiQuota(env, clientId);
  return ok({ ...result, left: after.left, unlimited: after.unlimited });
}

// The reply labels each photo, in order, with the letter of the item it shows. Photos with
// the same letter become one item; a missing or unknown label makes a photo its own,
// unrecognised item. Items come back ordered by their first photo, photos counted from 0.
// With given labels (photos the seller grouped) the grouping is kept even if the AI misses an item.
function parseBatch(reply, n, given) {
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
  const labels = given || (Array.isArray(out.photos) ? out.photos : []);
  const byLabel = new Map();
  const items = [];
  for (let i = 0; i < n; i++) {
    const label = String(labels[i] ?? '').trim();
    const known = label && (given || info.has(label));
    if (known && byLabel.has(label)) byLabel.get(label).photos.push(i);
    else {
      const item = { photos: [i], ...parseAiReply(info.get(label) || {}) };
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
  const { images, currency, groups } = await aiImages(req, AI_BATCH_MAX_IMAGES, AI_BATCH_MAX_IMAGE_BYTES);
  // Roughly one photo call's work per three photos.
  const q = await aiGate(env, req, clientId, Math.ceil(images.length / 3));
  // groups: the card each photo is on ("0,0,1,2"), when the seller already sorted them.
  const labels = groups && groups.length === images.length ? groups.map((g) => String.fromCharCode(65 + g)) : null;
  const ids = labels && [...new Set(labels)];
  const content = [{ type: 'text', text: labels ? aiGroupedPrompt(currency, images.length, ids) : aiBatchPrompt(currency, images.length) }];
  images.forEach((im, i) => content.push({ type: 'text', text: labels ? `物品 ${labels[i]}：` : `第 ${i + 1} 张：` }, im));
  const items = parseBatch(await runAi(env, content, 120 + 170 * images.length), images.length, labels);

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
  await chargeAi(env, clientId, uses);
  const after = await aiQuota(env, clientId);
  return ok({ items, limited, left: after.left, unlimited: after.unlimited });
}

const SURVEY_FIELDS = ['slowest', 'hours', 'pay', 'detail', 'contact'];

async function aiSurvey(env, req) {
  const clientId = requireClient(req);
  const b = await body(req);
  const answers = {};
  for (const k of SURVEY_FIELDS) answers[k] = str(b[k], { max: 300, name: ['回答', 'Answer'] });
  if (!answers.slowest || !answers.hours || !answers.pay) fail('INVALID', ['三道题都选一下就好', 'Please answer all three questions']);
  const q = await aiQuota(env, clientId);
  const stmts = [env.DB.prepare('INSERT INTO survey_responses (client_id, answers, created_at) VALUES (?, ?, ?)').bind(clientId, JSON.stringify(answers), now())];
  if (!q.surveyDone) stmts.push(...upsertQuota(env, clientId, `bonus = bonus + ${AI_SURVEY_BONUS}, survey_done = 1`));
  await env.DB.batch(stmts);
  return ok(await aiQuota(env, clientId));
}

async function aiTip(env, req) {
  const clientId = requireClient(req);
  const q = await aiQuota(env, clientId);
  if (!q.tipped) await env.DB.batch(upsertQuota(env, clientId, `bonus = bonus + ${AI_TIP_BONUS}, tipped = 1`));
  return ok({ ...(await aiQuota(env, clientId)), granted: !q.tipped, bonus: AI_TIP_BONUS });
}

const FEEDBACK_PER_DAY = 10;
const FEEDBACK_MAX_SHOTS = 3;

// Multipart: text fields plus up to FEEDBACK_MAX_SHOTS screenshots named "shot".
async function sendFeedback(env, req) {
  const clientId = requireClient(req);
  let form;
  try {
    form = await req.formData();
  } catch {
    fail('INVALID', ['请求格式不对', 'Bad request']);
  }
  const b = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const shots = form.getAll('shot').filter((f) => typeof f !== 'string').slice(0, FEEDBACK_MAX_SHOTS);
  if (shots.some((f) => f.size > MAX_PHOTO_BYTES)) fail('INVALID', ['截图太大了', 'Screenshot too large']);
  const text = str(b.text, { max: 1000, name: ['反馈', 'Feedback'] });
  if (!text && !shots.length) fail('INVALID', ['写一句或者传张截图吧', 'Write a line or add a screenshot']);
  const contact = str(b.contact, { max: 60, name: ['联系方式', 'Contact'] });
  // Path only: a manage URL's query holds the admin key.
  const page = String(b.page ?? '').split(/[?#]/)[0].slice(0, 100);
  const role = ['seller', 'buyer'].includes(b.role) ? b.role : '';
  const ua = `${(req.headers.get('user-agent') || '').slice(0, 300)} · ${Number(b.width) || 0}px`;
  const t = now();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE client_id = ? AND created_at > ?').bind(clientId, t - 24 * HOUR).first();
  if (n.n >= FEEDBACK_PER_DAY) fail('LIMIT', ['今天已经收到你好多条反馈了，明天再发吧', 'That\’s a lot of feedback today, send more tomorrow']);
  await limitIp(env, req, 'feedback', FEEDBACK_PER_IP);
  if (shots.length) await takeUploadRoom(env, req, shots.reduce((s, f) => s + f.size, 0));
  const ids = shots.map(() => rid(16));
  const stmts = await Promise.all(shots.map(async (f, i) =>
    env.DB.prepare("INSERT INTO photos (id, sale_id, full, thumb, created_at) VALUES (?, '', ?, NULL, ?)").bind(ids[i], await f.arrayBuffer(), t)));
  stmts.push(env.DB.prepare('INSERT INTO feedback (client_id, text, contact, page, role, ua, photos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(clientId, text, contact, page, role, ua, JSON.stringify(ids), t));
  await env.DB.batch(stmts);
  return ok({});
}

async function aiNudge(env, req) {
  const clientId = requireClient(req);
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('INSERT OR IGNORE INTO ai_nudges (client_id, day, created_at) VALUES (?, ?, ?)').bind(clientId, day, now()).run();
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT client_id) AS n FROM ai_nudges').first();
  return ok({ total: total.n });
}

// ---------- keep gift: AI tries that live in a saved /keep link ----------

const KEEP_GIFT_USES = 10;
// Reopening the link this soon is the saver checking it, not coming back to sell.
const KEEP_GIFT_MIN_AGE = HOUR;
// Dorms and campus Wi-Fi share one address, so this only stops scripted farming.
const KEEP_GIFTS_PER_IP_DAY = 20;

// Each card sent to a friend is its own gift (one friend claims it); this caps a device per day.
const FRIEND_GIFTS_PER_DAY = 5;

// Saving for yourself: one gift per device per day, asking again the same day returns the same code.
// For a friend ({ friend: true, name }): a new code each time.
async function keepGiftCreate(env, req) {
  const clientId = requireClient(req);
  const b = await body(req);
  const friend = !!b.friend;
  const t = now();
  const since = t - 24 * HOUR;
  if (friend) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM keep_gifts WHERE created_by = ? AND kind = 'friend' AND created_at > ?").bind(clientId, since).first();
    if (r.n >= FRIEND_GIFTS_PER_DAY) fail('LIMIT', [`今天已经送出 ${FRIEND_GIFTS_PER_DAY} 份了，明天再送`, `You sent ${FRIEND_GIFTS_PER_DAY} today, send more tomorrow`], 429);
  } else {
    const mine = await env.DB.prepare("SELECT code FROM keep_gifts WHERE created_by = ? AND kind = 'keep' AND created_at > ? ORDER BY created_at DESC LIMIT 1").bind(clientId, since).first();
    if (mine) return ok({ code: mine.code, uses: KEEP_GIFT_USES });
  }
  const ip = req.headers.get('cf-connecting-ip') || null;
  if (ip) {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM keep_gifts WHERE created_ip = ? AND created_at > ?').bind(ip, since).first();
    if (r.n >= KEEP_GIFTS_PER_IP_DAY) fail('LIMIT', ['今天送出的太多了，明天再来', 'Too many gifts today, come back tomorrow'], 429);
  }
  const code = rid(8);
  const name = friend ? String(b.name ?? '').replace(/[\s<>]+/g, ' ').trim().slice(0, 12) || null : null;
  // The earned column stays empty: what a seller made is theirs alone, never on a card they send.
  await env.DB.prepare('INSERT INTO keep_gifts (code, created_at, created_by, created_ip, kind, from_name) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(code, t, clientId, ip, friend ? 'friend' : 'keep', name).run();
  return ok({ code, uses: KEEP_GIFT_USES });
}

// The sender's name for a friend gift's card, or null for any other link.
async function friendGift(env, code) {
  if (!code || !/^\w{1,32}$/.test(code)) return null;
  const g = await env.DB.prepare("SELECT from_name FROM keep_gifts WHERE code = ? AND kind = 'friend'").bind(code).first();
  return g ? { name: g.from_name || '' } : null;
}

// Moves the gift onto this device. status: added | early | mine | taken | onePerDevice | invalid,
// or own when the sender opens their friend gift (it stays for the friend).
async function keepGiftRedeem(env, req, code) {
  const clientId = requireClient(req);
  const g = await env.DB.prepare('SELECT * FROM keep_gifts WHERE code = ?').bind(code).first();
  if (!g) return ok({ status: 'invalid' });
  const friend = g.kind === 'friend';
  if (g.redeemed_by) return ok({ status: g.redeemed_by === clientId ? 'mine' : 'taken', friend });
  if (friend && g.created_by === clientId) return ok({ status: 'own', friend, uses: KEEP_GIFT_USES });
  const t = now();
  if (!friend && t - g.created_at < KEEP_GIFT_MIN_AGE) return ok({ status: 'early', uses: KEEP_GIFT_USES });
  const had = await env.DB.prepare('SELECT 1 FROM keep_gifts WHERE redeemed_by = ? LIMIT 1').bind(clientId).first();
  if (had) return ok({ status: 'onePerDevice' });
  const res = await env.DB.prepare('UPDATE keep_gifts SET redeemed_at = ?, redeemed_by = ? WHERE code = ? AND redeemed_by IS NULL').bind(t, clientId, code).run();
  if (!res.meta.changes) return ok({ status: 'taken' });
  await env.DB.batch(upsertQuota(env, clientId, `bonus = bonus + ${KEEP_GIFT_USES}`));
  return ok({ status: 'added', friend, uses: KEEP_GIFT_USES });
}

async function aiInvite(env, req) {
  const clientId = requireClient(req);
  const code = String((await body(req)).code ?? '').trim().toUpperCase();
  if (!env.INVITE_CODE || code !== env.INVITE_CODE.toUpperCase()) fail('INVALID', ['邀请码不对', 'Wrong invite code']);
  await env.DB.batch(upsertQuota(env, clientId, 'unlimited = 1'));
  return ok(await aiQuota(env, clientId));
}
