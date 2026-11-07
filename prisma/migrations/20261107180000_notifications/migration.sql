-- CreateEnum
CREATE TYPE "NotifyState" AS ENUM ('NONE', 'PENDING', 'SENT', 'MERGED', 'STALE', 'FAILED');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "notifyGroupId" TEXT,
ADD COLUMN     "notifyState" "NotifyState" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "failCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationGroup" (
    "id" TEXT NOT NULL,
    "pair" "Pair" NOT NULL,
    "direction" "Direction" NOT NULL,
    "firstAlertId" TEXT NOT NULL,
    "strategyIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushSent" INTEGER NOT NULL DEFAULT 0,
    "pushFailed" INTEGER NOT NULL DEFAULT 0,
    "emailSent" INTEGER NOT NULL DEFAULT 0,
    "emailFailed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NotificationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationGroup_pair_direction_createdAt_idx" ON "NotificationGroup"("pair", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_notifyState_idx" ON "Alert"("notifyState");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_notifyGroupId_fkey" FOREIGN KEY ("notifyGroupId") REFERENCES "NotificationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

