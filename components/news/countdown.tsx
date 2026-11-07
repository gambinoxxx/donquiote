"use client";

// "in 25m" / "in 2h 10m" chip for a red event; re-renders every minute.
import { useEffect, useState } from "react";

function label(ms: number): string | null {
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) return null;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

export function Countdown({ time, serverNow }: { time: string; serverNow: string }) {
  // Start from the server's clock (no hydration mismatch), then tick locally.
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const ms = Date.parse(time) - now;
  const text = label(ms);
  if (!text) return null;
  const soon = ms <= 30 * 60_000;
  return (
    <span
      className={
        soon
          ? "flex-none rounded-[10px] bg-news-dot px-2 py-[3px] font-mono text-[11px] font-bold text-news-title"
          : "flex-none rounded-[10px] border border-strong px-2 py-[3px] font-mono text-[11px] font-semibold text-soft"
      }
    >
      {text}
    </span>
  );
}
