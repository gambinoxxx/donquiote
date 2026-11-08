import { describe, expect, it } from "vitest";
import { scanFile, scanText, secretValues } from "./scan";

describe("check:secrets scan", () => {
  it("finds server-only names", () => {
    const f = scanText("a.js", 'const x = process.env.OANDA_API_TOKEN; const y = "DATABASE_URL"', []);
    expect(f.map((x) => x.name)).toEqual(["OANDA_", "DATABASE_URL"]);
  });
  it("NEXT_PUBLIC_ names are fine", () => {
    expect(scanText("a.js", "NEXT_PUBLIC_VAPID_PUBLIC_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", [])).toEqual([]);
  });
  it("finds a secret value and reports only its name", () => {
    const values = secretValues({ RESEND_API_KEY: "re_fake_value_1234567890", NEXT_PUBLIC_X: "public-value-123456", OANDA_ENV: "practice" });
    expect(values.map((v) => v.name)).toEqual(["RESEND_API_KEY"]);
    const f = scanText("chunk.js", 'fetch("x",{h:"re_fake_value_1234567890"})', values);
    expect(f).toEqual([{ file: "chunk.js", name: "RESEND_API_KEY", kind: "value" }]);
    expect(JSON.stringify(f)).not.toContain("re_fake_value");
  });

  it("ignores only Clerk's empty browser process.env read, still checks values there", () => {
    const clerk = "x.env.NEXT_PUBLIC_CLERK_JS_VERSION,p.env.CLERK_SECRET_KEY,p.env.CLERK_MACHINE_SECRET_KEY";
    const r = scanFile("clerk.js", clerk, []);
    expect(r.findings).toEqual([]);
    expect(r.ignored).toHaveLength(1);
    // The same read without Clerk's marker still fails.
    expect(scanText("app.js", "p.env.CLERK_SECRET_KEY", []).map((f) => f.name)).toEqual(["CLERK_SECRET"]);
    // A string mention in Clerk's file still fails.
    expect(scanText("clerk.js", `${clerk};"CLERK_SECRET_KEY"`, []).map((f) => f.name)).toEqual(["CLERK_SECRET"]);
    const values = [{ name: "CLERK_SECRET_KEY", value: "sk_test_fakefakefake123" }];
    expect(scanText("clerk.js", `${clerk};"sk_test_fakefakefake123"`, values).map((f) => f.kind)).toContain("value");
  });
});
