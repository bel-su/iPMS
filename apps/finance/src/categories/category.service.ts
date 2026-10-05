import { ConflictException } from "@nestjs/common";
import { uuidv7 } from "@ipms/contracts";
import { Prisma, type PrismaClient } from "@prisma-clients/finance";
import { recordAudit } from "../audit.js";
import { notFound, requirePermission, type Actor } from "../common.js";

const MANAGE = "finance_category.manage";

/** The expense categories requests are filed under. Finance maintains them; disabling hides a category without breaking old requests. */
export class CategoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Everyone sees the active ones; those who manage categories also see the disabled. */
  list(actor: Actor) {
    const manages = actor.permissions.includes(MANAGE);
    return this.prisma.expenseCategory.findMany({
      where: manages ? {} : { disabledAt: null },
      orderBy: { code: "asc" },
    });
  }

  async create(dto: { code: string; name: string }, actor: Actor) {
    requirePermission(actor, MANAGE);
    if (
      await this.prisma.expenseCategory.findUnique({
        where: { code: dto.code },
      })
    )
      throw new ConflictException(
        `A category with code ${dto.code} already exists`,
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.expenseCategory.create({
          data: { id: uuidv7(), code: dto.code, name: dto.name },
        });
        await recordAudit(tx, {
          actorId: actor.id,
          action: "finance.category.created",
          objectType: "ExpenseCategory",
          objectId: created.id,
          previousState: {},
          newState: { code: dto.code, name: dto.name },
        });
        return created;
      });
    } catch (e) {
      // Two concurrent creates both pass the pre-check; the loser hits the unique constraint.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException(
          `A category with code ${dto.code} already exists`,
        );
      throw e;
    }
  }

  async update(
    id: string,
    dto: { name?: string; disabled?: boolean },
    actor: Actor,
  ) {
    requirePermission(actor, MANAGE);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.expenseCategory.findUnique({ where: { id } });
      if (!before) throw notFound("Category");
      const updated = await tx.expenseCategory.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.disabled === undefined
            ? {}
            : { disabledAt: dto.disabled ? new Date() : null }),
        },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "finance.category.updated",
        objectType: "ExpenseCategory",
        objectId: id,
        previousState: {
          name: before.name,
          disabled: before.disabledAt !== null,
        },
        newState: { name: updated.name, disabled: updated.disabledAt !== null },
      });
      return updated;
    });
  }
}
