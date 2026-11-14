import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/timeline.js';

const { Timeline, sampleKeyframes, sceneAt, nextKeyframeTime } = globalThis.MGViz;

const sceneA = {
  id: 'a',
  title: 'Scene A',
  duration: 4,
  keyframes: [
    { at: 0, label: 'start', state: { visible: [] } },
    { at: 2, label: 'half', state: { visible: ['x'] } },
  ],
};
const sceneB = {
  id: 'b',
  title: 'Scene B',
  duration: 3,
  keyframes: [
    { at: 0, label: 'start', state: { visible: ['x', 'y'] } },
    { at: 1.5, label: 'end', state: { visible: ['x', 'y', 'z'] } },
  ],
};

function makeTimeline() {
  return new Timeline({ scenes: [sceneA, sceneB] });
}

test('sampleKeyframes returns the latest keyframe at or before time', () => {
  const keyframes = sceneA.keyframes;
  assert.equal(sampleKeyframes(keyframes, 0).index, 0);
  assert.equal(sampleKeyframes(keyframes, 1.9).index, 0);
  assert.equal(sampleKeyframes(keyframes, 2).index, 1);
  assert.equal(sampleKeyframes(keyframes, 99).index, 1);
  assert.equal(sampleKeyframes(keyframes, 1).segmentProgress, 0.5);

  const last = sampleKeyframes(keyframes, 3);
  assert.equal(last.next, null);
  assert.equal(last.segmentProgress, 1);
});

test('sampleKeyframes rejects an empty scene', () => {
  assert.throws(() => sampleKeyframes([], 0), TypeError);
});

test('sceneAt handles boundaries and the total duration', () => {
  const scenes = [sceneA, sceneB];
  assert.equal(sceneAt(scenes, 0).sceneIndex, 0);
  assert.equal(sceneAt(scenes, 3.9).sceneIndex, 0);
  assert.equal(sceneAt(scenes, 4).sceneIndex, 1);
  assert.equal(sceneAt(scenes, 4).localTime, 0);
  assert.equal(sceneAt(scenes, 5.5).localTime, 1.5);
  assert.equal(sceneAt(scenes, 7).sceneIndex, 1);
  assert.equal(sceneAt(scenes, 7).localTime, 3);
  assert.equal(sceneAt(scenes, 100).localTime, 3);
});

test('nextKeyframeTime walks across scenes and stops at the last keyframe', () => {
  const scenes = [sceneA, sceneB];
  assert.equal(nextKeyframeTime(scenes, 0), 2);
  assert.equal(nextKeyframeTime(scenes, 2), 4);
  assert.equal(nextKeyframeTime(scenes, 4), 5.5);
  assert.equal(nextKeyframeTime(scenes, 5.5), null);
  assert.equal(nextKeyframeTime(scenes, 6.4), null);
});

test('Timeline starts paused at the first keyframe', () => {
  const timeline = makeTimeline();
  const snapshot = timeline.snapshot();
  assert.equal(timeline.duration, 7);
  assert.equal(snapshot.time, 0);
  assert.equal(snapshot.playing, false);
  assert.equal(snapshot.sceneId, 'a');
  assert.equal(snapshot.keyframeIndex, 0);
  assert.equal(snapshot.canStep, true);
  assert.equal(snapshot.ended, false);
});

test('play + advance honour the speed multiplier', () => {
  const timeline = makeTimeline();
  timeline.play();
  assert.equal(timeline.snapshot().playing, true);

  timeline.advance(1);
  assert.equal(timeline.snapshot().time, 1);

  timeline.setSpeed(2);
  timeline.advance(0.5);
  assert.equal(timeline.snapshot().time, 2);
  assert.equal(timeline.snapshot().keyframeIndex, 1);

  timeline.setSpeed(0.5);
  timeline.advance(2);
  assert.equal(timeline.snapshot().time, 3);
});

test('pause stops advancing', () => {
  const timeline = makeTimeline();
  timeline.play();
  timeline.advance(1);
  timeline.pause();
  timeline.advance(5);
  assert.equal(timeline.snapshot().time, 1);
  assert.equal(timeline.snapshot().playing, false);
});

test('step jumps to the next keyframe, across scene boundaries, and pauses', () => {
  const timeline = makeTimeline();
  timeline.play();
  timeline.step();
  assert.equal(timeline.snapshot().time, 2);
  assert.equal(timeline.snapshot().playing, false);

  timeline.advance(2.5); // paused: no-op
  assert.equal(timeline.snapshot().time, 2);

  timeline.seek(3.2);
  timeline.step();
  assert.equal(timeline.snapshot().time, 4);
  assert.equal(timeline.snapshot().sceneId, 'b');

  timeline.step();
  assert.equal(timeline.snapshot().time, 5.5);
  assert.equal(timeline.snapshot().canStep, false);

  timeline.step(); // no further keyframe: stay put
  assert.equal(timeline.snapshot().time, 5.5);
});

test('seek clamps to the timeline and stops at the end', () => {
  const timeline = makeTimeline();
  timeline.play();
  timeline.seek(-5);
  assert.equal(timeline.snapshot().time, 0);

  timeline.seek(100);
  assert.equal(timeline.snapshot().time, 7);
  assert.equal(timeline.snapshot().ended, true);
  assert.equal(timeline.snapshot().playing, false);

  timeline.advance(1);
  assert.equal(timeline.snapshot().time, 7);
});

test('playing from the end restarts at zero', () => {
  const timeline = makeTimeline();
  timeline.seek(7);
  timeline.play();
  assert.equal(timeline.snapshot().time, 0);
  assert.equal(timeline.snapshot().playing, true);
  assert.equal(timeline.snapshot().sceneId, 'a');
});

test('advance stops and pauses at the total duration', () => {
  const timeline = makeTimeline();
  timeline.play();
  timeline.seek(6.5);
  timeline.advance(1);
  const snapshot = timeline.snapshot();
  assert.equal(snapshot.time, 7);
  assert.equal(snapshot.ended, true);
  assert.equal(snapshot.playing, false);
});

test('setSpeed validates its input', () => {
  const timeline = makeTimeline();
  assert.throws(() => timeline.setSpeed(0), TypeError);
  assert.throws(() => timeline.setSpeed(-1), TypeError);
  assert.throws(() => timeline.setSpeed(Number.NaN), TypeError);
  assert.throws(() => timeline.setSpeed('2'), TypeError);
});

test('subscribers receive snapshots and can unsubscribe', () => {
  const seen = [];
  const timeline = makeTimeline();
  const unsubscribe = timeline.subscribe((snapshot) => seen.push(snapshot.time));
  timeline.seek(2);
  unsubscribe();
  timeline.seek(4);
  assert.deepEqual(seen, [2]);
});

test('Timeline rejects malformed scenes', () => {
  assert.throws(() => new Timeline({ scenes: [] }), TypeError);
  assert.throws(
    () =>
      new Timeline({
        scenes: [{ id: 'bad', duration: 0, keyframes: [] }],
      }),
    TypeError
  );
});
