// Which app this page is open in, and the UI language for this page view: 'zh' or 'en'.
// The language comes from ?lang= (remembered), else the viewer's earlier choice, else the phone's
// language. WeChat is Chinese unless chosen otherwise. Telegram users get their phone's language.

// The old workers.dev address hands over its browser storage in #migrate= (worker moved()):
// keys this address doesn't have yet are copied, lists are merged, then the fragment is removed.
// app.js imports this module before it reads storage, so this runs first.
// movedHere: this page view came from the old address (app.js asks to re-bookmark, once).
export const movedHere = /^#migrate=/.test(location.hash);
(function migrate() {
  const m = location.hash.match(/^#migrate=(.+)$/);
  if (!m) return;
  let hash = '';
  try {
    const old = JSON.parse(decodeURIComponent(m[1]));
    hash = typeof old.hash === 'string' ? old.hash : '';
    for (const [k, v] of Object.entries(old.data || {})) {
      const cur = localStorage.getItem(k);
      if (cur == null) localStorage.setItem(k, v);
      else if (k === 'mySales') {
        const mine = JSON.parse(cur);
        const ids = new Set(mine.map((s) => s.id));
        localStorage.setItem(k, JSON.stringify([...mine, ...JSON.parse(v).filter((s) => !ids.has(s.id))]));
      }
    }
  } catch {}
  history.replaceState(null, '', location.pathname + location.search + hash);
})();

const q = new URLSearchParams(location.search);
const ua = navigator.userAgent;

export const isWeChat = /MicroMessenger/i.test(ua);
// Telegram's in-app browser exposes TelegramWebviewProxy (and says Telegram in its user agent on
// Android); the links we share to Telegram carry src=tg, which also covers the system browser.
export const isTelegram = !isWeChat && (q.get('src') === 'tg' || typeof window.TelegramWebviewProxy !== 'undefined' || /Telegram/i.test(ua));
// Facebook's in-app browser (FBAN/FBAV/FB_IAB in its user agent), or a link we shared to a Facebook group.
export const isFacebook = !isWeChat && !isTelegram && (q.get('src') === 'fb' || /FBAN|FBAV|FB_IAB/.test(ua));

function saved() {
  try {
    const v = localStorage.getItem('lang');
    return v === 'zh' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function save(l) {
  try {
    localStorage.setItem('lang', l);
  } catch {}
}

// The language this viewer picked: ?lang= (remembered) or an earlier choice; null if never.
function chosen() {
  const forced = q.get('lang');
  if (forced === 'zh' || forced === 'en') {
    save(forced);
    return forced;
  }
  return saved();
}

export const chosenLang = chosen();

function pick() {
  // The landing page has a URL per language: /en is English, / Chinese unless the viewer chose English.
  const landing = window.__DATA__?.landing;
  if (landing === 'en') return 'en';
  if (chosenLang) return chosenLang;
  if (landing === 'zh' || isWeChat) return 'zh';
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
}

export const LANG = pick();
document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';

// tr('中文', 'English'): the string for the current UI language.
export const tr = (zh, en) => (LANG === 'en' ? en : zh);

export function setLang(l) {
  save(l);
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  // / and /en are one page per language; /keep keeps its gift link and asks for the other one.
  if (window.__DATA__?.landing && u.pathname === '/keep') u.searchParams.set('lang', l);
  else if (window.__DATA__?.landing) u.pathname = l === 'en' ? '/en' : '/';
  location.replace(u.href);
}
