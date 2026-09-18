import type { AuthzOverride } from './types.js';

/**
 * Whether an override is in force at `now`.
 *
 * `check()` imports this same predicate rather than keeping a copy, so the
 * validity window a token claim is resolved against and the one the guard
 * evaluates cannot drift apart by a boundary instant.
 */
export function withinValidity(o: AuthzOverride, now: Date): boolean {
  if (o.validFrom && now < o.validFrom) return false;
  if (o.validUntil && now > o.validUntil) return false;
  return true;
}

/** Global: applies wherever the user acts, so it can be folded into a token claim. */
function isGlobal(o: AuthzOverride): boolean {
  return o.projectId === null && o.siteId === null;
}

/**
 * The permission set a user effectively holds, role grants plus global
 * overrides, resolved the same way `check()` resolves them.
 *
 * The architecture puts permission *codes* in the JWT and replicates
 * project/site scope separately (§6 of the architecture design: the split is by
 * volatility). Global overrides are permission-shaped — they apply wherever the
 * user acts — so they belong in the claim; scoped overrides are resource-shaped
 * and cannot be, because a claim carries no resource to scope them against.
 * Folding a project-scoped DENY into the claim would silently apply it to every
 * project. Those reach `check()` through `OVERRIDE_PROVIDER` instead.
 *
 * This is the single implementation used by both token issuance
 * (`AuthService.login`/`refresh`) and the effective-permissions read
 * (`EffectiveService.forUser`). They must not have separate copies: the whole
 * point of the read endpoint is to tell an operator what enforcement will do,
 * and a second implementation is a second answer.
 *
 * Ordering is load-bearing. ALLOW is applied first and DENY second, and DENY
 * wins unconditionally — never "last row wins", which would make the outcome
 * depend on a database iteration order. This matches `check()`, whose DENY gate
 * runs *before* it asks whether the permission is held at all.
 */
export function resolvePermissions(
  rolePermissions: string[],
  overrides: AuthzOverride[],
  now: Date,
): string[] {
  const live = overrides.filter((o) => isGlobal(o) && withinValidity(o, now));
  const resolved = new Set(rolePermissions);

  for (const o of live) {
    if (o.effect === 'ALLOW') resolved.add(o.permission);
  }
  // Second pass, unconditionally: a DENY outranks both a role grant and an
  // ALLOW override for the same code, whatever order the rows arrived in.
  for (const o of live) {
    if (o.effect === 'DENY') resolved.delete(o.permission);
  }

  return [...resolved];
}
