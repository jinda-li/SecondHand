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

test('shareText: default intro, then name + price for everything not sold', () => {
  assert.equal(
    shareText(SALE, ITEMS),
    [
      '打扰了出二手，地铁站附近自提，点上面的卡片可以看大图和预订。',
      '',
      '【物品清单】',
      '杯子碟子 €3',
      '碗 €3',
      '拉蒜器 €1',
      '揉面套装 €2',
    ].join('\n'),
  );
});

test('shareText keeps a custom intro and regenerates the list', () => {
  const text = shareText(SALE, ITEMS, { intro: '毕业了，东西都便宜出' });
  assert.ok(text.startsWith('毕业了，东西都便宜出\n\n【物品清单】\n杯子碟子 €3'));
});

test('stripLinks removes URLs left in old saved intros', () => {
  assert.equal(stripLinks('打扰了出二手，点开链接可以看大图和预订。https://x.dev/s/abc'), '打扰了出二手，点开链接可以看大图和预订。');
  assert.equal(stripLinks('毕业甩卖 https://x.dev/s/abc 都便宜'), '毕业甩卖 都便宜');
});

test('shareText truncates long names and long lists', () => {
  const sale = { title: 'T', location: 'L', currency: 'EUR', rules: [] };
  const items = Array.from({ length: 32 }, (_, i) => ({ no: i + 1, name: '一二三四五六七八九十十一十二十三', priceCents: 100, status: 'available' }));
  const text = shareText(sale, items);
  assert.ok(text.includes('\n一二三四五六七八九十十一… €1'));
  assert.ok(text.includes('还有 2 件，点卡片看全部'));
  assert.equal(text.split('\n').filter((l) => l.endsWith('€1')).length, 30);
});

test('contactNote lists numbers and names with the buyer nickname', () => {
  assert.equal(
    contactNote([{ no: 3, name: '台灯' }, { no: 1, name: '笔记本支架' }], '小王'),
    '小王 想要 1号 笔记本支架、3号 台灯',
  );
  assert.equal(contactNote([{ no: 2, name: '一二三四五六七八九十十一' }], 'A'), 'A 想要 2号 一二三四五六七八九十…');
});
