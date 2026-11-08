// Install and notification hints for the installed app (pure: the browser
// facts are passed in, so this is testable without a browser).

export type Platform = "ios" | "android" | "other";

/**
 * iPhone / iPad (iPadOS reports a Mac user agent but has touch), Android,
 * or anything else (desktop).
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

/** Opened from the home-screen icon (display-mode standalone, or iOS's navigator.standalone). */
export const isInstalled = (displayModeStandalone: boolean, iosStandalone: boolean | undefined) =>
  displayModeStandalone || iosStandalone === true;

export const IPHONE_ADD_TO_HOME = "On iPhone: Share → Add to Home Screen, then open from the icon";

/** Settings › notifications row text when this browser has no web push. */
export function unsupportedPushText(platform: Platform, installed: boolean): string {
  if (platform === "ios") return installed ? "Needs iOS 16.4 or later" : IPHONE_ADD_TO_HOME;
  return "Not supported in this browser";
}

export const INSTALL_STEPS: Record<"android" | "ios", { label: string; steps: string }> = {
  android: { label: "Android", steps: "Chrome menu (⋮) → Install app" },
  ios: { label: "iPhone", steps: "Safari → Share → Add to Home Screen, then open from the icon" },
};

/** Which manual install steps to show, the device's own first. */
export function installStepsFor(platform: Platform): Array<(typeof INSTALL_STEPS)["android"]> {
  return platform === "ios" ? [INSTALL_STEPS.ios, INSTALL_STEPS.android] : [INSTALL_STEPS.android, INSTALL_STEPS.ios];
}

/** Android tips so alerts aren't delayed or silenced. */
export const ANDROID_NOTIFICATION_TIPS: readonly string[] = [
  "Allow notifications for Donquixote (Android Settings → Apps → Donquixote → Notifications).",
  "Set battery to Unrestricted (Apps → Donquixote → Battery), so Android doesn't hold alerts back.",
  "Keep sound and vibration on for its notifications, and Do Not Disturb off while trading.",
];
