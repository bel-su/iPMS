import { Controller, Get, Header } from '@nestjs/common';
import { metricsRegistry } from './metrics.js';

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Content-Type', () => metricsRegistry.contentType)
  async metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
