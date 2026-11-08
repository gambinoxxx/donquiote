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

Alarm test (go-live checklist): while the market is open, stop the
worker (see "Restart or stop the worker"), wait until a check runs with the
last OK scan over 45 min old (up to ~60 min) → exactly one "Scanner
stopped" push and email. Start the worker → after its first OK cycle, the
next check sends one "Scanner back".

## First deploy

Do these in order. Tick them off in `doc/go-live-checklist.md`.

1. **Neon**: in the existing project, create branch `production` from
   `dev`'s schema (or empty). Copy its pooled and direct URLs into your
   password manager.
2. **Migrate + seed production** from this laptop, without saving the URLs
   to disk:
   ```sh
   read -rs DIRECT_URL && export DIRECT_URL      # paste production direct URL
   read -rs DATABASE_URL && export DATABASE_URL  # paste production pooled URL
   npm run db:deploy && npm run db:status && npm run db:seed
   unset DIRECT_URL DATABASE_URL
   ```
   (Already-set variables win over `.env`, so this hits production. Close
   the terminal afterwards to be sure.) The seed prints the counts and
   `dg-v1=LIVE`, the others `TEST`.
3. **Stop any local worker** (Ctrl+C in its terminal). From now on never
   run `npm run worker` locally against production.
4. **Railway**: create the service from GitHub (see Railway above), set its
   variables, deploy. Logs should show `started`, then `notify ready`,
   `news ready`. On an empty database the first cycle backfills 90 days of
   15m and 365 days of 4H / D candles per pair (a few minutes; logged).
5. **Vercel**: import the repo, set its variables, deploy. Open the URL on
   a phone: sign-in page, then Home shows "Scanner OK" within ~15 min of
   the market being open (or "Market closed").
6. **Clerk**: add the Vercel URL (or domain) to the instance's allowed
   origins / redirect URLs if Clerk asks. Check both users can sign in and
   a third email lands on "Not allowed".
7. **cron-job.org**: set up the alarm (above) and run the test.
8. **Phones**: install the app and turn notifications on (Settings →
   This device), send a test notification.

## Releases

Every push to `main` deploys **both** Vercel and Railway (Railway's GitHub
autodeploy).

**Without a migration** (no new folder in `prisma/migrations/`): push to
`main`. That's it. Vercel promotes the new build; Railway's new worker
waits for the old one's lock and takes over within one cycle.

**With a migration** (a new folder in `prisma/migrations/`):
1. Make the migration additive (new tables / nullable or defaulted
   columns), so the running old code keeps working.
2. Before pushing, apply it to production (First deploy step 2, only
   `npm run db:deploy && npm run db:status`).
3. Push to `main`. A worker deployed before the migration refuses to start
   with `migrations_behind` (exit 1) — it's a reminder, not damage: run
   step 2, then Railway → Redeploy.
4. A failed migration (`db:status` shows it failed): fix the SQL with a new
   migration, or follow Prisma's `migrate resolve` steps; never edit an
   applied migration.

Roll back: Vercel → Deployments → Promote the previous one; Railway →
Deployments → Redeploy the previous one. Migrations are not rolled back
(additive ones don't need it).

## Add or rotate a key

1. Create the new key at the provider (Clerk, Resend, OANDA, VAPID, …).
2. Replace the value in **every** service the table above marks (Vercel,
   Railway or both). Vercel: Settings → Environment Variables → edit →
   Redeploy (variables only apply to new deployments). Railway: Variables →
   edit (it redeploys by itself).
3. Revoke the old key at the provider once both services run on the new
   one.
- **VAPID keys**: rotating them invalidates every phone's subscription.
  After rotating, each phone: Settings → This device → turn off, then on.
- **`CRON_SECRET`**: change it in Vercel and in cron-job.org's header
  together.
- A key leaked (pasted in a chat, committed): rotate it now, then check
  `git log -p` for the commit and ask before rewriting history.

## Restart or stop the worker

- **Restart**: Railway → service → Deployments → ⋮ → Restart. It finishes
  the current cycle, releases the lock, starts again (`started` in logs).
- **Stop**: Railway → service → Settings → Pause / remove the active
  deployment (or set replicas to 0). Alerts stop; the alarm will report it
  once while the market is open.
- **Start again**: Deployments → Redeploy (or replicas back to 1).
- **Never run a local worker while Railway runs.** Two workers never scan
  at the same time (a database lock), but a laptop worker started between
  cycles silently takes over production scanning, and production stops
  when the laptop sleeps. Local development uses the `dev` database
  branch only.

## On "Scanner stopped"

1. Open Home: is the scanner line red? Note the time.
2. Railway → service → Logs. Look at the last lines:
   - `fatal` + `Invalid environment variables` → a variable is missing
     (named in the line): add it, redeploy.
   - `migrations_behind` → run `npm run db:deploy` for production, redeploy.
   - `degraded` / `OANDA rejected the token` → the OANDA token expired or
     was revoked: new token, rotate it (above).
   - `refused … another worker holds the lock` repeating → someone runs a
     second worker (a laptop?): stop it.
   - Nothing for a while / crashed → Restart.
3. Railway status page / Neon status page if everything looks fine.
4. When it's back you get "Scanner back at …". Missed signals during the
   outage are not replayed beyond 48 h, and old ones (> 20 min) are never
   pushed late.

"Scanner failing since …": the worker runs but every cycle has a failing
pair: the message carries the reason; usually OANDA.

## Logs

- **Worker** (Railway → Logs): JSON lines (`ts`, `component`, `outcome`,
  pair, step). Useful filters: `"outcome":"error"`, `"component":"notify"`,
  `"component":"news"`, `"outcome":"fatal"`. No secrets, emails or
  endpoints are ever logged.
- **App** (Vercel → project → Logs): server errors, the cron route's
  errors (`"component":"scanner-check"`), env failures at start.
- **cron-job.org** → job history: one line per check with the HTTP status.
- Home's scanner line and `/news`'s source line show the latest state.

## Neon backups and restore

- Neon keeps a **restore window** (point-in-time history) per project. Its
  length depends on the plan (short on Free, days on paid plans) and Neon
  changes it now and then, so read the current value in the Neon console
  (project settings → history / restore window) and note it here:
  `Restore window: ____`. Anything older than that cannot be restored.
- **Restore** (bad migration, deleted data): Neon → Branches → production
  → Restore → pick a time inside the window (Neon keeps a backup branch of
  the state before the restore). Stop the Railway worker first, restart it
  after.
- Before a risky migration, make a branch from production ("Create branch")
  as a named snapshot; delete it later.
- Extra copy (optional): `pg_dump "$DIRECT_URL" > backup.sql` from a shell
  where the production URL is set as above; keep the file out of git.

## Add an allowed email

1. Vercel and Railway: edit `ALLOWED_EMAILS` (comma-separated, lowercase),
   both services, redeploy Vercel.
2. Clerk: create or invite the user (with passwords off, email code only).
3. The new person signs in; anyone not in the list lands on "Not allowed".
   The worker's emails go to every address in the list.

## Turn a strategy Live

In the app, not in code: Settings → Strategies → the strategy → Live. A
confirm sheet shows its paper results and warns when it has fewer than 30
closed paper trades. The change is in Settings › Change history and can be
undone. **During the monitoring period nothing goes Live before the review**
(doc/context/progress-tracker.md → Monitoring period).
6 hours (Neon Free plan). If data is deleted or broken by mistake,
restore within 6 hours: Branches → production → Restore.
Paid plans allow up to 30 days.