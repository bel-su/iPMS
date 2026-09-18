import { Injectable } from '@nestjs/common';
import { hashPassword, verifyPassword } from './password.js';

/**
 * Injectable wrapper over ./password.js. The parameters and the verify-never-
 * throws behaviour live there so the Prisma seed can reuse them without
 * importing Nest; see that file's comment.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    return verifyPassword(hash, plain);
  }
}
