-- AlterTable
ALTER TABLE "TaskAttachment" ADD COLUMN     "sizeBytes" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "kind" SET NOT NULL,
ALTER COLUMN "kind" SET DEFAULT 'OTHER';

-- CreateIndex
CREATE UNIQUE INDEX "TaskAttachment_taskId_kind_fileName_version_key" ON "TaskAttachment"("taskId", "kind", "fileName", "version");

