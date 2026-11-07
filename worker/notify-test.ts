// npm run notify:test
// One test push to every subscribed device and one test email to every
// address in ALLOWED_EMAILS. Prints counts only: never addresses,
// endpoints or keys. Subscriptions that are gone (404/410) are removed.
import "./load-env";
import { getDb } from "@/lib/db/client";
import { getNotifyConfig } from "@/lib/notify/config";
import { sendEmailToAll } from "@/lib/notify/email";
import { SAFETY_LINE } from "@/lib/notify/format";
import { sendPushToAll } from "@/lib/notify/push";
import { PrismaStore } from "./store-prisma";

async function main(): Promise<number> {
  const config = getNotifyConfig();
  const { channels } = config;
  for (const problem of config.problems) console.log(`! ${problem}`);
  const store = new PrismaStore();
  const settings = await store.loadSettings();
  const sentAt = new Date().toISOString();
  let delivered = 0;

  // Push
  if (!channels.push) {
    console.log("Push: not configured — skipped");
  } else {
    const targets = await store.loadPushTargets();
    if (!settings.pushEnabled) console.log("Push: note — turned off in Settings (sent anyway: this is a test)");
    if (targets.length === 0) {
      console.log("Push: no subscribed devices (Settings › Notifications › Enable on this device)");
    } else {
      const outcomes = await sendPushToAll(
        targets,
        {
          title: "Donquixote · Test",
          body: `Push works. Sent ${sentAt.slice(11, 19)} UTC by npm run notify:test`,
          url: "/settings",
          tag: "test",
        },
        channels.push.client,
      );
      await store.applyPushOutcomes(outcomes, sentAt);
      const ok = outcomes.filter((o) => o.result === "ok").length;
      const gone = outcomes.filter((o) => o.result === "gone").length;
      const failed = outcomes.filter((o) => o.result === "failed");
      delivered += ok;
      console.log(
        `Push: ${ok} sent, ${failed.length} failed, ${gone} expired and removed (of ${targets.length} device${targets.length === 1 ? "" : "s"})`,
      );
      for (const f of failed) if (f.result === "failed") console.log(`  failure: ${f.error}`);
    }
  }

  // Email
  if (!channels.email) {
    console.log("Email: not configured — skipped");
  } else {
    if (!settings.emailEnabled) console.log("Email: note — turned off in Settings (sent anyway: this is a test)");
    const subject = "Donquixote · Test email";
    const text = `Email alerts work.\nSent ${sentAt} by npm run notify:test.\n\n${SAFETY_LINE}`;
    const result = await sendEmailToAll(
      channels.email.recipients,
      {
        subject,
        text,
        html: `<p>Email alerts work.</p><p>Sent ${sentAt} by <code>npm run notify:test</code>.</p><p style="color:#9AA3AE">${SAFETY_LINE}</p>`,
      },
      channels.email.from,
      channels.email.client,
    );
    delivered += result.sent;
    console.log(`Email: ${result.sent} sent, ${result.failed} failed (of ${channels.email.recipients.length} allowed address${channels.email.recipients.length === 1 ? "" : "es"})`);
    for (const e of [...new Set(result.errors)]) console.log(`  failure: ${e}`);
  }
  return delivered > 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect().catch(() => {});
  });
