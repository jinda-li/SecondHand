// The landing page body for / (Chinese) and /en (English). Plain HTML so it reads without JavaScript;
// public/landing.js plays the room as you scroll, and app.js wires the feedback button.
import { ROOM_DEFS, ROOM_SHELL } from './landing-art.js';
import { thingsSvg, tagsSvg, rowsHtml } from '../public/landing.js';

// A made-up QR code for the long picture: three finder squares and a fixed scatter of modules.
const QR = (() => {
  const n = 21;
  const bits = '1011001110100101101100111001011010011101001011100101101001110010110100111';
  let out = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const f = [[0, 0], [0, n - 7], [n - 7, 0]].find(([fr, fc]) => r - fr >= 0 && r - fr < 7 && c - fc >= 0 && c - fc < 7);
    const dark = f
      ? ((dr, dc) => dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr > 1 && dr < 5 && dc > 1 && dc < 5))(r - f[0], c - f[1])
      : bits[(r * 7 + c * 3) % bits.length] === '1';
    if (dark) out += `M${c} ${r}h1v1h-1z`;
  }
  return `<svg viewBox="-1 -1 23 23"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/><path d="${out}" fill="#111"/></svg>`;
})();

// faq: [question, answer] pairs; tipUrl: the web tip page (Ko-fi), empty to leave it out.
export function landingHtml(lang, { appName, faq, esc, repoUrl, tipUrl }) {
  const T = (zh, en) => (lang === 'en' ? en : zh);
  const home = T('/', '/en');
  const start = '/new?go=1';
  const browse = '/nearby';
  const av = (id) => `<svg class="av"><use href="#av-${id}"></use></svg>`;
  const draw = (sym, vb) => `<svg viewBox="${vb}"><use href="#${sym}"></use></svg>`;
  const VB = { 'g-sofa': '0 0 190 160', 'g-shelf': '0 0 130 200', 'g-desk': '0 0 150 150', 'g-lamp': '0 0 50 70', 'g-chair': '0 0 80 100', 'g-plant': '0 0 70 110' };
  const pic = (sym) => draw(sym, VB[sym]);
  const roomSvg = (id, label, inner) => `<svg class="room" id="${id}" viewBox="0 0 760 640" role="img" aria-label="${label}">${ROOM_SHELL}${inner}</svg>`;
  const keys = '<use class="keys" href="#g-keys" x="352" y="446" width="56" height="35"></use>';
  const bubbles = '<svg viewBox="0 0 40 40"><rect class="pa-b1" x="4" y="7" width="22" height="15" rx="6" fill="#7fb36a" stroke="#5a3a2a" stroke-width="1.6"/><path class="pa-b1" d="M9 21 l-2 6 l7 -5" fill="#7fb36a" stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round"/><rect class="pa-b2" x="14" y="18" width="22" height="15" rx="6" fill="#4b8fd1" stroke="#5a3a2a" stroke-width="1.6"/><path class="pa-b2" d="M31 32 l2 5 l-7 -5" fill="#4b8fd1" stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const flip = '<svg viewBox="0 0 40 40"><rect x="5" y="6" width="30" height="28" rx="7" fill="#fff" stroke="#5a3a2a" stroke-width="1.6"/><text class="pa-zh" x="20" y="25.5" text-anchor="middle" font-size="15" font-weight="900" fill="#16213a">中</text><text class="pa-en" x="20" y="25" text-anchor="middle" font-size="12" font-weight="900" fill="#0058a3">EN</text></svg>';
  const rings = '<svg viewBox="0 0 40 40"><circle class="pa-ring" cx="20" cy="24" r="8" fill="none" stroke="#0058a3" stroke-width="1.6"/><circle class="pa-ring r2" cx="20" cy="24" r="8" fill="none" stroke="#0058a3" stroke-width="1.6"/><path d="M13 25 L20 18 L27 25 Z" fill="#cf5c45" stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round"/><rect x="15" y="24.5" width="10" height="8" fill="#f6ecd8" stroke="#5a3a2a" stroke-width="1.6"/></svg>';
  const cup = '<svg class="kofi-cup" viewBox="0 0 120 110" aria-hidden="true"><path d="M30 26 q4 -10 0 -18 M48 26 q4 -10 0 -18 M66 26 q4 -10 0 -18" stroke="#b9a58e" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M14 34 H86 V70 Q86 96 60 96 H40 Q14 96 14 70 Z" fill="#fff" stroke="#2f2a26" stroke-width="3" stroke-linejoin="round"/><path d="M86 44 Q106 42 104 60 Q102 76 84 74" fill="none" stroke="#2f2a26" stroke-width="3"/><path d="M38 58 q12 -12 24 0 q-12 16 -24 0 Z" fill="#e7738a"/><ellipse cx="50" cy="102" rx="44" ry="5" fill="#e3e8ee"/></svg>';

  const listTitle = T('搬家出闲置', 'Moving-out sale');
  // A link to the list as it shows in a chat: a picture of the things, the title, how many are in line.
  const linkCard = (style = '') => `<div class="lk"${style ? ` style="${style}"` : ''}><div class="lk-img">${draw('g-sofa', '0 0 190 160')}${draw('g-shelf', '0 0 130 200')}${draw('g-lamp', '0 0 50 70')}</div><div class="lk-t"><b>${listTitle}</b><small>${T('<em data-qtotal>0</em> 人在排队', '<em data-qtotal>0</em> in line')}</small></div></div>`;

  // The app's own screens, drawn small: a shared link card, the long picture, list tiles, the queue.
  const wxCard = `<div class="wxc"><b>${listTitle} · ${T('10 件', '10 items')}</b><div class="wxc-r"><span>${T('沙发 €40、书桌 €35、书架 €25…', 'Sofa €40, desk €35, shelf €25…')}</span><i>${pic('g-sofa')}</i></div><div class="wxc-f"><img src="/icon.svg" alt="" width="12" height="12">${appName}</div></div>`;
  const longPic = `<div class="lpic"><div class="lpic-in">
    <div class="lpic-h"><b>${listTitle}</b><small>${T('校园自提 · 周末前出完', 'Campus pickup · until Sunday')}</small></div>
    <div class="lpic-m">${[['g-sofa', '€40'], ['g-desk', '€35'], ['g-shelf', '€25'], ['g-chair', '€20']].map(([s, p]) => `<span>${pic(s)}<em>${p}</em></span>`).join('')}</div>
    <div class="lpic-l">${T([['沙发', '€40'], ['书桌', '€35'], ['书架', '€25'], ['椅子', '€20'], ['台灯', '€5'], ['绿植', '€3']], [['Sofa', '€40'], ['Desk', '€35'], ['Shelf', '€25'], ['Chair', '€20'], ['Lamp', '€5'], ['Plant', '€3']]).map(([n, p]) => `<span>${n}<b>${p}</b></span>`).join('')}</div>
    <div class="lpic-f">${QR}<b>${T('扫码预订', 'Scan to reserve')}</b></div>
  </div></div>`;
  const tile = (sym, name, price, btn, ghost = false) => `<div class="tl"><div class="tl-ph">${pic(sym)}</div><div class="tl-n">${name}</div><span class="tl-p">${price}</span><span class="tl-b${ghost ? ' ghost' : ''}">${btn}</span></div>`;
  const reserve = T('预订', 'Reserve');
  const waitlist = T('排候补 · 前面 1 人', 'Waitlist · 1 ahead');
  const queue = T([['微信', 'wx', '小雨', '20:15'], ['TG', 'tg', 'Lisa', '20:31'], ['微信', 'wx', '陈默', '21:02']], [['Telegram', 'tg', 'Lisa', '20:15'], ['WeChat', 'wx', 'Xiaoyu', '20:31'], ['Facebook', 'fb', 'Tom', '21:02']]);

  const wechatTip = `<div class="way"><b>${T('微信赞赏', 'WeChat')}</b><img src="/tip-qr.png" alt="${T('微信赞赏码', 'WeChat tip code')}" width="150" height="150" loading="lazy"><small>${T('微信里长按识别', 'Long-press it in WeChat')}</small></div>`;
  const kofiTip = tipUrl ? `<div class="way"><b>Ko-fi</b>${cup}<a class="lp-btn b" href="${esc(tipUrl)}" target="_blank" rel="noopener">${T('去 Ko-fi 打赏', 'Tip on Ko-fi')}</a><small>${T('银行卡就能付', 'Pay by card')}</small></div>` : '';

  return `<div class="lp">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${ROOM_DEFS}</defs></svg>
<header class="nav">
  <div class="wrap">
    <a class="lp-logo" href="${home}"><img src="/icon.svg" alt="" width="32" height="32"><span>${appName}</span></a>
    <nav class="nav-links" aria-label="${T('页面', 'Page')}">
      <a href="#how">${T('怎么用', 'How it works')}</a>
      <a href="#buy">${T('买二手', 'Buying')}</a>
      <a href="#faq">${T('常见问题', 'FAQ')}</a>
      <a href="/my">${T('我的排队', 'My reservations')}</a>
    </nav>
    <div class="nav-r">
      <span class="lang">${lang === 'en' ? '<a href="/" data-lang-switch>中文</a><a class="on" href="/en">EN</a>' : '<a class="on" href="/">中文</a><a href="/en" data-lang-switch>EN</a>'}</span>
      <a class="lp-btn y" href="${start}">${T('开始发布', 'Start posting')}</a>
    </div>
  </div>
</header>

<main>
<section class="hero" id="top" aria-label="${T('开场', 'Intro')}">
  <div class="pin">
    <div class="words">
      <h1><span class="w-top">${T('出二手，', 'One list,')}</span><span class="w-bot">${T('发一个<em>清单</em>就够了。', 'every <em>group</em>.')}</span></h1>
      <p class="lede-m">${T('发到微信群、Telegram、Facebook 群，<b>想要的人自己排队</b>。', 'Share it in WeChat, Telegram and Facebook groups. People <b>queue up themselves</b>.')}</p>
      <div class="side">
        <p>${T('拍照放进一个清单，链接发到微信群、Telegram 群、Facebook 群。<br>想要的人<b>自己排队</b>。', 'Snap your things into one list and share the link in your WeChat, Telegram and Facebook groups.<br>People <b>queue up themselves</b>.')}</p>
        <div class="cta">
          <a class="lp-btn y" href="${start}">${T('开始发布', 'Start posting')}</a>
          <a class="lp-btn ghost" href="${browse}">${T('浏览二手物品', 'Browse secondhand')}</a>
        </div>
        <small>${T('免费 · 不用下载 · 不用注册', 'Free · no app · no sign-up')}</small>
      </div>
    </div>

    <div class="stage">
      <div class="roomwrap">
        ${roomSvg('room1', T('一间摆满东西的房间：先用手机一件件拍照，再有人在几个群里排队，最后一件件卖掉，房间变得干干净净', 'A room full of things: each is photographed with a phone, people from several groups queue for them, then they sell one by one and the room is left clean'), `
          <g class="items">${thingsSvg()}</g>
          <g class="clean" clip-path="url(#floorClip)"><polygon class="sheen" points="300,330 340,310 140,610 100,630" fill="#fffdf4" fill-opacity=".45"></polygon></g>
          ${keys}
          <g class="vf"><rect x="0" y="0" width="100" height="100" rx="10" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="22 1000" pathLength="1000"></rect></g>
          <g class="tagset">${tagsSvg(lang)}</g>
          <g class="phg"><g class="ph-in">
            <rect x="0" y="0" width="58" height="104" rx="11" fill="#2f2a26"></rect>
            <rect x="4" y="9" width="50" height="78" rx="4" fill="#fbf1de"></rect>
            <use class="ph-item" href="#g-sofa" x="8" y="20" width="42" height="56"></use>
            <path d="M8 21 v-7 h7 M43 14 h7 v7 M50 75 v7 h-7 M15 82 h-7 v-7" fill="none" stroke="#0058a3" stroke-width="1.6"></path>
            <rect class="ph-dim" x="4" y="9" width="50" height="78" rx="4" fill="#2f2a26" opacity="0"></rect>
            <circle class="ph-btn" cx="29" cy="95.5" r="5" fill="#fff" stroke="#8b8b94" stroke-width="1.4"></circle>
          </g></g>`)}
      </div>
      <div class="counter" id="counter"><ol class="rail">${T(['拍照', '发群', '卖掉'], ['Snap', 'Share', 'Sell']).map((n, i) => `<li><i>${i + 1}</i><b>${n}</b></li>`).join('')}</ol><span class="live" id="live"><span id="count-pre"></span><b id="count-n">0</b><span id="count-post"></span></span></div>
      <aside class="mini" id="mini" aria-hidden="true">
        <div class="mini-h"><div><b>${T('我的闲置', 'My things')}</b><small>${T('校园自提 · 周末都在', 'Campus pickup · weekends')}</small></div><span>${T('发到群里', 'Share')}</span></div>
        <ul class="rows" id="rows">${rowsHtml(lang)}</ul>
      </aside>
      <aside class="gp" id="gp" aria-hidden="true">
        <div class="gp-scr">
          <div class="gp-tabs"><span class="on">${T('微信群', 'WeChat')}</span><span>Telegram</span><span>${T('朋友圈', 'Facebook')}</span></div>
          <div class="gp-body">
            <div class="gp-s on">
              <div class="gp-name">${T('校园二手群（412）', 'Campus buy & sell (412)')}</div>
              <div class="msg me">${av('me')}${linkCard()}</div>
              <div class="msg">${av('cat')}<div class="bub2">${T('沙发我排上了', 'Got in line for the sofa')}</div></div>
            </div>
            <div class="gp-s">
              <div class="gp-name">${T('本地二手群（2,140）', 'Local buy & sell (2,140)')}</div>
              <div class="msg me">${av('me')}${linkCard()}</div>
              <div class="msg">${av('hill')}<div class="bub2">Queued for the desk!</div></div>
            </div>
            <div class="gp-s">
              <div class="gp-name">${T('朋友圈', 'Neighbourhood group')}</div>
              <div class="moments">
                <div class="who-l">${av('me')}${T('我', 'Me')}</div>
                <div class="mo-txt">${T('周末搬家，闲置都在这儿', 'Moving out, everything\'s in this list')}</div>
                ${linkCard('width:100%')}
                <div class="likes">${T('小雨、Lisa、陈默 排了队', 'Lisa, Xiaoyu and Tom got in line')}</div>
              </div>
            </div>
          </div>
          <div class="gp-foot">${T('三个地方，同一条队', 'Three places, one line')}</div>
        </div>
      </aside>
      <aside class="gp-m" id="gpm" aria-hidden="true">
        <div class="in">
          <div class="row-g on">${av('cat')}<span>${T('校园二手群', 'Campus')}</span></div>
          <div class="row-g">${av('hill')}<span>${T('本地二手群', 'Local')}</span></div>
          <div class="row-g">${av('girl')}<span>${T('朋友圈', 'Facebook')}</span></div>
          <div class="t">${T('同一条队 · <b data-qtotal>0</b> 人', 'One line · <b data-qtotal>0</b> people')}</div>
        </div>
      </aside>
      <div class="cap" data-cap="1"><h3>${T('拍一张，AI 填好名字', 'Snap it. AI names it.')}</h3><p>${T('你只填价格。', 'You set the price.')}</p></div>
      <div class="cap" data-cap="2"><h3>${T('几个群，排同一条队', 'Many groups, one line')}</h3><p>${T('微信群、Telegram、Facebook 群、朋友圈都行。', 'WeChat, Telegram, Facebook, any group.')}</p></div>
      <div class="cap" data-cap="3"><h3>${T('卖掉一件，划掉一件', 'Sell one, cross it off')}</h3><p>${T('每个群里都是最新的。', 'Every group sees it live.')}</p></div>
    </div>
    <div class="scroll-hint"><i></i>${T('往下滑', 'Scroll')}</div>
  </div>
</section>

<section class="s" id="how">
  <div class="wrap">
    <div class="sec-h">
      <div class="eyebrow rv">${T('卖二手', 'Selling')}</div>
      <h2 class="h2 rv">${T('东西再多、群再多，<br>一个清单就管得过来。', 'Lots of stuff, lots of groups.<br>One list keeps track.')}</h2>
    </div>
    <div class="chores">
      <article class="chore rv" data-go>
        <div class="art art-share" aria-hidden="true">
          <div class="tm">${T('周六 10:24', 'Sat 10:24')}</div>
          <div class="msg me">${av('me')}<div class="swap">${wxCard}${longPic}</div></div>
        </div>
        <h3>${T('不用一个个群发', 'No re-posting in every group')}</h3>
        <p>${T('一个链接或一张长图，哪个群都能发。', 'Share one link, or one image of the whole list, anywhere.')}</p>
      </article>
      <article class="chore rv" data-go>
        <div class="art art-res" aria-hidden="true">
          <div class="f f1"><div class="tiles">${tile('g-sofa', T('布艺沙发', 'Fabric sofa'), '€40', reserve)}${tile('g-desk', T('实木书桌', 'Wooden desk'), '€35', waitlist, true)}</div></div>
          <div class="f f2"><b>${T('预订成功', 'Reserved!')}</b><div class="ct"><div class="ct-t">${T('你排第 1 位，去群里私聊卖家吧', 'You\'re first in line: message the seller from the group')}</div></div></div>
          <div class="f f3">
            <div class="ch-h">${T('卖家', 'Seller')}</div>
            <div class="msg me">${av('girl')}<div class="bub2">${T('我排第 1，周六来拿沙发？', 'I\'m first. Sofa on Saturday?')}</div></div>
            <div class="msg">${av('me')}<div class="bub2">${T('好，下午三点见', 'Sure, 3pm')}</div></div>
          </div>
        </div>
        <h3>${T('不用挨个回消息', 'No replying to everyone')}</h3>
        <p>${T('想要的人点预订排队，你只跟第 1 位聊。', 'People tap Reserve. You only chat with #1.')}</p>
      </article>
      <article class="chore rv" data-go>
        <div class="art art-q" data-subst aria-hidden="true">
          <div class="qh"><span class="qth">${pic('g-sofa')}</span><b>${T('布艺沙发', 'Fabric sofa')}</b><span class="tl-p">€40</span></div>
          <div class="ql">${T('排队名单（3 人）', 'In line (3)')}</div>
          <div class="qlist">${queue.map(([k, c, n, t], i) => `<div class="qr q${i}${i ? '' : ' first'}"><span class="pos">${i + 1}</span><div class="qr-m"><div><span class="kt ${c}">${k}</span><b>${n}</b><small>${t}</small></div><div class="acts"><span class="b p">${T('卖给他了', 'Sold')}</span><span class="b d">${T('他不要了', 'Backed out')}</span></div></div></div>`).join('')}</div>
          <div class="qtoast">${T('下一位顶上', 'Next in line moves up')}</div>
        </div>
        <h3>${T('不用记谁先要的', 'No keeping track of who asked first')}</h3>
        <p>${T('第 1 位不要了，下一位自动顶上。', 'If #1 backs out, the next moves up.')}</p>
      </article>
    </div>
  </div>
</section>

<section class="s share" style="padding-top:0">
  <div class="wrap">
    <div class="sec-h">
      <div class="eyebrow rv">${T('一个链接', 'One link')}</div>
      <h2 class="h2 rv">${T('发到几个群，<br>都是同一份清单。', 'Every group,<br>the same list.')}</h2>
    </div>
    <div class="share-stage">
      <ul class="chans" aria-hidden="true">${[['cat', T('校园二手群', 'Campus buy & sell')], ['hill', T('本地二手群', 'Local buy & sell')], ['bloom', T('朋友圈', 'Facebook group')]].map(([a, n]) => `<li>${av(a)}<span>${n}</span></li>`).join('')}</ul>
      <div class="phone" aria-hidden="true"><div class="scr">
        <div class="scr-h"><b>${listTitle}</b><small>${T('校园自提 · 周末 · 10 件', 'Campus pickup · weekends · 10 items')}</small></div>
        <div class="tiles">${tile('g-sofa', T('布艺沙发', 'Fabric sofa'), '€40', waitlist, true)}${tile('g-desk', T('实木书桌', 'Wooden desk'), '€35', reserve)}${tile('g-shelf', T('五层书架', 'Bookshelf'), '€25', reserve)}${tile('g-plant', T('绿植', 'Plant'), '€3', reserve)}</div>
      </div></div>
      <ul class="feats">
      <li class="rv"><i class="pa" aria-hidden="true">${bubbles}</i>${T('不用下载，点开就看', 'Opens anywhere, no app')}</li>
      <li class="rv"><i class="pa" aria-hidden="true">${flip}</i>${T('自动翻成英文', 'Auto-translated')}</li>
      <li class="rv"><i class="pa" aria-hidden="true">${rings}</i>${T('附近的人也能刷到', 'Seen by people nearby')}</li>
      </ul>
    </div>

    <div class="ai rv" data-go>
      <div>
        <div class="eyebrow">${T('AI 识图', 'AI listing')}</div>
        <h3>${T('拍照就能上架。', 'Snap a photo, get a listing.')}</h3>
        <p>${T('名字、介绍、参考价，AI 来写。', 'AI writes the name and description, and suggests a price.')}</p>
      </div>
      <div class="ai-demo" aria-hidden="true">
        <div class="shot">
          <svg class="obj" viewBox="0 0 50 70"><use href="#g-lamp"></use></svg>
          <svg class="brk" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M0 18 V0 H18 M82 0 H100 V18 M100 82 V100 H82 M18 100 H0 V82" fill="none" stroke="#fff" stroke-width="4" vector-effect="non-scaling-stroke"></path></svg>
          <div class="scan"></div>
        </div>
        <div class="fields">${T(
          [['名字', '宜家 台灯'], ['介绍', '可调角度，带灯泡'], ['新品价', '<em>€15–20</em>']],
          [['Name', 'IKEA desk lamp'], ['Details', 'Adjustable, bulb included'], ['New price', '<em>€15–20</em>']],
        ).map(([k, v]) => `<div class="fld"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      </div>
    </div>
  </div>
</section>

<section class="s buyer" id="buy">
  <div class="wrap buyer-in">
    <div>
      <div class="eyebrow">${T('买二手', 'Buying')}</div>
      <h2 class="h2">${T('在二手清单上，<br><span class="serif">凑齐一屋子家具。</span>', 'Furnish a whole room,<br><span class="serif">secondhand.</span>')}</h2>
      <ul class="bpoints">
        <li>${T('看中点「预订」，自己排队', 'Like it? Tap Reserve to get in line')}</li>
        <li>${T('排到第 1 位，直接约时间', 'First in line? Arrange a pickup')}</li>
        <li>${T('「附近的二手」看同城在出什么', 'Nearby shows what people around you are selling')}</li>
      </ul>
      <a class="lp-btn y" href="${browse}">${T('浏览二手物品', 'Browse secondhand')}</a>
    </div>
    <div class="room2" id="room2box">
      ${roomSvg('room2', T('一间空房间，往下滚，买来的东西一件件放进来', 'An empty room; as you scroll, the things you bought arrive one by one'), `<g class="items">${thingsSvg()}</g>`)}
      <div class="got">${T('已经买到 <b id="got-n">10</b> 件 · 一共 <b id="got-e">€163</b>', 'Got <b id="got-n">10</b> things · <b id="got-e">€163</b> in total')}</div>
    </div>
  </div>
</section>

<section class="s" id="faq">
  <div class="wrap faq">
    <div>
      <div class="eyebrow rv">${T('常见问题', 'FAQ')}</div>
      <h2 class="h2 rv">${T('大家常问的', 'Common questions')}</h2>
      <div class="ask rv"><button class="lp-btn ghost" type="button" data-feedback>${T('问开发者', 'Ask the developer')}</button></div>
    </div>
    <div class="rv">${faq.map(([q, a], i) => `<details${i ? '' : ' open'}><summary>${esc(q)}<i></i></summary><p>${esc(a)}</p></details>`).join('')}</div>
  </div>
</section>

<section class="s" style="padding-top:0">
  <div class="wrap">
    <div class="end rv">
      <div>
        <h2 class="h2">${T('有东西要出？<br>先拍第一张。', 'Got something to sell?<br>Start with one photo.')}</h2>
        <p>${T('剩下的慢慢加。', 'Add the rest as you go.')}</p>
        <div class="cta"><a class="lp-btn b" href="${start}">${T('开始发布', 'Start posting')}</a><a class="lp-btn ghost" href="${browse}">${T('浏览二手物品', 'Browse secondhand')}</a></div>
      </div>
      <div class="room3" aria-hidden="true">
        <svg class="room cleaned" viewBox="0 0 760 640">${ROOM_SHELL}${keys}</svg>
      </div>
    </div>

    <div class="tip rv" id="tip">
      <div>
        <h3>${T('请开发者喝杯咖啡', 'Buy the developer a coffee')}</h3>
        <p>${T('一个人业余做的，服务器和 AI 的钱自己出。', 'One person builds this and pays for the server and the AI.')}</p>
      </div>
      <div class="ways">${lang === 'en' ? kofiTip + wechatTip : wechatTip + kofiTip}</div>
    </div>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <span>${T('一个人做的免费小工具，代码开源。', 'A free tool built by one developer. The code is open source.')}</span>
    <a href="/my">${T('我的排队', 'My reservations')}</a>
    <a href="/privacy${T('', '#en')}">${T('隐私政策', 'Privacy')}</a>
    <a href="/terms${T('', '#en')}">${T('服务条款', 'Terms')}</a>
    <a href="${repoUrl}" rel="noopener">GitHub</a>
    <button class="linkbtn" type="button" data-feedback>${T('反馈', 'Feedback')}</button>
  </div>
</footer>
</div>`;
}
