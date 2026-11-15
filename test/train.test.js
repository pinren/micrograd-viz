import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/train.js';
import '../src/nn.js';

const {
  Value,
  trainStep,
  train,
  meanSquaredError,
  hingeLoss,
  MLP,
  createRng,
  forwardNumbers,
} = globalThis.MGViz;

function close(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    'expected ' + actual + ' to be within ' + epsilon + ' of ' + expected
  );
}

test('sub subtracts and passes +1 / -1 gradients', () => {
  const a = new Value(5);
  const b = new Value(2);
  const diff = a.sub(b);
  assert.equal(diff.data, 3);
  diff.backward();
  assert.equal(a.grad, 1);
  assert.equal(b.grad, -1);
  close(a.sub(2.5).data, 2.5);
});

test('zeroGrad clears the gradient and step moves against it', () => {
  const parameter = new Value(2);
  parameter.grad = 3;
  assert.equal(parameter.step(0.1), parameter);
  close(parameter.data, 1.7);
  close(parameter.grad, 3, 1e-12);
  assert.equal(parameter.zeroGrad(), parameter);
  assert.equal(parameter.grad, 0);
  // A zero gradient leaves the data alone.
  parameter.step(0.5);
  close(parameter.data, 1.7);
});

test('step rejects invalid learning rates', () => {
  const parameter = new Value(1);
  assert.throws(() => parameter.step(-0.1), TypeError);
  assert.throws(() => parameter.step(Number.NaN), TypeError);
  assert.throws(() => parameter.step('0.1'), TypeError);
  assert.throws(() => parameter.step(Number.POSITIVE_INFINITY), TypeError);
});

test('trainStep runs forward -> backward -> step and returns the loss', () => {
  const w = new Value(1, { name: 'w' });
  const loss = trainStep([w], () => w.sub(2).pow(2), 0.1);
  assert.equal(loss, 1);
  close(w.data, 1.2); // 1 - 0.1 * (2 * (1 - 2))
  close(w.grad, -2);
});

test('trainStep zeroes stale gradients before the forward pass', () => {
  const w = new Value(1);
  w.grad = 99;
  const loss = trainStep([w], () => w.mul(2), 0.1);
  assert.equal(loss, 2);
  close(w.data, 0.8); // 1 - 0.1 * 2
  close(w.grad, 2);
});

test('trainStep and train reject malformed arguments', () => {
  const w = new Value(1);
  assert.throws(() => trainStep([], () => w, 0.1), TypeError);
  assert.throws(() => trainStep([{}], () => w, 0.1), TypeError);
  assert.throws(() => trainStep([w], null, 0.1), TypeError);
  assert.throws(() => trainStep([w], () => 4, 0.1), TypeError);
  assert.throws(() => trainStep([w], () => w, -1), TypeError);
  assert.throws(() => train([w], () => w, { steps: -1 }), TypeError);
  assert.throws(() => train([w], () => w, { steps: 1.5 }), TypeError);
});

test('train converges monotonically on a quadratic', () => {
  const w = new Value(0, { name: 'w' });
  const losses = train([w], () => w.sub(3).pow(2), {
    lr: 0.1,
    steps: 60,
  });

  assert.equal(losses.length, 61);
  assert.ok(losses[0] > 8.99 && losses[0] < 9.01);
  for (let index = 1; index < losses.length; index++) {
    assert.ok(
      losses[index] <= losses[index - 1] + 1e-12,
      'loss increased at step ' + index
    );
  }
  assert.ok(losses[60] < losses[0] * 1e-6);
  close(w.data, 3, 1e-5);
});

test('meanSquaredError averages squared misses and backpropagates', () => {
  const first = new Value(1);
  const second = new Value(-2);
  const loss = meanSquaredError([first, second], [1, -1]);
  close(loss.data, 0.5);
  loss.backward();
  close(first.grad, 0);
  close(second.grad, -1);

  assert.throws(() => meanSquaredError([], []), TypeError);
  assert.throws(() => meanSquaredError([first], []), TypeError);
  assert.throws(() => meanSquaredError([first], [Number.NaN]), TypeError);
});

test('hingeLoss is max(0, 1 - target * prediction)', () => {
  const margin = new Value(0.5);
  const loss = hingeLoss([margin], [1]);
  close(loss.data, 0.5);
  loss.backward();
  close(margin.grad, -1);

  const satisfied = new Value(2);
  const zero = hingeLoss([satisfied], [1]);
  assert.equal(zero.data, 0);
  zero.backward();
  assert.equal(satisfied.grad, 0);
});

test('MLP builds a differentiable graph and its numeric snapshot agrees', () => {
  const mlp = new MLP(2, [3, 1], {
    rng: createRng(4),
    activation: ['tanh', 'linear'],
  });
  assert.equal(mlp.parameters().length, 13); // 3*(2+1) + 1*(3+1)

  const inputs = [new Value(2), new Value(3)];
  const output = mlp.forward(inputs)[0];
  output.backward();
  for (const parameter of mlp.parameters()) {
    assert.ok(Number.isFinite(parameter.grad));
  }

  const snapshot = mlp.snapshot();
  const numeric = forwardNumbers(snapshot, [2, 3])[0];
  close(numeric, output.data);

  // The output layer is linear, the hidden layer is tanh.
  assert.equal(snapshot[0][0].activation, 'tanh');
  assert.equal(snapshot[1][0].activation, 'linear');
});

test('MLP initialisation is deterministic per seed and activation is validated', () => {
  const first = new MLP(2, [3, 1], { rng: createRng(7) });
  const second = new MLP(2, [3, 1], { rng: createRng(7) });
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.throws(
    () => new MLP(2, [2], { activation: ['sigmoid'] }),
    TypeError
  );
  assert.throws(() => new MLP(2, []), TypeError);
});
