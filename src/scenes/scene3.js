/*
 * Scene 3: a single neuron, y = tanh(w · x + b), with three inputs.
 *
 * The forward pass lights up values from leaves to output; the backward pass
 * then flows the gradient back through tanh, the sums, and the three products,
 * showing how every weight's gradient falls out of its input and the upstream
 * gradient. No training step is performed here — that is ticket 3.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const NEURON_METRICS = {
    nodeWidth: 118,
    nodeHeight: 66,
    gapX: 54,
    gapY: 16,
    margin: 36,
  };

  function createScene3() {
    const {
      Value,
      layoutGraph,
      traceBackward,
      gradsById,
      formatNumber,
      localDerivative,
    } = global.MGViz;

    // w · x + b with clean inputs; b is chosen so z = 0.5.
    const w1 = new Value(0.5, { label: 'w\u2081', name: 'w1' });
    const w2 = new Value(-1, { label: 'w\u2082', name: 'w2' });
    const w3 = new Value(2, { label: 'w\u2083', name: 'w3' });
    const x1 = new Value(1, { label: 'x\u2081', name: 'x1' });
    const x2 = new Value(0.5, { label: 'x\u2082', name: 'x2' });
    const x3 = new Value(-1, { label: 'x\u2083', name: 'x3' });
    const bias = new Value(2.5, { label: 'b', name: 'b' });

    const p1 = w1.mul(x1);
    p1.label = '×';
    p1.name = 'p1';
    const p2 = w2.mul(x2);
    p2.label = '×';
    p2.name = 'p2';
    const p3 = w3.mul(x3);
    p3.label = '×';
    p3.name = 'p3';

    const dot1 = p1.add(p2);
    dot1.label = '+';
    dot1.name = 'dot1';
    const dot2 = dot1.add(p3);
    dot2.label = '+';
    dot2.name = 'dot2';
    const z = dot2.add(bias);
    z.label = '+';
    z.name = 'zb';
    const y = z.tanh();
    y.label = 'tanh';
    y.name = 'y';

    const graph = layoutGraph(y, NEURON_METRICS);
    const idOfValue = new Map(graph.nodes.map((node) => [node.value, node.id]));

    const orderedOps = graph.nodes
      .filter((node) => node.value._prev.size > 0)
      .sort(
        (left, right) => right.depth - left.depth || left.index - right.index
      );
    const trace = traceBackward(y, {
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
    const allVisible = graph.nodes.map((node) => node.id);
    const up = formatNumber(z.grad); // ∂y/∂z = 1 - y², the shared upstream grad
    const slope = 1 - y.data * y.data;

    const forwardLeaves = ['w1', 'x1', 'w2', 'x2', 'w3', 'x3', 'b'];
    const forwardProducts = [...forwardLeaves, 'p1', 'p2', 'p3'];
    const forwardSum = [...forwardProducts, 'dot1', 'dot2', 'zb'];

    const keyframes = [
      {
        at: 0,
        label: 'inputs',
        state: {
          visible: forwardLeaves,
          caption:
            'A neuron computes y = tanh(w \u00b7 x + b) with three inputs. Start with the inputs x, the weights w, and the bias b \u2014 all plain Values.',
        },
      },
      {
        at: 3,
        label: 'products',
        state: {
          visible: forwardProducts,
          focus: 'p1',
          caption:
            'Multiply each weight by its input: p1 = w1 \u00d7 x1 = ' +
            formatNumber(p1.data) +
            ', p2 = w2 \u00d7 x2 = ' +
            formatNumber(p2.data) +
            ', p3 = w3 \u00d7 x3 = ' +
            formatNumber(p3.data) +
            '.',
        },
      },
      {
        at: 6,
        label: 'sum + b',
        state: {
          visible: forwardSum,
          focus: 'zb',
          caption:
            'Sum the products and add the bias: z = (' +
            formatNumber(p1.data) +
            ' + ' +
            formatNumber(p2.data) +
            ') + ' +
            formatNumber(p3.data) +
            ' + ' +
            formatNumber(bias.data) +
            ' = ' +
            formatNumber(z.data) +
            '.',
        },
      },
      {
        at: 9,
        label: 'tanh',
        state: {
          visible: allVisible,
          focus: 'y',
          caption:
            'Squash with tanh: y = tanh(' +
            formatNumber(z.data) +
            ') = ' +
            formatNumber(y.data) +
            '. Forward pass done \u2014 now send the gradient back.',
        },
      },
      {
        at: 11.5,
        label: 'seed',
        state: {
          visible: allVisible,
          topo,
          focus: 'y',
          grads: { y: 1 },
          caption:
            'Backward starts at the output: y.grad = 1 (\u2202y/\u2202y). Operations are numbered in reverse topological order; each one runs only after every node that consumes its result. The weight gradients are still zero.',
        },
      },
    ];

    const stepCaptions = {
      y:
        'Process tanh: \u2202y/\u2202z = 1 \u2212 y\u00b2 = ' +
        formatNumber(slope) +
        '. Chain rule: z.grad = y.grad \u00d7 ' +
        formatNumber(slope) +
        ' = ' +
        up +
        '.',
      zb:
        'Process +: z.grad splits equally into dot2 and b because both local derivatives are 1. dot2.grad = b.grad = ' +
        up +
        '.',
      dot2:
        'Process +: dot2.grad splits into dot1 and p3; both local derivatives are 1.',
      dot1:
        'Process +: dot1.grad splits into p1 and p2; both local derivatives are 1.',
      p1:
        'Process \u00d7: p1.grad flows into w1 and x1. \u2202p1/\u2202w1 = x1 = ' +
        formatNumber(x1.data) +
        ', so w1.grad = ' +
        formatNumber(x1.data) +
        ' \u00d7 ' +
        up +
        ' = ' +
        formatNumber(w1.grad) +
        '; \u2202p1/\u2202x1 = w1 = ' +
        formatNumber(w1.data) +
        ', so x1.grad = ' +
        formatNumber(w1.data) +
        ' \u00d7 ' +
        up +
        ' = ' +
        formatNumber(x1.grad) +
        '.',
      p2:
        'Process \u00d7: w2.grad = x2 \u00d7 p2.grad = ' +
        formatNumber(x2.data) +
        ' \u00d7 ' +
        up +
        ' = ' +
        formatNumber(w2.grad) +
        '; x2.grad = w2 \u00d7 p2.grad = ' +
        formatNumber(w2.data) +
        ' \u00d7 ' +
        up +
        ' = ' +
        formatNumber(x2.grad) +
        '.',
      p3:
        'Process \u00d7: w3.grad = x3 \u00d7 p3.grad = ' +
        formatNumber(x3.data) +
        ' \u00d7 ' +
        up +
        ' = ' +
        formatNumber(w3.grad) +
        '; x3.grad = w3 \u00d7 p3.grad = ' +
        formatNumber(w3.data) +
        ' \u00d7 ' +
        up +
        ' = ' +
        formatNumber(x3.grad) +
        '.',
    };
    const stepLabels = {
      y: 'through tanh',
      zb: 'through + b',
      dot2: 'through + p3',
      dot1: 'through + p2',
      p1: 'through × w1',
      p2: 'through × w2',
      p3: 'through × w3',
    };

    const revealed = new Set([y]);
    trace.steps.forEach((step, index) => {
      const id = idOfValue.get(step.node);
      for (const child of step.children) revealed.add(child);
      const grads = {};
      for (const node of graph.nodes) {
        if (revealed.has(node.value)) {
          grads[node.id] = step.gradsAfter.get(node.value);
        }
      }
      keyframes.push({
        at: 13.5 + index * 2,
        label: stepLabels[id],
        state: {
          visible: allVisible,
          topo,
          focus: id,
          grads,
          activeEdges: edgesInto(id),
          edgeLabels: labelsFor(id),
          backward: true,
          caption: stepCaptions[id],
        },
      });
    });

    keyframes.push({
      at: 28,
      label: 'weight grads',
      state: {
        visible: allVisible,
        topo,
        grads: gradsById(graph, trace.grads),
        backward: true,
        caption:
          'All three weight gradients: w1 = ' +
          formatNumber(w1.grad) +
          ', w2 = ' +
          formatNumber(w2.grad) +
          ', w3 = ' +
          formatNumber(w3.grad) +
          '. Gradient descent would subtract a small multiple of each (ticket 3); no training loop here.',
      },
    });

    return {
      id: 'scene-3',
      title: 'Scene 3 \u00b7 One neuron: y = tanh(w \u00b7 x + b)',
      duration: 30,
      keyframes,
      graph,
      root: y,
      trace,
      values: { w1, w2, w3, x1, x2, x3, b: bias, p1, p2, p3, dot1, dot2, zb: z, y },
    };
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    createScene3,
    NEURON_METRICS,
  });
})(globalThis);
