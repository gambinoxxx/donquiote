"use client";

// News — doc/design/news.html. Calendar (red events, currency chips, day
// groups in Lagos time, countdowns, actual vs forecast) and Headlines (High
// only / All, source, time ago, link, currencies), then the news toggles.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { setNewsSetting } from "@/lib/data/settings-actions";
import { formatClock, formatWhen } from "@/lib/data/format";
import type { NewsDayGroup, NewsPageData } from "@/lib/data";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useToast } from "@/components/toast";
import { Countdown } from "./countdown";
import { NewsBanner } from "./news-banner";

const CURRENCIES = ["ALL", "USD", "EUR", "GBP", "JPY", "CAD", "CHF"] as const;
type Tab = "cal" | "heads";

const chip = (on: boolean) =>
  cn(
    "h-9 flex-none rounded-[18px] border px-3.5 text-[13px] font-semibold",
    on ? "border-accent bg-accent text-on-accent" : "border-input bg-surface text-foreground",
  );

const Ccy = ({ c }: { c: string }) => (
  <span className="inline-flex h-[22px] min-w-10 items-center justify-center rounded-md bg-chip px-1.5 font-mono text-xs font-semibold">{c}</span>
);
const RedDot = () => <span className="h-2 w-2 flex-none rounded-full bg-news-dot" aria-label="High impact" role="img" />;

export function NewsView({ data }: { data: NewsPageData }) {
  const [tab, setTab] = useState<Tab>("cal");
  const now = new Date(data.now);
  useEffect(() => {
    const sync = () => setTab(window.location.hash === "#headlines" ? "heads" : "cal");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function pick(t: Tab) {
    setTab(t);
    history.replaceState(null, "", t === "heads" ? "#headlines" : window.location.pathname);
  }

  return (
    <>
      <NewsBanner banner={data.banner} link={false} />
      <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-surface p-1" role="group" aria-label="News view">
        {(
          [
            ["cal", "Calendar"],
            ["heads", "Headlines"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={tab === v}
            onClick={() => pick(v)}
            className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold", tab === v ? "bg-accent text-on-accent" : "text-soft")}
          >
            {label}
            {v === "heads" && data.freshHigh > 0 && <RedDot />}
          </button>
        ))}
      </div>

      {tab === "cal" ? <Calendar data={data} now={now} /> : <Headlines data={data} now={now} />}

      <NewsSettings data={data} />
      <p className="text-xs leading-normal text-muted">
        Headlines arrive a few minutes after they happen. Use them to stay out, not to jump in.
        {data.sources.status && (
          <>
            {" "}
            Sources: {data.sources.status}
            {data.sources.checkedAt && ` (checked ${formatWhen(data.sources.checkedAt, now)})`}.
          </>
        )}
      </p>
    </>
  );
}

function Calendar({ data, now }: { data: NewsPageData; now: Date }) {
  const [ccy, setCcy] = useState<(typeof CURRENCIES)[number]>("ALL");
  const pick = (groups: NewsDayGroup[]) =>
    groups.map((d) => ({ ...d, events: d.events.filter((e) => ccy === "ALL" || e.currency === ccy) })).filter((d) => d.events.length > 0);
  const upcoming = pick(data.calendar.upcoming);
  const earlier = pick(data.calendar.earlier);
  return (
    <section className="flex flex-col gap-4" aria-label="Calendar">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Currency">
        {CURRENCIES.map((c) => (
          <button key={c} type="button" aria-pressed={ccy === c} onClick={() => setCcy(c)} className={chip(ccy === c)}>
            {c === "ALL" ? "All" : c}
          </button>
        ))}
      </div>
      {!data.calendar.hasActuals && (upcoming.length > 0 || earlier.length > 0) && (
        <p className="ml-1 text-xs text-muted">Actual not available from this feed.</p>
      )}
      {upcoming.length === 0 && (
        <p className="rounded-2xl border border-default bg-surface p-4 text-center text-sm text-muted">
          {ccy === "ALL" ? "No upcoming red news." : `No upcoming red news for ${ccy}.`}
        </p>
      )}
      {upcoming.map((d) => (
        <DayGroup key={d.day} group={d} now={now} serverNow={data.now} />
      ))}
      {earlier.length > 0 && (
        <details className="group flex flex-col gap-2">
          <summary className="ml-1 flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
            Earlier this week ({earlier.reduce((n, d) => n + d.events.length, 0)})
          </summary>
          <div className="mt-2 flex flex-col gap-4">
            {earlier.map((d) => (
              <DayGroup key={d.day} group={d} now={now} serverNow={data.now} />
            ))}
          </div>
        </details>
      )}
      <p className="text-xs leading-normal text-muted">
        Red (high-impact) events only, times in Lagos. Actual figures show when the calendar feed has them; above /
        below forecast is coloured blue / orange, not good or bad.
      </p>
    </section>
  );
}

function DayGroup({ group, now, serverNow }: { group: NewsDayGroup; now: Date; serverNow: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">{group.label}</h2>
      <ul className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        {group.events.map((e) => {
          const past = Date.parse(e.time) <= now.getTime();
          const figures = [
            e.actual && { label: "Actual", value: e.actual, tone: e.vsForecast },
            { label: "Forecast", value: e.forecast ?? "—" },
            { label: "Prev", value: e.previous ?? "—" },
          ].filter(Boolean) as Array<{ label: string; value: string; tone?: string | null }>;
          const noFigures = !e.actual && !e.forecast && !e.previous;
          return (
            <li key={e.id} className={cn("flex items-start gap-3 p-[14px]", past && !e.actual && "opacity-60")}>
              <span className="w-12 flex-none pt-px font-mono text-[13px] font-semibold">{formatClock(e.time)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <RedDot />
                  <Ccy c={e.currency} />
                  <span className="min-w-0 font-semibold">{e.title}</span>
                </p>
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {noFigures ? (
                    <span>No figures</span>
                  ) : (
                    figures.map((f) => (
                      <span key={f.label}>
                        {f.label}{" "}
                        <b
                          className={cn(
                            "font-mono font-semibold text-foreground",
                            f.tone === "above" && "text-buy",
                            f.tone === "below" && "text-sell",
                          )}
                          title={f.tone ? `${f.tone === "inline" ? "In line with" : f.tone === "above" ? "Above" : "Below"} forecast` : undefined}
                        >
                          {f.value}
                        </b>
                      </span>
                    ))
                  )}
                </p>
              </div>
              {!past && <Countdown time={e.time} serverNow={serverNow} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Headlines({ data, now }: { data: NewsPageData; now: Date }) {
  const [highOnly, setHighOnly] = useState(true);
  const list = highOnly ? data.headlines.filter((h) => h.impact === "HIGH") : data.headlines;
  return (
    <section className="flex flex-col gap-3" aria-label="Headlines">
      <div className="flex gap-2" role="group" aria-label="Impact">
        <button type="button" aria-pressed={highOnly} onClick={() => setHighOnly(true)} className={chip(highOnly)}>
          High only
        </button>
        <button type="button" aria-pressed={!highOnly} onClick={() => setHighOnly(false)} className={chip(!highOnly)}>
          All
        </button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-default bg-surface p-4 text-center text-sm text-muted">
          {highOnly ? "No high-impact headlines in the last few days." : "No headlines yet."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
          {list.map((h) => {
            const high = h.impact === "HIGH";
            const fresh = high && now.getTime() - Date.parse(h.publishedAt) <= 15 * 60_000;
            return (
              <li key={h.id}>
                <a
                  href={h.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col gap-2 p-[14px] text-foreground no-underline active:bg-pressed"
                >
                  <span className="flex w-full items-center gap-2 text-xs">
                    {high && <RedDot />}
                    {high && <span className="font-bold text-news-label">HIGH</span>}
                    <span className="truncate text-muted">{h.sourceLabel}</span>
                    <span className="ml-auto flex-none font-mono text-muted">{formatWhen(h.publishedAt, now)}</span>
                  </span>
                  <span className="flex items-start gap-2 font-semibold">
                    <span className="min-w-0 flex-1">{h.title}</span>
                    <ExternalLink className="mt-0.5 h-4 w-4 flex-none text-muted" aria-label="Opens the original in a new tab" />
                  </span>
                  {h.currencies.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {h.currencies.map((c) => (
                        <Ccy key={c} c={c} />
                      ))}
                      {fresh && <span className="text-xs text-muted">· alerts on these get a news warning for 15 min</span>}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NewsSettings({ data }: { data: NewsPageData }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(data.settings);
  const [pending, setPending] = useState<string | null>(null);

  async function change(key: "newsPushCalendar" | "newsPushHeadlines", value: boolean) {
    setPending(key);
    setValues((v) => ({ ...v, [key]: value }));
    try {
      const r = await setNewsSetting(key, value, data.versionId);
      if (!r.ok) {
        setValues((v) => ({ ...v, [key]: !value }));
        toast(r.error);
        return;
      }
      toast("Saved");
      router.refresh();
    } catch {
      setValues((v) => ({ ...v, [key]: !value }));
      toast("Could not save. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  const rows = [
    { key: "newsPushCalendar" as const, label: "Remind me before red news", hint: "Phone reminder 15 min before, for currencies on your watchlist" },
    { key: "newsPushHeadlines" as const, label: "Alert me on High headlines", hint: "Presidential posts, White House, central banks · at most one every 10 min" },
  ];
  return (
    <section className="flex flex-col gap-1.5" aria-label="News settings">
      <h2 className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">News alerts</h2>
      <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        {rows.map((r) => (
          <div key={r.key} className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2">
            <div>
              <p>{r.label}</p>
              <p className="text-xs text-muted">{r.hint}</p>
            </div>
            <ToggleSwitch checked={values[r.key]} onChange={(v) => change(r.key, v)} label={r.label} disabled={pending !== null} />
          </div>
        ))}
      </div>
      {!data.settings.pushEnabled && <p className="ml-1 text-xs text-muted">App alerts are off in Settings, so no news pushes are sent.</p>}
      <p className="ml-1 text-xs text-muted">News pushes go to your phone only (no email) and never change alerts or the risk guard.</p>
    </section>
  );
}
