# NullTap v2 — leagues, daily tasks, storage, SQLite, WNull → NULL

This is an updated runnable Node.js Telegram Mini App starter. It includes the requested game rules and a SQLite-backed state store. It is **not yet a fully audited production airdrop or a fully on-chain swap/transfer application**; see the explicit blockers below.

## Included in this ZIP

- Dark/purple NullTap UI, tap-to-earn, energy, boosts, referrals and squads.
- Daily task reward: **10,000 NULL**, claimable once per UTC day.
- One-time league entry rewards (server-side, saved in the database): Bronze 1,000; Silver 10,000; Gold 100,000; Crystal 500,000; Legendary 1,000,000 NULL.
- League thresholds: Bronze 1–99,999; Silver 100,000–999,999; Gold 1,000,000–9,999,999; Crystal 10,000,000–99,999,999; Legendary 100,000,000+.
- Per-league leaderboard: top 100 users are listed with names and balances; the current user's rank is shown separately, including when outside the top 100.
- Storage levels 1–5 cap offline Auto Tap accrual at 4 / 6 / 8 / 12 / 24 hours. Upgrade costs: level 2 = 100,000; level 3 = 200,000; level 4 = 500,000; level 5 = 1,000,000 NULL.
- Auto Tap is accrued on the server while the app is active and also catches up when the user returns, subject to the storage-level cap. Auto Tap also mines WNull into a shared global pool capped at 5Qa; the pool and each user’s WNull balance update live in the UI and stop accruing WNull when the pool is full.
- SQLite state persistence through `better-sqlite3`; set `DB_PATH` to a persistent disk/volume in hosting.
- TON Connect wallet connect/disconnect UI and a manifest served from the current public host.
- Shared WNull mining pool capped at 5Qa, with live/offline Auto Tap mining, a progress bar, personal WNull balance, and compact number suffixes through Qa/Qi/Sx/Sp/Oc/No/Dc.
- One-way WNull → NULL in-game ledger swap UI with a 1,000,000 WNull minimum and fractional amount display.

## Important limitations — do not skip

1. **Instagram, X, and YouTube follow verification is fail-closed, not yet integrated.** The server will not award those rewards until platform-specific official API/OAuth verification is implemented and configured. Merely opening a profile is not proof of a follow/subscription. Telegram membership can be checked with `getChatMember` when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL` are set and the bot has access to the channel.
2. **WNull swap is currently an internal game-ledger conversion, not an on-chain STON.fi swap.** This package does not create a WNull Jetton contract or liquidity pool. Set `WNULL_TO_NULL_RATE` to the rate you intend before launch; the current example default of `1` is only a placeholder and should not be treated as your tokenomics. This code also does not include a WNull mining/faucet feature, so WNull balance will remain zero unless another trusted game mechanic credits it.
3. **Real NULL Jetton transfers and the 1% fee split are not enabled.** TON Connect only connects the wallet. Before implementing transfers, verify the NULL Jetton master address and decimals, and supply a real owner wallet address to receive fees. The previously supplied `UQAhUNwAEG02lliy73xXxT9y6UtCVNEa3yEjIga54Gf1ZVjQ` was described as the token contract/master address; do not assume a Jetton master contract can receive a user's fee as a wallet. Never request seed phrases/private keys.
4. **Use a persistent volume.** SQLite is a real database, but if its file lives on ephemeral hosting storage, it can still be lost on redeploy. On Railway, attach a Volume mounted at `/data` and set `DB_PATH=/data/nulltap.sqlite`. Back it up.
5. The provided official social URLs are examples. Replace `NULL_INSTAGRAM_URL`, `NULL_X_URL`, and `NULL_YOUTUBE_URL` with your actual profile/channel links.
6. Use `DEV_MODE=false` in production. Public users must open the app through Telegram with valid `initData`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000` for local testing. TON Connect requires a public HTTPS URL and a reachable manifest; the wallet connect UI is only initialized on HTTPS.

## Hosting environment variables

Copy `.env.example` into your hosting provider's environment settings. Do not commit real secrets.

- `TELEGRAM_BOT_TOKEN`: secret token from @BotFather (server-side only)
- `TELEGRAM_BOT_USERNAME`: bot username without `@`
- `TELEGRAM_APP_SHORT_NAME`: optional Mini App short name
- `TELEGRAM_CHANNEL`: official Telegram channel username or chat ID
- `ADMIN_TELEGRAM_IDS`: comma-separated numeric Telegram user IDs
- `DEV_MODE=false`
- `DB_PATH=/data/nulltap.sqlite` (requires persistent volume mounted at `/data`)
- `WNULL_TO_NULL_RATE`: configure your actual intended internal ledger rate before enabling swap
- `NULL_INSTAGRAM_URL`, `NULL_X_URL`, `NULL_YOUTUBE_URL`: real profile URLs

## Files

- `server.js`: API, league reward ledger, SQLite persistence, tasks, storage levels, swap ledger, Telegram validation
- `public/index.html`: game UI
- `public/app.js`: UI state/rendering, league boards, wallet connection and swap interactions
- `public/style.css`: visual styling
- `public/tonconnect-manifest.json`: fallback manifest file; server serves a host-specific manifest dynamically
- `public/icon-180.png`: wallet/app icon

## TON Center API connectivity check

Set `TONCENTER_API_KEY` as a secret environment variable in your hosting dashboard (Render/Railway). Do not put the key in `public/app.js` or commit it to GitHub. Optional `TONCENTER_BASE_URL` defaults to the TON Center mainnet API v2 URL.

After deployment, open `/api/ton/status`. A successful response reports `connected: true` and the current masterchain sequence number. This endpoint is a read-only API connectivity check; it does not send transactions or collect a 1% token fee. TON Connect wallet connection is separate, and real Jetton fee transfers require a separately implemented and tested transaction flow.
