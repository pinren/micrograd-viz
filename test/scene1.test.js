import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/graph.js';
import '../src/scenes/scene1.js';

const { createScene1, SCENE1_NODES } = globalThis.MGViz;

test('scene 1 builds d = a*b + c with the expected values', () => {
  const scene = createScene1();
  const { a, b, c, product, sum } = scene.values;

  assert.equal(a.data, 2);
  assert.equal(b.data, -3);
  assert.equal(c.data, 10);
  assert.equal(product.data, -6);
  assert.equal(sum.data, 4);

  assert.equal(sum.grad, 1);
  assert.equal(product.grad, 1);
  assert.equal(a.grad, -3);
  assert.equal(b.grad, 2);
  assert.equal(c.grad, 1);
});

test('scene 1 graph has 5 nodes and 4 dependency edges', () => {
  const scene = createScene1();
  assert.equal(scene.graph.nodes.length, 5);
  assert.equal(scene.graph.edges.length, 4);
  assert.deepEqual(
    scene.graph.nodes.map((node) => node.id).sort(),
    [...SCENE1_NODES].sort()
  );
  assert.equal(scene.graph.rootId, 'add');
});

test('scene 1 keyframes grow the graph monotonically and end with grads', () => {
  const scene = createScene1();
  assert.equal(scene.keyframes.length, 6);
  assert.equal(scene.keyframes[0].at, 0);
  assert.equal(scene.keyframes[0].state.showGrad, undefined);

  let previous = new Set();
  for (const keyframe of scene.keyframes) {
    const visible = new Set(keyframe.state.visible);
    for (const id of visible) {
      assert.ok(SCENE1_NODES.includes(id), 'unknown node ' + id);
    }
    for (const id of previous) {
      assert.ok(visible.has(id), 'node ' + id + ' disappeared');
    }
    previous = visible;
  }

  const finalState = scene.keyframes[scene.keyframes.length - 1].state;
  assert.deepEqual(finalState.visible, SCENE1_NODES);
  assert.equal(finalState.showGrad, true);
  assert.match(finalState.caption, /grad/i);

  assert.ok(scene.keyframes[scene.keyframes.length - 1].at < scene.duration);
});
