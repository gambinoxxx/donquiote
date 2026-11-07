-- CreateEnum
CREATE TYPE "NewsImpact" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "HeadlineImpact" AS ENUM ('HIGH', 'NORMAL');

-- CreateEnum
CREATE TYPE "ClassifiedBy" AS ENUM ('KEYWORDS', 'AI');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "newsPushCalendar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "newsPushHeadlines" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "newsWarnMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "WorkerHeartbeat" ADD COLUMN     "newsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "newsStatus" TEXT;

-- CreateTable
CREATE TABLE "NewsEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impact" "NewsImpact" NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "forecast" TEXT,
    "previous" TEXT,
    "actual" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Headline" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "impact" "HeadlineImpact" NOT NULL,
    "currencies" TEXT[],
    "reason" TEXT,
    "classifiedBy" "ClassifiedBy" NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Headline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsEvent_externalId_key" ON "NewsEvent"("externalId");

-- CreateIndex
CREATE INDEX "NewsEvent_time_idx" ON "NewsEvent"("time");

-- CreateIndex
CREATE UNIQUE INDEX "Headline_externalId_key" ON "Headline"("externalId");

-- CreateIndex
CREATE INDEX "Headline_publishedAt_idx" ON "Headline"("publishedAt");

-- CreateIndex
CREATE INDEX "Headline_impact_publishedAt_idx" ON "Headline"("impact", "publishedAt");

