# 二手清单 上 Telegram + 英文：完整计划

日期：2026-10-21。基于当前代码（worker VERSION 39）。

## 0. 先说结论

最典型的用户不是“英文用户”，而是**一个中国留学生卖家，用中文操作，把同一份清单同时发到微信群和英文 Telegram 群**（比如学校的 marketplace 群）。所以有三条互相独立的“语言”轴，不能混成一个开关：

| 轴 | 谁决定 | 例子 |
|---|---|---|
| 界面语言 | 每个看页面的人自己（设备） | 卖家看中文管理页，芬兰买家看英文买家页 |
| 清单内容语言 | 每件物品存原文 + 译文 | 卖家写「宜家台灯」，英文买家看到「IKEA desk lamp」 |
| 联系渠道 | 每个人自己的联系方式类型 | 微信买家拿到卖家微信号，Telegram 买家拿到卖家 @username |

核心原则：**一份清单、一个排队，多个渠道。** 清单不分“微信版”和“Telegram 版”；发到哪儿都是同一个 `/s/<id>`，大家排同一个队，先到先得，和现在“发到好几个群也不会撞单”一致。

## 1. 现状（决定了改动范围）

- 没有账号。卖家靠管理链接里的 `admin_key`，买家靠浏览器里的 `buyerToken`（localStorage）。Google 登录已做但关着（`GOOGLE_CLIENT_ID = ""`），`sessions.sub` / `sales.owner_sub` 已经在。
- 联系方式是一个自由文本：`sales.wechat_id`（表单上叫“联系方式”，写“微信号、手机号都行”），`queues.buyer_wechat`（加入排队时必填，标着“你的微信号”）。
- 所有文案直接写在 `public/app.js`（约 3300 行）和 `src/worker.js` 里，全是中文；`lib.js` 的 `CONDITIONS`、`money()` 的“免费”、`parseLine` 只认“免费/送”、`defaultIntro`、`contactNote`（“我预订了 1号…”）都写死中文。
- 服务端报错文案是中文（`str()` 拼出“XX不能为空”），客户端直接 toast。
- 分享流程完全围绕微信设计：二维码绕路生成卡片、`cardSession`、“发卡片 + 发文字”两步、群文字故意去掉链接（因为链接在上面的卡片里）、“发给自己/文件传输助手/收藏”。
- AI 识图 prompt 写死“用简体中文回答”，品牌用“中国人常用的叫法”。
- 清单长图、封面卡片用 canvas 画中文字。
- 打赏是微信赞赏码；AI 次数、收藏送 AI、推荐朋友这一套都绑在微信收藏上。
- 隐私政策、条款只有中文。

## 2. 你问的三个问题

### 2.1 发到 Telegram 和发到微信，都能存下来、能排队

Telegram 和微信的根本差别：

| | 微信 | Telegram |
|---|---|---|
| 链接怎么显示 | 直接点开的链接转发出去只是一串网址，要扫码绕路才是卡片 | 任何链接自动生成预览（读 og:title / og:description / og:image），不用绕路 |
| 一条还是两条 | 卡片 + 文字两条 | 一条：文字里带链接，预览就是卡片 |
| 打开方式 | 微信内置浏览器 | Telegram 内置浏览器，或系统浏览器，或 Mini App（在 Telegram 里全屏打开、能拿到用户身份） |
| 能不能推送 | 不能（没有公众号） | 能：机器人可以私信用户（前提是用户点过机器人的 Start） |
| “存起来” | 收藏、文件传输助手 | Saved Messages（收藏夹），或机器人对话本身 |

落地做法：

1. **Telegram 群文字带链接**。`shareText()` 加一个 `target: 'wechat' | 'telegram'`。Telegram 版：开头一句 + 链接 + 物品清单（默认带价格，英文群几乎都要求写价格），总长控制在 4096 字以内。微信版保持现在不带链接。
2. **分享面板按渠道分支**。`shareSheet` 顶部先选“发到微信 / 发到 Telegram”（记住上次选的）。Telegram 分支只有一步：“复制，去 Telegram 粘贴”，外加不在 Telegram 里时用 `https://t.me/share/url?url=…&text=…` 直接打开 Telegram 选群。二维码、`cardSession`、“发卡片”这些只在微信分支出现。
3. **链接带来源**：Telegram 版链接用 `/s/<id>?src=tg`。作用：默认英文界面、默认联系方式类型选 Telegram、统计哪个渠道来的人多。不靠 UA 猜（Telegram 内置浏览器在 iOS 上 UA 不一定能认出来）。
4. **排队本身不用改**：同一个 `/item/:id/join` 接口，只是联系方式字段换成带类型的（见 2.2）。
5. **预览要专门测**：og 图现在是 JPEG，格式没问题；但要验证 `*.workers.dev` 域名在 Telegram 里会不会出预览，以及预览缓存（物品卖掉后，群里旧消息的预览不会更新，这是 Telegram 的行为，只能接受；页面打开后永远是实时的）。

> 如果你说的“选择文字”是指“选了语言之后”：切换语言只改显示，不会分出第二份清单或第二个队，排队、收藏都照常。

### 2.2 账号体系：有人填 Telegram，有人填微信

**不建议现在就上强制账号。** 保留“无注册”这个卖点，把联系方式升级成“带类型的联系方式”，再给 Telegram 用户一个**可选的**验证身份。

数据结构（迁移 0013）：

```sql
-- 卖家：可以同时有微信和 Telegram。wechat_id 保留并继续写入，兼容旧客户端。
ALTER TABLE sales ADD COLUMN contacts TEXT NOT NULL DEFAULT '[]';  -- [{"kind":"wechat","value":"xxx"},{"kind":"telegram","value":"jinda"}]
-- 买家：排队时留的联系方式及类型。buyer_wechat 保留。
ALTER TABLE queues ADD COLUMN contact_kind TEXT NOT NULL DEFAULT 'wechat';  -- wechat | telegram | phone | other
ALTER TABLE queues ADD COLUMN contact TEXT NOT NULL DEFAULT '';
ALTER TABLE queues ADD COLUMN tg_user_id INTEGER;  -- 只有经机器人/Mini App 验证过才有
UPDATE queues SET contact = buyer_wechat WHERE contact = '';
```

规则：

- **规范化 Telegram 用户名**：接受 `@name`、`name`、`t.me/name`、`https://t.me/name`，存成不带 @ 的 `name`；校验 `^[A-Za-z][A-Za-z0-9_]{4,31}$`。微信号也做基本校验（6–20 位字母数字下划线减号，字母开头），手机号单独一类。这样能挡掉大部分填错类型的情况（比如在 Telegram 那栏填了微信号）。
- **自动猜类型，允许改**：输入框上方一个小切换（微信 / Telegram / 电话），默认值来自 `?src=tg`、上次填写、界面语言。用户粘贴 `t.me/...` 或 `@...` 自动切到 Telegram。
- **给第 1 位买家看哪个卖家联系方式**：买家留的是 Telegram 且卖家有 Telegram，就给 Telegram（按钮直接打开 `https://t.me/<seller>`，可能还能带预填消息，见第 6 节待验证项）；否则给微信，复制 + “去微信加好友”的现有说明。卖家只填了一种就只给那一种，并在买家加入排队前提示“卖家只用微信”，避免排到了才发现联系不上。
- **卖家后台看买家**：每个排队的人旁边按类型显示操作：微信是“复制微信号”，Telegram 是“发消息”（打开 t.me 链接），电话是“复制/拨打”。
- **没有 Telegram 用户名的人**：Telegram 用户名不是必填，有些人没有。加入排队时如果选了 Telegram 但没有用户名，提示“去 设置 → 用户名 设一个，30 秒”，或者改留电话。验证身份的用户（下面）可以靠机器人联系，不需要用户名。
- **可选的“验证身份”**：通过 Telegram 机器人（第 4 节）。验证后 `sessions.sub = 'tg:<telegram user id>'`，直接复用现在给 Google 登录准备的 `sessions` / `owner_sub`，不用另起一套账号表。好处：
  - 买家排队不用手填用户名，而且不能冒充别人（现在谁都能填别人的微信号去排队）。
  - 换手机、换浏览器不丢“我的排队”和“我的清单”。
  - 能收推送。
- 现有 `buyer_wechat` 字段和 API 参数 `wechat` 继续接受（旧版 app.js 可能还缓存在用户手机上），服务端统一转成 `contact_kind/contact`。

### 2.3 语言：产品描述要不要中英文

要，但**卖家只写一种，系统补另一种**，卖家可以改。

- **存储**（同一个迁移）：
  ```sql
  ALTER TABLE sales ADD COLUMN lang TEXT NOT NULL DEFAULT 'zh';   -- 清单原文语言
  ALTER TABLE sales ADD COLUMN i18n TEXT NOT NULL DEFAULT '{}';   -- {"en":{"title":"…","location":"…","rules":[…]}}
  ALTER TABLE items ADD COLUMN i18n TEXT NOT NULL DEFAULT '{}';   -- {"en":{"name":"…","note":"…","auto":true}}
  ```
  原文仍在 `name/note/title`，译文放 `i18n`。`auto: true` 表示机器翻译、卖家没改过；卖家一改原文，自动译文重新生成，卖家手改过的译文不覆盖（改了原文时提示一下）。
- **AI 识图一次出两种语言**：prompt 里 `name/detail` 各要中英两份（`name_en`、`detail_en`），几乎不多花钱，质量比事后机翻好（品牌英文名本来就是原文，比如 IKEA、Dyson）。
- **手打的物品**：保存时用 Workers AI 翻译（`@cf/meta/m2m100-1.2b`，或者直接用现在的 Gemma，翻译短词更准），异步 `ctx.waitUntil`，不阻塞保存。
- **规则（不议价、先到先得…）**：默认规则用固定对照表，不走机翻；只有卖家自定义的才机翻。
- **展示**：买家界面英文时显示英文名，物品页有个“原文 / Original”小开关；界面中文时显示中文。分享文字、清单长图、og 预览按目标渠道/语言生成。
- **卖家开关**：清单设置里“给英文买家显示英文”默认开。卖家开 Telegram 分享时如果还没译文，当场补齐（`/sale/:id/translate`，一次批量翻）。
- 名字长度上限从 30 字放到 60 个字符（英文单词长；`IKEA MALM chest of 6 drawers` 已经 29）。

## 3. 界面国际化（工作量最大的一块）

- 新建 `public/i18n.js`：`t(key, vars)`、`zh`/`en` 两个字典、`lang` 来源优先级：URL `?lang=` > 本机保存的选择 > Telegram Mini App 的 `language_code` > `?src=tg` 时默认 en > `navigator.language`。买家页右上角放 中/EN 切换。
- `lib.js` 里的 `CONDITIONS`、`money()`（“免费”→“Free”）、`defaultIntro`、`shareText`、`contactNote` 全部改成接受 `lang` 参数。`parseLine` 增加英文：`free`、`for free`、`giveaway`，以及芬兰常见写法 `20e`、`€20`。
- 服务端报错改成“错误码 + 参数”，客户端按语言翻译；保留中文 `message` 给旧客户端。
- HTML 外壳：`<html lang>`、`og:locale`、`og:site_name`、默认标题描述都按清单语言/渠道出。英文首页 `/en`，加 `hreflang`。
- 日期、相对时间（“3 小时前” → “3h ago”）、件数（单复数）、货币位置（`€20`）统一走 `Intl`。
- **分批迁移，先买家后卖家**：
  1. 买家页（清单页、物品页、加入排队、我的排队、排到第 1 位的联系卡片）——这是英文用户唯一一定会看到的部分。
  2. 分享面板 Telegram 分支 + 卖家填联系方式 + 群文字英文版。
  3. 卖家管理页全量（英文卖家也能用）。
  4. 引导、收藏送 AI、推荐朋友、反馈、打赏、问卷、附近的二手。
- 加一个测试：扫 `app.js` 里引号内的中文字符，不在 `i18n.js` 字典里就报错，防止以后新加的文案漏翻。

## 4. Telegram 机器人：Telegram 比微信多出来的能力

Worker 里加 `/tg/webhook`（`setWebhook` 带 `secret_token`，`TG_BOT_TOKEN` 用 `wrangler secret put`）。机器人分两步上，第一步不用做 Mini App。

### 4a. 深链接 + 推送（便宜，收益最大）

- 买家网页上排完队，出现“在 Telegram 收提醒”按钮 → `https://t.me/<bot>?start=q_<一次性码>` → 用户点 Start → 机器人把这个 Telegram 身份绑定到这台设备的 buyerToken（一次性码存表，10 分钟过期，不把 buyerToken 本身放进链接）。
- 之后推送：**排到第 1 位**（附卖家联系方式或“直接给卖家发消息”按钮）、**物品被卖家标为已出**、**卖家下架/结束清单**。微信里做不到，这是 Telegram 版的最大卖点。
- 卖家同理：管理页“发到我的 Telegram”→ 机器人把管理链接发给卖家（取代 文件传输助手/收藏 那套说明），并推送“有人预订了 X”“X 排了 3 个人”“清单 7 天后暂停，点这里续期”。现在的 30 天续期提醒只能靠卖家自己打开页面才看到，有了机器人能主动提醒。
- 机器人命令：`/lists` 我的清单、`/queues` 我的排队、`/forget` 删掉我的 Telegram 绑定（GDPR）。

### 4b. Mini App（身份完全无感）

- BotFather `/newapp` 注册，直接链接 `https://t.me/<bot>/<app>?startapp=s_<saleId>`；同一份前端代码，检测到 `Telegram.WebApp.initData` 就进入 Telegram 模式（只在 Telegram 里加载 `telegram-web-app.js`，微信里不加载）。
- 服务端用 bot token 按官方 HMAC 方法校验 `initData`，检查 `auth_date` 不要太旧，然后建 session（`sub = 'tg:<id>'`）。
- 好处：买家点一下“预订”就排上了，不用填任何东西，不能冒充；用 `language_code` 自动选语言；`openTelegramLink` 直接打开和卖家的对话。
- 卖家在 Mini App 里的清单跟着 Telegram 账号走，彻底解决“换手机丢管理入口”。

### 4c. Telegram 原生玩法（以后）

- **inline 模式**：在任何群里输入 `@<bot>`，弹出自己的清单，选一个就发出带图、带“Reserve”按钮的消息（按钮打开 Mini App）。比粘贴文字体面。注意有的群关了“通过 inline 机器人发消息”的权限，要保留复制文字的退路。
- **群里实时清单**：卖家把机器人拉进群，机器人发一条清单消息，物品状态变化时 `editMessageText` 原地更新（已出的划掉）。
- **相册导出**：很多英文群要求“照片 + 文字”而不是链接。提供“下载全部照片 + 复制配文（1024 字以内）”，配文末尾带链接。
- **Telegram Stars**：替代微信赞赏码做打赏，以及买 AI 识图次数（Telegram 规定数字商品要用 Stars）。

## 5. 你可能还没想到的事

1. **三条语言轴**（第 0 节）。最容易做错的是只做一个“英文模式”开关，结果中文卖家发英文群时得把整个界面切成英文。
2. **平台检测靠不住**：Telegram iOS 内置浏览器的 UA 不一定带 Telegram 标记，用户也可能设置成用 Safari 打开。所有分支以 `?src=tg`、显式选择、`initData` 为准，UA 只作参考。现在的 `isWeChat` 判断保持不变。
3. **浏览器和 Mini App 是两个存储**：同一个人先在浏览器排队、后来从 Mini App 打开，看不到自己的排队。解法是第 4a 节的绑定：一旦有 Telegram 身份，`myQueues` 按 `tg_user_id` 和 buyerToken 合并查询。
4. **冒充别人排队**：现在谁都能填别人的微信号。Telegram 版有了验证身份，可以给卖家显示“已验证”小标；未验证的照常允许，不强制。
5. **Telegram 骗子多**：英文二手群里常见“先付定金”“我让快递来取”“发你一个付款链接”。买家页和联系卡片加一句安全提示：见面验货再付钱，不点陌生付款链接，不给验证码。
6. **当地习惯**：芬兰群里常见 MobilePay、“pick up only”、“DM me”、“20e”。默认规则英文版加“Pick-up only / Cash or MobilePay”可选项；价格解析认 `20e`。
7. **品牌名和域名**：英文用户看到 `ershouqingdan.jinda.workers.dev` 和“二手清单”记不住也不敢点。要定一个英文名（候选方向：Secondhand List / Moving Sale List / ListAndGo），以及要不要现在就上自定义域名。另外 `workers.dev` 的链接在 Telegram 里会不会被限制预览，要先测；被限就必须上域名。
8. **清单长图和封面卡片**：canvas 里画的中文要按语言画英文版；英文更长，要重新排版和截断。
9. **英文文案不是直译**：比如 AI 次数用完那套“薅羊毛/催开发者充钱”的调皮语气，英文要重新写成同样调皮的英文梗，而不是翻译。收藏送 AI、推荐朋友整套依赖微信收藏的机制，在 Telegram 里换成“Pin the bot / Saved Messages”，部分功能可以先不在英文版出。
10. **打赏码**：微信赞赏码对外国用户没用，英文界面先隐藏或换成 Stars / Ko-fi。
11. **附近的二手**：中英文清单混在一起。按买家界面语言优先排序，另一种语言的显示译文或标注“中文清单”。
12. **SEO**：英文首页、`hreflang`、英文 JSON-LD；`sitemap.xml` 加英文页。
13. **隐私/GDPR**：用户在欧盟。新增处理的数据：Telegram 用户 ID、用户名、语言、机器人消息记录（不存消息内容）。英文版隐私政策和条款必须在机器人上线前写好；`/forget` 删除绑定；数据保留期限写清楚。
14. **管理链接泄露**：Telegram 会抓取任何发出去的链接生成预览，管理链接发到 Saved Messages 没问题（现在已经 `noindex`），但英文提示里同样要强调“只发给自己”。机器人方案比让卖家自己存链接更安全。
15. **旧客户端兼容**：`app.js?v=` 有缓存，接口要同时接受旧字段（`wechatId`、`wechat`），一个版本以后再清理。
16. **英文排版**：按钮文字变长，320px 宽手机上要逐页检查；`theme.css` 里针对中文的字距、行高要放到 `:lang(zh)` 下。
17. **测试与验证**：`test/lib.test.js` 补英文 `parseLine`、`shareText(target:'telegram')`、联系方式规范化；Telegram 端要真机测 iOS + Android + Desktop 三端的预览、内置浏览器存储是否持久、`t.me` 链接行为。
18. **数据分析**：记录每份清单每个渠道带来的浏览和排队（`src` 参数），才能知道 Telegram 值不值得继续投入。

## 6. 动手前要先验证的假设（第 0 阶段，半天）

- `*.workers.dev` 链接发到 Telegram 群会不会出预览、大图还是小图（og:image 600×600 正方形可能显示成小图；横图 1200×630 才是大图，可能要为 Telegram 单独出一张）。
- Telegram iOS / Android 内置浏览器里 localStorage 关掉再开还在不在（决定买家不绑机器人时会不会丢排队）。
- `https://t.me/<username>?text=…` 能不能给普通用户预填消息（有第三方资料说可以，官方文档没写清楚）。能的话，第 1 位买家点一下就打开和卖家的对话并填好“Hi, I reserved #1 desk lamp from your list …”。
- Telegram 用户里没有用户名的比例（问几个目标群的群友就行）。
- 目标英文群的规则：允不允许发链接、允不允许机器人、要不要照片。

## 7. 分阶段计划

| 阶段 | 内容 | 粗估 | 上线后能做到 |
|---|---|---|---|
| P0 | 第 6 节验证；定英文名、要不要域名；注册机器人 | 0.5 天 | 知道哪些方案可行 |
| P1 | i18n 骨架；买家页英文；带类型的联系方式（迁移 0013 的联系方式部分）；Telegram 分享分支 + 英文群文字；`?src=tg` | 3–4 天 | 中文卖家能把清单发到英文 Telegram 群，英文买家能看懂、能排队、排到后能直接在 Telegram 联系卖家 |
| P2 | 物品双语（迁移 0013 的 i18n 部分）；AI 双语输出；手打物品机翻；默认规则对照表；英文清单长图/封面；英文隐私和条款 | 3 天 | 卖家写中文，买家看英文；英文的图和预览 |
| P3 | 卖家管理页全量英文；英文首页 `/en`；其余页面英文；英文调皮文案重写 | 3–4 天 | 英文母语卖家也能从头用 |
| P4 | 机器人 4a：深链接绑定 + 推送 + `/lists` `/queues` `/forget` | 2–3 天 | 排到第 1 位、被卖出、有人预订都会推送 |
| P5 | Mini App 4b：initData 校验、免填排队、账号跟着 Telegram 走 | 2–3 天 | Telegram 里一点就排上 |
| P6 | inline 分享、群里实时清单、相册导出、Stars 打赏 | 视反馈 | Telegram 原生体验 |

P1 结束就可以真实投放到一个英文 Telegram 群试水，看 `src=tg` 的数据再决定 P4 以后的投入。

## 8. 需要你拍板的事

1. 英文产品名叫什么。
2. 现在就上自定义域名，还是先测 `workers.dev` 在 Telegram 的表现再说。
3. Telegram 买家没有用户名时：要求设一个，还是允许留电话。
4. 机器翻译的物品名直接显示（标“自动翻译”），还是卖家确认后才显示。
5. 先做 P1 → P2（双语内容），还是 P1 → P4（推送）。我的建议是 P1 → P2 → P4：没有英文内容，英文群里的人不会点；推送是让他们留下来的东西。

## 9. 进度（2026-10-22）

已拍板：英文名 Secondhand List；先不买域名，用 workers.dev 测；联系方式只收微信号或 Telegram 用户名，不收电话；机翻物品名直接显示，卖家觉得不对自己改；打赏要有微信以外的渠道。

分支 `telegram-english` 已完成第 7 节的 P1、P2 和 P3 大部分：

- 全站中英双语（`public/i18n.js` 的 `tr(中文, English)`），按 `?lang=` / 上次选择 / 手机语言决定，微信里默认中文；页脚有 中文 / English 切换。
- 卖家填微信号、Telegram 用户名或两个都填；买家排队时选微信或 Telegram，每个输入框都写明是哪个 App；把 Telegram 用户名填进微信框会被拦下并提示。
- 排到第 1 位：留 Telegram 的买家看到“在 Telegram 给 @卖家 发消息”按钮和写好的开头一句，留微信的照旧看到微信号；都加了“见面验货再付钱”提示。
- 分享面板分“发到微信群 / 发到 Telegram 群”；Telegram 一条消息带链接（`?src=tg`），文字可选中文或英文，可直接打开 Telegram 选群。分享卡片（og 预览）随链接语言变。
- 物品名、详情、清单标题、取货地点自动翻译（Workers AI），卖家可在编辑里改译文；AI 识图一次出中英两份；老清单在有人打开时后台补翻译。
- 打赏：中文界面仍是微信赞赏码；另有 `TIP_URL`（Ko-fi / PayPal.me 等）给英文和 Telegram 用户，没配置时英文界面不显示打赏入口。
- 隐私政策、服务条款加了英文版并写明 Telegram 用户名和自动翻译。

还没做：第 6 节的真机验证（Telegram 预览、`t.me/用户名?text=` 预填）、机器人推送（P4）、Mini App（P5）、Telegram Stars（P6）。
