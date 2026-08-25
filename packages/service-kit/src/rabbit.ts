import type { Channel } from 'amqplib';
import { RABBIT } from '@oat/shared';

/**
 * Declares the job topology.
 *
 * The API and the worker both call this, so whichever starts first creates it
 * and the other finds it already correct. Declarations are idempotent *only* as
 * long as the arguments match exactly — a mismatch is a channel-level error, not
 * a silent no-op — which is why this exists once here rather than being written
 * out separately in each service.
 *
 * The shape:
 *
 *   aircraft.jobs (direct)
 *     └─ report.generate ──> aircraft.report.generate
 *                              │ on reject (no requeue)
 *                              ▼
 *                            aircraft.jobs.dlx (fanout)
 *                              └─> aircraft.report.generate.dlq
 *
 *   aircraft.report.generate.retry   (TTL, no consumer)
 *     └─ expires ──> aircraft.jobs / report.generate   (back to the main queue)
 *
 * Two different destinations for two different failures: a job that might
 * succeed later goes to the retry queue, a job that has exhausted its attempts
 * goes to the DLQ and waits for a human.
 */
export async function assertJobTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(RABBIT.exchange, 'direct', { durable: true });
  await channel.assertExchange(RABBIT.deadLetterExchange, 'fanout', { durable: true });

  await channel.assertQueue(RABBIT.reportQueue, {
    durable: true,
    deadLetterExchange: RABBIT.deadLetterExchange,
  });
  await channel.bindQueue(RABBIT.reportQueue, RABBIT.exchange, RABBIT.reportRoutingKey);

  // No consumer binds to this queue. Messages expire and the broker routes them
  // back to the main queue — the delay is the point.
  await channel.assertQueue(RABBIT.reportRetryQueue, {
    durable: true,
    messageTtl: RABBIT.retryDelayMs,
    deadLetterExchange: RABBIT.exchange,
    deadLetterRoutingKey: RABBIT.reportRoutingKey,
  });

  await channel.assertQueue(RABBIT.reportDlq, { durable: true });
  await channel.bindQueue(RABBIT.reportDlq, RABBIT.deadLetterExchange, '');
}
