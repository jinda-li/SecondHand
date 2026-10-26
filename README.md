# 二手清单 · Secondhand List

Sell your stuff without answering every message. Snap a photo, post one link to your groups, and buyers line up themselves.

**Live:** https://ershouqingdan.jinda.workers.dev

出二手，不用一个个回消息：拍照上架，一个链接发到微信群、Telegram 群，想要的人自己排队预订。免费、不用注册、不用下载。

## What it does

- **Photo in, item out.** Snap a photo and Workers AI names the item. Add a price and it is listed.
- **One link for every group.** The same list goes to any number of WeChat or Telegram groups. Mark something sold once and every link is up to date.
- **A queue, not a chat.** Buyers tap Reserve and leave a WeChat ID or Telegram username. Only the first in line sees the seller's contact; if they drop out, the next one moves up.
- **Chinese and English.** The UI is bilingual, and item names and details are translated automatically.
- **Nearby.** Lists can show up under other lists in the same area, so things sell faster.
- **No accounts.** Sellers manage a list with a key kept in their browser; Google sign-in exists but is off by default.

## How it is built

- One Cloudflare Worker ([src/worker.js](src/worker.js)) serves the pages and the API.
- D1 (SQLite) stores lists, items and queues; schema in [migrations/](migrations).
- Workers AI recognizes photos and translates text.
- The front end is plain JavaScript modules in [public/](public), with no framework and no build step.

## Run it locally

You need Node.js 20+ and a Cloudflare account.

```bash
npx wrangler login
npm run migrate:local
npm run dev
```

Then open the address wrangler prints (http://localhost:8787 by default). Tests run with `npm test`.

## Deploy your own

1. Create a D1 database (`npx wrangler d1 create <name>`) and put its name and ID in [wrangler.toml](wrangler.toml).
2. Apply the migrations: `npx wrangler d1 migrations apply <name> --remote`.
3. Optional settings in `wrangler.toml` under `[vars]`:
   - `TIP_URL`: your own tip page (Ko-fi, etc.), or empty to hide it.
   - `GOOGLE_CLIENT_ID`: a Google OAuth web client ID to turn on Google sign-in.
4. Optional secret: `npx wrangler secret put INVITE_CODE` gives unlimited AI photo recognition to people who enter the code.
5. `npm run deploy`.

If you deploy a copy, replace [public/tip-qr.png](public/tip-qr.png) (my WeChat tip code) and `TIP_URL` with your own, and update the contact email in [public/privacy.html](public/privacy.html) and [public/terms.html](public/terms.html).

## Support

Secondhand List is free with no ads. I pay for the server, the domain and the AI myself. If it helped you, you can tip on [Ko-fi](https://ko-fi.com/jindali) or with WeChat:

<img src="public/tip-qr.png" alt="WeChat tip code" width="200">

Bug reports and ideas are welcome as [issues](https://github.com/jinda-li/SecondHand/issues), or through the Feedback button in the app.

## License

[MIT](LICENSE) © Jinda Li
