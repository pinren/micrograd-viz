/*
 * Scene 1: build the expression graph for d = a * b + c, one keyframe at a
 * time, then reveal every node's gradient after a backward pass.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const ALL_NODES = ['a', 'b', 'c', 'mul', 'add'];

  function createScene1() {
    const { Value, layoutGraph } = global.MGViz;

    const a = new Value(2, { label: 'a', name: 'a' });
    const b = new Value(-3, { label: 'b', name: 'b' });
    const c = new Value(10, { label: 'c', name: 'c' });
    const product = a.mul(b);
    product.label = '×';
    product.name = 'mul';
    const sum = product.add(c);
    sum.label = '+';
    sum.name = 'add';

    // The gradients are computed once; the final keyframe reveals them. This
    // ticket does not animate the backward pass itself.
    sum.backward();

    const keyframes = [
      {
        at: 0,
        label: 'a',
        state: {
          visible: ['a'],
          focus: 'a',
          caption:
            'Start with a = 2. A Value holds one number (data) and one gradient (grad), which is still zero.',
        },
      },
      {
        at: 2,
        label: 'b',
        state: {
          visible: ['a', 'b'],
          focus: 'b',
          caption:
            'Add b = -3. Inputs are plain Values; no operation connects them yet.',
        },
      },
      {
        at: 4,
        label: 'a × b',
        state: {
          visible: ['a', 'b', 'mul'],
          focus: 'mul',
          caption:
            'Multiply: mul = a × b = -6. The new node remembers its two operands, so the graph now has edges.',
        },
      },
      {
        at: 6,
        label: 'c',
        state: {
          visible: ['a', 'b', 'mul', 'c'],
          focus: 'c',
          caption: 'Add the third input: c = 10.',
        },
      },
      {
        at: 8,
        label: 'a × b + c',
        state: {
          visible: ALL_NODES,
          focus: 'add',
          caption:
            'Add: d = a × b + c = 4. This root node is the expression we will differentiate.',
        },
      },
      {
        at: 10.5,
        label: 'grads',
        state: {
          visible: ALL_NODES,
          focus: 'add',
          showGrad: true,
          caption:
            'Backward pass: d.grad = 1. Then mul.grad = 1 and c.grad = 1; the chain rule gives a.grad = b = -3 and b.grad = a = 2.',
        },
      },
    ];

    return {
      id: 'scene-1',
      title: 'Scene 1 · Build the expression graph',
      duration: 13,
      keyframes,
      graph: layoutGraph(sum),
      root: sum,
      values: { a, b, c, product, sum },
    };
  }

  global.MGViz = Object.assign(global.MGViz || {}, { createScene1, SCENE1_NODES: ALL_NODES });
})(globalThis);
