-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Pair" AS ENUM ('EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CAD', 'USD_CHF', 'XAU_USD');

-- CreateEnum
CREATE TYPE "Timeframe" AS ENUM ('D', 'H4', 'M15');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('WATCHING', 'READY', 'EXPIRED', 'TAKEN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SweepType" AS ENUM ('PDH', 'PDL', 'EQH', 'EQL');

-- CreateEnum
CREATE TYPE "TradeResult" AS ENUM ('OPEN', 'WIN', 'LOSS', 'BREAKEVEN');

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "accountSizeUsd" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "startingBalanceUsd" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "riskPct" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "rewardRatio" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "dailyLossLimitPct" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "maxDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "warnDailyLossPct" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "stopDailyLossPct" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "warnOverallLossPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "maxTradesPerDay" INTEGER NOT NULL DEFAULT 2,
    "stopBufferPips" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "watchExpiryMinutes" INTEGER NOT NULL DEFAULT 120,
    "swingStrength" INTEGER NOT NULL DEFAULT 2,
    "equalTolerancePips" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "watchingPushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistPair" (
    "pair" "Pair" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "WatchlistPair_pkey" PRIMARY KEY ("pair")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "pair" "Pair" NOT NULL,
    "direction" "Direction" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'WATCHING',
    "dedupeKey" TEXT NOT NULL,
    "sweepType" "SweepType" NOT NULL,
    "sweepLevel" DOUBLE PRECISION NOT NULL,
    "sweepExtreme" DOUBLE PRECISION NOT NULL,
    "sweepTime" TIMESTAMP(3) NOT NULL,
    "bosLevel" DOUBLE PRECISION,
    "entry" DOUBLE PRECISION,
    "stop" DOUBLE PRECISION,
    "target" DOUBLE PRECISION,
    "stopPips" DOUBLE PRECISION,
    "targetPips" DOUBLE PRECISION,
    "lotSize" DOUBLE PRECISION,
    "riskPct" DOUBLE PRECISION,
    "riskUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "expiredAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "pair" "Pair" NOT NULL,
    "direction" "Direction" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "result" "TradeResult" NOT NULL DEFAULT 'OPEN',
    "resultR" DOUBLE PRECISION,
    "resultPct" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candle" (
    "pair" "Pair" NOT NULL,
    "timeframe" "Timeframe" NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("pair","timeframe","time")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastScanAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "message" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_pair_createdAt_idx" ON "Alert"("pair", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_alertId_key" ON "JournalEntry"("alertId");

-- CreateIndex
CREATE INDEX "JournalEntry_takenAt_idx" ON "JournalEntry"("takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

