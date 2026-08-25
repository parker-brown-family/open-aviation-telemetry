import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ARCH_EDGES, ARCH_NODES, NODE_BY_ID, TOUR, diagramService } from '../architecture.js';
import { NODE_H, NODE_W } from '../components/diagramText.js';
import { renderWithProviders, stubApiOffline } from '../test-utils.js';
import { Architecture } from './Architecture.js';

/**
 * The Architecture explorer.
 *
 * Two classes of assertion live here. The behavioural ones cover selection and
 * the guided tour. The geometric ones cover what a type checker cannot see: SVG
 * happily draws a label through a box or a connector across the text it points
 * at, with no error and nothing to notice but the picture. Both defects shipped
 * once; these encode them so they cannot ship again.
 */

/** Read a viewBox-unit attribute off an SVG element. */
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const nodeRects = (): Rect[] => ARCH_NODES.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: NODE_H }));

beforeEach(() => {
  // No API is attached to the published page, and the estate panel must render
  // its simulated figures regardless. Offline is the honest default here.
  stubApiOffline();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the diagram', () => {
  it('draws every component as an operable control', async () => {
    renderWithProviders(<Architecture />);
    for (const node of ARCH_NODES) {
      expect(
        screen.getByRole('button', { name: `${node.label} — ${node.awsService}` }),
        `${node.id} is not reachable`,
      ).toBeInTheDocument();
    }
  });

  it('labels each box with the short service name, not the full one', () => {
    // The abbreviation exists so the text fits the box; the full name belongs
    // in the panel, which has room for it.
    const { container } = renderWithProviders(<Architecture />);
    const rds = NODE_BY_ID.get('rds')!;
    const services = [...container.querySelectorAll('.arch__service')].map((el) => el.textContent);
    expect(services).toContain(diagramService(rds));
    expect(services).not.toContain(rds.awsService);
  });

  it('draws one connector per edge, each with a label', () => {
    const { container } = renderWithProviders(<Architecture />);
    expect(container.querySelectorAll('path.arch__edge')).toHaveLength(ARCH_EDGES.length);
    expect(container.querySelectorAll('.arch__edge-label')).toHaveLength(ARCH_EDGES.length);
    expect(container.querySelectorAll('.arch__edge-chip')).toHaveLength(ARCH_EDGES.length);
  });

  it('names all three connector kinds in the legend', () => {
    const { container } = renderWithProviders(<Architecture />);
    const legend = container.querySelector('.legend')!;
    expect(legend).toHaveTextContent('synchronous request');
    expect(legend).toHaveTextContent('asynchronous message');
    expect(legend).toHaveTextContent('database access');
  });

  it('gives every legend swatch a colour', () => {
    // These once referenced --cyan and --violet, tokens the tactical palette
    // does not define, so the swatches rendered with no colour at all beside
    // the olive and orange edges they were labelling.
    const { container } = renderWithProviders(<Architecture />);
    const swatches = [...container.querySelectorAll('.legend i')];
    expect(swatches.length).toBeGreaterThan(0);
    for (const swatch of swatches) {
      const colour = (swatch as HTMLElement).style.borderColor;
      expect(colour, 'a legend swatch has no border colour').toBeTruthy();
      expect(colour).toMatch(/rgb\(var\(--/);
    }
  });
});

describe('connector geometry', () => {
  it('starts and ends every connector outside the boxes it joins', () => {
    // The defect this prevents: three edges converged on the PostgreSQL box and
    // were ruled straight across "PostgreSQL / Amazon RDS", with each arrowhead
    // landing somewhere inside the box rather than on its border.
    const { container } = renderWithProviders(<Architecture />);
    const paths = [...container.querySelectorAll('path.arch__edge')];
    expect(paths).toHaveLength(ARCH_EDGES.length);

    paths.forEach((path, i) => {
      const edge = ARCH_EDGES[i]!;
      const d = path.getAttribute('d')!;
      const match = /^M([-\d.]+) ([-\d.]+) Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)$/.exec(d);
      expect(match, `edge ${edge.from} → ${edge.to} has an unreadable path: ${d}`).not.toBeNull();

      const [x0, y0, x1, y1] = [
        Number(match![1]),
        Number(match![2]),
        Number(match![3]),
        Number(match![4]),
      ];
      const from = NODE_BY_ID.get(edge.from)!;
      const to = NODE_BY_ID.get(edge.to)!;

      const inside = (px: number, py: number, n: { x: number; y: number }): boolean =>
        px > n.x && px < n.x + NODE_W && py > n.y && py < n.y + NODE_H;

      expect(inside(x0, y0, from), `${edge.from} → ${edge.to} starts inside ${edge.from}`).toBe(
        false,
      );
      expect(inside(x1, y1, to), `${edge.from} → ${edge.to} ends inside ${edge.to}`).toBe(false);
    });
  });

  it('never starts a connector at a box centre', () => {
    // Centre-to-centre is the anchoring, not the drawing. If a path ever begins
    // at a centre again, trimming has been bypassed.
    const { container } = renderWithProviders(<Architecture />);
    for (const path of container.querySelectorAll('path.arch__edge')) {
      const [, x, y] = /^M([-\d.]+) ([-\d.]+)/.exec(path.getAttribute('d')!)!;
      for (const node of ARCH_NODES) {
        const cx = node.x + NODE_W / 2;
        const cy = node.y + NODE_H / 2;
        const atCentre = Math.abs(Number(x) - cx) < 0.01 && Math.abs(Number(y) - cy) < 0.01;
        expect(atCentre, `a connector still starts at the centre of ${node.id}`).toBe(false);
      }
    }
  });
});

describe('edge labels', () => {
  it('keeps every label chip clear of every box', () => {
    // "project + read" was being cut in half by the Job queue box, and "HTTP"
    // was drawn underneath Ingress. A label sitting on a box is unreadable and
    // silently so.
    const { container } = renderWithProviders(<Architecture />);
    const boxes = nodeRects();

    for (const chip of container.querySelectorAll('.arch__edge-chip')) {
      const rect: Rect = {
        x: num(chip, 'x'),
        y: num(chip, 'y'),
        w: num(chip, 'width'),
        h: num(chip, 'height'),
      };
      for (const [i, box] of boxes.entries()) {
        expect(overlaps(rect, box), `a label chip overlaps ${ARCH_NODES[i]!.id}`).toBe(false);
      }
    }
  });

  it('sits each label on its own chip', () => {
    const { container } = renderWithProviders(<Architecture />);
    const chips = [...container.querySelectorAll('.arch__edge-chip')];
    const labels = [...container.querySelectorAll('.arch__edge-label')];

    labels.forEach((label, i) => {
      const chip = chips[i]!;
      const cx = num(label, 'x');
      const chipLeft = num(chip, 'x');
      const chipRight = chipLeft + num(chip, 'width');
      expect(cx).toBeGreaterThanOrEqual(chipLeft);
      expect(cx).toBeLessThanOrEqual(chipRight);
    });
  });

  it('keeps every chip inside the drawing area', () => {
    // The viewBox is 100 × 74. Anything outside it is simply not drawn.
    const { container } = renderWithProviders(<Architecture />);
    for (const chip of container.querySelectorAll('.arch__edge-chip')) {
      expect(num(chip, 'x')).toBeGreaterThanOrEqual(0);
      expect(num(chip, 'x') + num(chip, 'width')).toBeLessThanOrEqual(100);
      expect(num(chip, 'y')).toBeGreaterThanOrEqual(0);
      expect(num(chip, 'y') + num(chip, 'height')).toBeLessThanOrEqual(74);
    }
  });
});

describe('selecting a component', () => {
  it('opens on the telemetry API', () => {
    renderWithProviders(<Architecture />);
    const api = NODE_BY_ID.get('api')!;
    expect(screen.getByText(`${api.label} — ${api.awsService}`)).toBeInTheDocument();
  });

  it('shows the detail for whichever box is clicked', async () => {
    renderWithProviders(<Architecture />);
    const rds = NODE_BY_ID.get('rds')!;
    await userEvent.click(screen.getByRole('button', { name: `${rds.label} — ${rds.awsService}` }));
    expect(screen.getByText(`${rds.label} — ${rds.awsService}`)).toBeInTheDocument();
    expect(screen.getByText(rds.what)).toBeInTheDocument();
  });

  it('marks the selected box in the diagram', async () => {
    const { container } = renderWithProviders(<Architecture />);
    const worker = NODE_BY_ID.get('worker')!;
    await userEvent.click(
      screen.getByRole('button', { name: `${worker.label} — ${worker.awsService}` }),
    );
    const selected = container.querySelectorAll('.arch__node--selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent(worker.label);
  });

  it('is reachable by keyboard, not only by mouse', async () => {
    // The boxes are <g> elements with role=button; they get no key handling for
    // free, so Enter and Space are wired by hand and are worth pinning.
    renderWithProviders(<Architecture />);
    const kafka = NODE_BY_ID.get('kafka')!;
    const box = screen.getByRole('button', { name: `${kafka.label} — ${kafka.awsService}` });
    box.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText(`${kafka.label} — ${kafka.awsService}`)).toBeInTheDocument();
  });

  it('selects on Space as well', async () => {
    renderWithProviders(<Architecture />);
    const eks = NODE_BY_ID.get('eks')!;
    const box = screen.getByRole('button', { name: `${eks.label} — ${eks.awsService}` });
    box.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByText(`${eks.label} — ${eks.awsService}`)).toBeInTheDocument();
  });
});

describe('the guided tour', () => {
  const startTour = async (): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: 'Start the tour' }));
  };

  it('offers itself before it is running', () => {
    renderWithProviders(<Architecture />);
    expect(screen.getByRole('button', { name: 'Start the tour' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('opens on the first step and selects that step’s component', async () => {
    renderWithProviders(<Architecture />);
    await startTour();
    const first = TOUR[0]!;
    expect(screen.getByText(first.title)).toBeInTheDocument();
    expect(screen.getByText(`1 / ${TOUR.length}`)).toBeInTheDocument();
    const node = NODE_BY_ID.get(first.nodeId)!;
    expect(screen.getByText(`${node.label} — ${node.awsService}`)).toBeInTheDocument();
  });

  it('cannot go back from the first step', async () => {
    renderWithProviders(<Architecture />);
    await startTour();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('walks forward through every step, selecting each component in turn', async () => {
    renderWithProviders(<Architecture />);
    await startTour();

    for (let i = 1; i < TOUR.length; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      const step = TOUR[i]!;
      expect(screen.getByText(`${i + 1} / ${TOUR.length}`)).toBeInTheDocument();
      expect(screen.getByText(step.title)).toBeInTheDocument();
      const node = NODE_BY_ID.get(step.nodeId)!;
      expect(
        screen.getByText(`${node.label} — ${node.awsService}`),
        `step ${i + 1} did not select ${step.nodeId}`,
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('goes back a step', async () => {
    renderWithProviders(<Architecture />);
    await startTour();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText(`1 / ${TOUR.length}`)).toBeInTheDocument();
  });

  it('highlights the step’s component distinctly from the selection', async () => {
    const { container } = renderWithProviders(<Architecture />);
    await startTour();
    expect(container.querySelectorAll('.arch__node--highlight')).toHaveLength(1);
  });

  it('exits back to the offer', async () => {
    renderWithProviders(<Architecture />);
    await startTour();
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(screen.getByRole('button', { name: 'Start the tour' })).toBeInTheDocument();
    expect(screen.queryByText(TOUR[0]!.title)).toBeNull();
  });

  it('ends the tour when a reader clicks a box themselves', async () => {
    // Otherwise Next would jump away from whatever they just chose to look at.
    const { container } = renderWithProviders(<Architecture />);
    await startTour();
    const terraform = NODE_BY_ID.get('terraform')!;
    await userEvent.click(
      screen.getByRole('button', { name: `${terraform.label} — ${terraform.awsService}` }),
    );
    expect(screen.getByRole('button', { name: 'Start the tour' })).toBeInTheDocument();
    expect(container.querySelectorAll('.arch__node--highlight')).toHaveLength(0);
  });
});

describe('the AWS estate panel', () => {
  it('says the figures are simulated rather than measured', async () => {
    // The honesty rule: nothing is deployed, and the panel has to say so
    // instead of presenting placeholders as readings.
    renderWithProviders(<Architecture />);
    const panel = await screen.findByText('AWS estate');
    const card = panel.closest('.panel')! as HTMLElement;

    // Two separate statements, both required: the status pill, and the notice
    // spelling out that these are placeholders rather than readings.
    await waitFor(() => expect(within(card).getByText('simulated')).toBeVisible());
    expect(within(card).getByText(/No AWS account is attached/i)).toBeInTheDocument();
    expect(within(card).queryByText('measured')).toBeNull();
  });

  it('marks each component as not deployed', async () => {
    renderWithProviders(<Architecture />);
    await waitFor(() =>
      expect(screen.getAllByText(/not deployed/i).length).toBeGreaterThanOrEqual(1),
    );
  });
});
