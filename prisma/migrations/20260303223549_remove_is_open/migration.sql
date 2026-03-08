/*
  Warnings:

  - You are about to drop the column `isOpen` on the `Consultation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Consultation" DROP COLUMN "isOpen";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "middleName" DROP NOT NULL;
