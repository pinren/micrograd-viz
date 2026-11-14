import test from 'node:test';
import assert from 'node:assert/strict';

// Source files are browser classic scripts; importing them runs their factory
// and publishes the API on globalThis.MGViz.
import '../src/value.js';

const { Value, toValue } = globalThis.MGViz;

function close(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    'expected ' + actual + ' to be within ' + epsilon + ' of ' + expected
  );
}

test('Value starts with data and a zero gradient', () => {
  const value = new Value(3.5);
  assert.equal(value.data, 3.5);
  assert.equal(value.grad, 0);
  assert.equal(value._prev.size, 0);
  assert.equal(value.label, '');
});

test('Value rejects non-numeric data', () => {
  assert.throws(() => new Value('3'), TypeError);
  assert.throws(() => new Value(undefined), TypeError);
});

test('toValue wraps numbers and passes Values through', () => {
  const value = new Value(2);
  assert.equal(toValue(value), value);
  assert.equal(toValue(4).data, 4);
});

test('arithmetic forward pass', () => {
  const a = new Value(2);
  const b = new Value(-3);
  const c = new Value(10);
  assert.equal(a.add(b).data, -1);
  assert.equal(a.mul(b).data, -6);
  assert.equal(a.mul(b).add(c).data, 4);
  assert.equal(a.pow(3).data, 8);
  assert.equal(a.pow(b).data, 0.125);
  close(new Value(0.5).tanh().data, Math.tanh(0.5));
  close(new Value(-1.5).relu().data, 0);
  assert.equal(new Value(1.5).relu().data, 1.5);
  close(new Value(2).exp().data, Math.exp(2));
});

test('backward computes chain-rule gradients for a*b + c', () => {
  const a = new Value(2);
  const b = new Value(-3);
  const c = new Value(10);
  const d = a.mul(b).add(c);

  d.backward();

  assert.equal(d.data, 4);
  assert.equal(d.grad, 1);
  assert.equal(a.grad, -3);
  assert.equal(b.grad, 2);
  assert.equal(c.grad, 1);
});

test('gradients accumulate across shared subexpressions', () => {
  const a = new Value(3);
  const shared = a.mul(a); // a * a
  const out = shared.add(shared); // 2 * a^2
  out.backward();
  assert.equal(out.data, 18);
  assert.equal(a.grad, 12); // 4 * a
});

test('backward is repeatable and resets stale gradients', () => {
  const a = new Value(2);
  const b = new Value(5);
  const out = a.mul(b);
  out.backward();
  out.backward();
  assert.equal(a.grad, 5);
  assert.equal(b.grad, 2);
  // A second, unrelated root must not inherit the first root's grad.
  const other = a.add(1);
  other.backward();
  assert.equal(a.grad, 1);
  assert.equal(other.grad, 1);
});

test('relu passes gradient only on the positive side', () => {
  const positive = new Value(2);
  positive.relu().backward();
  assert.equal(positive.grad, 1);

  const negative = new Value(-2);
  negative.relu().backward();
  assert.equal(negative.grad, 0);

  const zero = new Value(0);
  zero.relu().backward();
  assert.equal(zero.grad, 0);
});

test('tanh and exp derivatives match their analytic forms', () => {
  const x = new Value(0.7);
  x.tanh().backward();
  const t = Math.tanh(0.7);
  close(x.grad, 1 - t * t);

  const y = new Value(1.2);
  y.exp().backward();
  close(y.grad, Math.exp(1.2));
});

test('pow with a Value exponent uses the log derivative', () => {
  const base = new Value(2);
  const exponent = new Value(3);
  const out = base.pow(exponent);
  out.backward();
  assert.equal(out.data, 8);
  close(base.grad, 3 * Math.pow(2, 2), 1e-9);
  close(exponent.grad, 8 * Math.log(2), 1e-9);
});

test('Value.pow rejects a non-numeric exponent', () => {
  assert.throws(() => new Value(2).pow('2'), TypeError);
  assert.throws(() => new Value(2).pow(Number.NaN), TypeError);
});
