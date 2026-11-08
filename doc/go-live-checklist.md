# Go-live checklist

Tick each box yourself when it's done and checked. How-to for every step:
`doc/runbook.md`.

## Database

- [ ] Neon `production` branch created; its URLs only in the password manager, Vercel and Railway
- [ ] `npm run db:deploy` on production; `npm run db:status` says up to date
- [ ] `npm run db:seed` on production: settings, 6 pairs, `dg-v1=LIVE`, other strategies `TEST`, 1 settings version

## App (Vercel)

- [ ] Every Vercel variable from the runbook table set (Production)
- [ ] Deploy succeeded; the URL opens the sign-in page over https
- [ ] DG signs in with an email code
- [ ] Gambino signs in with an email code
- [ ] A third email is refused ("Not allowed")
- [ ] Domain decision made (custom domain + Clerk production + Resend domain, or stay on vercel.app)

## Worker (Railway)

- [ ] Every Railway variable from the runbook table set
- [ ] One replica, restart on failure (from `railway.json`)
- [ ] Logs show `started`, notifications `ready` (push on, email on), news `ready`
- [ ] Candle backfill finished (chart shows history for every pair)
- [ ] Home shows "Scanner OK" while the market is open
- [ ] Local worker stopped on every laptop (and nobody runs one against production)

## Alarm (cron-job.org)

- [ ] Job every 15 min with `Authorization: Bearer <CRON_SECRET>`; "Test run" returns 200
- [ ] Alarm test: worker stopped while the market is open → one "Scanner stopped" push + email
- [ ] Worker started again → one "Scanner back"

## DG's Android phone

- [ ] Installed from Chrome (Settings → Install Donquixote, or Chrome menu → Install app); Donquixote icon on the home screen
- [ ] Opens full screen from the icon
- [ ] Notifications on (Settings → This device → On); test notification arrives with long vibration
- [ ] Battery set to Unrestricted for the app; sound and vibration on

## Gambino's iPhone

- [ ] Safari → Share → Add to Home Screen; opened from the icon
- [ ] Notifications on from inside the installed app; test notification arrives

## Email and features

- [ ] Test email received (`npm run notify:test` with production variables, or the alarm test)
- [ ] News › Calendar shows upcoming events first (Today, Tomorrow, …) on both phones
- [ ] Ask Claude (chart + summary) opens the share sheet with picture + text on DG's Android
- [ ] Ask Claude (chart + summary) opens the share sheet with picture + text on Gambino's iPhone

## Start of monitoring

- [ ] Paper-trade start date written in `doc/context/progress-tracker.md` → Monitoring period
- [ ] Reminder set to review when each strategy reaches 30 closed paper trades
