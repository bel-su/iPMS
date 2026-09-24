import { uuidv7 } from '@ipms/contracts';
import type { AuthzScope } from '@ipms/authz';
import type { IamScopeGranted, IamScopeRevoked } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/project';

/**
 * The local projection of iam's authoritative scope grants.
 *
 * This class is the ONLY writer of `user_scope`. A request handler that writes
 * here has invented authority iam did not grant, and the two will disagree
 * about the same user until someone notices -- which, for an authorization
 * table, means until someone sees data they should not have.
 */
export class UserScopeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async applyGranted(event: IamScopeGranted): Promise<void> {
    try {
      await this.prisma.userScope.create({
        data: {
          id: uuidv7(),
          userId: event.userId,
          level: event.level,
          projectId: event.projectId,
          siteId: event.siteId,
        },
      });
    } catch (err) {
      // P2002 is a unique violation on one of the three partial indexes, which
      // means this exact grant is already projected. At-least-once delivery
      // makes that routine, not exceptional. Swallowing it keeps the handler
      // idempotent without a read-then-write that would race two redeliveries
      // against each other. Anything else rethrows: swallowing a connection
      // failure would leave a silently empty projection that denies every user
      // while looking healthy.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  async applyRevoked(event: IamScopeRevoked): Promise<void> {
    // deleteMany, not delete: a revocation can outrun its grant or arrive
    // twice, and neither is an error. `delete` would throw P2025 on a row that
    // is already gone, and the consumer would retry it five times and
    // dead-letter a message whose desired end state already holds.
    await this.prisma.userScope.deleteMany({
      where: {
        userId: event.userId,
        level: event.level,
        projectId: event.projectId,
        siteId: event.siteId,
      },
    });
  }

  /** Every grant for a user, dropped at once. Used on `iam.user.deactivated`. */
  async clearUser(userId: string): Promise<void> {
    await this.prisma.userScope.deleteMany({ where: { userId } });
  }

  /**
   * The user's replicated scope.
   *
   * A user with nothing projected gets `{ global: false, projectIds: [], siteIds: [] }`,
   * which `scopeWhere` turns into a query matching nothing. That is the same
   * answer an unreplicated projection produces, and it is deliberate: the two
   * are indistinguishable from here, and denying is the only safe reading of
   * both.
   */
  async scopeFor(userId: string): Promise<AuthzScope> {
    const rows = await this.prisma.userScope.findMany({ where: { userId } });
    return {
      global: rows.some((row) => row.level === 'GLOBAL'),
      projectIds: rows.flatMap((row) => (row.level === 'PROJECT' && row.projectId !== null ? [row.projectId] : [])),
      siteIds: rows.flatMap((row) => (row.level === 'SITE' && row.siteId !== null ? [row.siteId] : [])),
    };
  }

  /** True when nothing has ever been replicated. */
  async isEmpty(): Promise<boolean> {
    return (await this.prisma.userScope.count()) === 0;
  }
}
