import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import {
  AskClaudeCard,
  ChartCard,
  DecisionSection,
  DetailHeader,
  NewsWarningSlot,
  PaperCard,
  RulesCard,
  TicketCard,
} from "@/components/alert-detail/sections";
import { BackLink } from "@/components/back-link";
import { requireAllowedUser } from "@/lib/auth";
import { getAlert } from "@/lib/data";

export const metadata: Metadata = { title: "Alert" };

export default async function AlertDetailPage({ params }: PageProps<"/alerts/[id]">) {
  // Live data and the current time: always render at request time.
  await connection();
  await requireAllowedUser();
  const { id } = await params;
  const alert = await getAlert(id);
  if (!alert) notFound();
  const now = new Date();
  return (
    <div className="flex flex-col gap-[14px]">
      <BackLink href="/alerts" label="Alerts" />
      <DetailHeader alert={alert} />
      <NewsWarningSlot />
      <ChartCard alert={alert} />
      <RulesCard alert={alert} />
      <TicketCard alert={alert} />
      <PaperCard alert={alert} now={now} />
      <AskClaudeCard alert={alert} />
      <DecisionSection alert={alert} />
    </div>
  );
}
