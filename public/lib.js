// Pure helpers shared by the browser app and unit tests.

export const CURRENCIES = { EUR: '€', USD: '$', GBP: '£', CNY: '¥', SEK: 'kr ' };

export const CONDITIONS = {
  new: '全新',
  like_new: '九成新',
  good: '八成新',
  worn: '有使用痕迹',
};

export function money(cents, currency = 'EUR') {
  if (cents === 0) return '免费';
  if (cents == null) return '';
  const sym = CURRENCIES[currency] ?? '';
  const v = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return sym + v;
}

const CURRENCY_WORDS = /(欧元|欧|块钱|块|元|人民币|eur|euro|euros|kr|sek|usd|gbp|rmb|[€$£¥])/gi;
const EDGE_PUNCT = /^[\s,，.。;；:：、!！?？~～\-—_/|()（）【】\[\]]+|[\s,，.。;；:：、!！?？~～\-—_/|()（）【】\[\]]+$/g;

function cleanName(s) {
  return s.replace(CURRENCY_WORDS, ' ').replace(/\s+/g, ' ').replace(EDGE_PUNCT, '').trim();
}

// 6.3: the last number in the line is the price; the text before it is the name.
// "免费" / "送" with no number means price 0. No number at all -> priceCents null.
export function parseLine(text) {
  const t = String(text ?? '').trim();
  const nums = [...t.matchAll(/\d+(?:[.,]\d{1,2})?/g)];
  if (nums.length === 0) {
    if (/免费|送/.test(t)) {
      return { name: cleanName(t.replace(/免费|白送|送人|送/g, ' ')).slice(0, 30), priceCents: 0 };
    }
    return { name: cleanName(t).slice(0, 30), priceCents: null };
  }
  const last = nums[nums.length - 1];
  const priceCents = Math.round(parseFloat(last[0].replace(',', '.')) * 100);
  let name = cleanName(t.slice(0, last.index));
  if (!name) name = cleanName(t.slice(last.index + last[0].length));
  return { name: name.slice(0, 30), priceCents };
}

function cut(s, n) {
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

export const LIST_MARK = '【物品清单】';

// The editable opening line of the group text; the seller can rewrite it.
// No link: it goes under the card sent just before, which is what buyers tap.
export function defaultIntro(sale) {
  return `打扰了出二手，${sale.location}，点上面的卡片可以看大图和预订。`;
}

// Intros saved before the text went link-free may still carry the old URL.
export function stripLinks(s) {
  return String(s ?? '').replace(/\s*https?:\/\/\S+/g, '').trim();
}

// Group text: intro, then a regenerated list of everything not yet sold — names only unless
// prices is set, one per line or, when compact, joined with " · ".
// Buyers don't see item numbers here; reserved items are listed like the rest.
export function shareText(sale, items, { intro, maxListed = 30, prices = false, compact = false } = {}) {
  const open = items.filter((i) => i.status === 'available' || i.status === 'reserved').sort((a, b) => a.no - b.no);
  const names = open.slice(0, maxListed).map((i) => (prices ? `${i.name} ${money(i.priceCents, sale.currency)}` : i.name));
  const lines = [intro ?? defaultIntro(sale), '', LIST_MARK, ...(compact && names.length ? [names.join(' · ')] : names)];
  if (open.length > maxListed) lines.push(`还有 ${open.length - maxListed} 件，点卡片看全部`);
  return lines.join('\n');
}

// "小王 想要 1号 笔记本支架、3号 台灯" — what a head-of-queue buyer says when contacting the seller.
export function contactNote(items) {
  const list = [...items].sort((a, b) => a.no - b.no).map((i) => `${i.no}号 ${cut(i.name, 10)}`).join('、');
  return `我预订了 ${list}`;
}
