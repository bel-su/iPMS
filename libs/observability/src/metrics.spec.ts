import { describe, expect, it } from 'vitest';
import { metricsRegistry } from './metrics.js';

describe('metricsRegistry', () => {
  it('exposes the custom metric names plus default metrics after import', async () => {
    const names = (await metricsRegistry.getMetricsAsJSON()).map((metric) => metric.name);

    expect(names).toContain('ipms_http_request_duration_seconds');
    expect(names).toContain('ipms_events_consumed_total');
    // Default metrics (collectDefaultMetrics) register process/runtime metrics;
    // a registry that silently failed to register default metrics would only
    // contain the two custom ones above.
    expect(names.length).toBeGreaterThan(2);
  });
});
