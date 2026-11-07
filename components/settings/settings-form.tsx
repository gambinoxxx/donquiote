"use client";

// Settings form — doc/design/settings.html. One Save for everything; saves
// through saveSettings (one transaction + a Change history version).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/lib/data/settings-actions";
import type { SettingsSnapshot, SettingsValues } from "@/lib/data/types";
import { validate } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { PendingButton } from "@/components/pending-button";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useToast } from "@/components/toast";
import type { ReactNode } from "react";

type NumberKey = {
  [K in keyof SettingsValues]: SettingsValues[K] extends number ? K : never;
}[keyof SettingsValues];
type BoolKey = {
  [K in keyof SettingsValues]: SettingsValues[K] extends boolean ? K : never;
}[keyof SettingsValues];

/** Prop firm day: common reset zones (the hour is a number field). */
const RESET_ZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/New_York", label: "New York" },
  { value: "Europe/London", label: "London" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/Prague", label: "Prague" },
  { value: "Africa/Lagos", label: "Lagos" },
];

interface Field {
  key: NumberKey;
  label: string;
  /** Shown before / after the number. */
  prefix?: string;
  suffix?: string;
  mode: "decimal" | "numeric";
}

const SECTIONS: ReadonlyArray<{ title: string; note?: string; fields: readonly Field[] }> = [
  {
    title: "Trading account",
    fields: [
      { key: "accountSizeUsd", label: "Account size", prefix: "$", mode: "decimal" },
      { key: "riskPct", label: "Risk per trade", suffix: "%", mode: "decimal" },
    ],
  },
  {
    title: "Prop firm limits",
    fields: [
      { key: "dailyLossLimitPct", label: "Daily loss limit", suffix: "%", mode: "decimal" },
      { key: "maxDrawdownPct", label: "Max drawdown", suffix: "%", mode: "decimal" },
    ],
  },
  {
    title: "Risk guard",
    note: "Based only on the trades you log in the Journal. Today starts at your prop firm's reset time. Static drawdown is measured from your account size; trailing from your highest closed balance.",
    fields: [
      { key: "warnDailyLossPct", label: "Warn me at (today)", prefix: "−", suffix: "%", mode: "decimal" },
      { key: "stopDailyLossPct", label: "Done for the day at", prefix: "−", suffix: "%", mode: "decimal" },
      { key: "warnOverallLossPct", label: "Warn me at (overall)", prefix: "−", suffix: "%", mode: "decimal" },
      { key: "maxTradesPerDay", label: "Max trades per day", mode: "numeric" },
      { key: "dayResetHour", label: "Prop day starts at", suffix: ":00", mode: "numeric" },
    ],
  },
  {
    title: "Strategy numbers · DG v1",
    note: "Changes apply to new setups only. DG v2 uses the same numbers; the other strategies have fixed rules.",
    fields: [
      { key: "stopBufferPips", label: "Stop buffer", suffix: "pips", mode: "decimal" },
      { key: "watchExpiryMinutes", label: "Setup expires after", suffix: "min", mode: "numeric" },
      { key: "equalTolerancePips", label: "Equal highs/lows tolerance", suffix: "pips", mode: "decimal" },
      { key: "swingStrength", label: "Swing strength", suffix: "candles", mode: "numeric" },
    ],
  },
  {
    title: "Paper trades",
    fields: [{ key: "paperTimeoutHours", label: "Time limit before Unresolved", suffix: "h", mode: "numeric" }],
  },
  {
    title: "News",
    note: "Home shows a red banner this long before red calendar news. News only warns: it never changes alerts or the risk guard.",
    fields: [{ key: "newsWarnMinutes", label: "Red news banner from", suffix: "min", mode: "numeric" }],
  },
];

const TOGGLES: ReadonlyArray<{ key: BoolKey; label: string; hint: string }> = [
  { key: "pushEnabled", label: "App alert", hint: "Push to every device that turned notifications on" },
  { key: "emailEnabled", label: "Email backup", hint: "Sent to every allowed email" },
  { key: "newsPushCalendar", label: "Remind me before red news", hint: "Phone reminder 15 min before" },
  { key: "newsPushHeadlines", label: "Alert me on High headlines", hint: "At most one every 10 min; push only" },
];

type Draft = Record<NumberKey, string>;

function toDraft(s: SettingsValues): Draft {
  const out = {} as Draft;
  for (const section of SECTIONS) for (const f of section.fields) out[f.key] = String(s[f.key]);
  return out;
}

/** Parses the text inputs; empty or invalid text stays NaN so validation reports it. */
function toValues(
  base: SettingsValues,
  draft: Draft,
  toggles: Record<BoolKey, boolean>,
  choices: Pick<SettingsValues, "dayResetTz" | "drawdownType">,
): SettingsValues {
  const out: SettingsValues = { ...base, ...toggles, ...choices };
  for (const key of Object.keys(draft) as NumberKey[]) {
    const text = (draft[key] ?? "").replace(/[,\s$%]/g, "");
    out[key] = text === "" ? Number.NaN : Number(text);
  }
  return out;
}

export function SettingsForm({ initial, versionId, children }: { initial: SettingsSnapshot; versionId: string | null; children?: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial.settings));
  const [toggles, setToggles] = useState<Record<BoolKey, boolean>>({
    pushEnabled: initial.settings.pushEnabled,
    emailEnabled: initial.settings.emailEnabled,
    watchingPushEnabled: initial.settings.watchingPushEnabled,
    newsPushCalendar: initial.settings.newsPushCalendar,
    newsPushHeadlines: initial.settings.newsPushHeadlines,
  });
  const [choices, setChoices] = useState<Pick<SettingsValues, "dayResetTz" | "drawdownType">>({
    dayResetTz: initial.settings.dayResetTz,
    drawdownType: initial.settings.drawdownType,
  });
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ text: string; stale?: boolean } | null>(null);
  const [touched, setTouched] = useState(false);

  const next: SettingsSnapshot = useMemo(
    () => ({ ...initial, settings: toValues(initial.settings, draft, toggles, choices) }),
    [initial, draft, toggles, choices],
  );
  const dirty = JSON.stringify(next.settings) !== JSON.stringify(initial.settings);
  const check = useMemo(() => validate(next), [next]);
  const errors: Record<string, string> = { ...serverErrors };
  if (!check.ok && touched) for (const e of check.errors) errors[e.path] ??= e.message;

  // Unsaved changes: ask before leaving (reload / close, and in-app links).
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  async function save() {
    setTouched(true);
    setBanner(null);
    setServerErrors({});
    if (!check.ok) {
      setBanner({ text: "Fix the highlighted values first." });
      return;
    }
    setPending(true);
    try {
      const result = await saveSettings(next, versionId);
      if (!result.ok) {
        if (result.fieldErrors) setServerErrors(Object.fromEntries(result.fieldErrors.map((e) => [e.path, e.message])));
        setBanner({ text: result.error, stale: result.stale });
        return;
      }
      if ("noChanges" in result) {
        toast("No changes");
        return;
      }
      toast("Saved. Applies from the next scan.");
      router.refresh();
    } catch {
      setBanner({ text: "Could not save. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-1.5">
          <h2 className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">{section.title}</h2>
          <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
            {section.fields.map((f) => {
              const error = errors[`settings.${f.key}`];
              return (
                <div key={f.key} className="flex flex-col px-3.5 py-1.5">
                  <div className="flex min-h-[40px] items-center justify-between gap-3">
                    <label htmlFor={f.key}>{f.label}</label>
                    <div className="flex items-center gap-1.5">
                      {f.prefix && <span className="font-mono text-sm text-muted">{f.prefix}</span>}
                      <input
                        id={f.key}
                        inputMode={f.mode}
                        value={draft[f.key]}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${f.key}-error` : undefined}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                          setServerErrors((s) => {
                            const rest = { ...s };
                            delete rest[`settings.${f.key}`];
                            return rest;
                          });
                        }}
                        onBlur={() => setTouched(true)}
                        className={cn(
                          "h-10 w-24 rounded-lg border bg-base px-2.5 text-right font-mono text-sm text-foreground outline-none focus:border-accent",
                          error ? "border-[var(--state-error)]" : "border-input",
                        )}
                      />
                      {f.suffix && <span className="w-[52px] font-mono text-xs text-muted">{f.suffix}</span>}
                    </div>
                  </div>
                  {error && (
                    <p id={`${f.key}-error`} className="pb-1 text-xs text-error">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
            {section.title === "Risk guard" && (
              <>
                <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-1.5">
                  <label htmlFor="dayResetTz">Prop day time zone</label>
                  <select
                    id="dayResetTz"
                    value={choices.dayResetTz}
                    onChange={(e) => setChoices((c) => ({ ...c, dayResetTz: e.target.value }))}
                    className="h-10 rounded-lg border border-input bg-base px-2.5 text-sm text-foreground"
                  >
                    {[...RESET_ZONES, ...(RESET_ZONES.some((z) => z.value === choices.dayResetTz) ? [] : [{ value: choices.dayResetTz, label: choices.dayResetTz }])].map((z) => (
                      <option key={z.value} value={z.value}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-1.5">
                  <span id="dd-label">Max drawdown</span>
                  <div className="inline-flex gap-1 rounded-[10px] bg-base p-[3px]" role="group" aria-labelledby="dd-label">
                    {(["STATIC", "TRAILING"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={choices.drawdownType === v}
                        onClick={() => setChoices((c) => ({ ...c, drawdownType: v }))}
                        className={cn(
                          "h-[34px] min-w-[72px] rounded-lg px-2.5 text-[13px] font-semibold",
                          choices.drawdownType === v ? "bg-accent text-on-accent" : "text-soft",
                        )}
                      >
                        {v === "STATIC" ? "Static" : "Trailing"}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {section.title === "Trading account" && (
              <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-1.5">
                <span>Risk to reward</span>
                <span className="font-mono text-sm text-soft">1:{initial.settings.rewardRatio} fixed</span>
              </div>
            )}
          </div>
          {section.note && <p className="ml-1 text-xs text-muted">{section.note}</p>}
        </section>
      ))}

      <section className="flex flex-col gap-1.5">
        <h2 className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Notifications</h2>
        <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-1.5">
              <div>
                <p>{t.label}</p>
                <p className="text-xs text-muted">{t.hint}</p>
              </div>
              <ToggleSwitch checked={toggles[t.key]} onChange={(v) => setToggles((s) => ({ ...s, [t.key]: v }))} label={t.label} />
            </div>
          ))}
        </div>
      </section>
      {children}

      <div className="sticky bottom-[calc(var(--tab-bar-height)+12px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2">
        {banner && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-[var(--state-error)] bg-surface px-3.5 py-2.5 text-sm text-error">
            <span>{banner.text}</span>
            {banner.stale && (
              <button type="button" onClick={() => window.location.reload()} className="flex-none font-semibold underline">
                Reload
              </button>
            )}
          </div>
        )}
        <PendingButton
          type="button"
          pending={pending}
          pendingLabel="Saving…"
          disabled={!dirty}
          onClick={save}
          className="h-[52px] w-full rounded-xl bg-accent font-bold text-on-accent shadow-[0_-8px_24px_var(--bg-base)] disabled:opacity-50"
        >
          {dirty ? "Save changes" : "No changes to save"}
        </PendingButton>
      </div>
    </>
  );
}
