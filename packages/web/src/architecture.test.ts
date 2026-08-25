import { describe, expect, it } from 'vitest';
import { CONSUMER_GROUPS, MAX_JOB_ATTEMPTS, RABBIT, THRESHOLDS, TOPICS } from '@oat/shared';
import { ARCH_EDGES, ARCH_NODES, NODE_BY_ID, TOUR } from './architecture.js';

// Must match the constants in pages/Architecture.tsx. If the diagram is
// re-laid-out, these assertions are what catch two boxes landing on top of
// each other or a label running off the right edge.
const NODE_W = 15;
const NODE_H = 7;

/**
 * The Architecture Explorer is the part of this project a reviewer is most
 * likely to read closely, so its content is checked like code.
 *
 * The point of these tests is that the page cannot quietly become wrong: a
 * dangling edge, an empty section, or a topic name that no longer matches the
 * one the services use would all fail here.
 */

describe('architecture nodes', () => {
  it('has unique ids', () => {
    const ids = ARCH_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('answers every question for every component', () => {
    for (const node of ARCH_NODES) {
      for (const field of [
        'what',
        'why',
        'alternative',
        'failure',
        'scaling',
        'security',
      ] as const) {
        expect(node[field].length, `${node.id}.${field} must be filled in`).toBeGreaterThan(40);
      }
      expect(node.source.length, `${node.id} must point at source files`).toBeGreaterThan(0);
    }
  });

  it('names a real alternative for every component, not a placeholder', () => {
    for (const node of ARCH_NODES) {
      expect(node.alternative.toLowerCase(), `${node.id} alternative`).not.toMatch(
        /^(n\/a|none|tbd)/,
      );
    }
  });

  it('keeps every node inside the diagram viewBox', () => {
    for (const node of ARCH_NODES) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + NODE_W).toBeLessThanOrEqual(100);
      expect(node.y + NODE_H).toBeLessThanOrEqual(74);
    }
  });

  it('does not overlap any two nodes', () => {
    for (let i = 0; i < ARCH_NODES.length; i += 1) {
      for (let j = i + 1; j < ARCH_NODES.length; j += 1) {
        const a = ARCH_NODES[i];
        const b = ARCH_NODES[j];
        if (!a || !b) continue;
        const overlaps = Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});

describe('architecture edges', () => {
  it('connects only nodes that exist', () => {
    for (const edge of ARCH_EDGES) {
      expect(NODE_BY_ID.has(edge.from), `edge from unknown node ${edge.from}`).toBe(true);
      expect(NODE_BY_ID.has(edge.to), `edge to unknown node ${edge.to}`).toBe(true);
    }
  });

  it('leaves no component unconnected', () => {
    const connected = new Set(ARCH_EDGES.flatMap((e) => [e.from, e.to]));
    // Platform concerns are drawn as context rather than wired into the flow.
    const contextOnly = new Set(['eks', 'terraform', 'observability']);
    for (const node of ARCH_NODES) {
      if (contextOnly.has(node.id)) continue;
      expect(connected.has(node.id), `${node.id} is not connected to anything`).toBe(true);
    }
  });

  it('describes the two messaging hops as asynchronous', () => {
    const async = ARCH_EDGES.filter((e) => e.kind === 'async').map((e) => `${e.from}->${e.to}`);
    expect(async).toContain('api->kafka');
    expect(async).toContain('api->rabbit');
    expect(async).toContain('kafka->consumer');
    expect(async).toContain('rabbit->worker');
  });
});

describe('the guided tour', () => {
  it('points every step at a component that exists', () => {
    for (const step of TOUR) {
      expect(NODE_BY_ID.has(step.nodeId), `tour step "${step.title}" targets ${step.nodeId}`).toBe(
        true,
      );
    }
  });

  it('walks the request path in order: API, stream, database, processor, queue, worker', () => {
    const order = TOUR.map((s) => s.nodeId);
    expect(order.indexOf('api')).toBeLessThan(order.indexOf('kafka'));
    expect(order.indexOf('kafka')).toBeLessThan(order.indexOf('consumer'));
    expect(order.indexOf('rabbit')).toBeLessThan(order.indexOf('worker'));
  });

  it('is long enough to tell the story and short enough to hold attention', () => {
    expect(TOUR.length).toBeGreaterThanOrEqual(6);
    expect(TOUR.length).toBeLessThanOrEqual(12);
  });
});

describe('content stays in step with the implementation', () => {
  it('quotes the real topic and consumer group', () => {
    const kafka = NODE_BY_ID.get('kafka');
    expect(kafka?.what).toContain(TOPICS.telemetry);
    expect(kafka?.what).toContain(CONSUMER_GROUPS.telemetryProcessors);
    expect(kafka?.failure).toContain(TOPICS.telemetryDlq);
  });

  it('quotes the real queue name and retry policy', () => {
    const rabbit = NODE_BY_ID.get('rabbit');
    expect(rabbit?.what).toContain(RABBIT.reportQueue);
    expect(rabbit?.what).toContain(String(RABBIT.retryDelayMs));
    expect(rabbit?.failure).toContain(String(MAX_JOB_ATTEMPTS));
  });

  it('quotes the real detection thresholds in the tour', () => {
    const derivation = TOUR.find((s) => s.title.includes('derived state'));
    expect(derivation?.body).toContain(String(THRESHOLDS.engineTempWarningC));
    expect(derivation?.body).toContain(String(Math.abs(THRESHOLDS.rapidDescentFpm)));
  });
});
