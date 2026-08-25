import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AircraftState } from '@oat/shared';

/**
 * The map-to-scope fallback.
 *
 * This is the claim that lets the map be the default at all: the demonstration
 * gets the good picture AND cannot be broken by the room's network, because the
 * view drops to the self-contained scope on its own when tiles do not arrive.
 * If that stops working, the default view becomes a grey rectangle in front of
 * a hiring manager — so it is worth a test rather than a hope.
 *
 * TacticalMap is mocked here on purpose. Instantiating Leaflet in jsdom to
 * assert a piece of React state would be slow and would test Leaflet; the mock
 * exposes the one thing that matters, which is the callback that reports the
 * basemap unreachable.
 */

const tilesUnavailable = vi.fn();

vi.mock('./TacticalMap.js', () => ({
  TacticalMap: ({ onTilesUnavailable }: { onTilesUnavailable?: () => void }) => {
    tilesUnavailable.mockImplementation(() => onTilesUnavailable?.());
    return <div data-testid="tactical-map" />;
  },
}));

vi.mock('./PlanView.js', () => ({
  PlanView: () => <div data-testid="plan-view" />,
}));

const { FleetView } = await import('./FleetView.js');

function aircraft(): AircraftState {
  return {
    aircraft_id: 'C-GABC',
    callsign: 'OKA101',
    registration: 'C-GABC',
    type_icao: 'DH8D',
    operator: 'Okanagan Air',
    status: 'active',
    flight_phase: 'cruise',
    first_seen: '2026-08-25T17:00:00.000Z',
    last_seen: '2026-08-25T18:00:00.000Z',
    latest: {
      aircraft_id: 'C-GABC',
      timestamp: '2026-08-25T18:00:00.000Z',
      position: { latitude: 49.9561, longitude: -119.3777 },
      altitude_ft: 24000,
      groundspeed_kts: 360,
      heading_deg: 90,
      vertical_rate_fpm: 0,
      engine: { temperature_c: 92, rpm: 2200 },
      source: 'simulated',
    },
  };
}

describe('FleetView', () => {
  it('shows the map by default, because it is the better picture', () => {
    render(<FleetView aircraft={[aircraft()]} />);
    expect(screen.getByTestId('tactical-map')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-view')).toBeNull();
  });

  it('can be switched to the scope by hand', async () => {
    render(<FleetView aircraft={[aircraft()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
    expect(screen.getByTestId('plan-view')).toBeInTheDocument();
    expect(screen.queryByTestId('tactical-map')).toBeNull();
  });

  it('honours an explicit initial mode', () => {
    render(<FleetView aircraft={[aircraft()]} initialMode="scope" />);
    expect(screen.getByTestId('plan-view')).toBeInTheDocument();
  });

  it('marks the active view as pressed, so the switch reads as a switch', async () => {
    render(<FleetView aircraft={[aircraft()]} />);
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
    expect(screen.getByRole('button', { name: 'Scope' })).toHaveAttribute('aria-pressed', 'true');
  });

  describe('when the basemap cannot be reached', () => {
    it('falls back to the scope without being asked', async () => {
      render(<FleetView aircraft={[aircraft()]} />);
      expect(screen.getByTestId('tactical-map')).toBeInTheDocument();

      tilesUnavailable();

      await waitFor(() => expect(screen.getByTestId('plan-view')).toBeInTheDocument());
      expect(screen.queryByTestId('tactical-map')).toBeNull();
    });

    it('says why, rather than silently changing the view', async () => {
      render(<FleetView aircraft={[aircraft()]} />);
      tilesUnavailable();
      await waitFor(() => expect(screen.getByText(/basemap unreachable/i)).toBeInTheDocument());
    });

    it('disables the Map button so it cannot be chosen back into a blank rectangle', async () => {
      render(<FleetView aircraft={[aircraft()]} />);
      tilesUnavailable();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Map' })).toBeDisabled());
    });
  });

  it('shows the altitude legend only alongside the map it explains', async () => {
    // Query the legend container, not its text: two bands legitimately contain
    // "30,000 ft" ("30,000 ft +" and "20–30,000 ft"), so a text match is
    // ambiguous by design rather than by accident.
    const { container } = render(<FleetView aircraft={[aircraft()]} />);
    expect(container.querySelector('.alt-legend')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
    expect(container.querySelector('.alt-legend')).toBeNull();
  });
});
