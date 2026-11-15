import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/graph.js';

const { Value } = globalThis.MGViz;
const {
  layoutGraph,
  formatNumber,
  GRAPH_METRICS,
  buildRenderModel,
  edgeMidpoint,
} = globalThis.MGViz;

function makeDiamond() {
  const a = new Value(2, { label: 'a', name: 'a' });
  const b = new Value(-3, { label: 'b', name: 'b' });
  const c = new Value(10, { label: 'c', name: 'c' });
  const mul = a.mul(b);
  mul.label = '×';
  mul.name = 'mul';
  const add = mul.add(c);
  add.label = '+';
  add.name = 'add';
  return { a, b, c, mul, add };
}

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

test('layoutGraph honours compact metrics for larger graphs', () => {
  const { add } = makeDiamond();
  const layout = layoutGraph(add, {
    nodeWidth: 118,
    nodeHeight: 66,
    gapX: 54,
    gapY: 16,
    margin: 36,
  });

  assert.equal(layout.metrics.nodeWidth, 118);
  assert.equal(layout.metrics.nodeHeight, 66);
  for (const node of layout.nodes) {
    assert.equal(node.width, 118);
    assert.equal(node.height, 66);
    assert.ok(node.x >= 0 && node.x + node.width <= layout.width);
    assert.ok(node.y >= 0 && node.y + node.height <= layout.height);
  }
  // Edges leave the right side of a child and enter the left side of a parent.
  for (const edge of layout.edges) {
    const from = layout.nodeById.get(edge.from);
    const to = layout.nodeById.get(edge.to);
    assert.equal(edge.fromX, from.x + from.width);
    assert.equal(edge.toX, to.x);
  }
});

test('layoutGraph rejects non-positive metrics', () => {
  const { add } = makeDiamond();
  assert.throws(() => layoutGraph(add, { nodeWidth: 0 }), TypeError);
  assert.throws(() => layoutGraph(add, { gapY: -1 }), TypeError);
  assert.throws(() => layoutGraph(add, { margin: Number.NaN }), TypeError);
});

test('edgeMidpoint is the middle of the edge', () => {
  assert.deepEqual(
    edgeMidpoint({ fromX: 10, fromY: 20, toX: 40, toY: 80 }),
    { x: 25, y: 50 }
  );
});

test('buildRenderModel resolves partial gradients and edge decoration', () => {
  const { add } = makeDiamond();
  const layout = layoutGraph(add);
  const model = buildRenderModel(layout, {
    visible: ['a', 'b', 'mul', 'add'],
    grads: { add: 1, mul: 1 },
    active: 'add',
    activeEdges: ['mul->add'],
    edgeLabels: { 'mul->add': '∂=1' },
    topo: ['add', 'mul'],
    backward: true,
  });

  assert.deepEqual(
    model.nodes.map((node) => node.id),
    ['a', 'b', 'mul', 'add']
  );
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get('add').hasGrad, true);
  assert.equal(byId.get('add').gradText, 'grad 1');
  assert.equal(byId.get('add').active, true);
  assert.equal(byId.get('add').topoIndex, 1);
  assert.equal(byId.get('mul').topoIndex, 2);
  assert.equal(byId.get('a').hasGrad, false);
  assert.equal(byId.get('a').gradText, 'grad 0');
  assert.equal(byId.get('c'), undefined, 'c is not visible');

  assert.equal(model.edges.length, 3);
  const active = model.edges.find((edge) => edge.id === 'mul->add');
  assert.equal(active.active, true);
  assert.equal(active.hasLabel, true);
  assert.equal(active.label, '∂=1');
  assert.equal(active.labelX, edgeMidpoint(active.edge).x);
  assert.equal(active.labelY, edgeMidpoint(active.edge).y - 9);
  assert.equal(model.backward, true);
  assert.match(model.summary, /4 of 5 nodes visible/);
  assert.match(model.summary, /mul=-6 \(grad 1\)/);
});

test('buildRenderModel can reveal every gradient or none', () => {
  const { add } = makeDiamond();
  const layout = layoutGraph(add);

  const all = buildRenderModel(layout, { showGrad: true });
  assert.ok(all.nodes.every((node) => node.hasGrad));

  const none = buildRenderModel(layout, {});
  assert.ok(none.nodes.every((node) => node.hasGrad === false));
  assert.ok(none.edges.every((edge) => edge.hasLabel === false));
});
