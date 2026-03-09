/*
  Warnings:

  - Made the column `tokenEncrypted` on table `TeacherInvite` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "TeacherInvite" ALTER COLUMN "tokenEncrypted" SET NOT NULL;
