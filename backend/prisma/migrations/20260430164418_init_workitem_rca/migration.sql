-- CreateEnum
CREATE TYPE "WorkItemState" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "state" "WorkItemState" NOT NULL DEFAULT 'OPEN',
    "firstSignalAt" TIMESTAMP(3) NOT NULL,
    "lastSignalAt" TIMESTAMP(3) NOT NULL,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "mttrMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RCA" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "incidentStart" TIMESTAMP(3) NOT NULL,
    "incidentEnd" TIMESTAMP(3) NOT NULL,
    "rootCauseCategory" TEXT NOT NULL,
    "fixApplied" TEXT NOT NULL,
    "preventionSteps" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RCA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RCA_workItemId_key" ON "RCA"("workItemId");

-- AddForeignKey
ALTER TABLE "RCA" ADD CONSTRAINT "RCA_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
