import type { ReactNode } from 'react';

export type Tone = 'default' | 'olive' | 'amber' | 'red';

export function StatTile({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <div className={`tile${tone === 'default' ? '' : ` tile--${tone}`}`}>
      <div className="tile__label">{label}</div>
      <div className="tile__value">{value}</div>
      {note ? <div className="tile__note">{note}</div> : null}
    </div>
  );
}

/**
 * A status pill. The class is derived from the status string so a new status
 * value gets neutral styling rather than silently inheriting another's colour.
 */
export function Pill({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}): React.JSX.Element {
  return <span className={`pill pill--${status}`}>{children ?? status.replace(/_/g, ' ')}</span>;
}

export function Panel({
  title,
  actions,
  children,
  bodyClassName,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}): React.JSX.Element {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{title}</h2>
        {actions}
      </div>
      <div className={bodyClassName ?? 'panel__body'}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="empty">{children}</div>;
}

/**
 * A live-data heartbeat.
 *
 * On a page where every figure updates in place, a frozen page and a quiet
 * period look identical. This is the only element that distinguishes them: it
 * pulses while data is arriving and goes amber-and-still when the last update
 * is older than it should be.
 */
export function Pulse({
  capturedAt,
  staleAfterMs = 8000,
  nowMs = Date.now(),
}: {
  capturedAt: string | null | undefined;
  staleAfterMs?: number;
  nowMs?: number;
}): React.JSX.Element {
  const age = capturedAt ? nowMs - Date.parse(capturedAt) : Number.POSITIVE_INFINITY;
  const stale = !Number.isFinite(age) || age > staleAfterMs;
  return (
    <span
      className={`pulse${stale ? ' pulse--stale' : ''}`}
      role="status"
      aria-label={stale ? 'Data is stale' : 'Data is live'}
      title={stale ? `No update for ${since(capturedAt, nowMs)}` : 'Live'}
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="error" role="alert">
      {children}
    </div>
  );
}

/** Formats a number with thousands separators and a stable width. */
export function num(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-CA', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Relative time, e.g. "12s ago". Kept short so it fits in a table cell. */
export function since(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '—';
  const deltaS = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (deltaS < 60) return `${deltaS}s ago`;
  if (deltaS < 3600) return `${Math.floor(deltaS / 60)}m ago`;
  if (deltaS < 86_400) return `${Math.floor(deltaS / 3600)}h ago`;
  return `${Math.floor(deltaS / 86_400)}d ago`;
}
