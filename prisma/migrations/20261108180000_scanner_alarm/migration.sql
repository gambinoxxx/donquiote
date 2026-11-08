-- CreateTable
CREATE TABLE "ScannerAlarm" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "stoppedAt" TIMESTAMP(3),
    "lastOkAtWhenStopped" TIMESTAMP(3),
    "lastRecoveredAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannerAlarm_pkey" PRIMARY KEY ("id")
);
