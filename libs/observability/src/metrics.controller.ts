import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@ipms/authz';
import { metricsRegistry } from './metrics.js';

// Prometheus scrapes carry no token.
@Public()
@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Content-Type', () => metricsRegistry.contentType)
  async metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
