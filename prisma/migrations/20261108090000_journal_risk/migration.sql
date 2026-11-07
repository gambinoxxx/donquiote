-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalResult" AS ENUM ('WIN', 'LOSS', 'BREAKEVEN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DrawdownType" AS ENUM ('STATIC', 'TRAILING');

-- DropIndex
DROP INDEX "JournalEntry_takenAt_idx";

-- AlterTable
ALTER TABLE "JournalEntry" DROP COLUMN "resultPct",
DROP COLUMN "takenAt",
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "entry" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "lots" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "openedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "pnlUsd" DOUBLE PRECISION,
ADD COLUMN     "riskUsd" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "status" "JournalStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "stop" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "strategyId" TEXT,
ADD COLUMN     "target" DOUBLE PRECISION NOT NULL,
DROP COLUMN "result",
ADD COLUMN     "result" "JournalResult";

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "dayResetHour" INTEGER NOT NULL DEFAULT 17,
ADD COLUMN     "dayResetTz" TEXT NOT NULL DEFAULT 'America/New_York',
ADD COLUMN     "drawdownType" "DrawdownType" NOT NULL DEFAULT 'STATIC';

-- DropEnum
DROP TYPE "TradeResult";

-- CreateIndex
CREATE INDEX "JournalEntry_status_openedAt_idx" ON "JournalEntry"("status", "openedAt");

-- CreateIndex
CREATE INDEX "JournalEntry_openedAt_idx" ON "JournalEntry"("openedAt");

