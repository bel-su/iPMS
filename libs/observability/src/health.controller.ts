import { Controller, Get } from '@nestjs/common';

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

@Controller('health')
export class HealthController {
  @Get('live')
  async live(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const results: Record<string, 'ok' | 'error'> = {};
    for (const [name, check] of checks) {
      try {
        results[name] = (await check()) ? 'ok' : 'error';
      } catch {
        results[name] = 'error';
      }
    }
    const healthy = Object.values(results).every((r) => r === 'ok');
    return { status: healthy ? 'ok' : 'error', checks: results };
  }
}
