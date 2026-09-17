import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '@ipms/authz';

export type ReadinessCheck = () => Promise<boolean>;

const checks = new Map<string, ReadinessCheck>();

export function registerReadinessCheck(name: string, check: ReadinessCheck): void {
  checks.set(name, check);
}

export function resetReadinessChecks(): void {
  checks.clear();
}

export interface ReadinessResult {
  status: 'ok' | 'error';
  checks: Record<string, 'ok' | 'error'>;
}

// Orchestrator liveness/readiness probes carry no token.
@Public()
@Controller('health')
export class HealthController {
  @Get('live')
  async live(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const outcomes = await Promise.all(
      Array.from(checks.entries()).map(async ([name, check]): Promise<[string, 'ok' | 'error']> => {
        try {
          return [name, (await check()) ? 'ok' : 'error'];
        } catch {
          return [name, 'error'];
        }
      }),
    );

    const results: Record<string, 'ok' | 'error'> = {};
    for (const [name, status] of outcomes) {
      results[name] = status;
    }

    const healthy = Object.values(results).every((r) => r === 'ok');
    const result: ReadinessResult = { status: healthy ? 'ok' : 'error', checks: results };

    if (!healthy) {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }
}
