-- Global reach as a first-class, replicable grant.
--
-- Until now nothing in the platform ever set AuthzScope.global: toScope()
-- hardcoded false, no table granted it, and the seed created no scope rows at
-- all. That was invisible because no service enforced scope at query level.
-- `project` is the first that does, and without a row here the seeded
-- SUPER_ADMIN holds every permission and can see nothing.
--
-- A plain UNIQUE is correct here, unlike on user_role: userId is NOT NULL, so
-- the NULL-distinctness hazard that forced three partial indexes there does
-- not apply.
CREATE TABLE "user_global_scope" (
  "id" uuid PRIMARY KEY,
  "userId" uuid NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
