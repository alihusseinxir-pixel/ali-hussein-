-- CreateEnum
CREATE TYPE "ShootStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistPhase" AS ENUM ('PRE_PRODUCTION', 'SHOOT_DAY', 'HANDOVER', 'EQUIPMENT');

-- CreateTable
CREATE TABLE "Talent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Talent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "mapUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ShootStatus" NOT NULL DEFAULT 'PLANNED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "callTime" TIMESTAMP(3),
    "locationId" TEXT,
    "photographerId" TEXT,
    "videographerId" TEXT,
    "directorId" TEXT,
    "requiredItems" TEXT,
    "shotList" TEXT,
    "prepNotes" TEXT,
    "budget" DECIMAL(12,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ShootSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootContent" (
    "shootId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "ShootContent_pkey" PRIMARY KEY ("shootId","taskId")
);

-- CreateTable
CREATE TABLE "ShootTalent" (
    "shootId" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,

    CONSTRAINT "ShootTalent_pkey" PRIMARY KEY ("shootId","talentId")
);

-- CreateTable
CREATE TABLE "ShootChecklistItem" (
    "id" TEXT NOT NULL,
    "shootId" TEXT NOT NULL,
    "phase" "ChecklistPhase" NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "ShootChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Talent_organizationId_idx" ON "Talent"("organizationId");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "ShootSession_organizationId_startsAt_idx" ON "ShootSession"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "ShootSession_photographerId_idx" ON "ShootSession"("photographerId");

-- CreateIndex
CREATE INDEX "ShootSession_videographerId_idx" ON "ShootSession"("videographerId");

-- CreateIndex
CREATE INDEX "ShootSession_directorId_idx" ON "ShootSession"("directorId");

-- CreateIndex
CREATE INDEX "ShootContent_taskId_idx" ON "ShootContent"("taskId");

-- CreateIndex
CREATE INDEX "ShootTalent_talentId_idx" ON "ShootTalent"("talentId");

-- CreateIndex
CREATE INDEX "ShootChecklistItem_shootId_phase_position_idx" ON "ShootChecklistItem"("shootId", "phase", "position");

-- AddForeignKey
ALTER TABLE "Talent" ADD CONSTRAINT "Talent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootSession" ADD CONSTRAINT "ShootSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootSession" ADD CONSTRAINT "ShootSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootSession" ADD CONSTRAINT "ShootSession_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootSession" ADD CONSTRAINT "ShootSession_videographerId_fkey" FOREIGN KEY ("videographerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootSession" ADD CONSTRAINT "ShootSession_directorId_fkey" FOREIGN KEY ("directorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootContent" ADD CONSTRAINT "ShootContent_shootId_fkey" FOREIGN KEY ("shootId") REFERENCES "ShootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootContent" ADD CONSTRAINT "ShootContent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootTalent" ADD CONSTRAINT "ShootTalent_shootId_fkey" FOREIGN KEY ("shootId") REFERENCES "ShootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootTalent" ADD CONSTRAINT "ShootTalent_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootChecklistItem" ADD CONSTRAINT "ShootChecklistItem_shootId_fkey" FOREIGN KEY ("shootId") REFERENCES "ShootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
