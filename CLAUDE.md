# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user LINE bot for tracking income/expenses and credit card debt, backed by a self-hosted Actual Budget server, with a LINE LIFF web dashboard for viewing summaries and charts. Designed to run entirely on a 1 vCPU / 1GB RAM VPS.

There are three independently-managed sub-projects in this repo:

- `bot/` — the LINE webhook + LIFF API server (plain Node.js/Express, no build step)
- `liff-web/` — the LIFF dashboard (SvelteKit, Svelte 5 runes, TypeScript, Tailwind v4)
- `line-messaging-api/SKILL.md` — a standalone LINE Messaging API curl reference (not application code)

They are tied together at deploy time by `docker-compose.yml` + `Caddyfile` at the repo root, not by a shared package manager workspace. There is no root-level build/test — the root `package.json` is a stray/unused file with a placeholder `test` script; ignore it.

## Commands

### bot/ (Node.js/Express)
```bash
cd bot
npm install
npm run dev     # node --watch src/index.js
npm start        # node src/index.js
```
No test suite, linter, or build step exists for `bot/`. There is no single-test command because there are no tests.

### liff-web/ (SvelteKit)
```bash
cd liff-web
bun install                # or npm install
bun run dev                 # vite dev server; proxies /api/* to http://localhost:3000 (see vite.config.ts)
bun run build                # outputs static SPA to liff-web/build/ — this is what gets deployed
bun run check                 # svelte-kit sync && svelte-check (TypeScript/Svelte type checking)
bun run lint                   # prettier --check .
bun run format                  # prettier --write .
```
`node_modules/` in this project was installed on Windows (bun) — native deps (esbuild etc.) are platform-specific, so `bun install`/`bun run build` must be run on the actual dev machine, not assumed to work in an arbitrary Linux sandbox.

### Full stack (Docker)
```bash
docker compose up -d --build          # chiyu + line-bot + actual-server
docker compose logs -f line-bot
docker compose restart <service>
```
`liff-web` is **not** rebuilt by `docker compose up` — Chiyu serves the pre-built `liff-web/build/` directory directly (bind-mounted, read-only). After any change under `liff-web/`, you must `bun run build` first, then `docker compose restart chiyu`, or the deployed dashboard won't reflect the change.

## Architecture

### Request routing (single Chiyu entrypoint)
The Caddy service (configured via `Caddyfile`) is the only container with a published port. It routes to the other two containers over the internal `app` Docker network, on two separate domains:
- On `$DOMAIN`, by path prefix: `/webhook*` and `/api/*` → `line-bot:3000`; `/app/*` → static files from the bind-mounted `liff-web/build` (LIFF dashboard)
- On `$ACTUAL_DOMAIN` (a separate subdomain, root path) → `actual-server:5006` (Actual Budget's own web UI, used for initial setup/admin). It must be a separate (sub)domain rather than a path prefix under `$DOMAIN` — Actual's frontend references its JS/CSS bundles with root-absolute paths (e.g. `/static/js/index.*.js`), so proxying it under a path prefix breaks asset loading.

`line-bot` and `actual-server` have no ports published to the host — only Caddy is reachable from outside.

### Two unrelated auth mechanisms live in the same `bot/` process
- The LINE webhook (`bot/src/index.js`, `POST /webhook`) is authenticated by `@line/bot-sdk`'s `line.middleware`, which verifies the LINE signature against the **raw** request body. Because of this, `express.json()` must never be applied globally ahead of this route — request bodies are parsed per-route, not app-wide.
- The LIFF dashboard API (`bot/src/routes/api.js`, mounted at `/api`) is authenticated separately by `bot/src/auth.js`, which verifies the LIFF ID token against LINE's `oauth2/v2.1/verify` endpoint and then checks the resulting `sub` against a single hardcoded `ALLOWED_LINE_USER_ID` env var. This app is intentionally single-user — there is no multi-tenant concept anywhere in the auth layer.

### Two separate data stores, split by what each is responsible for
- **Actual Budget** (running as its own container, `actual-server`) owns transactions, account balances, and budgets. `bot/src/actualClient.js` wraps `@actual-app/api` to talk to it over the internal network. Note: `getAccountBalance()` computes balance by summing all transactions rather than reading a balance field directly, because the installed `@actual-app/api` version doesn't expose one reliably — check the installed version's docs before assuming a faster path exists.
- **Local SQLite** (`bot/src/db.js`, via `better-sqlite3`, persisted in the `bot_data` volume) owns everything Actual has no field for: `cards` (credit limit, due day, statement day, APR — linked to an Actual account via `cards.actual_account_id`), `users` (LINE user IDs seen), `transaction_refs` (de-dup of slips/QR by bank ref), and `tx_entries` (one row per transaction recorded through the bot: local entry id, time-of-day `occurred_at`, optional slip image path in `bot/data/slips/`, and `actual_tx_id`). Because `@actual-app/api`'s `addTransactions` returns only `"ok"`, the bot stamps the entry id into the transaction's `imported_id` and resolves the real Actual tx id from that (see `findTransactionByImportedId`); the "จดสำเร็จ" Flex card carries an edit button that must link via the LIFF permanent link `https://liff.line.me/$LIFF_ID/edit/{entryId}` (a plain `https://$DOMAIN/app/edit/{id}` URL opens LINE's in-app browser, where `liff.closeWindow()` silently does nothing even though `liff.isInClient()` returns true), backed by `GET/PUT/DELETE /api/tx/:id` (+ `GET /api/tx/:id/slip`) and the SvelteKit route `liff-web/src/routes/edit/[id]/` (deep links require the `try_files` SPA fallback in the Caddyfile). Time-of-day and slip images live only in SQLite; amount/payee/category/date edits are written back to Actual.
- There is currently no command or UI path that populates `cards.actual_account_id` — it has to be inserted directly into SQLite.

### `liff-web` is a client-only SPA, not a normal SvelteKit app
- `ssr` is disabled globally (`src/routes/+layout.ts`) because the LIFF SDK requires `window` at init time.
- The adapter is `@sveltejs/adapter-static` with `fallback: 'index.html'` (SPA mode, not prerendering) — this is required by `ssr = false`.
- The LINE LIFF SDK and Chart.js are loaded as classic global `<script>` tags in `src/app.html`, not as npm packages. `src/vite-env.d.ts` declares `window.liff` / `window.Chart` by hand since there are no installed types for them.
- `src/lib/liff.ts` and `src/lib/api.ts` are the only places that talk to the outside world (LIFF auth + `/api/*` fetches); components under `src/lib/components/` are pure presentational (typed props in, no data fetching).

### Incomplete/stubbed functionality
Several handlers exist as scaffolding with explicit `// TODO` comments rather than working implementations — check `README.md`'s "สิ่งที่ยังเป็น TODO ในโค้ด" section and the source before assuming a feature works end-to-end. In particular: incoming text/slip messages are not yet mapped to a real Actual `accountId` (`bot/src/index.js`), OCR'd slip text is returned raw without amount/reference parsing (`vision.js` output, unused by `handleImage`), PDF statement import (`handleFile`) is now implemented: it drives a multi-step postback flow (pick bank → decrypt with `PDF_PASSWORDS[bank]` via qpdf → render pages to JPEG via pdftoppm in `pdf.js` → `statementExtract.js` sends them to Gemini → preview ALL extracted rows as a Flex carousel → confirm → pick account → save), with per-import state (and status `await_bank`/`await_review`/`await_account`) in the `pending_import` SQLite table. Note `transaction_refs` dedup is NOT applied to statement imports, so re-importing the same PDF will duplicate rows.
