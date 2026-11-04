import { describe, expect, it } from "vitest";
import { isEmailAllowed, parseAllowedEmails } from "@/lib/allowlist";

describe("parseAllowedEmails", () => {
  it("splits, trims and lowercases", () => {
    expect(parseAllowedEmails(" DG@Example.com , gambino@example.com")).toEqual([
      "dg@example.com",
      "gambino@example.com",
    ]);
  });

  it("drops blank entries", () => {
    expect(parseAllowedEmails("a@example.com,, ,")).toEqual(["a@example.com"]);
  });

  it("returns an empty list for missing or blank input", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
    expect(parseAllowedEmails(" , ")).toEqual([]);
  });
});

describe("isEmailAllowed", () => {
  const allowed = parseAllowedEmails("dg@example.com,gambino@example.com");

  it("allows a listed email", () => {
    expect(isEmailAllowed("dg@example.com", allowed)).toBe(true);
  });

  it("ignores case", () => {
    expect(isEmailAllowed("DG@Example.COM", allowed)).toBe(true);
  });

  it("ignores surrounding spaces", () => {
    expect(isEmailAllowed("  gambino@example.com\n", allowed)).toBe(true);
  });

  it("compares case-insensitively even if the list itself is not normalised", () => {
    expect(isEmailAllowed("dg@example.com", [" DG@EXAMPLE.COM "])).toBe(true);
  });

  it("denies an email that is not on the list", () => {
    expect(isEmailAllowed("someone@example.com", allowed)).toBe(false);
  });

  it("denies near-misses", () => {
    expect(isEmailAllowed("dg@example.co", allowed)).toBe(false);
    expect(isEmailAllowed("xdg@example.com", allowed)).toBe(false);
  });

  it("denies a missing or non-string email claim", () => {
    expect(isEmailAllowed(undefined, allowed)).toBe(false);
    expect(isEmailAllowed(null, allowed)).toBe(false);
    expect(isEmailAllowed("", allowed)).toBe(false);
    expect(isEmailAllowed("   ", allowed)).toBe(false);
    expect(isEmailAllowed(42, allowed)).toBe(false);
    expect(isEmailAllowed(["dg@example.com"], allowed)).toBe(false);
  });

  it("denies everyone when the list is empty", () => {
    expect(isEmailAllowed("dg@example.com", [])).toBe(false);
    expect(isEmailAllowed("", [])).toBe(false);
  });
});
