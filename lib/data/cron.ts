// Entry points for the cron route (app/ may only use lib/data).
import "server-only";
import { isAuthorized, runScannerCheck, type ScannerCheckResult } from "./scanner-alarm";
import { prismaScannerCheckDeps } from "./scanner-alarm-store";

export const isCronAuthorized = isAuthorized;

export function checkScanner(now: Date): Promise<ScannerCheckResult> {
  return runScannerCheck(now, prismaScannerCheckDeps());
}
