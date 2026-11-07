-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('MARKET', 'LIMIT');

-- AlterEnum
ALTER TYPE "PaperStatus" ADD VALUE 'NOT_FILLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SweepType" ADD VALUE 'ASH';
ALTER TYPE "SweepType" ADD VALUE 'ASL';
ALTER TYPE "SweepType" ADD VALUE 'H4H';
ALTER TYPE "SweepType" ADD VALUE 'H4L';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "entryType" "EntryType" NOT NULL DEFAULT 'MARKET',
ADD COLUMN     "entryValidUntil" TIMESTAMP(3);

