-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT';

-- AlterTable
ALTER TABLE "TaskAttachment" ADD COLUMN     "commentId" TEXT;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

