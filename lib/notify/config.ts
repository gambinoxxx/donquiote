// Notification channels from the environment (worker, scripts and the
// Settings test action). Server-only: reads secrets from process.env.
// A channel whose variables are missing or invalid is turned off (null) with
// a warning that names the variable, never its value. The worker keeps
// scanning either way.
import { z } from "zod";
import { parseAllowedEmails } from "@/lib/allowlist";
import type { NotifyChannels } from "./deliver";
import { createResendClient } from "./email";
import { createWebPushClient } from "./push";

export const DEFAULT_APP_URL = "http://localhost:3000";

const nonEmpty = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

export interface NotifyConfig {
  channels: NotifyChannels;
  /** Why a channel is off (variable names only). */
  problems: string[];
  recipients: number;
}

export function getNotifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  const problems: string[] = [];

  let push: NotifyChannels["push"] = null;
  const publicKey = nonEmpty(env.VAPID_PUBLIC_KEY);
  const privateKey = nonEmpty(env.VAPID_PRIVATE_KEY);
  const subject = nonEmpty(env.VAPID_SUBJECT);
  const missingPush = [
    !publicKey && "VAPID_PUBLIC_KEY",
    !privateKey && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT",
  ].filter((x): x is string => typeof x === "string");
  if (missingPush.length > 0) {
    problems.push(`push off: missing ${missingPush.join(", ")}`);
  } else if (!/^(mailto:|https:)/.test(subject as string)) {
    problems.push("push off: VAPID_SUBJECT must start with mailto: or https:");
  } else {
    push = { client: createWebPushClient({ subject: subject as string, publicKey: publicKey as string, privateKey: privateKey as string }) };
  }

  let email: NotifyChannels["email"] = null;
  const apiKey = nonEmpty(env.RESEND_API_KEY);
  const from = nonEmpty(env.EMAIL_FROM);
  const recipients = parseAllowedEmails(env.ALLOWED_EMAILS).filter((e) => z.email().safeParse(e).success);
  const missingEmail = [
    !apiKey && "RESEND_API_KEY",
    !from && "EMAIL_FROM",
    recipients.length === 0 && "ALLOWED_EMAILS",
  ].filter((x): x is string => typeof x === "string");
  if (missingEmail.length > 0) {
    problems.push(`email off: missing ${missingEmail.join(", ")}`);
  } else {
    email = { client: createResendClient(apiKey as string), from: from as string, recipients };
  }

  const appUrl = nonEmpty(env.APP_URL) ?? DEFAULT_APP_URL;
  return { channels: { appUrl, push, email }, problems, recipients: recipients.length };
}
