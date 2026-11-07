// Push subscriptions (one row per device). Server-only.
import "server-only";
import { getDb } from "@/lib/db/client";
import type { PushTarget } from "@/lib/notify/push";

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Saves (or refreshes) this device's subscription for `userEmail`. */
export async function upsertPushSubscription(
  sub: DeviceSubscription,
  userEmail: string,
  userAgent: string | null,
): Promise<void> {
  const data = { p256dh: sub.p256dh, auth: sub.auth, userEmail, userAgent, failCount: 0 };
  await getDb().pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, ...data },
    update: data,
  });
}

/** Removes this device's subscription, only if it belongs to `userEmail`. */
export async function deletePushSubscription(endpoint: string, userEmail: string): Promise<number> {
  const { count } = await getDb().pushSubscription.deleteMany({ where: { endpoint, userEmail } });
  return count;
}

/** This user's devices. */
export async function getPushTargetsFor(userEmail: string): Promise<PushTarget[]> {
  return getDb().pushSubscription.findMany({
    where: { userEmail },
    select: { id: true, endpoint: true, p256dh: true, auth: true, failCount: true },
  });
}

/** Bookkeeping after a test push: same rules as the worker. */
export async function recordPushResults(
  outcomes: ReadonlyArray<{ id: string; result: "ok" | "gone" | "failed"; deleteNow?: boolean }>,
): Promise<void> {
  const db = getDb();
  const ok = outcomes.filter((o) => o.result === "ok").map((o) => o.id);
  const remove = outcomes.filter((o) => o.result === "gone" || o.deleteNow).map((o) => o.id);
  const failed = outcomes.filter((o) => o.result === "failed" && !o.deleteNow).map((o) => o.id);
  await db.$transaction([
    db.pushSubscription.updateMany({ where: { id: { in: ok } }, data: { failCount: 0, lastSuccessAt: new Date() } }),
    db.pushSubscription.deleteMany({ where: { id: { in: remove } } }),
    db.pushSubscription.updateMany({ where: { id: { in: failed } }, data: { failCount: { increment: 1 } } }),
  ]);
}
