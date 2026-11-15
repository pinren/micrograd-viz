/*
 * Scene 2: where gradients come from.
 *
 * The graph is the same d = a * b + c as scene 1, but now the backward pass is
 * animated: operations are numbered in reverse topological order, each step
 * highlights the node's incoming edges, labels them with their local
 * derivatives, and then shows the gradient landing in the child nodes.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const ALL_NODES = ['a', 'b', 'c', 'mul', 'add'];

  function createScene2() {
    const {
      Value,
      layoutGraph,
      traceBackward,
      gradsById,
      formatNumber,
      localDerivative,
    } = global.MGViz;

    const a = new Value(2, { label: 'a', name: 'a' });
    const b = new Value(-3, { label: 'b', name: 'b' });
    const c = new Value(10, { label: 'c', name: 'c' });
    const product = a.mul(b);
    product.label = '×';
    product.name = 'mul';
    const sum = product.add(c);
    sum.label = '+';
    sum.name = 'add';

    const graph = layoutGraph(sum);
    const idOfValue = new Map(graph.nodes.map((node) => [node.value, node.id]));

    // Presentation order: deepest operations first (a valid reverse
    // topological order), so + is processed before × and the story reads
    // top-down instead of following Set insertion order.
    const orderedOps = graph.nodes
      .filter((node) => node.value._prev.size > 0)
      .sort(
        (left, right) => right.depth - left.depth || left.index - right.index
      );
    const trace = traceBackward(sum, {
      order: orderedOps.map((node) => node.value),
    });
    const stepByValue = new Map(trace.steps.map((step) => [step.node, step]));

    const localOfEdge = new Map();
    for (const edge of graph.edges) {
      const from = graph.nodeById.get(edge.from);
      const to = graph.nodeById.get(edge.to);
      localOfEdge.set(edge.id, localDerivative(to.value, from.value));
    }
    const edgesInto = (id) =>
      graph.edges.filter((edge) => edge.to === id).map((edge) => edge.id);
    const labelsFor = (id) =>
      Object.fromEntries(
        edgesInto(id).map((edgeId) => [
          edgeId,
          '∂=' + formatNumber(localOfEdge.get(edgeId)),
        ])
      );

    const topo = orderedOps.map((node) => node.id);
    const revealed = new Set([sum]);
    const seedGrads = gradsById(
      graph,
      new Map([[sum, trace.seedGrads.get(sum)]])
    );

    const keyframes = [
      {
        at: 0,
        label: 'setup',
        state: {
          visible: ALL_NODES,
          caption:
            'We already have d = a × b + c = ' +
            formatNumber(sum.data) +
            '. Backward starts at the output and walks the graph in reverse topological order, accumulating each node\u2019s grad.',
        },
      },
      {
        at: 2.5,
        label: 'reverse topo',
        state: {
          visible: ALL_NODES,
          topo,
          focus: 'add',
          caption:
            'Only operations are numbered: \u2460 + must run before \u2461 ×. The × node\u2019s gradient has to be complete before it can pass anything back to a and b \u2014 that is the reverse topological order.',
        },
      },
      {
        at: 5,
        label: 'seed',
        state: {
          visible: ALL_NODES,
          topo,
          focus: 'add',
          grads: seedGrads,
          caption:
            'Seed the output: d.grad = 1 (\u2202d/\u2202d). Every other grad is still zero.',
        },
      },
    ];

    const captions = {
      add:
        'Process \u2460 +: d.grad = 1 flows back along both edges. The local derivatives are \u2202d/\u2202mul = 1 and \u2202d/\u2202c = 1, so mul.grad = 1 and c.grad = 1.',
      mul:
        'Process \u2461 ×: mul.grad = 1 flows to a and b. The local derivatives are \u2202mul/\u2202a = b = ' +
        formatNumber(b.data) +
        ' and \u2202mul/\u2202b = a = ' +
        formatNumber(a.data) +
        ', so a.grad = 1 × ' +
        formatNumber(b.data) +
        ' = ' +
        formatNumber(b.data) +
        ' and b.grad = 1 × ' +
        formatNumber(a.data) +
        ' = ' +
        formatNumber(a.data) +
        '.',
    };
    const atByNode = { add: 7.5, mul: 10.5 };
    const labelByNode = { add: 'through +', mul: 'through ×' };

    for (const step of trace.steps) {
      const id = idOfValue.get(step.node);
      for (const child of step.children) revealed.add(child);
      const grads = {};
      for (const node of graph.nodes) {
        if (revealed.has(node.value)) {
          grads[node.id] = step.gradsAfter.get(node.value);
        }
      }
      keyframes.push({
        at: atByNode[id],
        label: labelByNode[id],
        state: {
          visible: ALL_NODES,
          topo,
          focus: id,
          grads,
          activeEdges: edgesInto(id),
          edgeLabels: labelsFor(id),
          backward: true,
          caption: captions[id],
        },
      });
    }

    keyframes.push({
      at: 13.5,
      label: 'chain rule',
      state: {
        visible: ALL_NODES,
        topo,
        grads: gradsById(graph, trace.grads),
        backward: true,
        caption:
          'Done. Chain rule along a \u2192 mul \u2192 d: \u2202d/\u2202a = \u2202d/\u2202mul \u00b7 \u2202mul/\u2202a = 1 \u00b7 b = ' +
          formatNumber(b.data) +
          '. Reverse topological order made mul.grad complete before it was used.',
      },
    });

    return {
      id: 'scene-2',
      title: 'Scene 2 \u00b7 Where gradients come from',
      duration: 15.5,
      keyframes,
      graph,
      root: sum,
      trace,
      values: { a, b, c, product, sum },
    };
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    createScene2,
    SCENE2_NODES: ALL_NODES,
  });
})(globalThis);
