// GET /api/cron/scanner-check — the "Scanner stopped" alarm, called every 15
// minutes by cron-job.org with `Authorization: Bearer <CRON_SECRET>`.
// Public in proxy.ts (no Clerk session); this secret is the only access
// check. Returns { ok: true, data } or { ok: false, error }. Never logs or
// echoes the secret.
import { getServerEnv } from "@/lib/env";
import { checkScanner, isCronAuthorized } from "@/lib/data/cron";

export async function GET(request: Request): Promise<Response> {
  const secret = getServerEnv().cronSecret;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await checkScanner(new Date());
    return Response.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ component: "scanner-check", outcome: "error", error: error instanceof Error ? error.message : "error" }));
    return Response.json({ ok: false, error: "Check failed" }, { status: 500 });
  }
}
