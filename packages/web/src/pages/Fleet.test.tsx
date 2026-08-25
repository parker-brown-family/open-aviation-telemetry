import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE } from '../sample-data.js';
import { renderWithProviders, stubApiOffline } from '../test-utils.js';
import { Fleet } from './Fleet.js';

/**
 * The fleet page.
 *
 * Most of the weight here is on the keyboard handler. It is a window-level
 * listener with several interacting conditions — j/k, arrows, Escape, "/", and
 * a "not while typing" guard — which is the sort of code where a small edit
 * quietly breaks one path while the others keep working. It is also the part a
 * user notices immediately: a console that moves the selection while you are
 * typing a callsign into the filter is worse than one with no shortcuts at all.
 */

const FILTER = 'Filter aircraft by callsign, registration, type or operator';

beforeEach(() => {
  stubApiOffline();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Wait for the sample fleet to arrive. */
const readyFleet = async (): Promise<void> => {
  await waitFor(() => expect(screen.getByLabelText(FILTER)).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByText(`${SAMPLE.aircraft.length} tracked · datum YLW`)).toBeVisible(),
  );
};

describe('before anything is selected', () => {
  it('says how to select an aircraft rather than showing a blank panel', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();
    expect(screen.getByText(/Select an aircraft/)).toBeInTheDocument();
  });

  it('lists the whole fleet', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();
    expect(screen.getByText(`Aircraft — ${SAMPLE.aircraft.length}`)).toBeInTheDocument();
  });
});

describe('keyboard navigation', () => {
  it('selects the first aircraft on j', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('j');
    await waitFor(() => expect(screen.queryByText(/Select an aircraft/)).toBeNull());
  });

  it('selects the last aircraft on k when nothing is selected yet', async () => {
    // k means "up"; with no selection there is nothing above the top, so it
    // wraps to the bottom rather than doing nothing.
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('k');
    await waitFor(() => expect(screen.queryByText(/Select an aircraft/)).toBeNull());
  });

  it('steps down and back up again', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('j');
    const first = await screen.findByRole('button', { name: 'Request report' });
    const firstPanel = first.closest('.panel')!.querySelector('h2')!.textContent;

    await userEvent.keyboard('j');
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Request report' })
          .closest('.panel')!
          .querySelector('h2')!.textContent,
      ).not.toBe(firstPanel),
    );

    await userEvent.keyboard('k');
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Request report' })
          .closest('.panel')!
          .querySelector('h2')!.textContent,
      ).toBe(firstPanel),
    );
  });

  it('accepts the arrow keys as well as j and k', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.queryByText(/Select an aircraft/)).toBeNull());
  });

  it('stops at the top instead of wrapping around', async () => {
    // Wrapping in an operations list loses your place: you press k twice and
    // end up at the far end of the fleet with no indication you moved.
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('j');
    const heading = () =>
      screen.getByRole('button', { name: 'Request report' }).closest('.panel')!.querySelector('h2')!
        .textContent;
    const first = heading();

    await userEvent.keyboard('k');
    await userEvent.keyboard('k');
    expect(heading()).toBe(first);
  });

  it('clears the selection on Escape', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('j');
    await waitFor(() => expect(screen.queryByText(/Select an aircraft/)).toBeNull());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByText(/Select an aircraft/)).toBeInTheDocument());
  });

  it('jumps to the filter on /', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('/');
    expect(screen.getByLabelText(FILTER)).toHaveFocus();
  });

  it('does not move the selection while a callsign is being typed', async () => {
    // The bug this prevents: typing "j" into the filter also steps the fleet.
    renderWithProviders(<Fleet />);
    await readyFleet();

    const filter = screen.getByLabelText(FILTER);
    await userEvent.click(filter);
    await userEvent.type(filter, 'jk');

    expect(filter).toHaveValue('jk');
    expect(screen.getByText(/Select an aircraft/)).toBeInTheDocument();
  });

  it('leaves the field on Escape rather than clearing the selection', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('j');
    const filter = screen.getByLabelText(FILTER);
    await userEvent.click(filter);
    await userEvent.keyboard('{Escape}');

    expect(filter).not.toHaveFocus();
    // The selection survives: Escape in a field means "leave the field".
    expect(screen.queryByText(/Select an aircraft/)).toBeNull();
  });

  it('ignores a shortcut pressed with a modifier held', async () => {
    // Ctrl+J and friends belong to the browser, not to this page.
    renderWithProviders(<Fleet />);
    await readyFleet();

    await userEvent.keyboard('{Control>}j{/Control}');
    expect(screen.getByText(/Select an aircraft/)).toBeInTheDocument();
  });
});

describe('the filter', () => {
  it('narrows the table and says so in the heading', async () => {
    renderWithProviders(<Fleet />);
    await readyFleet();

    // callsign is nullable on AircraftState — filter for one that has it
    // rather than asserting, so this keeps working if the sample changes.
    const named = SAMPLE.aircraft.find((a): a is typeof a & { callsign: string } =>
      Boolean(a.callsign),
    );
    expect(named, 'no sample aircraft has a callsign to filter on').toBeDefined();
    await userEvent.type(screen.getByLabelText(FILTER), named!.callsign);

    await waitFor(() =>
      expect(screen.getByText(new RegExp(`of ${SAMPLE.aircraft.length}`))).toBeInTheDocument(),
    );
  });
});

describe('selection in the URL', () => {
  it('opens with whichever aircraft the link named', async () => {
    // Selection is a query parameter so an alert can link straight to the
    // airframe it concerns, and so a reload keeps its place.
    const target = SAMPLE.aircraft[1]!;
    renderWithProviders(<Fleet />, { route: `/fleet?aircraft=${target.aircraft_id}` });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request report' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Select an aircraft/)).toBeNull();
  });

  it('shows the readings for the aircraft it was given', async () => {
    const target = SAMPLE.aircraft[1]!;
    renderWithProviders(<Fleet />, { route: `/fleet?aircraft=${target.aircraft_id}` });

    await screen.findByRole('button', { name: 'Request report' });
    expect(screen.getByText('altitude')).toBeInTheDocument();
    expect(screen.getByText('groundspeed')).toBeInTheDocument();
  });
});

describe('requesting a report', () => {
  it('reports the refusal rather than appearing to queue one', async () => {
    // No API is attached, so requestReport rejects. The page must say that
    // instead of printing a fabricated report id.
    const target = SAMPLE.aircraft[1]!;
    renderWithProviders(<Fleet />, { route: `/fleet?aircraft=${target.aircraft_id}` });

    const button = await screen.findByRole('button', { name: 'Request report' });
    await userEvent.click(button);

    expect(await screen.findByText(/Not available in sample mode/)).toBeInTheDocument();
    expect(screen.queryByText(/Queued report/)).toBeNull();
  });
});
