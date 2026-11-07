import { beforeEach, describe, expect, it, vi } from "vitest";

// Library mocks: nothing leaves the machine in tests.
const webPushSend = vi.fn();
vi.mock("web-push", () => ({ sendNotification: (...args: unknown[]) => webPushSend(...args) }));
const resendSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => resendSend(...args) };
  },
}));

const { deliverGroup } = await import("./deliver");
const { createResendClient, redactEmails, sendEmailToAll } = await import("./email");
const { emailContent, formatDuration, pushPayload, SAFETY_LINE } = await import("./format");
const { createWebPushClient, MAX_PUSH_FAILURES, PUSH_TTL_SECONDS, sendPushToAll } = await import("./push");
type NotifyContent = import("./format").NotifyContent;
type PushTarget = import("./push").PushTarget;

const EUR: NotifyContent = {
  id: "alert1",
  pair: "EUR_USD",
  direction: "SELL",
  strategyIds: ["dg-v1"],
  entry: 1.118,
  stop: 1.1195,
  target: 1.1135,
  lotSize: 0.25,
  riskUsd: 50,
  sweepType: "PDH",
  sweepLevel: 1.1192,
  bosLevel: 1.1184,
  entryType: "MARKET",
  readyAt: "2026-11-04T10:00:00.000Z",
  entryValidUntil: null,
};
const target = (id: string, failCount = 0): PushTarget => ({ id, endpoint: `https://push.example/${id}`, p256dh: "p", auth: "a", failCount });
const httpError = (statusCode: number) => Object.assign(new Error("Received unexpected response code"), { statusCode });

beforeEach(() => {
  webPushSend.mockReset();
  resendSend.mockReset();
});

describe("format", () => {
  it("push title, body (pair precision), url and tag", () => {
    expect(pushPayload(EUR, "group1")).toEqual({
      title: "EUR/USD SELL · Ready",
      body: "Entry 1.11800 · SL 1.11950 · TP 1.11350 · 0.25 lots · V1",
      url: "/alerts/alert1",
      tag: "group1",
    });
  });

  it("USD_JPY prices use 3 decimals", () => {
    const jpy = { ...EUR, pair: "USD_JPY" as const, direction: "BUY" as const, entry: 156.78, stop: 156.22, target: 158.46 };
    expect(pushPayload(jpy, "g").body).toBe("Entry 156.780 · SL 156.220 · TP 158.460 · 0.25 lots · V1");
    expect(pushPayload(jpy, "g").title).toBe("USD/JPY BUY · Ready");
  });

  it("a LIMIT entry starts with the limit price and how long it is valid", () => {
    const limit = {
      ...EUR,
      strategyIds: ["gemini-fvg"],
      entryType: "LIMIT" as const,
      entryValidUntil: "2026-11-04T14:00:00.000Z",
    };
    expect(pushPayload(limit, "g").body).toBe("Limit 1.11800 (valid 4h) · SL 1.11950 · TP 1.11350 · 0.25 lots · FVG");
    expect(emailContent(limit, "http://localhost:3000").text).toContain("Limit entry: 1.11800 (valid 4h)");
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });

  it("email: subject = push title; levels, strategy names, button link and the safety line", () => {
    const email = emailContent({ ...EUR, strategyIds: ["dg-v1", "pro-v1-swing"] }, "http://localhost:3000/");
    expect(email.subject).toBe("EUR/USD SELL · Ready");
    for (const line of [
      "Pair: EUR/USD SELL",
      "Strategy: DG v1 · Original, Pro Sweep",
      "Entry: 1.11800",
      "Stop: 1.11950",
      "Target: 1.11350",
      "Lot size: 0.25 lots",
      "Risk: $50.00",
      "Swept: PDH 1.11920",
      "Break level: 1.11840",
      "Open the alert: http://localhost:3000/alerts/alert1",
      SAFETY_LINE,
    ]) {
      expect(email.text).toContain(line);
    }
    expect(email.html).toContain('href="http://localhost:3000/alerts/alert1"');
    expect(email.html).toContain(SAFETY_LINE);
  });
});

describe("push", () => {
  it("web-push is called with high urgency, a 30-minute TTL and the VAPID details", async () => {
    webPushSend.mockResolvedValue({ statusCode: 201 });
    const client = createWebPushClient({ subject: "mailto:x@example.com", publicKey: "pub", privateKey: "priv" });
    const out = await sendPushToAll([target("s1")], pushPayload(EUR, "g"), client);
    expect(out).toEqual([{ id: "s1", result: "ok" }]);
    const [sub, body, options] = webPushSend.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(sub).toEqual({ endpoint: "https://push.example/s1", keys: { p256dh: "p", auth: "a" } });
    expect(JSON.parse(body)).toMatchObject({ title: "EUR/USD SELL · Ready", url: "/alerts/alert1", tag: "g" });
    expect(options).toMatchObject({ urgency: "high", TTL: PUSH_TTL_SECONDS, vapidDetails: { subject: "mailto:x@example.com" } });
    expect(PUSH_TTL_SECONDS).toBe(1800);
  });

  it("404 / 410 mean the subscription is gone (delete it)", async () => {
    const client = { send: vi.fn().mockRejectedValueOnce(httpError(410)).mockRejectedValueOnce(httpError(404)) };
    expect(await sendPushToAll([target("a"), target("b")], pushPayload(EUR, "g"), client)).toEqual([
      { id: "a", result: "gone", status: 410 },
      { id: "b", result: "gone", status: 404 },
    ]);
  });

  it("other errors count as failures; the 5th in a row deletes the subscription", async () => {
    const client = { send: vi.fn().mockRejectedValue(httpError(500)) };
    const out = await sendPushToAll([target("new", 0), target("old", MAX_PUSH_FAILURES - 1)], pushPayload(EUR, "g"), client);
    expect(out).toEqual([
      { id: "new", result: "failed", status: 500, error: "HTTP 500", deleteNow: false },
      { id: "old", result: "failed", status: 500, error: "HTTP 500", deleteNow: true },
    ]);
  });

  it("a hanging push service times out instead of blocking", async () => {
    const client = { send: () => new Promise<void>(() => {}) };
    const [outcome] = await sendPushToAll([target("slow")], pushPayload(EUR, "g"), client, 20);
    expect(outcome).toMatchObject({ result: "failed", error: "timeout" });
  });

  it("never puts the endpoint in an error", async () => {
    const leaky = Object.assign(new Error("bad"), { endpoint: "https://push.example/secret" });
    const client = { send: vi.fn().mockRejectedValue(leaky) };
    const out = await sendPushToAll([target("s")], pushPayload(EUR, "g"), client);
    expect(JSON.stringify(out)).not.toContain("push.example");
  });
});

describe("email", () => {
  it("Resend gets one message per recipient with subject, html and text", async () => {
    resendSend.mockResolvedValue({ data: { id: "e1" }, error: null });
    const client = createResendClient("re_test");
    const result = await sendEmailToAll(["a@example.com", "b@example.com"], emailContent(EUR, "http://x"), "alerts@example.com", client);
    expect(result).toEqual({ sent: 2, failed: 0, errors: [] });
    expect(resendSend.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["a@example.com", "b@example.com"]);
    expect(resendSend.mock.calls[0]?.[0]).toMatchObject({ from: "alerts@example.com", subject: "EUR/USD SELL · Ready" });
  });

  it("a Resend error counts as failed, with addresses redacted", async () => {
    resendSend.mockResolvedValue({
      data: null,
      error: { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (me@example.com)." },
    });
    const result = await sendEmailToAll(["dg@example.com"], emailContent(EUR, "http://x"), "onboarding@resend.dev", createResendClient("re_test"));
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("[email]");
    expect(result.errors.join()).not.toContain("example.com");
    expect(redactEmails("to dg@example.com, x")).toBe("to [email], x");
  });
});

describe("deliverGroup", () => {
  const channels = (push: unknown, email: unknown) =>
    ({ appUrl: "http://localhost:3000", push, email }) as Parameters<typeof deliverGroup>[0]["channels"];

  it("sends push and email in parallel; a push failure does not stop the email", async () => {
    const push = { client: { send: vi.fn().mockRejectedValue(httpError(500)) } };
    const email = { client: { send: vi.fn().mockResolvedValue(undefined) }, from: "f@example.com", recipients: ["a@example.com"] };
    const result = await deliverGroup({
      content: EUR,
      groupId: "g",
      channels: channels(push, email),
      pushEnabled: true,
      emailEnabled: true,
      pushTargets: [target("s1")],
    });
    expect(result).toMatchObject({ pushSent: 0, pushFailed: 1, emailSent: 1, emailFailed: 0 });
  });

  it("an email client that throws does not stop the push", async () => {
    const push = { client: { send: vi.fn().mockResolvedValue(undefined) } };
    const email = { client: { send: vi.fn().mockRejectedValue(new Error("network down")) }, from: "f@example.com", recipients: ["a@example.com"] };
    const result = await deliverGroup({
      content: EUR,
      groupId: "g",
      channels: channels(push, email),
      pushEnabled: true,
      emailEnabled: true,
      pushTargets: [target("s1"), target("s2")],
    });
    expect(result).toMatchObject({ pushSent: 2, pushFailed: 0, emailSent: 0, emailFailed: 1 });
  });

  it("respects the Settings toggles and missing channels", async () => {
    const push = { client: { send: vi.fn() } };
    const email = { client: { send: vi.fn() }, from: "f@example.com", recipients: ["a@example.com"] };
    const off = await deliverGroup({
      content: EUR,
      groupId: "g",
      channels: channels(push, email),
      pushEnabled: false,
      emailEnabled: false,
      pushTargets: [target("s1")],
    });
    expect(off).toMatchObject({ pushSent: 0, emailSent: 0 });
    expect(push.client.send).not.toHaveBeenCalled();
    expect(email.client.send).not.toHaveBeenCalled();
    const none = await deliverGroup({ content: EUR, groupId: "g", channels: channels(null, null), pushEnabled: true, emailEnabled: true, pushTargets: [target("s1")] });
    expect(none).toMatchObject({ pushSent: 0, pushFailed: 0, emailSent: 0, emailFailed: 0 });
  });
});
