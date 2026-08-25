import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  REPORT_KINDS,
  RABBIT,
  TelemetryReportSchema,
  detectAnomalies,
  type ReportJob,
} from '@oat/shared';
import type { AppContext } from '../context.js';
import { METRIC } from '../metrics.js';
import {
  createReport,
  getAircraft,
  getHistory,
  getReport,
  insertAlertSuppressed,
  listAircraft,
  listAlerts,
  listReports,
  upsertLatest,
} from '@oat/data';

/**
 * Ingest accepts the telemetry contract plus an optional identity block. An
 * airframe's callsign and operator change rarely, so they ride along rather than
 * needing a separate registration call — the first report for a tail number is
 * enough to make it appear on the fleet view with a name.
 */
const IngestSchema = z.object({
  ...TelemetryReportSchema.shape,
  identity: z
    .object({
      callsign: z.string().max(16).optional(),
      registration: z.string().max(16).optional(),
      type_icao: z.string().max(8).optional(),
      operator: z.string().max(64).optional(),
    })
    .optional(),
});

const AircraftParams = z.object({ aircraft_id: z.string().min(2).max(16) });

export async function registerFleetRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, kafka, rabbit, metrics, log } = ctx;

  // -------------------------------------------------------------------------
  // Ingest
  // -------------------------------------------------------------------------

  app.post(
    '/api/v1/telemetry',
    {
      schema: {
        summary: 'Ingest one telemetry report',
        description:
          'Validates a report, publishes it to Kafka, and updates the current-state ' +
          'projection. Returns once the event is durably accepted into the stream.',
        tags: ['telemetry'],
      },
    },
    async (request, reply) => {
      const parsed = IngestSchema.safeParse(request.body);
      if (!parsed.success) {
        metrics.increment(METRIC.telemetryRejected);
        return reply.status(400).send({
          error: 'invalid_telemetry',
          message: 'Telemetry report failed validation.',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const { identity, ...report } = parsed.data;

      // Publish BEFORE writing the projection.
      //
      // Kafka is the system of record for "this happened". The current-state row
      // is a projection of the stream, so if the projection write fails the next
      // report repairs it and the stream processor still writes history. Doing it
      // the other way round would let the database record a report that no
      // consumer ever sees.
      let eventId: string;
      try {
        const envelope = await kafka.publishTelemetry(report);
        eventId = envelope.event_id;
        metrics.increment(METRIC.kafkaPublished);
      } catch (err) {
        metrics.increment(METRIC.kafkaPublishFailed);
        log.error({ err, aircraft_id: report.aircraft_id }, 'telemetry publish failed');
        return reply.status(503).send({
          error: 'stream_unavailable',
          message:
            'The event stream is not accepting writes. The report was not accepted; retry it.',
        });
      }

      // Best-effort projection. A failure here is logged and counted but does not
      // fail the request, because the event has already been accepted upstream
      // and a client retry would only duplicate it.
      try {
        await upsertLatest(db, report, identity ?? {});
      } catch (err) {
        log.error({ err, aircraft_id: report.aircraft_id }, 'current-state projection failed');
        metrics.increment('projection_failures');
      }

      // Alerts are also raised on the ingest path so the operator sees a critical
      // condition at the moment it is reported, not one stream hop later. The
      // stream processor runs the same pure rules over history; the suppression
      // window in the database is what stops the two paths double-reporting.
      try {
        for (const anomaly of detectAnomalies(report)) {
          await insertAlertSuppressed(db, { aircraft_id: report.aircraft_id, ...anomaly });
        }
      } catch (err) {
        log.warn({ err }, 'inline alert evaluation failed');
      }

      metrics.increment(METRIC.telemetryAccepted);
      return reply.status(202).send({
        accepted: true,
        event_id: eventId,
        aircraft_id: report.aircraft_id,
        topic: 'aircraft.telemetry.v1',
      });
    },
  );

  // -------------------------------------------------------------------------
  // Fleet reads
  // -------------------------------------------------------------------------

  app.get(
    '/api/v1/aircraft',
    { schema: { summary: 'List aircraft with their latest telemetry', tags: ['fleet'] } },
    async (request) => {
      const limit = Number((request.query as Record<string, unknown>)?.limit ?? 500);
      const aircraft = await listAircraft(db, Math.min(Math.max(limit, 1), 1000));
      return { count: aircraft.length, aircraft };
    },
  );

  app.get(
    '/api/v1/aircraft/:aircraft_id',
    { schema: { summary: 'Get one aircraft', tags: ['fleet'] } },
    async (request, reply) => {
      const params = AircraftParams.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'invalid_aircraft_id' });

      const aircraft = await getAircraft(db, params.data.aircraft_id);
      if (!aircraft) return reply.status(404).send({ error: 'not_found' });
      return aircraft;
    },
  );

  app.get(
    '/api/v1/aircraft/:aircraft_id/telemetry',
    { schema: { summary: 'Telemetry history for one aircraft, newest first', tags: ['fleet'] } },
    async (request, reply) => {
      const params = AircraftParams.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'invalid_aircraft_id' });

      const limit = Number((request.query as Record<string, unknown>)?.limit ?? 200);
      const history = await getHistory(
        db,
        params.data.aircraft_id,
        Math.min(Math.max(limit, 1), 1000),
      );
      return { aircraft_id: params.data.aircraft_id, count: history.length, telemetry: history };
    },
  );

  app.get(
    '/api/v1/alerts',
    { schema: { summary: 'Recent alerts across the fleet', tags: ['fleet'] } },
    async (request) => {
      const query = request.query as Record<string, unknown>;
      const limit = Math.min(Math.max(Number(query?.limit ?? 100), 1), 500);
      const aircraftId = typeof query?.aircraft_id === 'string' ? query.aircraft_id : undefined;
      const alerts = await listAlerts(db, { limit, ...(aircraftId ? { aircraftId } : {}) });
      return { count: alerts.length, alerts };
    },
  );

  // -------------------------------------------------------------------------
  // Reports — the asynchronous path
  // -------------------------------------------------------------------------

  const ReportRequestSchema = z.object({
    kind: z.enum(REPORT_KINDS).default('flight_summary'),
    window_minutes: z.number().int().min(1).max(1440).default(60),
    /** Demo-only: makes the worker fail so retry and dead-lettering are visible. */
    inject_failure: z.boolean().default(false),
  });

  app.post(
    '/api/v1/aircraft/:aircraft_id/reports',
    {
      schema: {
        summary: 'Request a report for an aircraft',
        description:
          'Creates a pending report row and enqueues a job. Returns 202 immediately — ' +
          'generation happens on a worker, not in the request.',
        tags: ['reports'],
      },
    },
    async (request, reply) => {
      const params = AircraftParams.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'invalid_aircraft_id' });

      const body = ReportRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.status(400).send({
          error: 'invalid_report_request',
          issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }

      const aircraft = await getAircraft(db, params.data.aircraft_id);
      if (!aircraft) return reply.status(404).send({ error: 'not_found' });

      metrics.increment(METRIC.reportsRequested);

      const reportId = randomUUID();
      await createReport(db, {
        reportId,
        aircraftId: params.data.aircraft_id,
        kind: body.data.kind,
        windowMinutes: body.data.window_minutes,
      });

      const job: ReportJob = {
        job_id: randomUUID(),
        report_id: reportId,
        aircraft_id: params.data.aircraft_id,
        kind: body.data.kind,
        requested_at: new Date().toISOString(),
        window_minutes: body.data.window_minutes,
        inject_failure: body.data.inject_failure,
      };

      try {
        await rabbit.enqueueReport(job);
        metrics.increment(METRIC.reportsEnqueued);
      } catch (err) {
        metrics.increment(METRIC.reportEnqueueFailed);
        log.error({ err, report_id: reportId }, 'report enqueue failed');
        // The row stays 'pending' and is visible as such rather than vanishing.
        return reply.status(503).send({
          error: 'queue_unavailable',
          message: 'The job queue is unavailable. The report was recorded but not scheduled.',
          report_id: reportId,
        });
      }

      return reply.status(202).send({
        report_id: reportId,
        status: 'pending',
        queue: RABBIT.reportQueue,
        poll: `/api/v1/reports/${reportId}`,
      });
    },
  );

  app.get(
    '/api/v1/reports',
    { schema: { summary: 'Recent reports', tags: ['reports'] } },
    async (request) => {
      const limit = Math.min(
        Math.max(Number((request.query as Record<string, unknown>)?.limit ?? 50), 1),
        200,
      );
      const reports = await listReports(db, limit);
      return { count: reports.length, reports };
    },
  );

  app.get(
    '/api/v1/reports/:report_id',
    { schema: { summary: 'Get one report', tags: ['reports'] } },
    async (request, reply) => {
      const params = z.object({ report_id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'invalid_report_id' });

      const report = await getReport(db, params.data.report_id);
      if (!report) return reply.status(404).send({ error: 'not_found' });
      return report;
    },
  );
}
