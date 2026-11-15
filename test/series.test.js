import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';
import '../src/timeline.js';
import '../src/train.js';
import '../src/nn.js';
import '../src/plot.js';
import '../src/scenes/scene1.js';
import '../src/scenes/scene2.js';
import '../src/scenes/scene3.js';
import '../src/scenes/scene4.js';
import '../src/scenes/scene5.js';

const {
  Timeline,
  createScene1,
  createScene2,
  createScene3,
  createScene4,
  createScene5,
} = globalThis.MGViz;

function createSeries() {
  return [
    createScene1(),
    createScene2(),
    createScene3(),
    createScene4(),
    createScene5(),
  ];
}

test('the five scenes form one strictly increasing timeline', () => {
  const scenes = createSeries();
  assert.deepEqual(
    scenes.map((scene) => scene.id),
    ['scene-1', 'scene-2', 'scene-3', 'scene-4', 'scene-5']
  );
  assert.deepEqual(
    scenes.map((scene) => scene.duration),
    [13, 15.5, 30, 27, 25]
  );

  const timeline = new Timeline({ scenes });
  assert.equal(timeline.duration, 110.5);

  for (const scene of scenes) {
    assert.equal(scene.keyframes[0].at, 0);
    let previous = -1;
    for (const frame of scene.keyframes) {
      assert.ok(frame.at > previous, scene.id + ' keyframe order');
      assert.ok(frame.at < scene.duration, scene.id + ' keyframe inside scene');
      assert.ok(frame.state.caption.length > 0, scene.id + ' caption');
      previous = frame.at;
    }
  }
});

test('Step walks from scene 1 through scene 5', () => {
  const scenes = createSeries();
  const timeline = new Timeline({ scenes });

  timeline.seek(10.5); // last scene 1 keyframe
  timeline.step();
  assert.equal(timeline.snapshot().time, 13);
  assert.equal(timeline.snapshot().sceneId, 'scene-2');
  assert.equal(timeline.snapshot().keyframeIndex, 0);

  timeline.seek(26.5); // last scene 2 keyframe
  timeline.step();
  assert.equal(timeline.snapshot().time, 28.5);
  assert.equal(timeline.snapshot().sceneId, 'scene-3');
  assert.equal(timeline.snapshot().keyframeIndex, 0);

  timeline.seek(56.5); // last scene 3 keyframe
  timeline.step();
  assert.equal(timeline.snapshot().time, 58.5);
  assert.equal(timeline.snapshot().sceneId, 'scene-4');
  assert.equal(timeline.snapshot().keyframeIndex, 0);

  timeline.seek(83.5); // last scene 4 keyframe
  timeline.step();
  assert.equal(timeline.snapshot().time, 85.5);
  assert.equal(timeline.snapshot().sceneId, 'scene-5');
  assert.equal(timeline.snapshot().keyframeIndex, 0);

  timeline.seek(109.5); // last scene 5 keyframe (epoch 60)
  assert.equal(timeline.snapshot().canStep, false);
  assert.equal(timeline.snapshot().duration, 110.5);
  timeline.step();
  assert.equal(timeline.snapshot().time, 109.5);
});

test('sceneAt finds the scene and local time at each boundary', () => {
  const scenes = createSeries();
  const boundaries = [
    [0, 'scene-1', 0],
    [12.99, 'scene-1', 12.99],
    [13, 'scene-2', 0],
    [28.49, 'scene-2', 15.49],
    [28.5, 'scene-3', 0],
    [58.49, 'scene-3', 29.99],
    [58.5, 'scene-4', 0],
    [85.49, 'scene-4', 26.99],
    [85.5, 'scene-5', 0],
    [110.5, 'scene-5', 25],
  ];
  for (const [time, id, localTime] of boundaries) {
    const timeline = new Timeline({ scenes });
    timeline.seek(time);
    const snapshot = timeline.snapshot();
    assert.equal(snapshot.sceneId, id, 'scene at ' + time);
    assert.ok(
      Math.abs(snapshot.localTime - localTime) < 1e-9,
      'local time at ' + time
    );
  }
});
