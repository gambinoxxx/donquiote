-- CreateEnum
CREATE TYPE "StrategyMode" AS ENUM ('LIVE', 'TEST', 'OFF');

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "strategyId" TEXT NOT NULL,
    "mode" "StrategyMode" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyConfig_pkey" PRIMARY KEY ("strategyId")
);
