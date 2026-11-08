import { describe, expect, it } from "vitest";
import { detectPlatform, installStepsFor, isInstalled, unsupportedPushText, IPHONE_ADD_TO_HOME } from "./pwa";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

describe("PWA hints", () => {
  it("detects the platform (iPad by touch points)", () => {
    expect(detectPlatform(UA.iphone)).toBe("ios");
    expect(detectPlatform(UA.ipad, 5)).toBe("ios");
    expect(detectPlatform(UA.mac, 0)).toBe("other");
    expect(detectPlatform(UA.android)).toBe("android");
  });
  it("installed when standalone (either signal)", () => {
    expect(isInstalled(true, undefined)).toBe(true);
    expect(isInstalled(false, true)).toBe(true);
    expect(isInstalled(false, undefined)).toBe(false);
  });
  it("iPhone in a Safari tab gets the Add to Home Screen hint, not 'Not supported'", () => {
    expect(unsupportedPushText("ios", false)).toBe(IPHONE_ADD_TO_HOME);
    expect(unsupportedPushText("ios", true)).toBe("Needs iOS 16.4 or later");
    expect(unsupportedPushText("other", false)).toBe("Not supported in this browser");
  });
  it("install steps: the device's own first", () => {
    expect(installStepsFor("ios")[0]!.label).toBe("iPhone");
    expect(installStepsFor("android")[0]!.steps).toBe("Chrome menu (⋮) → Install app");
  });
});
