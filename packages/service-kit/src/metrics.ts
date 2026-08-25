/**
 * A deliberately small metrics registry.
 *
 * These are real counters incremented by real request handling, not display
 * values — the dashboard's "API requests" tile and the /metrics endpoint read
 * the same numbers. A production deployment would scrape /metrics with the
 * CloudWatch agent or Prometheus; nothing here assumes a particular scraper.
 *
 * Pulling in a full client library would add a dependency for maybe eighty
 * lines of code, and would hide what a counter and a histogram actually are
 * from anyone reading this project to learn from it.
 */

export interface HistogramSnapshot {
  count: number;
  sum: number;
  buckets: Record<string, number>;
  p50: number;
  p95: number;
  p99: number;
}

const LATENCY_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

class Histogram {
  private readonly values: number[] = [];
  private sum = 0;
  /** Ring buffer: quantiles come from a bounded recent sample, so memory is flat. */
  private readonly capacity = 2048;
  private cursor = 0;
  private total = 0;

  observe(value: number): void {
    this.sum += value;
    this.total += 1;
    if (this.values.length < this.capacity) {
      this.values.push(value);
    } else {
      this.values[this.cursor] = value;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
  }

  snapshot(): HistogramSnapshot {
    const sorted = [...this.values].sort((a, b) => a - b);
    const quantile = (q: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
      return sorted[idx] ?? 0;
    };
    const buckets: Record<string, number> = {};
    for (const bound of LATENCY_BUCKETS_MS) {
      buckets[String(bound)] = sorted.filter((v) => v <= bound).length;
    }
    buckets['+Inf'] = sorted.length;
    return {
      count: this.total,
      sum: Number(this.sum.toFixed(3)),
      buckets,
      p50: Number(quantile(0.5).toFixed(2)),
      p95: Number(quantile(0.95).toFixed(2)),
      p99: Number(quantile(0.99).toFixed(2)),
    };
  }
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  readonly requestLatency = new Histogram();
  readonly startedAt = Date.now();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  get(name: string): number {
    return this.counters.get(name) ?? this.gauges.get(name) ?? 0;
  }

  observeLatency(ms: number): void {
    this.requestLatency.observe(ms);
  }

  uptimeSeconds(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  toJSON(): Record<string, unknown> {
    return {
      uptime_seconds: this.uptimeSeconds(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      request_latency_ms: this.requestLatency.snapshot(),
    };
  }

  /** Prometheus text exposition format, version 0.0.4. */
  toPrometheus(): string {
    const lines: string[] = [];
    lines.push('# HELP oat_uptime_seconds Seconds since process start.');
    lines.push('# TYPE oat_uptime_seconds gauge');
    lines.push(`oat_uptime_seconds ${this.uptimeSeconds()}`);

    for (const [name, value] of this.counters) {
      const metric = `oat_${name}_total`;
      lines.push(`# TYPE ${metric} counter`);
      lines.push(`${metric} ${value}`);
    }
    for (const [name, value] of this.gauges) {
      const metric = `oat_${name}`;
      lines.push(`# TYPE ${metric} gauge`);
      lines.push(`${metric} ${value}`);
    }

    const h = this.requestLatency.snapshot();
    lines.push('# HELP oat_http_request_duration_ms Request duration in milliseconds.');
    lines.push('# TYPE oat_http_request_duration_ms histogram');
    for (const [bound, count] of Object.entries(h.buckets)) {
      lines.push(`oat_http_request_duration_ms_bucket{le="${bound}"} ${count}`);
    }
    lines.push(`oat_http_request_duration_ms_sum ${h.sum}`);
    lines.push(`oat_http_request_duration_ms_count ${h.count}`);

    return `${lines.join('\n')}\n`;
  }
}
