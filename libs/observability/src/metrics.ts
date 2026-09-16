import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new Histogram({
  name: 'ipms_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.025, 0.1, 0.5, 1, 5],
  registers: [metricsRegistry],
});

export const eventsConsumed = new Counter({
  name: 'ipms_events_consumed_total',
  help: 'Events consumed from NATS',
  labelNames: ['subject', 'outcome'],
  registers: [metricsRegistry],
});
