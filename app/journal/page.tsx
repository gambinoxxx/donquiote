import type { Metadata } from "next";
import { connection } from "next/server";
import { JournalView } from "@/components/journal/journal-view";
import { PageHeader } from "@/components/page-header";
import { requireAllowedUser } from "@/lib/auth";
import { getJournal, getSignals } from "@/lib/data";
import { JOURNAL_PERIODS, PERIOD_LABEL, type JournalPeriod } from "@/lib/data/journal-logic";

export const metadata: Metadata = { title: "Journal" };

export default async function JournalPage({ searchParams }: PageProps<"/journal">) {
  // Live data and the current time: always render at request time.
  await connection();
  await requireAllowedUser();
  const raw = (await searchParams).period;
  const period: JournalPeriod = JOURNAL_PERIODS.includes(raw as JournalPeriod) ? (raw as JournalPeriod) : "7d";
  const now = new Date();
  const [journal, signals] = await Promise.all([getJournal({ period }, now), getSignals({ period }, now)]);
  return (
    <>
      <PageHeader eyebrow={`${PERIOD_LABEL[period]} · Lagos time`} title="Journal" />
      <JournalView journal={journal} signals={signals} now={now.toISOString()} />
    </>
  );
}
