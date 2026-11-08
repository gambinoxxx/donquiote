# Donquixote FX — Runbook

How the app runs in production and what to do when something needs
changing. Values never go in this file, in git or in a chat: only in the
Vercel and Railway dashboards (and your password manager).

## Where things run

| Piece | Where | Notes |
| --- | --- | --- |
| Dashboard (Next.js) | **Vercel**, built from GitHub `main` | No migrations in the build |
| Worker (scanner, news, notifications) | **Railway**, `Dockerfile` + `railway.json` | Exactly one replica |
| Database | **Neon**, branch `production` | Local dev uses branch `dev` |
| "Scanner stopped" alarm | **cron-job.org** → `GET /api/cron/scanner-check` | Every 15 min |

## Environment variables

Names only. "Both" means set the same value in Vercel **and** Railway.

| Variable | Vercel (app) | Railway (worker) | What it is |
| --- | :-: | :-: | --- |
| `DATABASE_URL` | ✓ | ✓ | Neon **production** branch, pooled URL (host has `-pooler`) |
| `DIRECT_URL` | — | ✓ | Neon production, direct URL (worker lock, migration check). Also in your shell for `npm run db:deploy` |
| `ALLOWED_EMAILS` | ✓ | ✓ | DG's and Gambino's emails, comma-separated (who can sign in; who gets emails) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✓ | — | Clerk publishable key (`pk_live_…` with a domain, else `pk_test_…`) |
| `CLERK_SECRET_KEY` | ✓ | — | Clerk secret key (`sk_live_…` / `sk_test_…`) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | ✓ | — | Always `/sign-in` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ✓ | — | VAPID public key (the browser subscribes with it) |
| `VAPID_PUBLIC_KEY` | ✓ | ✓ | Same VAPID public key |
| `VAPID_PRIVATE_KEY` | ✓ | ✓ | VAPID private key |
| `VAPID_SUBJECT` | ✓ | ✓ | `mailto:<your email>` |
| `RESEND_API_KEY` | ✓ | ✓ | Resend API key |
| `EMAIL_FROM` | ✓ | ✓ | Sender, e.g. `alerts@<your domain>` (see Domain below) |
| `APP_URL` | ✓ | ✓ | The dashboard's https URL (links in emails and pushes) |
| `CRON_SECRET` | ✓ | — | ≥ 32 random characters; cron-job.org sends it as a Bearer token |
| `OANDA_API_TOKEN` | — | ✓ | OANDA v20 token |
| `OANDA_ACCOUNT_ID` | — | ✓ | OANDA account id (`101-…`) |
| `OANDA_ENV` | — | ✓ | `practice` |
| `FINNHUB_API_KEY` | — | optional | Headline feed; without it Fed + White House feeds only |
| `ANTHROPIC_API_KEY` | — | optional | Headline classification fallback; without it keyword rules only |

Why the app needs push and email keys too: Settings › "Send test
notification" and the "Scanner stopped" alarm are sent by the app, not the
worker.

A missing or invalid variable stops the process at start with a message
that **names** it (never shows the value): Vercel shows it in the function
logs, Railway in the deploy logs.

Generate keys: VAPID `npx web-push generate-vapid-keys`; `CRON_SECRET`
`openssl rand -hex 32`.

## Railway (worker)

- New project → Deploy from GitHub repo → this repo. Railway reads
  `railway.json`: Dockerfile build, start command `npm run worker`,
  **1 replica**, restart on failure (max 10), 30 s overlap, 120 s drain.
- Variables: the Railway column above.
- Logs: one JSON line per event on stdout (`component`, `outcome`, pair,
  step). Filter in Railway's log view, e.g. `"outcome":"error"`.
- Redeploy: Railway starts the new instance (it logs `waiting_for_lock`),
  then sends SIGTERM to the old one, which finishes its cycle, logs
  `lock_released` and exits 0; the new one starts within ~15 s (tested:
  12 s). A worker that loses the lock to another logs `lock_taken_over`
  and exits 0 (no restart).
- The worker refuses to start (`migrations_behind`, exit 1) if the
  database is missing a migration: run `npm run db:deploy` (Releases).

## Vercel (app)

- Import the GitHub repo. Framework: Next.js. Build command: default
  (`next build`); `postinstall` runs `prisma generate`. **No migrations in
  the build.**
- Variables: the Vercel column above, for **Production** (and Preview only
  if you use previews; point those at the `dev` branch, never production).
- Every push to `main` deploys. Roll back from Vercel → Deployments →
  Promote an older one.

## Domain: with or without

**Without a custom domain** (the app stays on `<project>.vercel.app`):
- Clerk stays on its development instance (`pk_test_…` / `sk_test_…`):
  fine for two users, sign-in shows a small "Development mode" badge.
- Resend can only send from `onboarding@resend.dev`, and only **to the
  Resend account owner's own address**: alert and alarm emails reach
  Gambino only; DG relies on push.
- `APP_URL` = `https://<project>.vercel.app`.

**With a custom domain** (about $10–15 a year):
- Vercel → Domains: add it (e.g. `app.<domain>`), set the DNS records.
- Clerk → create the **production** instance for the domain, add its DNS
  records, set the session token claim
  `{ "email": "{{user.primary_email_address}}" }` again (see Unit 3 notes),
  turn passwords off, invite/create both users. Replace both Clerk keys in
  Vercel with the `pk_live_` / `sk_live_` ones. The CSP follows the new key
  automatically after a redeploy.
- Resend → Domains: add the domain, add its DNS records, wait for
  "Verified". Set `EMAIL_FROM=alerts@<domain>` in Vercel and Railway.
- `APP_URL` = `https://app.<domain>` in Vercel and Railway.

## Database (Neon)

- One project, two branches: `production` and `dev`. Never put production
  URLs in a local `.env`.
- Schema changes ship as migrations. `npm run db:deploy` applies them; it
  is run by hand (Releases), never by the Vercel build.
- `npm run db:seed` is safe on a live database: it only creates what's
  missing (settings defaults, watchlist, heartbeat, strategy modes with
  dg-v1 LIVE and the others TEST, the first settings version).

## "Scanner stopped" alarm (cron-job.org)

`GET /api/cron/scanner-check` sends **one** push + email to both users when
the market is open (and has been for 45 min) and the last fully OK scan is
older than 45 minutes: "Scanner stopped at 14:15" (or "Scanner failing
since 14:15" when the worker runs but every cycle fails, with the reason).
When a new OK scan appears it sends one "Scanner back at …". Nothing more
is sent during one outage, however long. It ignores the alert toggles in
Settings: it's about the app itself.

Set up (free account at cron-job.org):
1. Create cronjob → URL `https://<your app>/api/cron/scanner-check`.
2. Schedule: every 15 minutes (`*/15 * * * *`).
3. Advanced → Request method `GET`; Headers → add
   `Authorization` = `Bearer <CRON_SECRET>` (the same value as in Vercel).
4. Turn on "Notify me when the job fails" (cron-job.org emails you if the
   app itself is down: then the alarm can't run, but you still hear).
5. Save, then "Test run": expect HTTP 200 and
   `{"ok":true,"data":{"state":"ok" | "market_closed", …}}`.
   401 = the header is wrong; 503 = `CRON_SECRET` missing in Vercel.

Alarm test (go-live checklist): while the market is open, stop the Railway
worker (Settings → Remove deployment or scale to 0... see Restart / stop),
wait ~50 min for the next check → one "Scanner stopped" push and email;
start the worker → within one cycle and the next check, one "Scanner back".
