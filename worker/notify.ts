// Notification step of the worker cycle (the outbox's second half).
// PENDING is written in the same transaction that makes a LIVE strategy's
// alert READY (scanPairStrategy). This step, run after the commit, decides
// with lib/notify/plan.ts, then for each alert:
// - STALE / NONE: recorded, nothing sent
// - MERGED: joins the open group for that pair + direction, nothing sent
// - send: the alert is claimed in a transaction (still PENDING, unclaimed),
//   push + email go out, then SENT or FAILED is recorded with the counts
// A crash before the claim leaves the alert PENDING → sent next cycle (if
// not stale). A crash after the claim leaves it claimed → FAILED next cycle,
// never sent twice.
import type { Pair } from "@/lib/types";
import { deliverGroup, type NotifyChannels } from "@/lib/notify/deliver";
import { MERGE_WINDOW_MS, planNotifications } from "@/lib/notify/plan";
import { describeError, type Logger } from "./log";
import type { WorkerStore } from "./store";

export interface NotifyReport {
  sent: number;
  merged: number;
  stale: number;
  failed: number;
  skipped: number;
}

const emptyReport = (): NotifyReport => ({ sent: 0, merged: 0, stale: 0, failed: 0, skipped: 0 });

/** Sends what is waiting in the outbox (one pair, or all). Never throws. */
export async function notifyPending(args: {
  store: WorkerStore;
  channels: NotifyChannels;
  now: Date;
  logger: Logger;
  pair?: Pair;
  /** Real time of sending (notifiedAt). Defaults to the wall clock. */
  clock?: () => Date;
}): Promise<NotifyReport> {
  const { store, channels, now, logger } = args;
  const clock = args.clock ?? (() => new Date());
  const at = now.toISOString();
  const report = emptyReport();
  try {
    const pending = await store.loadPendingNotifications(args.pair);
    if (pending.length === 0) return report;

    // Claimed by an earlier run that never finished: delivery unknown, so
    // mark it FAILED rather than risk sending it twice.
    for (const p of pending.filter((x) => x.claimedGroupId !== null)) {
      await store.finishSend(p.id, p.claimedGroupId as string, "FAILED", at, {
        pushSent: 0,
        pushFailed: 0,
        emailSent: 0,
        emailFailed: 0,
      });
      report.failed++;
      logger({ component: "notify", pair: p.pair, alertId: p.id, outcome: "interrupted", message: "claimed by an earlier run that did not finish; not resent" });
    }
    const todo = pending.filter((x) => x.claimedGroupId === null);
    const byId = new Map(todo.map((p) => [p.id, p]));

    const groups = await store.loadRecentGroups(new Date(now.getTime() - MERGE_WINDOW_MS).toISOString());
    // Only LIVE strategies' alerts are ever PENDING: the mode at READY was LIVE.
    const actions = planNotifications({
      alerts: todo.map((p) => ({ ...p, modeAtReady: "LIVE" as const })),
      groups,
      now,
    });

    const settings = await store.loadSettings();
    const groupIds = new Map<string, string>(); // plan ref → database id
    for (const action of actions) {
      const p = byId.get(action.alertId);
      if (!p) continue;
      try {
        switch (action.kind) {
          case "skip":
            if (await store.setNotifyState(p.id, "NONE", at)) report.skipped++;
            break;
          case "stale":
            if (await store.setNotifyState(p.id, "STALE", at)) {
              report.stale++;
              logger({
                component: "notify",
                pair: p.pair,
                direction: p.direction,
                strategy: p.strategyId,
                alertId: p.id,
                ageMin: Math.round(action.ageMs / 60_000),
                outcome: "stale",
              });
            }
            break;
          case "merge": {
            const groupId = "id" in action.group ? action.group.id : groupIds.get(action.group.ref);
            // The group it would join was not created by this run (another
            // run sent it): leave it PENDING; the next run merges it.
            if (!groupId) break;
            if (await store.mergeIntoGroup(p.id, groupId, p.strategyId, at)) {
              report.merged++;
              logger({ component: "notify", pair: p.pair, direction: p.direction, strategy: p.strategyId, alertId: p.id, groupId, outcome: "merged" });
            }
            break;
          }
          case "send": {
            const groupId = await store.claimForSend(p.id, {
              pair: p.pair,
              direction: p.direction,
              strategyId: p.strategyId,
              createdAt: at,
            });
            if (!groupId) break; // already handled elsewhere: never send twice
            groupIds.set(action.group.ref, groupId);
            const pushTargets = settings.pushEnabled && channels.push ? await store.loadPushTargets() : [];
            const result = await deliverGroup({
              content: p.content,
              groupId,
              channels,
              pushEnabled: settings.pushEnabled,
              emailEnabled: settings.emailEnabled,
              pushTargets,
            });
            const counts = {
              pushSent: result.pushSent,
              pushFailed: result.pushFailed,
              emailSent: result.emailSent,
              emailFailed: result.emailFailed,
            };
            const delivered = result.pushSent + result.emailSent > 0;
            const sentAt = clock().toISOString();
            await store.finishSend(p.id, groupId, delivered ? "SENT" : "FAILED", sentAt, counts);
            await store.applyPushOutcomes(result.pushOutcomes, sentAt).catch((error: unknown) =>
              logger({ component: "notify", step: "subscriptions", outcome: "error", error: describeError(error) }),
            );
            if (delivered) report.sent++;
            else report.failed++;
            logger({
              component: "notify",
              pair: p.pair,
              direction: p.direction,
              strategies: p.strategyId,
              alertId: p.id,
              groupId,
              ...counts,
              ms: result.ms,
              outcome: delivered ? "sent" : "failed",
              ...(result.errors.length > 0 && { errors: [...new Set(result.errors)].slice(0, 5).join("; ") }),
              ...(!channels.push && { push: "not configured" }),
              ...(!channels.email && { email: "not configured" }),
            });
            break;
          }
        }
      } catch (error) {
        report.failed++;
        logger({ component: "notify", pair: p.pair, alertId: p.id, outcome: "error", error: describeError(error) });
      }
    }
  } catch (error) {
    logger({ component: "notify", ...(args.pair && { pair: args.pair }), outcome: "error", error: describeError(error) });
  }
  return report;
}
