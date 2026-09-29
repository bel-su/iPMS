import { Counter, Gauge, Histogram } from 'prom-client';
import { metricsRegistry } from '@ipms/observability';

const registers = [metricsRegistry];

export const uploadsRegistered = new Counter({ name: 'media_uploads_registered_total', help: 'Files registered for upload', labelNames: ['kind'], registers });
export const uploadsCompleted = new Counter({ name: 'media_uploads_completed_total', help: 'Uploads reported complete by the device', labelNames: ['kind'], registers });
export const verifyDuration = new Histogram({ name: 'media_verify_duration_seconds', help: 'Time to verify one object', buckets: [0.1, 0.5, 1, 5, 15, 60], registers });
export const mediaRejected = new Counter({ name: 'media_rejected_total', help: 'Objects rejected by verification', labelNames: ['reason'], registers });
export const verifyQueueDepth = new Gauge({ name: 'media_verify_queue_depth', help: 'Objects waiting for verification', registers });
export const verifyStuck = new Counter({ name: 'media_verify_stuck_total', help: 'Objects that exhausted verification retries and need an operator', registers });
export const captureToReceipt = new Histogram({
  name: 'media_capture_to_receipt_seconds', help: 'Capture time to upload completion — shows remote sites uploading late',
  buckets: [60, 600, 3600, 21_600, 86_400, 259_200, 604_800], registers,
});
