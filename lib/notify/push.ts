// Web push sender (web-push library). Worker and the Settings test action
// only. Never logs or returns keys or endpoints.
import { sendNotification, type WebPushError } from "web-push";
import type { PushPayload } from "./format";

/** Push services drop the message after 30 minutes: by then the signal is stale. */
export const PUSH_TTL_SECONDS = 1800;
export const SEND_TIMEOUT_MS = 10_000;
/** A subscription is deleted after this many failures in a row. */
export const MAX_PUSH_FAILURES = 5;

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Failures in a row so far. */
  failCount: number;
}

/** Sends one encrypted message; rejects with `{ statusCode? }` on failure. */
export interface PushClient {
  send(target: PushTarget, body: string): Promise<void>;
}

export function createWebPushClient(vapid: VapidConfig): PushClient {
  return {
    async send(target, body) {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        body,
        {
          vapidDetails: vapid,
          urgency: "high",
          TTL: PUSH_TTL_SECONDS,
          timeout: SEND_TIMEOUT_MS,
        },
      );
    },
  };
}

export type PushOutcome =
  | { id: string; result: "ok" }
  /** 404 / 410: the browser dropped the subscription → delete it. */
  | { id: string; result: "gone"; status: number }
  | { id: string; result: "failed"; status?: number; error: string; deleteNow: boolean };

/** Status code of a push error, if it has one (web-push's WebPushError does). */
function statusOf(error: unknown): number | undefined {
  const status = (error as Partial<WebPushError> | null)?.statusCode;
  return typeof status === "number" ? status : undefined;
}

/** A safe description: the status, never the endpoint the error carries. */
function describe(error: unknown, status: number | undefined): string {
  if (status !== undefined) return `HTTP ${status}`;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return error instanceof Error ? error.name : "error";
}

/** Rejects after `ms` (the client also has its own timeout). */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`timed out after ${ms} ms`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Sends `payload` to every target in parallel. Never throws. */
export async function sendPushToAll(
  targets: readonly PushTarget[],
  payload: PushPayload,
  client: PushClient,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<PushOutcome[]> {
  const body = JSON.stringify(payload);
  return Promise.all(
    targets.map(async (target): Promise<PushOutcome> => {
      try {
        await withTimeout(client.send(target, body), timeoutMs);
        return { id: target.id, result: "ok" };
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 410) return { id: target.id, result: "gone", status };
        return {
          id: target.id,
          result: "failed",
          ...(status !== undefined && { status }),
          error: describe(error, status),
          deleteNow: target.failCount + 1 >= MAX_PUSH_FAILURES,
        };
      }
    }),
  );
}
