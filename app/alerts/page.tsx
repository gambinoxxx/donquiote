import type { Metadata } from "next";
import { connection } from "next/server";
import { AlertsBrowser } from "@/components/alerts/alerts-browser";
import { PageHeader } from "@/components/page-header";
import { requireAllowedUser } from "@/lib/auth";
import { getAlerts, parsePair } from "@/lib/data";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/data/types";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  // Live data and the current time: always render at request time.
  await connection();
  await requireAllowedUser();
  const params = await searchParams;
  const raw = typeof params.status === "string" ? params.status : "all";
  const status: StatusFilter = STATUS_FILTERS.includes(raw as StatusFilter) ? (raw as StatusFilter) : "all";
  const pair = parsePair(typeof params.pair === "string" ? params.pair : undefined);
  // Test signals are off by default; the browser switches them on if remembered.
  const initial = await getAlerts({ status, includeTest: false, pair });
  return (
    <>
      <PageHeader eyebrow="Newest first · Lagos time" title="Alerts" />
      <AlertsBrowser initial={initial} initialStatus={status} pair={pair} now={new Date().toISOString()} />
    </>
  );
}
