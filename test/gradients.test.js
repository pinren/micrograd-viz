import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';

const { Value } = globalThis.MGViz;

const H = 1e-5;
const TOLERANCE = 1e-4;

/** Central finite difference of f with respect to values[index]. */
function numericGradient(build, values, index) {
  const plus = values.slice();
  const minus = values.slice();
  plus[index] += H;
  minus[index] -= H;
  const fPlus = build(plus).root.data;
  const fMinus = build(minus).root.data;
  return (fPlus - fMinus) / (2 * H);
}

/**
 * Checks every leaf of a graph against a finite-difference estimate.
 * `build(values)` returns `{ root, vars }` where vars are the leaf Values in
 * the same order as `values`.
 */
function checkAnalyticGradients(name, build, initialValues) {
  test(name, () => {
    const analytic = build(initialValues);
    analytic.root.backward();
    const gradients = analytic.vars.map((value) => value.grad);

    initialValues.forEach((_, index) => {
      const numeric = numericGradient(build, initialValues, index);
      assert.ok(
        Math.abs(gradients[index] - numeric) <= TOLERANCE,
        name +
          ': gradient[' +
          index +
          '] analytic=' +
          gradients[index] +
          ' numeric=' +
          numeric
      );
    });
  });
}

checkAnalyticGradients(
  'gradient of a*b + c',
  ([a, b, c]) => {
    const va = new Value(a);
    const vb = new Value(b);
    const vc = new Value(c);
    return { root: va.mul(vb).add(vc), vars: [va, vb, vc] };
  },
  [2, -3, 10]
);

checkAnalyticGradients(
  'gradient through tanh',
  ([a, b]) => {
    const va = new Value(a);
    const vb = new Value(b);
    return { root: va.mul(vb).tanh(), vars: [va, vb] };
  },
  [0.8, -1.3]
);

checkAnalyticGradients(
  'gradient through relu (positive branch)',
  ([a, b, c]) => {
    const va = new Value(a);
    const vb = new Value(b);
    const vc = new Value(c);
    return { root: va.mul(vb).add(vc).relu(), vars: [va, vb, vc] };
  },
  [2, 3, -1]
);

checkAnalyticGradients(
  'gradient through relu (zero branch)',
  ([a, b, c]) => {
    const va = new Value(a);
    const vb = new Value(b);
    const vc = new Value(c);
    return { root: va.mul(vb).add(vc).relu(), vars: [va, vb, vc] };
  },
  [1, -3, 1]
);

checkAnalyticGradients(
  'gradient through exp',
  ([a, b]) => {
    const va = new Value(a);
    const vb = new Value(b);
    return { root: va.mul(vb).exp(), vars: [va, vb] };
  },
  [0.4, 1.1]
);

checkAnalyticGradients(
  'gradient through a**3 * b',
  ([a, b]) => {
    const va = new Value(a);
    const vb = new Value(b);
    return { root: va.pow(3).mul(vb), vars: [va, vb] };
  },
  [1.7, -0.6]
);

checkAnalyticGradients(
  'gradient through a**b with a positive base',
  ([a, b]) => {
    const va = new Value(a);
    const vb = new Value(b);
    return { root: va.pow(vb), vars: [va, vb] };
  },
  [2.5, 1.7]
);

checkAnalyticGradients(
  'gradient through a composite tanh(exp * tanh)**2',
  ([a, b, c]) => {
    const va = new Value(a);
    const vb = new Value(b);
    const vc = new Value(c);
    const inner = va.tanh().mul(vb).add(vc.exp());
    return { root: inner.pow(2).tanh(), vars: [va, vb, vc] };
  },
  [0.5, -1.2, 0.3]
);

checkAnalyticGradients(
  'gradient with a repeated leaf (diamond)',
  ([a]) => {
    const va = new Value(a);
    return { root: va.pow(2).add(va), vars: [va] };
  },
  [3]
);

// A deeper graph exercises the topological order: each node's gradient must be
// complete before it is propagated further down the chain.
checkAnalyticGradients(
  'gradient through a deep chain',
  ([a, b, c]) => {
    const va = new Value(a);
    const vb = new Value(b);
    const vc = new Value(c);
    const root = va
      .mul(vb)
      .add(vc)
      .tanh()
      .mul(va.add(vb))
      .exp()
      .tanh();
    return { root, vars: [va, vb, vc] };
  },
  [0.3, -0.7, 0.4]
);
