// Test fixture: the seeded default settings.
import type { SettingsValues } from "../snapshot";

export const DEFAULTS: SettingsValues = {
  accountSizeUsd: 10_000,
  startingBalanceUsd: 10_000,
  riskPct: 0.5,
  rewardRatio: 3,
  dailyLossLimitPct: 3,
  maxDrawdownPct: 10,
  warnDailyLossPct: 1.5,
  stopDailyLossPct: 2,
  warnOverallLossPct: 5,
  maxTradesPerDay: 2,
  stopBufferPips: 3,
  watchExpiryMinutes: 120,
  swingStrength: 2,
  equalTolerancePips: 2,
  paperTimeoutHours: 72,
  dayResetTz: "America/New_York",
  dayResetHour: 17,
  drawdownType: "STATIC",
  pushEnabled: true,
  emailEnabled: true,
  watchingPushEnabled: false,
};
