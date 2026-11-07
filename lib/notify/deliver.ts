// Sends one notification group: push to every device and email to every
// allowed address, in parallel. One channel failing never blocks the other,
// and nothing here throws (the worker cycle must keep going).
import { sendEmailToAll, type EmailClient } from "./email";
import { emailContent, pushPayload, type NotifyContent } from "./format";
import { sendPushToAll, type PushClient, type PushOutcome, type PushTarget } from "./push";

/** How to reach people; a channel is null when its keys are not configured. */
export interface NotifyChannels {
  /** Absolute app URL for links in emails, e.g. http://localhost:3000. */
  appUrl: string;
  push: { client: PushClient } | null;
  email: { client: EmailClient; from: string; recipients: readonly string[] } | null;
}

export interface DeliveryInput {
  content: NotifyContent;
  groupId: string;
  channels: NotifyChannels;
  /** Settings toggles. */
  pushEnabled: boolean;
  emailEnabled: boolean;
  pushTargets: readonly PushTarget[];
  timeoutMs?: number;
}

export interface DeliveryResult {
  pushSent: number;
  pushFailed: number;
  emailSent: number;
  emailFailed: number;
  /** Per subscription, for failCount / delete bookkeeping. */
  pushOutcomes: PushOutcome[];
  /** Short reasons (no addresses, no endpoints). */
  errors: string[];
  ms: number;
}

export async function deliverGroup(input: DeliveryInput): Promise<DeliveryResult> {
  const started = Date.now();
  const { channels, content } = input;
  const errors: string[] = [];

  const push = async (): Promise<PushOutcome[]> => {
    if (!input.pushEnabled || !channels.push || input.pushTargets.length === 0) return [];
    return sendPushToAll(input.pushTargets, pushPayload(content, input.groupId), channels.push.client, input.timeoutMs);
  };
  const email = async () => {
    if (!input.emailEnabled || !channels.email || channels.email.recipients.length === 0) return null;
    return sendEmailToAll(
      channels.email.recipients,
      emailContent(content, channels.appUrl),
      channels.email.from,
      channels.email.client,
      input.timeoutMs,
    );
  };

  const [pushResult, emailResult] = await Promise.allSettled([push(), email()]);
  const pushOutcomes = pushResult.status === "fulfilled" ? pushResult.value : [];
  if (pushResult.status === "rejected") errors.push(`push: ${String(pushResult.reason)}`);
  const emailOut = emailResult.status === "fulfilled" ? emailResult.value : null;
  if (emailResult.status === "rejected") errors.push(`email: ${String(emailResult.reason)}`);
  for (const o of pushOutcomes) if (o.result === "failed") errors.push(`push: ${o.error}`);
  for (const e of emailOut?.errors ?? []) errors.push(`email: ${e}`);

  return {
    pushSent: pushOutcomes.filter((o) => o.result === "ok").length,
    pushFailed: pushOutcomes.filter((o) => o.result !== "ok").length,
    emailSent: emailOut?.sent ?? 0,
    emailFailed: (emailOut?.failed ?? 0) + (emailResult.status === "rejected" ? 1 : 0),
    pushOutcomes,
    errors,
    ms: Date.now() - started,
  };
}
