-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'READY_FOR_PRODUCTION');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "contentPillar" TEXT,
ADD COLUMN     "hook" TEXT,
ADD COLUMN     "scriptStatus" "ScriptStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "ScriptScene" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "shotDescription" TEXT NOT NULL,
    "cameraAngle" TEXT,
    "visualAction" TEXT,
    "dialogue" TEXT,
    "onScreenText" TEXT,
    "audio" TEXT,
    "props" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptRevision" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScriptScene_taskId_position_key" ON "ScriptScene"("taskId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptRevision_taskId_version_key" ON "ScriptRevision"("taskId", "version");

-- AddForeignKey
ALTER TABLE "ScriptScene" ADD CONSTRAINT "ScriptScene_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptRevision" ADD CONSTRAINT "ScriptRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
