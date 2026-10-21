// Pure helpers shared by the browser app, the worker and unit tests.
// Anything shown to people takes a lang: 'zh' (default) or 'en'.

export const CURRENCIES = { EUR: '€', USD: '$', GBP: '£', CNY: '¥', SEK: 'kr ' };

export const CONDITIONS = {
  new: '全新',
  like_new: '九成新',
  good: '八成新',
  worn: '有使用痕迹',
};
const CONDITIONS_EN = { new: 'New', like_new: 'Like new', good: 'Good', worn: 'Used' };

export function conditionText(code, lang = 'zh') {
  return (lang === 'en' ? CONDITIONS_EN : CONDITIONS)[code] || '';
}

export function money(cents, currency = 'EUR', lang = 'zh') {
  if (cents === 0) return lang === 'en' ? 'Free' : '免费';
  if (cents == null) return '';
  const sym = CURRENCIES[currency] ?? '';
  const v = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return sym + v;
}

// ---------- two languages of content ----------

export const hasCJK = (s) => /[㐀-鿿豈-﫿]/.test(String(s ?? ''));
// The language a piece of text was written in, as far as we need to know: Chinese or not.
export const textLang = (s) => (hasCJK(s) ? 'zh' : 'en');

// An item's name and details in lang, each on its own (an English name may have Chinese details):
// the original when it is already in that language, else the stored translation when there is one.
const pick = (orig, alt, lang) => (alt && textLang(orig) !== lang ? alt : orig ?? '');

export function itemText(it, lang = 'zh') {
  return { name: pick(it.name, it.nameAlt, lang), note: pick(it.note, it.noteAlt, lang) };
}

// The default rules, which are translated by this table rather than by a machine.
export const RULES = {
  zh: ['价格固定不议价', '先到先得', '多件打包可优惠'],
  en: ['Fixed prices', 'First come, first served', 'Bundle discount'],
};

export function ruleText(r, lang) {
  const from = RULES[lang === 'en' ? 'zh' : 'en'].indexOf(r);
  return from >= 0 ? RULES[lang][from] : null;
}

// A list's title, pickup place and rules in lang, each on its own. sale.alt holds the translations, when made.
export function saleText(sale, lang = 'zh') {
  const alt = sale.alt || {};
  const rules = (sale.rules || []).map((r, i) => (textLang(r) === lang ? r : ruleText(r, lang) || alt.rules?.[i] || r));
  return { title: pick(sale.title, alt.title, lang), location: pick(sale.location, alt.location, lang), rules };
}

// ---------- contacts ----------

// "@name", "name", "t.me/name" or "https://t.me/name" -> "name"; null when it can't be a username.
export function normTelegram(v) {
  const s = String(v ?? '').trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s) ? s : null;
}

// Typed into a WeChat box but clearly a Telegram handle.
export const looksLikeTelegram = (v) => /^\s*@|t(?:elegram)?\.me\//i.test(String(v ?? ''));

// ---------- parsing a typed line ----------

const CURRENCY_WORDS = /(欧元|欧|块钱|块|元|人民币|eur|euro|euros|kr|sek|usd|gbp|rmb|[€$£¥])/gi;
const EDGE_PUNCT = /^[\s,，.。;；:：、!！?？~～\-—_/|()（）【】\[\]]+|[\s,，.。;；:：、!！?？~～\-—_/|()（）【】\[\]]+$/g;
const FREE_WORDS = /免费|白送|送人|送|\bfor free\b|\bfree\b|\bgiveaway\b/gi;

function cleanName(s) {
  return s.replace(CURRENCY_WORDS, ' ').replace(/\s+/g, ' ').replace(EDGE_PUNCT, '').trim();
}

// 6.3: the last number in the line is the price; the text before it is the name.
// "免费" / "送" / "free" with no number means price 0. No number at all -> priceCents null.
// "20e" (common in Finnish groups) reads as 20.
export function parseLine(text) {
  const t = String(text ?? '').trim();
  const nums = [...t.matchAll(/\d+(?:[.,]\d{1,2})?/g)];
  if (nums.length === 0) {
    if (/免费|送|\bfree\b|\bgiveaway\b/i.test(t)) return { name: cleanName(t.replace(FREE_WORDS, ' ')).slice(0, 30), priceCents: 0 };
    return { name: cleanName(t).slice(0, 30), priceCents: null };
  }
  const last = nums[nums.length - 1];
  const priceCents = Math.round(parseFloat(last[0].replace(',', '.')) * 100);
  const after = t.slice(last.index + last[0].length).replace(/^e\b/i, '');
  let name = cleanName(t.slice(0, last.index));
  if (!name) name = cleanName(after);
  return { name: name.slice(0, 30), priceCents };
}

function cut(s, n) {
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

// ---------- group text ----------

// The line between the seller's own opening and the regenerated item list.
export const LIST_MARK = '【物品清单】';
const LIST_MARK_EN = '[ Items ]';
export const listMark = (lang = 'zh') => (lang === 'en' ? LIST_MARK_EN : LIST_MARK);

// The editable opening line of the group text; the seller can rewrite it.
// WeChat: no link, it goes under the card sent just before, which is what buyers tap.
// Telegram: one message, the link follows this line and Telegram turns it into a preview.
export function defaultIntro(sale, { lang = 'zh', target = 'wechat' } = {}) {
  const where = saleText(sale, lang).location;
  if (target === 'telegram') {
    return lang === 'en'
      ? `Selling my stuff — ${where}. Photos and reservations at the link, first come first served:`
      : `出二手，${where}。点链接看大图、预订，先到先得：`;
  }
  return lang === 'en'
    ? `Selling my stuff — ${where}. Tap the card above for photos and to reserve.`
    : `打扰了出二手，${where}，点上面的卡片可以看大图和预订。`;
}

// Intros saved before the text went link-free may still carry the old URL.
export function stripLinks(s) {
  return String(s ?? '').replace(/\s*https?:\/\/\S+/g, '').trim();
}

// Group text: intro, the link (Telegram only), then a regenerated list of everything not yet
// sold — names only unless prices is set, one per line or, when compact, joined with " · ".
// Buyers don't see item numbers here; reserved items are listed like the rest.
export function shareText(sale, items, { intro, maxListed = 30, prices = false, compact = false, lang = 'zh', target = 'wechat', link = '' } = {}) {
  const open = items.filter((i) => i.status === 'available' || i.status === 'reserved').sort((a, b) => a.no - b.no);
  const names = open.slice(0, maxListed).map((i) => {
    const name = itemText(i, lang).name;
    return prices ? `${name} ${money(i.priceCents, sale.currency, lang)}` : name;
  });
  const head = [intro ?? defaultIntro(sale, { lang, target })];
  if (target === 'telegram' && link) head.push(link);
  const lines = [...head, '', listMark(lang), ...(compact && names.length ? [names.join(' · ')] : names)];
  const more = open.length - maxListed;
  if (more > 0) {
    const where = target === 'telegram' ? (lang === 'en' ? 'see the link' : '点链接看全部') : lang === 'en' ? 'tap the card' : '点卡片看全部';
    lines.push(lang === 'en' ? `…and ${more} more, ${where}` : `还有 ${more} 件，${where}`);
  }
  return lines.join('\n');
}

// What a head-of-queue buyer says when contacting the seller:
// "我预订了 1号 笔记本支架、3号 台灯" / "Hi! I reserved #1 laptop stand, #3 desk lamp from your list".
// Names are already in the buyer's language.
export function contactNote(items, lang = 'zh') {
  const sorted = [...items].sort((a, b) => a.no - b.no);
  if (lang === 'en') return `Hi! I reserved ${sorted.map((i) => `#${i.no} ${cut(i.name, 24)}`).join(', ')} from your list`;
  return `我预订了 ${sorted.map((i) => `${i.no}号 ${cut(i.name, 10)}`).join('、')}`;
}
