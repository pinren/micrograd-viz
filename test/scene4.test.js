import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';
import '../src/timeline.js';
import '../src/scenes/scene3.js';
import '../src/scenes/scene4.js';

const {
  Timeline,
  createScene3,
  createScene4,
  SCENE4_LEARNING_RATE,
} = globalThis.MGViz;

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    'expected ' + actual + ' to be close to ' + expected
  );
}

function keyframe(scene, label) {
  const found = scene.keyframes.find((candidate) => candidate.label === label);
  assert.ok(found, 'missing keyframe ' + label);
  return found;
}

test('scene 4 continues the scene-3 neuron with a target and a loss', () => {
  const scene = createScene4();
  const scene3 = createScene3();

  assert.deepEqual(scene.before.values, {
    w1: scene3.values.w1.data,
    x1: scene3.values.x1.data,
    w2: scene3.values.w2.data,
    x2: scene3.values.x2.data,
    w3: scene3.values.w3.data,
    x3: scene3.values.x3.data,
    b: scene3.values.b.data,
    t: 1,
  });
  assert.equal(scene.before.loss, 0.289317952514053);
  assert.equal(scene.after.loss, 0.12263663330900093);
  assert.ok(scene.after.loss < scene.before.loss * 0.5);
});

test('scene 4 gradients match the analytic chain rule', () => {
  const scene = createScene4();
  const { values, graph, trace } = scene;
  const { w1, w2, w3, x1, x2, x3, y, diff, loss, b, t } = values;
  const grads = scene.before.grads;

  assert.equal(grads.loss, 1);
  closeTo(grads.diff, 2 * diff.data);
  closeTo(grads.y, 2 * diff.data);
  closeTo(grads.b, 2 * diff.data * (1 - y.data * y.data));
  closeTo(grads.w1, x1.data * grads.diff * (1 - y.data * y.data));
  closeTo(grads.w2, x2.data * grads.diff * (1 - y.data * y.data));
  closeTo(grads.w3, x3.data * grads.diff * (1 - y.data * y.data));
  closeTo(grads.t, -grads.diff);
  assert.equal(graph.nodes.length, 17);
  assert.equal(graph.edges.length, 16);
  assert.equal(graph.rootId, 'loss');
  assert.equal(trace.steps.length, 9);
});

test('scene 4 records one exact SGD step per parameter', () => {
  const scene = createScene4();
  assert.equal(scene.learningRate, SCENE4_LEARNING_RATE);

  for (const name of ['w1', 'w2', 'w3', 'b']) {
    const update = scene.updates[name];
    closeTo(update.delta, -scene.learningRate * update.gradient);
    closeTo(update.after, update.before + update.delta);
    closeTo(scene.after.values[name], update.after);
    assert.ok(
      Math.abs(update.delta) > 0.04,
      name + ' should move visibly: ' + update.delta
    );
  }
  clearCheck(scene);
});

function clearCheck(scene) {
  assert.equal(scene.values.w1.grad, 0);
  assert.equal(scene.values.w2.grad, 0);
  assert.equal(scene.values.w3.grad, 0);
  assert.equal(scene.values.b.grad, 0);
}

test('scene 4 shows update arrows and a before/after table', () => {
  const scene = createScene4();
  const step = keyframe(scene, 'SGD step');
  const after = keyframe(scene, 'after step');

  assert.deepEqual(
    Object.keys(step.state.updates).sort(),
    ['b', 'w1', 'w2', 'w3']
  );
  assert.match(step.state.updates.w1, /^-g 0\.85 → 0\.58$/);
  assert.match(step.state.updates.w2, /^-g 0\.42 → -0\.96$/);
  assert.match(step.state.updates.w3, /^-g -0\.85 → 1\.92$/);

  const rows = step.state.readout.table.rows;
  assert.deepEqual(step.state.readout.table.columns, [
    'param',
    'data',
    'grad',
    '−lr·g',
    'new data',
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], ['w₁', '0.5', '-0.85', '+0.08', '0.58']);

  closeTo(after.state.data.w1, scene.after.values.w1);
  closeTo(after.state.data.b, scene.after.values.b);
  closeTo(after.state.data.loss, scene.after.loss);
  closeTo(step.state.data.w1, scene.before.values.w1);
  assert.equal('grads' in after.state, false);
});

test('scene 4 backward frames reveal one operation at a time', () => {
  const scene = createScene4();
  const seedFrame = keyframe(scene, 'seed');
  assert.deepEqual(seedFrame.state.grads, { loss: 1 });
  assert.deepEqual(seedFrame.state.topo, [
    'loss',
    'diff',
    'y',
    'zb',
    'dot2',
    'dot1',
    'p1',
    'p2',
    'p3',
  ]);

  const square = keyframe(scene, '∂loss/∂y');
  assert.deepEqual(square.state.activeEdges, ['diff->loss']);
  assert.deepEqual(square.state.edgeLabels, { 'diff->loss': '∂=-1.08' });

  const tanh = keyframe(scene, 'through tanh');
  closeTo(tanh.state.grads.y, scene.before.grads.y);
  assert.equal('w1' in tanh.state.grads, false);

  const last = keyframe(scene, 'through × w3');
  closeTo(last.state.grads.w1, scene.updates.w1.gradient);
  closeTo(last.state.grads.w2, scene.updates.w2.gradient);
  closeTo(last.state.grads.w3, scene.updates.w3.gradient);
  closeTo(last.state.grads.b, scene.updates.b.gradient);
});

test('scene 4 keyframes are ordered and captions explain the step', () => {
  const scene = createScene4();
  let previous = -1;
  for (const frame of scene.keyframes) {
    assert.ok(frame.at > previous, 'keyframe order at ' + frame.at);
    previous = frame.at;
    assert.ok(frame.state.caption.length > 0);
  }
  assert.ok(previous < scene.duration);
  assert.equal(scene.keyframes.length, 15);

  const step = keyframe(scene, 'SGD step');
  assert.match(step.state.caption, /p ← p − lr · g/);
  const after = keyframe(scene, 'after step');
  assert.match(after.state.caption, /fell from 0\.29 to 0\.12/);
  assert.match(after.state.caption, /zeroGrad\(\)/);
});

test('driving the timeline into scene 4 exposes the update state', () => {
  const scene3 = createScene3();
  const scene4 = createScene4();
  const timeline = new Timeline({ scenes: [scene3, scene4] });
  const stepAt = scene3.duration + keyframe(scene4, 'SGD step').at;

  timeline.seek(stepAt);
  const snapshot = timeline.snapshot();
  assert.equal(snapshot.sceneId, 'scene-4');
  assert.match(snapshot.state.updates.w1, /-g 0\.85/);
  closeTo(snapshot.state.data.w1, 0.5);

  timeline.seek(scene3.duration + keyframe(scene4, 'after step').at);
  closeTo(timeline.snapshot().state.data.loss, 0.12263663330900093);
});
