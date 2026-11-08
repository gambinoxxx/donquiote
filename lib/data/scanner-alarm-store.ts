// Prisma storage and real senders for the "Scanner stopped" alarm. Server-only.
import "server-only";
import { getDb } from "@/lib/db/client";
import { getNotifyConfig } from "@/lib/notify/config";
import { sendEmailToAll } from "@/lib/notify/email";
import { sendPushToAll } from "@/lib/notify/push";
import { recordPushResults } from "./push-subscriptions";
import type { ScannerCheckDeps } from "./scanner-alarm";

const ALARM_ID = 1;
const HEARTBEAT_ID = 1;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function prismaScannerCheckDeps(): ScannerCheckDeps {
  const db = getDb();
  const config = getNotifyConfig();
  return {
    appUrl: config.channels.appUrl,
    async loadHeartbeat() {
      const h = await db.workerHeartbeat.findUnique({ where: { id: HEARTBEAT_ID } });
      return h ? { lastScanAt: iso(h.lastScanAt), lastOkAt: iso(h.lastOkAt), status: h.status, message: h.message } : null;
    },
    async loadAlarm() {
      const a = await db.scannerAlarm.upsert({ where: { id: ALARM_ID }, create: { id: ALARM_ID }, update: {} });
      return { stoppedAt: iso(a.stoppedAt), lastOkAtWhenStopped: iso(a.lastOkAtWhenStopped) };
    },
    async claimRaise(at, lastOkAt) {
      const { count } = await db.scannerAlarm.updateMany({
        where: { id: ALARM_ID, stoppedAt: null },
        data: { stoppedAt: new Date(at), lastOkAtWhenStopped: lastOkAt ? new Date(lastOkAt) : null },
      });
      return count === 1;
    },
    async claimRecover(stoppedAt, at) {
      const { count } = await db.scannerAlarm.updateMany({
        where: { id: ALARM_ID, stoppedAt: new Date(stoppedAt) },
        data: { stoppedAt: null, lastOkAtWhenStopped: null, lastRecoveredAt: new Date(at) },
      });
      return count === 1;
    },
    async markChecked(at) {
      await db.scannerAlarm.update({ where: { id: ALARM_ID }, data: { checkedAt: new Date(at) } });
    },
    async send(message) {
      const { channels, problems } = config;
      let push = 0;
      let email = 0;
      const out = [...problems];
      if (channels.push) {
        const targets = await db.pushSubscription.findMany({ select: { id: true, endpoint: true, p256dh: true, auth: true, failCount: true } });
        const outcomes = await sendPushToAll(targets, message.push, channels.push.client);
        await recordPushResults(outcomes).catch(() => {});
        push = outcomes.filter((o) => o.result === "ok").length;
        if (targets.length === 0) out.push("push: no subscribed devices");
      }
      if (channels.email) {
        const r = await sendEmailToAll(channels.email.recipients, message.email, channels.email.from, channels.email.client);
        email = r.sent;
        out.push(...r.errors.map((e) => `email: ${e}`));
      }
      return { push, email, problems: out };
    },
  };
}
