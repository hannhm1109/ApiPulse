-- A resolved incident must not prevent a later unhealthy period from opening.
CREATE UNIQUE INDEX "Incident_one_open_per_endpoint_idx"
ON "Incident" ("endpointId") WHERE "status" = 'OPEN';

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_resolution_state_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "recoveryCheckId" IS NULL)
    OR
    ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL
        AND "recoveryCheckId" IS NOT NULL AND "resolvedAt" >= "startedAt")
);
