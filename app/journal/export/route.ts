// CSV download for the Journal: ?kind=trades|signals&period=7d|30d|month|all.
import { NotAllowedError, requireAllowedUser } from "@/lib/auth";
import { exportCsv } from "@/lib/data";
import { JOURNAL_PERIODS, type JournalPeriod } from "@/lib/data/journal-logic";

export async function GET(request: Request) {
  try {
    await requireAllowedUser();
  } catch (e) {
    if (e instanceof NotAllowedError) return new Response("Not allowed", { status: 403 });
    throw e;
  }
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "signals" ? "signals" : "trades";
  const raw = params.get("period");
  const period: JournalPeriod = JOURNAL_PERIODS.includes(raw as JournalPeriod) ? (raw as JournalPeriod) : "30d";
  const { filename, csv } = await exportCsv(kind, period);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
