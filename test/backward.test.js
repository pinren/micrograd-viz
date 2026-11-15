import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';

const { Value, localDerivative, topoSort, traceBackward, gradsById } =
  globalThis.MGViz;

function makeExpression() {
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

function closeTo(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    'expected ' + actual + ' to be close to ' + expected
  );
}

test('topoSort puts every child before its parent', () => {
  const { a, b, c, mul, add } = makeExpression();
  const order = topoSort(add);
  assert.deepEqual(order, [a, b, mul, c, add]);
});

test('topoSort rejects non-Value input', () => {
  assert.throws(() => topoSort(null), TypeError);
  assert.throws(() => topoSort({}), TypeError);
});

test('traceBackward records the same gradients as backward()', () => {
  const { a, b, c, mul, add } = makeExpression();
  const trace = traceBackward(add);

  add.backward();
  assert.equal(trace.grads.get(add), add.grad);
  assert.equal(trace.seedGrads.get(add), 1);
  assert.equal(trace.grads.get(mul), 1);
  assert.equal(trace.grads.get(c), 1);
  assert.equal(trace.grads.get(a), -3);
  assert.equal(trace.grads.get(b), 2);
  assert.equal(trace.steps.length, 2);
  assert.deepEqual(
    trace.steps.map((step) => step.node),
    [add, mul]
  );
});

test('traceBackward captures gradients after every operation step', () => {
  const { a, b, c, mul, add } = makeExpression();
  const trace = traceBackward(add);
  const [addStep, mulStep] = trace.steps;

  assert.equal(addStep.node, add);
  assert.equal(addStep.gradsBefore.get(add), 1);
  assert.equal(addStep.gradsBefore.get(mul), 0);
  assert.equal(addStep.gradsAfter.get(add), 1);
  assert.equal(addStep.gradsAfter.get(mul), 1);
  assert.equal(addStep.gradsAfter.get(c), 1);
  assert.equal(addStep.gradsAfter.get(a), 0);
  assert.deepEqual(addStep.localDerivs, [
    { child: mul, local: 1 },
    { child: c, local: 1 },
  ]);

  assert.equal(mulStep.gradsBefore.get(mul), 1);
  assert.equal(mulStep.gradsAfter.get(a), -3);
  assert.equal(mulStep.gradsAfter.get(b), 2);
  assert.deepEqual(mulStep.localDerivs, [
    { child: a, local: -3 },
    { child: b, local: 2 },
  ]);
  assert.deepEqual(mulStep.contributions, [
    { child: a, local: -3, contribution: -3 },
    { child: b, local: 2, contribution: 2 },
  ]);
});

test('a custom reverse topological order produces identical gradients', () => {
  const graph = makeExpression();
  const defaultTrace = traceBackward(graph.add);
  // Deepest first, then graph order: also a valid reverse topological order.
  const order = [graph.add, graph.mul];
  const customTrace = traceBackward(graph.add, { order });

  for (const node of customTrace.topo) {
    closeTo(customTrace.grads.get(node), defaultTrace.grads.get(node));
  }
  assert.deepEqual(
    customTrace.steps.map((step) => step.node),
    order
  );
});

test('traceBackward rejects an invalid step order', () => {
  const { mul, add } = makeExpression();
  assert.throws(() => traceBackward(add, { order: [mul, add] }), TypeError);
  assert.throws(
    () => traceBackward(add, { order: [add, add] }),
    TypeError
  );
  assert.throws(
    () => traceBackward(add, { order: [add] }),
    TypeError,
    'every operation node is required'
  );
});

test('traceBackward keeps repeated operands correct', () => {
  const x = new Value(3);
  const square = x.mul(x);
  const trace = traceBackward(square);
  closeTo(trace.grads.get(x), 6);
  closeTo(localDerivative(square, x), 6);

  const doubled = x.add(x);
  doubled.backward();
  closeTo(x.grad, 2);
});

test('localDerivative reports the recorded local partials', () => {
  const { a, b, mul, add } = makeExpression();
  assert.equal(localDerivative(add, mul), 1);
  assert.equal(localDerivative(mul, a), -3);
  assert.equal(localDerivative(mul, b), 2);

  const t = new Value(0.5);
  const y = t.tanh();
  closeTo(localDerivative(y, t), 1 - y.data * y.data);

  const e = new Value(0.5);
  closeTo(localDerivative(e.exp(), e), Math.exp(0.5));

  const r = new Value(-2);
  assert.equal(localDerivative(r.relu(), r), 0);
});

test('gradsById keys gradient snapshots by layout id', () => {
  const { layoutGraph } = globalThis.MGViz;
  const { add } = makeExpression();
  const trace = traceBackward(add);
  const layout = layoutGraph(add);
  const grads = gradsById(layout, trace.grads);
  assert.deepEqual(grads, { a: -3, b: 2, c: 1, mul: 1, add: 1 });
});

test('traceBackward is repeatable', () => {
  const { add, a } = makeExpression();
  const first = traceBackward(add);
  const second = traceBackward(add);
  assert.deepEqual(
    second.steps.map((step) => step.gradsAfter.get(a)),
    first.steps.map((step) => step.gradsAfter.get(a))
  );
  assert.equal(second.grads.get(a), -3);
});
