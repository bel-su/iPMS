export type VersionAcceptance = { ok: true } | { ok: false; reason: 'DISABLED' | 'NOT_PUBLISHED' | 'SUPERSEDED' };

const DAY_MS = 86_400_000;

export function acceptVersion(
  version: { status: string; retiredAt: Date | null },
  template: { disabledAt: Date | null },
  now: Date,
  graceDays: number,
): VersionAcceptance {
  if (template.disabledAt) return { ok: false, reason: 'DISABLED' };
  if (version.status === 'PUBLISHED') return { ok: true };
  if (version.status === 'RETIRED') {
    const withinGrace = version.retiredAt !== null && version.retiredAt.getTime() > now.getTime() - graceDays * DAY_MS;
    return withinGrace ? { ok: true } : { ok: false, reason: 'SUPERSEDED' };
  }
  return { ok: false, reason: 'NOT_PUBLISHED' };
}
