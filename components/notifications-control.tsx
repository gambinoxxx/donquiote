"use client";

// Settings › Notifications: turn push on or off for this device and send a
// test notification. The browser subscription is saved through a server
// action (allowed users only).
import { useCallback, useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/lib/data/notification-actions";
import { cn } from "@/lib/utils";
import { PendingButton } from "./pending-button";

type DeviceState = "checking" | "unsupported" | "unconfigured" | "blocked" | "off" | "on";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const STATUS_TEXT: Record<DeviceState, string> = {
  checking: "Checking…",
  unsupported: "Not supported in this browser",
  unconfigured: "Not set up on the server yet",
  blocked: "Blocked in browser settings",
  off: "Off",
  on: "On",
};

/** VAPID public key (base64url) → bytes for pushManager.subscribe. */
function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

export function NotificationsControl({ title = "Notifications" }: { title?: string }) {
  const [state, setState] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (!PUBLIC_KEY) {
      setState("unconfigured");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub && Notification.permission === "granted") {
      setState("on");
      // Keep the server copy fresh (it is an upsert by endpoint).
      void savePushSubscription(sub.toJSON(), navigator.userAgent).catch(() => {});
    } else {
      setState("off");
    }
  }, []);

  useEffect(() => {
    // Browser-only APIs: read them after mount, then update the state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch(() => setState("unsupported"));
  }, [refresh]);

  async function turnOn() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "blocked" : "off");
      return;
    }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(PUBLIC_KEY) }));
    const result = await savePushSubscription(sub.toJSON(), navigator.userAgent);
    if (!result.ok) {
      await sub.unsubscribe().catch(() => {});
      throw new Error(result.error);
    }
    setState("on");
  }

  async function turnOff() {
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) {
      await removePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
  }

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (state === "on") await turnOff();
      else await turnOn();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not change notifications." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    try {
      const result = await sendTestPush();
      setMessage(result.ok ? { tone: "ok", text: result.message ?? "Sent." } : { tone: "error", text: result.error });
    } catch {
      setMessage({ tone: "error", text: "Could not send the test notification." });
    } finally {
      setTesting(false);
    }
  }

  const canToggle = state === "on" || state === "off";
  return (
    <section aria-labelledby="notifications" className="flex flex-col gap-1.5">
      <h2 id="notifications" className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2">
          <div className="flex flex-col">
            <span>Enable notifications on this device</span>
            <span className={cn("text-xs", state === "blocked" ? "text-error" : "text-muted")} aria-live="polite">
              {STATUS_TEXT[state]}
              {state === "on" && " · long vibration, stays until tapped"}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={state === "on"}
            aria-label="Enable notifications on this device"
            disabled={!canToggle || busy}
            onClick={toggle}
            className="flex h-8 w-[52px] shrink-0 cursor-pointer justify-start rounded-2xl bg-[var(--border-input)] p-[3px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-checked:justify-end aria-checked:bg-primary"
          >
            <span className="size-[26px] rounded-full bg-foreground" />
          </button>
        </div>
        <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-1.5">
          <span>Test notification</span>
          <PendingButton
            type="button"
            pending={testing}
            pendingLabel="Sending…"
            disabled={state !== "on"}
            onClick={test}
            className="h-10 rounded-xl border border-input px-[18px] text-sm font-semibold"
          >
            Send
          </PendingButton>
        </div>
      </div>
      {message && (
        <p role="status" className={cn("ml-1 text-xs", message.tone === "error" ? "text-error" : "text-success")}>
          {message.text}
        </p>
      )}
    </section>
  );
}
