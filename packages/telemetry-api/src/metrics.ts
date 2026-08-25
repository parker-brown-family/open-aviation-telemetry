export { Metrics, type HistogramSnapshot } from '@oat/service-kit';

/**
 * The metric names this service records. Kept as a constant so a typo becomes a
 * compile error rather than a counter that silently never increments — the
 * failure mode where a dashboard shows zero and everyone assumes it means zero.
 */
export const METRIC = {
  httpRequests: 'http_requests',
  httpErrors: 'http_errors',
  telemetryAccepted: 'telemetry_accepted',
  telemetryRejected: 'telemetry_rejected',
  kafkaPublished: 'kafka_events_published',
  kafkaPublishFailed: 'kafka_publish_failures',
  reportsRequested: 'reports_requested',
  reportsEnqueued: 'reports_enqueued',
  reportEnqueueFailed: 'report_enqueue_failures',
} as const;
