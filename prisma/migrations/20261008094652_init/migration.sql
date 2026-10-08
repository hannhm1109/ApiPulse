-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('SUCCESS', 'FAILURE', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expectedStatusCode" INTEGER NOT NULL DEFAULT 200,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "checkIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "responseTimeMs" INTEGER,
    "statusCode" INTEGER,
    "status" "CheckStatus" NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "cause" TEXT NOT NULL,
    "firstFailedCheckId" TEXT NOT NULL,
    "recoveryCheckId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Endpoint_enabled_lastCheckedAt_idx" ON "Endpoint"("enabled", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "CheckResult_endpointId_checkedAt_idx" ON "CheckResult"("endpointId", "checkedAt");

-- CreateIndex
CREATE INDEX "Incident_endpointId_status_idx" ON "Incident"("endpointId", "status");

-- CreateIndex
CREATE INDEX "Incident_endpointId_startedAt_idx" ON "Incident"("endpointId", "startedAt");

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_firstFailedCheckId_fkey" FOREIGN KEY ("firstFailedCheckId") REFERENCES "CheckResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_recoveryCheckId_fkey" FOREIGN KEY ("recoveryCheckId") REFERENCES "CheckResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
