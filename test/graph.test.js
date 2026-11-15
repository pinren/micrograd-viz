import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/graph.js';

const { Value } = globalThis.MGViz;
const { layoutGraph, formatNumber, GRAPH_METRICS } = globalThis.MGViz;

test('layoutGraph lays a diamond out left to right', () => {
  const a = new Value(2, { label: 'a', name: 'a' });
  const b = new Value(-3, { label: 'b', name: 'b' });
  const c = new Value(10, { label: 'c', name: 'c' });
  const mul = a.mul(b);
  mul.label = '×';
  mul.name = 'mul';
  const add = mul.add(c);
  add.label = '+';
  add.name = 'add';

  const layout = layoutGraph(add);

  assert.equal(layout.nodes.length, 5);
  assert.equal(layout.edges.length, 4);
  assert.equal(layout.rootId, 'add');
  assert.equal(layout.nodeById.get('a').depth, 0);
  assert.equal(layout.nodeById.get('b').depth, 0);
  assert.equal(layout.nodeById.get('c').depth, 0);
  assert.equal(layout.nodeById.get('mul').depth, 1);
  assert.equal(layout.nodeById.get('add').depth, 2);

  // Every edge goes from an operand (shallower) to a result (deeper).
  for (const edge of layout.edges) {
    const from = layout.nodeById.get(edge.from);
    const to = layout.nodeById.get(edge.to);
    assert.ok(from.depth < to.depth, edge.id + ' should point rightwards');
    assert.ok(from.x + from.width <= to.x, edge.id + ' should not overlap');
  }

  // All boxes stay inside the computed viewBox.
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.x + node.width <= layout.width);
    assert.ok(node.y >= 0 && node.y + node.height <= layout.height);
  }

  // A depth layer's boxes never overlap vertically.
  const byDepth = new Map();
  for (const node of layout.nodes) {
    if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
    byDepth.get(node.depth).push(node);
  }
  for (const layer of byDepth.values()) {
    layer.sort((left, right) => left.y - right.y);
    for (let i = 1; i < layer.length; i++) {
      assert.ok(layer[i].y >= layer[i - 1].y + layer[i - 1].height);
    }
  }
});

test('layoutGraph works on an arbitrary deep expression', () => {
  const x = new Value(1);
  const y = new Value(2);
  const z = new Value(-3);
  const root = x.mul(y).add(z).tanh().exp();
  const layout = layoutGraph(root);

  assert.equal(layout.nodes.length, 7); // x, y, z, mul, add, tanh, exp
  assert.equal(layout.edges.length, 6);
  assert.equal(layout.nodes.length, layout.nodeById.size);
  assert.equal(new Set(layout.nodes.map((node) => node.id)).size, layout.nodes.length);
  // The root is the rightmost layer.
  const rootNode = layout.nodeById.get(layout.rootId);
  assert.equal(rootNode.depth, Math.max(...layout.nodes.map((node) => node.depth)));
});

test('layoutGraph gives unique ids to duplicate labels', () => {
  const first = new Value(1, { label: 'x' });
  const second = new Value(2, { label: 'x' });
  const layout = layoutGraph(first.add(second));
  const ids = layout.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('x'));
  assert.ok(ids.includes('x#2'));
});

test('layoutGraph rejects non-Value input', () => {
  assert.throws(() => layoutGraph(null), TypeError);
  assert.throws(() => layoutGraph({}), TypeError);
});

test('formatNumber keeps labels compact', () => {
  assert.equal(formatNumber(4), '4');
  assert.equal(formatNumber(-3), '-3');
  assert.equal(formatNumber(0.5), '0.5');
  assert.equal(formatNumber(1 / 3), '0.33');
  assert.equal(formatNumber(0.0000123), '1.23e-5');
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), 'Infinity');
});

test('graph metrics are positive', () => {
  for (const value of Object.values(GRAPH_METRICS)) {
    assert.ok(value > 0);
  }
});
