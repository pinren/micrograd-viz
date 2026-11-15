import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';
import '../src/timeline.js';
import '../src/scenes/scene2.js';
import '../src/scenes/scene3.js';

const { Timeline, createScene2, createScene3, NEURON_METRICS } =
  globalThis.MGViz;

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

test('scene 3 computes the neuron forward pass', () => {
  const scene = createScene3();
  const {
    w1,
    w2,
    w3,
    x1,
    x2,
    x3,
    b,
    p1,
    p2,
    p3,
    dot1,
    dot2,
    zb,
    y,
  } = scene.values;

  assert.deepEqual([w1.data, w2.data, w3.data], [0.5, -1, 2]);
  assert.deepEqual([x1.data, x2.data, x3.data], [1, 0.5, -1]);
  assert.equal(b.data, 2.5);
  assert.equal(p1.data, 0.5);
  assert.equal(p2.data, -0.5);
  assert.equal(p3.data, -2);
  assert.equal(dot1.data, 0);
  assert.equal(dot2.data, -2);
  assert.equal(zb.data, 0.5);
  closeTo(y.data, Math.tanh(0.5));
});

test('scene 3 gradient animation ends with the analytic weight grads', () => {
  const scene = createScene3();
  const { w1, w2, w3, x1, x2, x3, b, p1, p2, p3, zb, y } = scene.values;
  const slope = 1 - y.data * y.data;

  closeTo(y.grad, 1);
  closeTo(zb.grad, slope);
  closeTo(b.grad, slope);
  closeTo(p1.grad, slope);
  closeTo(p2.grad, slope);
  closeTo(p3.grad, slope);
  closeTo(w1.grad, x1.data * slope);
  closeTo(w2.grad, x2.data * slope);
  closeTo(w3.grad, x3.data * slope);
  closeTo(x1.grad, w1.data * slope);
  closeTo(x2.grad, w2.data * slope);
  closeTo(x3.grad, w3.data * slope);
});

test('scene 3 reveals weight grads one product at a time', () => {
  const scene = createScene3();
  const throughW1 = keyframe(scene, 'through × w1');
  const throughW2 = keyframe(scene, 'through × w2');
  const throughW3 = keyframe(scene, 'through × w3');

  closeTo(throughW1.state.grads.w1, 0.7864477329659273);
  closeTo(throughW1.state.grads.x1, 0.3932238664829636);
  assert.equal('w2' in throughW1.state.grads, false);
  assert.equal('w3' in throughW1.state.grads, false);

  closeTo(throughW2.state.grads.w2, 0.3932238664829636);
  assert.equal('w3' in throughW2.state.grads, false);

  closeTo(throughW3.state.grads.w3, -0.7864477329659273);
  closeTo(throughW3.state.grads.x3, 1.5728954659318546);
});

test('scene 3 steps through tanh, adds and muls in reverse topo order', () => {
  const scene = createScene3();
  const topo = keyframe(scene, 'seed').state.topo;
  assert.deepEqual(topo, ['y', 'zb', 'dot2', 'dot1', 'p1', 'p2', 'p3']);

  const throughTanh = keyframe(scene, 'through tanh');
  assert.deepEqual(throughTanh.state.activeEdges, ['zb->y']);
  assert.deepEqual(throughTanh.state.edgeLabels, { 'zb->y': '∂=0.79' });

  const throughBias = keyframe(scene, 'through + b');
  assert.deepEqual(throughBias.state.activeEdges, ['dot2->zb', 'b->zb']);
});

test('scene 3 gradient frames agree with the live autograd values', () => {
  const scene = createScene3();
  const { w1, w2, w3, y } = scene.values;
  const final = scene.keyframes[scene.keyframes.length - 1];

  closeTo(final.state.grads.w1, w1.grad);
  closeTo(final.state.grads.w2, w2.grad);
  closeTo(final.state.grads.w3, w3.grad);
  closeTo(final.state.grads.y, y.grad);
  closeTo(final.state.grads.zb, 1 - y.data * y.data);
});

test('scene 3 captions pair each local derivative with the right grad', () => {
  const scene = createScene3();
  const w1 = keyframe(scene, 'through × w1');
  assert.match(w1.state.caption, /w1\.grad = 1 × 0\.79 = 0\.79/);
  assert.match(w1.state.caption, /x1\.grad = 0\.5 × 0\.79 = 0\.39/);

  const w2 = keyframe(scene, 'through × w2');
  assert.match(w2.state.caption, /w2\.grad = x2 × p2\.grad = 0\.5 × 0\.79 = 0\.39/);
  assert.match(w2.state.caption, /x2\.grad = w2 × p2\.grad = -1 × 0\.79 = -0\.79/);

  const w3 = keyframe(scene, 'through × w3');
  assert.match(w3.state.caption, /w3\.grad = x3 × p3\.grad = -1 × 0\.79 = -0\.79/);
  assert.match(w3.state.caption, /x3\.grad = w3 × p3\.grad = 2 × 0\.79 = 1\.57/);

  const final = scene.keyframes[scene.keyframes.length - 1];
  assert.match(final.state.caption, /w1 = 0\.79, w2 = 0\.39, w3 = -0\.79/);
});

test('scene 3 uses a compact layout that still fits its boxes', () => {
  const scene = createScene3();
  assert.equal(scene.graph.nodes.length, 14);
  assert.equal(scene.graph.edges.length, 13);
  assert.equal(scene.graph.metrics.nodeWidth, NEURON_METRICS.nodeWidth);
  assert.equal(scene.graph.metrics.nodeHeight, NEURON_METRICS.nodeHeight);

  for (const node of scene.graph.nodes) {
    assert.ok(node.x >= 0 && node.x + node.width <= scene.graph.width);
    assert.ok(node.y >= 0 && node.y + node.height <= scene.graph.height);
  }
  assert.equal(scene.graph.rootId, 'y');
});

test('driving the timeline into scene 3 exposes the expected grads', () => {
  const scene2 = createScene2();
  const scene3 = createScene3();
  const timeline = new Timeline({ scenes: [scene2, scene3] });
  const w1At = scene2.duration + keyframe(scene3, 'through × w1').at;

  timeline.seek(w1At);
  let snapshot = timeline.snapshot();
  assert.equal(snapshot.sceneId, 'scene-3');
  closeTo(snapshot.state.grads.w1, 0.7864477329659273);
  assert.equal('w2' in snapshot.state.grads, false);

  timeline.seek(scene2.duration + keyframe(scene3, 'weight grads').at);
  snapshot = timeline.snapshot();
  closeTo(snapshot.state.grads.w3, -0.7864477329659273);
  closeTo(snapshot.state.grads.x3, 1.5728954659318546);
});

test('scene 3 keyframes are ordered and end before the scene duration', () => {
  const scene = createScene3();
  assert.equal(scene.keyframes.length, 13);
  let previous = -1;
  for (const frame of scene.keyframes) {
    assert.ok(frame.at > previous);
    previous = frame.at;
  }
  assert.ok(previous < scene.duration);
});
