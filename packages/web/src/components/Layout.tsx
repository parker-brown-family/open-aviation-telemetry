import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useDataSource } from '../data-source.js';
import { CompassRose } from './CompassRose.js';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/fleet', label: 'Fleet' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/architecture', label: 'Architecture' },
  { to: '/research', label: 'Research' },
  { to: '/training', label: 'Training' },
  { to: '/demo', label: 'Demo console' },
];

/**
 * The data-source banner.
 *
 * Always rendered, never dismissible. It is the first thing on the page after
 * the masthead because everything below it is only meaningful in the context of
 * where the numbers came from.
 */
function DataSourceBanner(): React.JSX.Element {
  const { mode, apiBaseUrl, reason, recheck } = useDataSource();

  if (mode === 'probing') {
    return (
      <div className="banner banner--probing" role="status">
        <span>Checking for a live API at {apiBaseUrl}…</span>
      </div>
    );
  }

  if (mode === 'live') {
    return (
      <div className="banner banner--live" role="status">
        <span>
          <strong>LIVE</strong> — connected to the API at <code>{apiBaseUrl}</code>. Fleet,
          telemetry, alert, consumer-lag and queue figures below are measured from the running
          system. Figures on the Architecture page marked <em>simulated</em> are not.
        </span>
      </div>
    );
  }

  return (
    <div className="banner banner--sample" role="status">
      <span>
        <strong>SAMPLE DATA</strong> — no API is attached to this page, so nothing here is being
        measured. Everything shown is a bundled sample dataset built from the same reference data
        the simulator uses. Run the full stack with <code>make demo</code> to see live figures.{' '}
        {reason ? <span className="faint">({reason})</span> : null}
      </span>
      <button type="button" className="small" onClick={recheck}>
        Re-check
      </button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead__mark">
          <CompassRose />
          Open Aviation Telemetry
        </span>
        <span className="masthead__sub">
          An open-source AWS reference architecture — EKS · RDS · MSK · Amazon MQ · Terraform
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <a
            href="https://github.com/parker-brown-family/open-aviation-telemetry"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source on GitHub
          </a>
        </span>
      </header>

      <div>
        <DataSourceBanner />
        <nav className="nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="page">{children}</main>
    </div>
  );
}
