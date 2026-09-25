import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import { PrismaClient } from '@prisma-clients/notification';
import { PrismaBaseService } from '@ipms/persistence';

@Injectable()
export class PrismaService extends PrismaBaseService {
  protected readonly client: PrismaClient;

  constructor() {
    super();
    const connectionString = process.env['NOTIFICATION_DATABASE_URL'];
    if (!connectionString) throw new Error('NOTIFICATION_DATABASE_URL is not set');
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  get db(): PrismaClient {
    return this.client;
  }
}
