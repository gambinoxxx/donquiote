-- CreateEnum
CREATE TYPE "PaperStatus" AS ENUM ('OPEN', 'WIN', 'LOSS', 'UNRESOLVED');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "paperClosedAt" TIMESTAMP(3),
ADD COLUMN     "paperExitPrice" DOUBLE PRECISION,
ADD COLUMN     "paperNote" TEXT,
ADD COLUMN     "paperOpenedAt" TIMESTAMP(3),
ADD COLUMN     "paperPnlUsd" DOUBLE PRECISION,
ADD COLUMN     "paperResultR" DOUBLE PRECISION,
ADD COLUMN     "paperStatus" "PaperStatus";

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "paperTimeoutHours" INTEGER NOT NULL DEFAULT 72;

-- CreateIndex
CREATE INDEX "Alert_paperStatus_idx" ON "Alert"("paperStatus");

-- CreateIndex
CREATE INDEX "Alert_strategyId_paperStatus_idx" ON "Alert"("strategyId", "paperStatus");

