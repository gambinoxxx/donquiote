import { describe, expect, it } from "vitest";
import { pipSize, priceDecimals } from "@/lib/market/pip";

describe("pipSize", () => {
  it("is 0.0001 for non-JPY FX pairs", () => {
    for (const pair of ["EUR_USD", "GBP_USD", "USD_CAD", "USD_CHF"] as const) {
      expect(pipSize(pair)).toBe(0.0001);
    }
  });
  it("is 0.01 for USD_JPY", () => expect(pipSize("USD_JPY")).toBe(0.01));
  it("is 0.1 for gold", () => expect(pipSize("XAU_USD")).toBe(0.1));
});

describe("priceDecimals", () => {
  it("is 5 for non-JPY FX pairs", () => {
    for (const pair of ["EUR_USD", "GBP_USD", "USD_CAD", "USD_CHF"] as const) {
      expect(priceDecimals(pair)).toBe(5);
    }
  });
  it("is 3 for USD_JPY", () => expect(priceDecimals("USD_JPY")).toBe(3));
  it("is 2 for gold", () => expect(priceDecimals("XAU_USD")).toBe(2));
});
