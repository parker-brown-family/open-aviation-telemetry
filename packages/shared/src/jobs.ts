import { z } from 'zod';

/**
 * RabbitMQ carries *commands* — a specific unit of work, done once, by one
 * worker, with an acknowledgement. Kafka carries *facts* — something happened,
 * read by anyone, replayable. Report generation is a command, so it lives here.
 * See docs/adr/0005-rabbitmq-for-work-items.md.
 */
export const RABBIT = {
  exchange: 'aircraft.jobs',
  deadLetterExchange: 'aircraft.jobs.dlx',
  reportQueue: 'aircraft.report.generate',
  /**
   * The delay queue. A failed job is published here, sits for retryDelayMs with
   * no consumer attached, and is then dead-lettered *back* to the main queue by
   * the broker. That is how you get a delayed retry out of RabbitMQ without a
   * plugin and without a worker holding a message open while it sleeps.
   */
  reportRetryQueue: 'aircraft.report.generate.retry',
  reportDlq: 'aircraft.report.generate.dlq',
  reportRoutingKey: 'report.generate',
  retryDelayMs: 5000,
} as const;

/** After this many failed attempts a job is dead-lettered instead of retried forever. */
export const MAX_JOB_ATTEMPTS = 3;

/** Header carrying the attempt count across a retry cycle. */
export const ATTEMPT_HEADER = 'x-oat-attempt';

export const REPORT_KINDS = ['flight_summary', 'maintenance_summary'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ReportJobSchema = z.object({
  job_id: z.string().uuid(),
  report_id: z.string().uuid(),
  aircraft_id: z.string(),
  kind: z.enum(REPORT_KINDS),
  requested_at: z.string().datetime({ offset: true }),
  window_minutes: z.number().int().min(1).max(1440).default(60),
  /**
   * Demo affordance: makes the worker throw so a reviewer can watch retry and
   * dead-lettering actually happen. Never set by normal application code.
   */
  inject_failure: z.boolean().default(false),
});

export type ReportJob = z.infer<typeof ReportJobSchema>;

export interface ReportRecord {
  report_id: string;
  aircraft_id: string;
  kind: ReportKind;
  status: ReportStatus;
  attempts: number;
  requested_at: string;
  completed_at: string | null;
  error: string | null;
  payload: FlightSummary | null;
}

export interface FlightSummary {
  aircraft_id: string;
  window_minutes: number;
  samples: number;
  first_sample_at: string | null;
  last_sample_at: string | null;
  distance_nm: number;
  max_altitude_ft: number;
  max_groundspeed_kts: number;
  avg_groundspeed_kts: number;
  max_engine_temp_c: number;
  alerts_in_window: number;
  generated_at: string;
}
