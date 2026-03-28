/*
  Warnings:

  - A unique constraint covering the columns `[consultationId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "consultationId" INTEGER,
ALTER COLUMN "slotId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "withoutIntervals" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "slotDurationMinutes" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_consultationId_key" ON "Booking"("consultationId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
