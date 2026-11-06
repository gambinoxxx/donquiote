-- DropIndex
DROP INDEX "Alert_dedupeKey_key";

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "statusNote" TEXT,
ADD COLUMN     "strategyId" TEXT NOT NULL DEFAULT 'dg-v1';

-- AlterTable
ALTER TABLE "WorkerHeartbeat" ADD COLUMN     "lastCleanupAt" TIMESTAMP(3),
ADD COLUMN     "version" TEXT;

-- CreateTable
CREATE TABLE "ScanCursor" (
    "pair" "Pair" NOT NULL,
    "strategyId" TEXT NOT NULL,
    "lastCandleTime" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanCursor_pkey" PRIMARY KEY ("pair","strategyId")
);

-- CreateIndex
CREATE INDEX "Alert_strategyId_createdAt_idx" ON "Alert"("strategyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_strategyId_dedupeKey_key" ON "Alert"("strategyId", "dedupeKey");

