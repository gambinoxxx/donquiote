"use server";

// Settings › Notifications: save / remove this device's push subscription
// and send a test push to the signed-in user's own devices.
import { z } from "zod";
import { requireAllowedUser } from "@/lib/auth";
import { deletePushSubscription, getPushTargetsFor, recordPushResults, upsertPushSubscription } from "@/lib/db/push-subscriptions";
import { getNotifyConfig } from "@/lib/notify/config";
import { sendPushToAll } from "@/lib/notify/push";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const subscriptionSchema = z.object({
  endpoint: z.url().max(2000).refine((u) => u.startsWith("https://"), "must be https"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function savePushSubscription(input: unknown, userAgent: unknown): Promise<ActionResult> {
  const { email } = await requireAllowedUser();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This browser returned an invalid subscription." };
  const agent = typeof userAgent === "string" ? userAgent.slice(0, 300) : null;
  await upsertPushSubscription(
    { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
    email,
    agent,
  );
  return { ok: true };
}

export async function removePushSubscription(endpoint: unknown): Promise<ActionResult> {
  const { email } = await requireAllowedUser();
  const parsed = z.url().max(2000).safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: "Invalid subscription." };
  await deletePushSubscription(parsed.data, email);
  return { ok: true };
}

/** A test push to the signed-in user's devices only. */
export async function sendTestPush(): Promise<ActionResult> {
  const { email } = await requireAllowedUser();
  const { channels } = getNotifyConfig();
  if (!channels.push) return { ok: false, error: "Push is not set up on the server (VAPID keys missing)." };
  const targets = await getPushTargetsFor(email);
  if (targets.length === 0) return { ok: false, error: "No device is subscribed yet." };
  const outcomes = await sendPushToAll(
    targets,
    {
      title: "Donquixote · Test",
      body: "Notifications work on this device. Real alerts look like: EUR/USD SELL · Ready",
      url: "/settings",
      tag: "test",
    },
    channels.push.client,
  );
  await recordPushResults(outcomes);
  const sent = outcomes.filter((o) => o.result === "ok").length;
  return sent > 0
    ? { ok: true, message: `Sent to ${sent} of ${targets.length} device${targets.length === 1 ? "" : "s"}.` }
    : { ok: false, error: "The push service refused every device. Try turning notifications off and on." };
}
