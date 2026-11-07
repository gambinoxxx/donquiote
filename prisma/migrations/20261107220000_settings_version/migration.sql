-- CreateTable
CREATE TABLE "SettingsVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "restoredFromId" TEXT,

    CONSTRAINT "SettingsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettingsVersion_createdAt_idx" ON "SettingsVersion"("createdAt");

