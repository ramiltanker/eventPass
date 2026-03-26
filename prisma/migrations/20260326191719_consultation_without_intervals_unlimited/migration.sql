-- DropIndex
DROP INDEX "Booking_consultationId_key";

-- CreateIndex
CREATE INDEX "Booking_consultationId_idx" ON "Booking"("consultationId");
