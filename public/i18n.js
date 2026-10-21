// Which app this page is open in, and the UI language for this page view: 'zh' or 'en'.
// The language comes from ?lang= (remembered), else the viewer's earlier choice, else the phone's
// language. WeChat is Chinese unless chosen otherwise. Telegram users get their phone's language.

const q = new URLSearchParams(location.search);
const ua = navigator.userAgent;

export const isWeChat = /MicroMessenger/i.test(ua);
// Telegram's in-app browser exposes TelegramWebviewProxy (and says Telegram in its user agent on
// Android); the links we share to Telegram carry src=tg, which also covers the system browser.
export const isTelegram = !isWeChat && (q.get('src') === 'tg' || typeof window.TelegramWebviewProxy !== 'undefined' || /Telegram/i.test(ua));

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

function pick() {
  const forced = q.get('lang');
  if (forced === 'zh' || forced === 'en') {
    save(forced);
    return forced;
  }
  const s = saved();
  if (s) return s;
  if (isWeChat) return 'zh';
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
  location.replace(u.href);
}
