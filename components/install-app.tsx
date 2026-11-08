"use client";

// Settings › "Install the app": an Install button when Chrome offers one
// (beforeinstallprompt, Android), otherwise the manual steps. Hidden once the
// app is installed (opened from the icon). Android notification tips below.
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { ANDROID_NOTIFICATION_TIPS, detectPlatform, installStepsFor, isInstalled, type Platform } from "@/lib/pwa";
import { useToast } from "@/components/toast";
import { clearInstallPrompt, currentInstallPrompt, onInstallPromptChange, type BeforeInstallPromptEvent } from "./install-prompt";

interface DeviceInfo {
  platform: Platform;
  installed: boolean;
}

function readDevice(): DeviceInfo {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone;
  return { platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints), installed: isInstalled(standalone, ios) };
}

const label = "ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase";

export function InstallApp() {
  const toast = useToast();
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const sync = () => {
      setDevice(readDevice());
      setPrompt(currentInstallPrompt());
    };
    // Browser-only facts: read after mount.
    sync();
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", sync);
    const off = onInstallPromptChange(sync);
    return () => {
      media.removeEventListener("change", sync);
      off();
    };
  }, []);

  if (!device) return null;

  async function install() {
    if (!prompt) return;
    clearInstallPrompt(); // a prompt can only be used once
    setPrompt(null);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") toast("Installing Donquixote…");
  }

  return (
    <>
      {!device.installed && (
        <section aria-labelledby="install" className="flex flex-col gap-1.5">
          <h2 id="install" className={label}>
            Install the app
          </h2>
          <div className="flex flex-col gap-3 rounded-2xl border border-default bg-surface p-3.5">
            <p className="text-sm text-muted">Installed, it opens full screen from its own icon and alerts arrive like a normal app.</p>
            {prompt ? (
              <button
                type="button"
                onClick={install}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-accent font-bold text-on-accent"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
                Install Donquixote
              </button>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {installStepsFor(device.platform).map((s) => (
                  <li key={s.label}>
                    <span className="font-semibold">{s.label}:</span> {s.steps}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      {device.platform !== "ios" && (
        <section aria-labelledby="android-tips" className="flex flex-col gap-1.5">
          <h2 id="android-tips" className={label}>
            Android notification tips
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 rounded-2xl border border-default bg-surface py-3.5 pr-3.5 pl-8 text-sm">
            {ANDROID_NOTIFICATION_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
