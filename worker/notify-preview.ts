// npm run notify:preview -- --alert <id>
// Prints the push payload and the email (subject + text) for an alert,
// as the worker would send them. Sends nothing; writes nothing.
import "./load-env";
import { parseArgs } from "node:util";
import { getDb } from "@/lib/db/client";
import { getNotifyConfig } from "@/lib/notify/config";
import { emailContent, pushPayload } from "@/lib/notify/format";

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { alert: { type: "string" } } });
  if (!values.alert) {
    console.error("pass --alert <id>");
    return 1;
  }
  const a = await getDb().alert.findUnique({ where: { id: values.alert }, include: { notifyGroup: true } });
  if (!a) {
    console.error(`No alert with id ${values.alert}`);
    return 1;
  }
  if (a.readyAt === null || a.entry === null || a.stop === null || a.target === null) {
    console.error(`Alert ${a.id} is ${a.status}: only alerts that reached READY have a notification.`);
    return 1;
  }
  const content = {
    id: a.id,
    pair: a.pair,
    direction: a.direction,
    strategyIds: a.notifyGroup?.strategyIds.length ? a.notifyGroup.strategyIds : [a.strategyId],
    entry: a.entry,
    stop: a.stop,
    target: a.target,
    lotSize: a.lotSize ?? 0,
    riskUsd: a.riskUsd ?? 0,
    sweepType: a.sweepType,
    sweepLevel: a.sweepLevel,
    bosLevel: a.bosLevel,
    entryType: a.entryType,
    readyAt: a.readyAt.toISOString(),
    entryValidUntil: a.entryValidUntil?.toISOString() ?? null,
  };
  const groupId = a.notifyGroupId ?? "(group id, set when sent)";
  const email = emailContent(content, getNotifyConfig().channels.appUrl);

  console.log(`Alert ${a.id} · ${a.strategyId} · ${a.status} · notify ${a.notifyState}\n`);
  console.log("Push payload:");
  console.log(JSON.stringify(pushPayload(content, groupId), null, 2));
  console.log(`\nEmail subject: ${email.subject}\n`);
  console.log(email.text);
  console.log("\n(nothing was sent)");
  return 0;
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
