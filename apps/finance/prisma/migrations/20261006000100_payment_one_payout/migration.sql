-- A request is paid out at most once: one PAYOUT row per request. Cash returns
-- (CASH_RETURN) are not limited. A partial index, so it lives in SQL only;
-- Prisma cannot express it in schema.prisma.
CREATE UNIQUE INDEX "payment_one_payout_per_request" ON "payment"("requestId") WHERE "kind" = 'PAYOUT';
