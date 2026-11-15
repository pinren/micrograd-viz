import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';
import '../src/timeline.js';
import '../src/scenes/scene1.js';
import '../src/scenes/scene2.js';

const { Timeline, createScene1, createScene2, SCENE2_NODES } = globalThis.MGViz;

function closeTo(actual, expected, tolerance = 1e-12) {
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

test('scene 2 reuses d = a*b + c and finishes with the scene 1 gradients', () => {
  const scene = createScene2();
  const { a, b, c, product, sum } = scene.values;

  assert.equal(sum.data, 4);
  assert.equal(product.data, -6);
  assert.equal(sum.grad, 1);
  assert.equal(product.grad, 1);
  assert.equal(a.grad, -3);
  assert.equal(b.grad, 2);
  assert.equal(c.grad, 1);
});

test('scene 2 graph is the same 5-node, 4-edge expression graph', () => {
  const scene = createScene2();
  assert.equal(scene.graph.nodes.length, 5);
  assert.equal(scene.graph.edges.length, 4);
  assert.equal(scene.graph.rootId, 'add');
  assert.deepEqual(
    scene.graph.nodes.map((node) => node.id).sort(),
    [...SCENE2_NODES].sort()
  );
});

test('scene 2 numbers operations in reverse topological order', () => {
  const scene = createScene2();
  const topoKeyframe = keyframe(scene, 'reverse topo');
  assert.deepEqual(topoKeyframe.state.topo, ['add', 'mul']);
  assert.equal(topoKeyframe.state.focus, 'add');
  assert.match(topoKeyframe.state.caption, /reverse topological/i);
});

test('scene 2 reveals gradients progressively, one operation at a time', () => {
  const scene = createScene2();
  const seed = keyframe(scene, 'seed');
  assert.deepEqual(seed.state.grads, { add: 1 });

  const throughAdd = keyframe(scene, 'through +');
  assert.deepEqual(throughAdd.state.grads, {
    add: 1,
    mul: 1,
    c: 1,
  });
  assert.equal(throughAdd.state.activeEdges.length, 2);
  assert.ok(throughAdd.state.activeEdges.includes('mul->add'));
  assert.ok(throughAdd.state.activeEdges.includes('c->add'));
  assert.deepEqual(throughAdd.state.edgeLabels, {
    'mul->add': '∂=1',
    'c->add': '∂=1',
  });
  assert.equal(throughAdd.state.backward, true);

  const throughMul = keyframe(scene, 'through ×');
  assert.deepEqual(throughMul.state.grads, {
    a: -3,
    b: 2,
    c: 1,
    mul: 1,
    add: 1,
  });
  assert.deepEqual(throughMul.state.edgeLabels, {
    'a->mul': '∂=-3',
    'b->mul': '∂=2',
  });
});

test('scene 2 animation frames agree with a real backward pass', () => {
  const scene = createScene2();
  const { a, b, c, product, sum } = scene.values;
  const throughAdd = keyframe(scene, 'through +');
  const throughMul = keyframe(scene, 'through ×');
  const final = scene.keyframes[scene.keyframes.length - 1];

  assert.equal(throughAdd.state.grads.mul, product.grad);
  assert.equal(throughAdd.state.grads.c, c.grad);
  assert.equal(throughMul.state.grads.a, a.grad);
  assert.equal(throughMul.state.grads.b, b.grad);
  assert.deepEqual(final.state.grads, {
    a: -3,
    b: 2,
    c: 1,
    mul: 1,
    add: 1,
  });
  closeTo(sum.grad, 1);
});

test('scene 2 only shows grads that have already been reached', () => {
  const scene = createScene2();
  const throughAdd = keyframe(scene, 'through +');
  assert.equal('a' in throughAdd.state.grads, false);
  assert.equal('b' in throughAdd.state.grads, false);

  const seed = keyframe(scene, 'seed');
  assert.equal('mul' in seed.state.grads, false);
  assert.equal('c' in seed.state.grads, false);
});

test('scene 2 keyframes are ordered and end before the scene duration', () => {
  const scene = createScene2();
  assert.ok(scene.keyframes.length >= 5);
  let previous = -1;
  for (const frame of scene.keyframes) {
    assert.ok(frame.at > previous, 'keyframe times must increase');
    previous = frame.at;
  }
  assert.ok(previous < scene.duration);
});

test('driving the timeline to a scene 2 keyframe yields that grad state', () => {
  const scene1 = createScene1();
  const scene2 = createScene2();
  const timeline = new Timeline({ scenes: [scene1, scene2] });
  const throughAddAt = scene1.duration + keyframe(scene2, 'through +').at;
  const throughMulAt = scene1.duration + keyframe(scene2, 'through ×').at;

  timeline.seek(throughAddAt);
  let snapshot = timeline.snapshot();
  assert.equal(snapshot.sceneId, 'scene-2');
  assert.equal(snapshot.state.grads.mul, 1);
  assert.equal('a' in snapshot.state.grads, false);

  timeline.seek(throughMulAt);
  snapshot = timeline.snapshot();
  assert.equal(snapshot.state.grads.a, -3);
  assert.equal(snapshot.state.grads.b, 2);
  assert.deepEqual(snapshot.state.edgeLabels, {
    'a->mul': '∂=-3',
    'b->mul': '∂=2',
  });

  timeline.seek(scene1.duration);
  assert.equal(timeline.snapshot().sceneId, 'scene-2');
  assert.equal(timeline.snapshot().state.grads, undefined);
});
