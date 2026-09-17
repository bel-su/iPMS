import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PrismaBaseService } from '@ipms/persistence';

/**
 * Wires Prisma Client to the audit service's own database via a driver
 * adapter (required as of Prisma ORM 7 — there is no default connection
 * string wiring left on the client constructor).
 *
 * Reads AUDIT_DATABASE_URL, not DATABASE_URL: `audit` owns the `ipms_audit`
 * database, and DATABASE_URL is reserved for the Prisma CLI's own migration
 * tooling (see prisma.config.ts).
 */
@Injectable()
export class PrismaService extends PrismaBaseService {
  protected readonly client: PrismaClient;

  constructor() {
    super();
    const connectionString = process.env['AUDIT_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('AUDIT_DATABASE_URL is not set');
    }
    const adapter = new PrismaPg({ connectionString });
    this.client = new PrismaClient({ adapter });
  }

  get db(): PrismaClient {
    return this.client;
  }
}
