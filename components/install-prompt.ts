// Holds Chrome's beforeinstallprompt event (Android / desktop Chrome) so the
// Settings "Install app" button can use it later. The event can fire before
// React mounts, so an inline script in the root layout catches it first
// (INSTALL_PROMPT_SCRIPT); this module picks it up from there.

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __donqInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** Runs in <head> before the app loads: keep the event for later. */
export const INSTALL_PROMPT_SCRIPT =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__donqInstallPrompt=e;window.dispatchEvent(new Event('donq-install-prompt'))});" +
  "window.addEventListener('appinstalled',function(){window.__donqInstallPrompt=null;window.dispatchEvent(new Event('donq-install-prompt'))});";

export function currentInstallPrompt(): BeforeInstallPromptEvent | null {
  return window.__donqInstallPrompt ?? null;
}

/** Calls back whenever the prompt becomes available or is used up / the app gets installed. */
export function onInstallPromptChange(cb: () => void): () => void {
  window.addEventListener("donq-install-prompt", cb);
  window.addEventListener("appinstalled", cb);
  return () => {
    window.removeEventListener("donq-install-prompt", cb);
    window.removeEventListener("appinstalled", cb);
  };
}

export function clearInstallPrompt() {
  window.__donqInstallPrompt = null;
}
