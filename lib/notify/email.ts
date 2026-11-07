// Email sender (Resend). Worker and scripts only. Never logs keys or
// addresses: callers get counts back.
import { Resend } from "resend";
import type { EmailContent } from "./format";
import { SEND_TIMEOUT_MS, withTimeout } from "./push";

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one email; rejects on failure. */
export interface EmailClient {
  send(message: EmailMessage): Promise<void>;
}

export function createResendClient(apiKey: string): EmailClient {
  const resend = new Resend(apiKey);
  return {
    async send(message) {
      const { error } = await resend.emails.send(message);
      // Resend's message names the problem (e.g. an unverified domain) and can
      // quote an address: redact addresses before it reaches any log.
      if (error) {
        throw new Error(`Resend ${error.statusCode ?? ""} ${error.name}: ${redactEmails(error.message)}`.trim());
      }
    },
  };
}

/** Replaces anything that looks like an email address with "[email]". */
export function redactEmails(text: string): string {
  return text.replace(/[^\s@()<>"',;:]+@[^\s@()<>"',;:]+\.[a-z]{2,}/gi, "[email]");
}

export interface EmailResult {
  sent: number;
  failed: number;
  /** One per failure, without the address. */
  errors: string[];
}

/** One email per recipient (no shared To list), in parallel. Never throws. */
export async function sendEmailToAll(
  recipients: readonly string[],
  content: EmailContent,
  from: string,
  client: EmailClient,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<EmailResult> {
  const results = await Promise.allSettled(
    recipients.map((to) => withTimeout(client.send({ from, to, ...content }), timeoutMs)),
  );
  const errors = results.flatMap((r) =>
    r.status === "rejected" ? [redactEmails(r.reason instanceof Error ? r.reason.message : "error")] : [],
  );
  return { sent: results.length - errors.length, failed: errors.length, errors };
}
