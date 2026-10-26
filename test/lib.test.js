import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, shareText, stripLinks, money, contactNote } from '../public/lib.js';

test('parseLine: last number is the price, text before it is the name', () => {
  assert.deepEqual(parseLine('杯子碟子，3欧全部'), { name: '杯子碟子', priceCents: 300 });
  assert.deepEqual(parseLine('宜家书桌 20'), { name: '宜家书桌', priceCents: 2000 });
  assert.deepEqual(parseLine('台灯 €5.5'), { name: '台灯', priceCents: 550 });
  assert.deepEqual(parseLine('2个枕头 8欧'), { name: '2个枕头', priceCents: 800 });
  assert.deepEqual(parseLine('€5 台灯'), { name: '台灯', priceCents: 500 });
  assert.deepEqual(parseLine('IKEA lamp 7,50'), { name: 'IKEA lamp', priceCents: 750 });
});

test('parseLine: free and missing price', () => {
  assert.deepEqual(parseLine('旧衣架 免费'), { name: '旧衣架', priceCents: 0 });
  assert.deepEqual(parseLine('纸箱送'), { name: '纸箱', priceCents: 0 });
  assert.deepEqual(parseLine('电饭锅'), { name: '电饭锅', priceCents: null });
  assert.deepEqual(parseLine(''), { name: '', priceCents: null });
});

test('money', () => {
  assert.equal(money(300, 'EUR'), '€3');
  assert.equal(money(350, 'EUR'), '€3.50');
  assert.equal(money(0, 'EUR'), '免费');
});

const SALE = { title: '小王的二手清单', location: '地铁站附近自提', currency: 'EUR', rules: ['先到先得'] };
const ITEMS = [
  { no: 1, name: '杯子碟子', priceCents: 300, status: 'available' },
  { no: 2, name: '碗', priceCents: 300, status: 'available' },
  { no: 3, name: '拉蒜器', priceCents: 100, status: 'reserved' },
  { no: 4, name: '揉面套装', priceCents: 200, status: 'available' },
  { no: 5, name: '旧锅', priceCents: 500, status: 'sold' },
];

test('shareText: default intro, then names of everything not sold', () => {
  assert.equal(
    shareText(SALE, ITEMS),
    [
      '打扰了出二手，地铁站附近自提，点上面的卡片可以看大图和预订。',
      '',
      '【物品清单】',
      '杯子碟子',
      '碗',
      '揉面套装',
      '拉蒜器',
    ].join('\n'),
  );
});

test('shareText with prices lists name + price', () => {
  assert.equal(
    shareText(SALE, ITEMS, { prices: true }),
    [
      '打扰了出二手，地铁站附近自提，点上面的卡片可以看大图和预订。',
      '',
      '【物品清单】',
      '杯子碟子 €3',
      '碗 €3',
      '揉面套装 €2',
      '拉蒜器 €1',
    ].join('\n'),
  );
});

test('shareText keeps a custom intro and regenerates the list', () => {
  const text = shareText(SALE, ITEMS, { intro: '毕业了，东西都便宜出' });
  assert.ok(text.startsWith('毕业了，东西都便宜出\n\n【物品清单】\n杯子碟子\n'));
});

test('shareText compact joins the list with dots', () => {
  assert.ok(shareText(SALE, ITEMS, { compact: true }).endsWith('【物品清单】\n杯子碟子 · 碗 · 揉面套装 · 拉蒜器'));
  assert.ok(shareText(SALE, ITEMS, { compact: true, prices: true }).endsWith('\n杯子碟子 €3 · 碗 €3 · 揉面套装 €2 · 拉蒜器 €1'));
});

test('shareText lists the newest day first, like the buyer page', () => {
  const day = 86400_000;
  const t = new Date(2026, 9, 20, 12).getTime();
  const items = [
    { no: 1, name: '杯子碟子', status: 'available', createdAt: t - 2 * day },
    { no: 2, name: '碗', status: 'reserved', createdAt: t },
    { no: 3, name: '拉蒜器', status: 'available', createdAt: t },
    { no: 4, name: '揉面套装', status: 'available', createdAt: t - 3 * day, droppedAt: t + 3600_000 },
  ];
  assert.ok(shareText(SALE, items, { compact: true }).endsWith('\n拉蒜器 · 揉面套装 · 杯子碟子 · 碗'));
});

test('stripLinks removes URLs left in old saved intros', () => {
  assert.equal(stripLinks('打扰了出二手，点开链接可以看大图和预订。https://x.dev/s/abc'), '打扰了出二手，点开链接可以看大图和预订。');
  assert.equal(stripLinks('毕业甩卖 https://x.dev/s/abc 都便宜'), '毕业甩卖 都便宜');
});

test('shareText keeps full names and truncates long lists', () => {
  const sale = { title: 'T', location: 'L', currency: 'EUR', rules: [] };
  const items = Array.from({ length: 32 }, (_, i) => ({ no: i + 1, name: '一二三四五六七八九十十一十二十三', priceCents: 100, status: 'available' }));
  const text = shareText(sale, items, { prices: true });
  assert.ok(text.includes('\n一二三四五六七八九十十一十二十三 €1'));
  assert.ok(text.includes('还有 2 件，点卡片看全部'));
  assert.equal(text.split('\n').filter((l) => l.endsWith('€1')).length, 30);
});

test('contactNote lists numbers and names in order', () => {
  assert.equal(
    contactNote([{ no: 3, name: '台灯' }, { no: 1, name: '笔记本支架' }]),
    '我在你的清单上预订了 1号 笔记本支架、3号 台灯',
  );
  assert.equal(contactNote([{ no: 2, name: '一二三四五六七八九十十一' }]), '我在你的清单上预订了 2号 一二三四五六七八九十…');
});

import { normTelegram, looksLikeTelegram, itemText, saleText, defaultIntro, listMark, conditionText } from '../public/lib.js';

test('parseLine: English free and the "20e" price style', () => {
  assert.deepEqual(parseLine('Old hangers free'), { name: 'Old hangers', priceCents: 0 });
  assert.deepEqual(parseLine('IKEA desk lamp 20e'), { name: 'IKEA desk lamp', priceCents: 2000 });
  assert.deepEqual(parseLine('Kettle, giveaway'), { name: 'Kettle', priceCents: 0 });
});

test('money and conditions in English', () => {
  assert.equal(money(0, 'EUR', 'en'), 'Free');
  assert.equal(money(1250, 'EUR', 'en'), '€12.50');
  assert.equal(conditionText('like_new', 'en'), 'Like new');
  assert.equal(conditionText('like_new'), '九成新');
});

test('normTelegram accepts the usual ways people write a username', () => {
  assert.equal(normTelegram('@jinda_li'), 'jinda_li');
  assert.equal(normTelegram('jinda_li'), 'jinda_li');
  assert.equal(normTelegram('https://t.me/jinda_li'), 'jinda_li');
  assert.equal(normTelegram('t.me/jinda_li/'), 'jinda_li');
  assert.equal(normTelegram(' telegram.me/Jinda '), 'Jinda');
  assert.equal(normTelegram('12345'), null);
  assert.equal(normTelegram('ab'), null);
  assert.equal(normTelegram('微信号'), null);
  assert.ok(looksLikeTelegram('@abc'));
  assert.ok(looksLikeTelegram('https://t.me/abc'));
  assert.ok(!looksLikeTelegram('wxid_abc'));
});

test('itemText shows the translation only when the original is in the other language', () => {
  const zh = { name: '宜家台灯', note: '三档亮度', nameAlt: 'IKEA desk lamp', noteAlt: '3 brightness levels' };
  assert.deepEqual(itemText(zh, 'en'), { name: 'IKEA desk lamp', note: '3 brightness levels' });
  assert.deepEqual(itemText(zh, 'zh'), { name: '宜家台灯', note: '三档亮度' });
  const en = { name: 'Desk lamp', note: '', nameAlt: '台灯', noteAlt: '' };
  assert.deepEqual(itemText(en, 'zh'), { name: '台灯', note: '' });
  assert.deepEqual(itemText({ name: '台灯', note: '' }, 'en'), { name: '台灯', note: '' });
});

test('saleText translates default rules by table and the rest from alt', () => {
  const sale = { title: '小王的二手清单', location: '地铁站', rules: ['先到先得', '周末取'], alt: { title: "Wang's secondhand list", location: 'Metro station', rules: ['First come', 'Weekend pick-up'] } };
  assert.deepEqual(saleText(sale, 'en'), { title: "Wang's secondhand list", location: 'Metro station', rules: ['First come, first served', 'Weekend pick-up'] });
  assert.deepEqual(saleText(sale, 'zh'), { title: '小王的二手清单', location: '地铁站', rules: ['先到先得', '周末取'] });
});

test('shareText for Telegram carries the link and English names', () => {
  const sale = { title: 'Moving sale', location: 'Otaniemi', currency: 'EUR', rules: [] };
  const items = [{ no: 1, name: '台灯', nameAlt: 'Desk lamp', priceCents: 500, status: 'available' }, { no: 2, name: 'Kettle', priceCents: 0, status: 'available' }];
  const link = 'https://x.dev/s/abc?src=tg';
  assert.equal(
    shareText(sale, items, { lang: 'en', target: 'telegram', link, prices: true }),
    [defaultIntro(sale, { lang: 'en', target: 'telegram' }), link, '', listMark('en'), 'Desk lamp €5', 'Kettle Free'].join('\n'),
  );
});

test('contactNote in English', () => {
  assert.equal(contactNote([{ no: 3, name: 'Desk lamp' }, { no: 1, name: 'Laptop stand' }], 'en'), 'Hi! I reserved #1 Laptop stand, #3 Desk lamp from your list');
});

test('itemText and saleText pick each field by its own language', () => {
  const mixed = { name: 'Desk lamp', note: '三档亮度', nameAlt: '台灯', noteAlt: '3 brightness levels' };
  assert.deepEqual(itemText(mixed, 'en'), { name: 'Desk lamp', note: '3 brightness levels' });
  assert.deepEqual(itemText(mixed, 'zh'), { name: '台灯', note: '三档亮度' });
  const sale = { title: "Alex's moving sale", location: '地铁站自提', rules: [], alt: { title: 'Alex 的搬家甩卖', location: 'Pick-up at the metro station' } };
  assert.equal(saleText(sale, 'en').location, 'Pick-up at the metro station');
  assert.equal(saleText(sale, 'en').title, "Alex's moving sale");
  assert.equal(normTelegram('abcd'), null);
  assert.equal(normTelegram('abcde'), 'abcde');
});
