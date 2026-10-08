BEGIN;

ALTER TABLE "Endpoint"
ADD COLUMN "checkClaimToken" TEXT,
ADD COLUMN "checkClaimExpiresAt" TIMESTAMPTZ(3);

ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_check_claim_pair_check" CHECK (
    ("checkClaimToken" IS NULL AND "checkClaimExpiresAt" IS NULL)
    OR ("checkClaimToken" IS NOT NULL AND "checkClaimExpiresAt" IS NOT NULL)
);

COMMIT;
