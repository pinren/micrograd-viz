import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';
import '../src/train.js';
import '../src/nn.js';
import '../src/plot.js';
import '../src/timeline.js';
import '../src/scenes/scene4.js';
import '../src/scenes/scene5.js';

const {
  Timeline,
  createScene4,
  createScene5,
  buildBoundary,
  forwardNumbers,
  toPlotX,
  toPlotY,
  PLOT_BOX,
  SCENE5_EPOCHS,
  SCENE5_LEARNING_RATE,
} = globalThis.MGViz;

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    'expected ' + actual + ' to be close to ' + expected
  );
}

function decisionValue(snapshot, x, y) {
  return forwardNumbers(snapshot, [x, y])[0];
}

test('scene 5 trains a 2-3-1 MLP and the loss falls monotonically', () => {
  const scene = createScene5();

  assert.equal(scene.epochs, SCENE5_EPOCHS);
  assert.equal(scene.learningRate, SCENE5_LEARNING_RATE);
  assert.deepEqual(scene.arch, [3, 1]);
  assert.equal(scene.params.length, 13);
  assert.equal(scene.losses.length, SCENE5_EPOCHS + 1);
  assert.equal(scene.keyframes.length, SCENE5_EPOCHS + 1);

  closeTo(scene.initialLoss, 1.3220888454228548);
  closeTo(scene.finalLoss, 0.30016173887140346);
  assert.ok(
    scene.finalLoss < scene.initialLoss * 0.4,
    'final loss should be well below the initial loss'
  );

  let decreased = 0;
  for (let index = 1; index < scene.losses.length; index++) {
    assert.ok(
      scene.losses[index] <= scene.losses[index - 1] + 1e-12,
      'loss increased at epoch ' + index
    );
    if (scene.losses[index] < scene.losses[index - 1] - 1e-9) decreased++;
  }
  assert.ok(decreased > 30, 'the loop should visibly descend: ' + decreased);
});

test('scene 5 ends with all four points classified correctly', () => {
  const scene = createScene5();
  assert.equal(scene.finalAccuracy, 4);
  scene.finalPredictions.forEach((prediction, index) => {
    const predicted = prediction > 0 ? 1 : -1;
    assert.equal(predicted, scene.points[index].label);
    assert.ok(
      Math.abs(prediction) > 0.15,
      'point ' + index + ' should be clear of the boundary'
    );
  });

  const finalSnapshot = scene.finalSnapshot;
  const initialSnapshot = scene.keyframes[0].state.snapshot;
  assert.notDeepEqual(initialSnapshot, finalSnapshot);
  closeTo(
    decisionValue(finalSnapshot, 2, 3),
    scene.finalPredictions[0]
  );
});

test('scene 5 decision boundary is the network zero contour', () => {
  const scene = createScene5();
  assert.ok(scene.finalBoundary.length >= 1);

  let pointCount = 0;
  for (const segment of scene.finalBoundary) {
    assert.equal(segment.length, 2);
    for (const [x, y] of segment) {
      assert.ok(x >= scene.domain.xMin && x <= scene.domain.xMax);
      assert.ok(y >= scene.domain.yMin && y <= scene.domain.yMax);
      assert.ok(
        Math.abs(decisionValue(scene.finalSnapshot, x, y)) < 0.08,
        'boundary sample should sit on z = 0'
      );
      pointCount++;
    }
  }
  assert.ok(pointCount > 20, 'boundary should be a visible curve: ' + pointCount);
});

test('buildBoundary finds a straight linear separator', () => {
  // Single linear neuron: z = x - 2.5, so the boundary is the vertical line x = 2.5.
  const snapshot = [[{ w: [1, 0], b: -2.5, activation: 'linear' }]];
  const lines = buildBoundary(snapshot, {
    domain: { xMin: 0, xMax: 5, yMin: 0, yMax: 5 },
    columns: 21,
    rows: 40,
  });
  assert.ok(lines.length > 2);
  for (const segment of lines) {
    assert.equal(segment.length, 2);
    for (const [x, y] of segment) {
      closeTo(x, 2.5, 0.02);
      assert.ok(y >= 0 && y <= 5);
    }
  }
  assert.throws(() => buildBoundary([]), TypeError);
});

test('plot coordinates map the data domain onto the plot box', () => {
  const domain = { xMin: 0.5, xMax: 4.5, yMin: 0.5, yMax: 5.5 };
  closeTo(toPlotX(0.5, domain, PLOT_BOX), PLOT_BOX.x);
  closeTo(toPlotX(4.5, domain, PLOT_BOX), PLOT_BOX.x + PLOT_BOX.width);
  closeTo(toPlotX(2.5, domain, PLOT_BOX), PLOT_BOX.x + PLOT_BOX.width / 2);
  closeTo(toPlotY(0.5, domain, PLOT_BOX), PLOT_BOX.y + PLOT_BOX.height);
  closeTo(toPlotY(5.5, domain, PLOT_BOX), PLOT_BOX.y);
});

test('scene 5 keyframes are one epoch apart and inside the duration', () => {
  const scene = createScene5();
  let previous = -1;
  for (let index = 0; index < scene.keyframes.length; index++) {
    const frame = scene.keyframes[index];
    assert.equal(frame.state.epoch, index);
    assert.ok(frame.at > previous);
    previous = frame.at;
    assert.ok(frame.state.caption.length > 0);
    assert.equal(frame.state.losses.length, scene.losses.length);
    assert.equal(frame.state.readout.stats[1].value, globalThis.MGViz.formatNumber(frame.state.loss));
  }
  assert.ok(previous < scene.duration);
  assert.equal(scene.keyframes[SCENE5_EPOCHS].at, 24);
  closeTo(scene.keyframes[SCENE5_EPOCHS].state.loss, scene.finalLoss);
});

test('the timeline and fast-forward indexing reach the same epoch frames', () => {
  const scene4 = createScene4();
  const scene5 = createScene5();
  const timeline = new Timeline({ scenes: [scene4, scene5] });

  timeline.seek(scene4.duration + scene5.keyframes[30].at);
  let snapshot = timeline.snapshot();
  assert.equal(snapshot.sceneId, 'scene-5');
  assert.equal(snapshot.state.epoch, 30);
  closeTo(snapshot.state.loss, scene5.losses[30]);

  // Fast-forward by N epochs is a seek to keyframe current + N.
  const target = 30 + 25;
  timeline.seek(scene4.duration + scene5.keyframes[target].at);
  snapshot = timeline.snapshot();
  assert.equal(snapshot.state.epoch, 55);
  closeTo(snapshot.state.loss, scene5.losses[55]);

  timeline.seek(scene4.duration + scene5.keyframes[SCENE5_EPOCHS].at);
  snapshot = timeline.snapshot();
  assert.equal(snapshot.state.accuracy, 4);
  // Epoch 60 is the last keyframe; one final second of scene remains but there
  // is no further keyframe to step to.
  assert.equal(snapshot.canStep, false);
});
