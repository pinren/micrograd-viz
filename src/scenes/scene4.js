/*
 * Scene 4: one SGD step on the scene-3 neuron.
 *
 *   y = tanh(w · x + b),  loss = (y − t)²
 *
 * The scene forwards the loss, runs the backward pass to fill every parameter
 * gradient, then applies exactly one update — p ← p − lr · g — and shows the
 * parameter values and the loss after the step. Scene 5 repeats this loop.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const SCENE4_METRICS = {
    nodeWidth: 104,
    nodeHeight: 62,
    gapX: 30,
    gapY: 30,
    margin: 24,
  };

  const LEARNING_RATE = 0.1;

  /** Plain-number forward pass, used for the post-update snapshot. */
  function forwardNumbers(params) {
    const p1 = params.w1 * params.x1;
    const p2 = params.w2 * params.x2;
    const p3 = params.w3 * params.x3;
    const dot1 = p1 + p2;
    const dot2 = dot1 + p3;
    const zb = dot2 + params.b;
    const y = Math.tanh(zb);
    const diff = y - params.t;
    const loss = diff * diff;
    return {
      w1: params.w1,
      x1: params.x1,
      w2: params.w2,
      x2: params.x2,
      w3: params.w3,
      x3: params.x3,
      b: params.b,
      t: params.t,
      p1,
      p2,
      p3,
      dot1,
      dot2,
      zb,
      y,
      diff,
      loss,
    };
  }

  function createScene4() {
    const {
      Value,
      layoutGraph,
      traceBackward,
      gradsById,
      formatNumber,
      localDerivative,
    } = global.MGViz;

    // Same neuron as scene 3: w · x + b with z = 0.5 and y ≈ 0.46.
    const w1 = new Value(0.5, { label: 'w\u2081', name: 'w1' });
    const x1 = new Value(1, { label: 'x\u2081', name: 'x1' });
    const w2 = new Value(-1, { label: 'w\u2082', name: 'w2' });
    const x2 = new Value(0.5, { label: 'x\u2082', name: 'x2' });
    const w3 = new Value(2, { label: 'w\u2083', name: 'w3' });
    const x3 = new Value(-1, { label: 'x\u2083', name: 'x3' });
    const bias = new Value(2.5, { label: 'b', name: 'b' });

    const p1 = w1.mul(x1);
    p1.label = '\u00d7';
    p1.name = 'p1';
    const p2 = w2.mul(x2);
    p2.label = '\u00d7';
    p2.name = 'p2';
    const p3 = w3.mul(x3);
    p3.label = '\u00d7';
    p3.name = 'p3';

    const dot1 = p1.add(p2);
    dot1.label = '+';
    dot1.name = 'dot1';
    const dot2 = dot1.add(p3);
    dot2.label = '+';
    dot2.name = 'dot2';
    const zb = dot2.add(bias);
    zb.label = '+';
    zb.name = 'zb';
    const y = zb.tanh();
    y.label = 'tanh';
    y.name = 'y';

    const target = new Value(1, { label: 't', name: 't' });
    const diff = y.sub(target);
    diff.label = '\u2212';
    diff.name = 'diff';
    const loss = diff.pow(2);
    loss.label = 'loss';
    loss.name = 'loss';

    const graph = layoutGraph(loss, SCENE4_METRICS);
    const idOfValue = new Map(graph.nodes.map((node) => [node.value, node.id]));

    const orderedOps = graph.nodes
      .filter((node) => node.value._prev.size > 0)
      .sort(
        (left, right) => right.depth - left.depth || left.index - right.index
      );
    const trace = traceBackward(loss, {
      order: orderedOps.map((node) => node.value),
    });
    const topo = orderedOps.map((node) => node.id);

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
          '\u2202=' + formatNumber(localOfEdge.get(edgeId)),
        ])
      );

    const parameters = { w1, w2, w3, b: bias };
    const before = {
      w1: w1.data,
      x1: x1.data,
      w2: w2.data,
      x2: x2.data,
      w3: w3.data,
      x3: x3.data,
      b: bias.data,
      t: target.data,
    };
    const beforeLoss = loss.data;
    const beforeGrads = Object.fromEntries(
      graph.nodes.map((node) => [node.id, trace.grads.get(node.value)])
    );

    // Record one real gradient-descent step on the parameters themselves.
    const updates = {};
    for (const [name, parameter] of Object.entries(parameters)) {
      updates[name] = {
        gradient: parameter.grad,
        delta: -LEARNING_RATE * parameter.grad,
        before: parameter.data,
        after: parameter.data - LEARNING_RATE * parameter.grad,
      };
      parameter.step(LEARNING_RATE);
      parameter.zeroGrad();
    }
    const after = {
      ...before,
      w1: w1.data,
      w2: w2.data,
      w3: w3.data,
      b: bias.data,
    };
    const afterForward = forwardNumbers(after);
    const afterLoss = afterForward.loss;
    const afterData = Object.fromEntries(
      graph.nodes.map((node) => [node.id, afterForward[node.value.name]])
    );

    for (const node of graph.nodes) {
      if (!(node.value.name in afterForward)) {
        throw new Error('scene 4: missing forward value for ' + node.id);
      }
    }

    const allNeuron = graph.nodes
      .filter((node) => !['t', 'diff', 'loss'].includes(node.id))
      .map((node) => node.id);
    const allVisible = graph.nodes.map((node) => node.id);
    const parameterIds = ['w1', 'w2', 'w3', 'b'];
    const updateText = Object.fromEntries(
      parameterIds.map((id) => {
        const update = updates[id];
        return [
          id,
          '-g ' +
            formatNumber(-update.gradient) +
            ' \u2192 ' +
            formatNumber(update.after),
        ];
      })
    );

    const rows = parameterIds.map((id) => ({
      id,
      label: graph.nodeById.get(id).label,
      data: formatNumber(updates[id].before),
      gradient: formatNumber(updates[id].gradient),
      delta: (updates[id].delta >= 0 ? '+' : '') + formatNumber(updates[id].delta),
      after: formatNumber(updates[id].after),
    }));

    const readout = {
      title:
        'SGD step \u00b7 lr = ' +
        LEARNING_RATE +
        ' \u00b7 loss ' +
        formatNumber(beforeLoss) +
        ' \u2192 ' +
        formatNumber(afterLoss),
      stats: [
        { label: 'loss before', value: formatNumber(beforeLoss) },
        { label: 'loss after', value: formatNumber(afterLoss) },
        { label: 'learning rate', value: String(LEARNING_RATE) },
      ],
      table: {
        columns: ['param', 'data', 'grad', '\u2212lr\u00b7g', 'new data'],
        rows: rows.map((row) => [
          row.label,
          row.data,
          row.gradient,
          row.delta,
          row.after,
        ]),
      },
    };

    const keyframes = [
      {
        at: 0,
        label: 'inputs',
        state: {
          visible: ['w1', 'x1', 'w2', 'x2', 'w3', 'x3', 'b'],
          caption:
            'The same neuron as scene 3: y = tanh(w \u00b7 x + b). This time we know the answer we want: a target t = 1. The parameters w and b are the Values that training will change.',
        },
      },
      {
        at: 2.5,
        label: 'forward',
        state: {
          visible: allNeuron,
          focus: 'y',
          caption:
            'Forward pass: z = ' +
            formatNumber(zb.data) +
            ', so y = tanh(' +
            formatNumber(zb.data) +
            ') = ' +
            formatNumber(y.data) +
            '. The prediction is a Value, built out of Values.',
        },
      },
      {
        at: 5,
        label: 'loss',
        state: {
          visible: allVisible,
          focus: 'loss',
          caption:
            'Measure the error: loss = (y \u2212 t)\u00b2 = (' +
            formatNumber(y.data) +
            ' \u2212 ' +
            formatNumber(target.data) +
            ')\u00b2 = ' +
            formatNumber(beforeLoss) +
            '. A bigger miss gives a bigger loss.',
        },
      },
      {
        at: 7,
        label: 'seed',
        state: {
          visible: allVisible,
          topo,
          focus: 'loss',
          grads: { loss: 1 },
          caption:
            'Backward starts at the loss: loss.grad = 1. Operations run in reverse topological order, so each node receives every contribution before it passes its gradient on.',
        },
      },
    ];

    const stepCaptions = {
      loss:
        'Differentiate the square: \u2202loss/\u2202diff = 2 \u00d7 diff = ' +
        formatNumber(2 * diff.data) +
        ', so diff.grad = ' +
        formatNumber(diff.grad) +
        '.',
      diff:
        'Differentiate the subtraction: \u2202diff/\u2202y = 1 and \u2202diff/\u2202t = \u22121, so y.grad = ' +
        formatNumber(y.grad) +
        ' and t.grad = ' +
        formatNumber(target.grad) +
        '. The target is an input, not a parameter.',
      y:
        'Through tanh: \u2202y/\u2202z = 1 \u2212 y\u00b2 = ' +
        formatNumber(1 - y.data * y.data) +
        ', so z.grad = y.grad \u00d7 ' +
        formatNumber(1 - y.data * y.data) +
        ' = ' +
        formatNumber(zb.grad) +
        '.',
      zb:
        'Through the bias add: z.grad splits equally into dot2 and b, so each gets ' +
        formatNumber(zb.grad) +
        '.',
      dot2:
        'Through the second add: dot2.grad splits into dot1 and p3 (both local derivatives are 1).',
      dot1:
        'Through the first add: dot1.grad splits into p1 and p2 (both local derivatives are 1).',
      p1:
        'Through the first product: w1.grad = x1 \u00d7 p1.grad = ' +
        formatNumber(x1.data) +
        ' \u00d7 ' +
        formatNumber(p1.grad) +
        ' = ' +
        formatNumber(w1.grad) +
        '; x1 is an input, so its gradient stops here.',
      p2:
        'Through the second product: w2.grad = x2 \u00d7 p2.grad = ' +
        formatNumber(x2.data) +
        ' \u00d7 ' +
        formatNumber(p2.grad) +
        ' = ' +
        formatNumber(w2.grad) +
        '.',
      p3:
        'Through the third product: w3.grad = x3 \u00d7 p3.grad = ' +
        formatNumber(x3.data) +
        ' \u00d7 ' +
        formatNumber(p3.grad) +
        ' = ' +
        formatNumber(w3.grad) +
        '. All parameter gradients are now complete.',
    };
    const stepLabels = {
      loss: '\u2202loss/\u2202y',
      diff: 'through \u2212',
      y: 'through tanh',
      zb: 'through + b',
      dot2: 'through + p3',
      dot1: 'through + p2',
      p1: 'through \u00d7 w1',
      p2: 'through \u00d7 w2',
      p3: 'through \u00d7 w3',
    };

    const revealed = new Set([loss]);
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
        at: 8.5 + index * 1.5,
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
      at: 22.5,
      label: 'SGD step',
      state: {
        visible: allVisible,
        grads: gradsById(graph, trace.grads),
        // The graph's own intermediate values are still the pre-update ones;
        // only the four parameter leaves were stepped in place.
        data: {
          w1: before.w1,
          w2: before.w2,
          w3: before.w3,
          b: before.b,
        },
        updates: updateText,
        readout: {
          ...readout,
          title: 'SGD step \u00b7 lr = ' + LEARNING_RATE,
        },
        caption:
          'Gradient descent takes one step along the negative gradient: p \u2190 p \u2212 lr \u00b7 g with lr = ' +
          LEARNING_RATE +
          '. Each parameter annotation shows \u2212g and the new data; the table lists every weight before and after.',
      },
    });

    keyframes.push({
      at: 25,
      label: 'after step',
      state: {
        visible: allVisible,
        data: afterData,
        updates: updateText,
        readout,
        focus: 'loss',
        caption:
          'After one update the loss fell from ' +
          formatNumber(beforeLoss) +
          ' to ' +
          formatNumber(afterLoss) +
          '. w\u2081 moved ' +
          (updates.w1.delta >= 0 ? '+' : '') +
          formatNumber(updates.w1.delta) +
          ' because its gradient was ' +
          formatNumber(updates.w1.gradient) +
          '. Gradients are cleared with zeroGrad() before the next forward pass. Scene 5 repeats this loop until the network learns.',
      },
    });

    return {
      id: 'scene-4',
      title: 'Scene 4 \u00b7 One SGD step: follow the negative gradient',
      duration: 27,
      keyframes,
      graph,
      root: loss,
      trace,
      learningRate: LEARNING_RATE,
      before: { values: before, loss: beforeLoss, grads: beforeGrads },
      after: { values: after, loss: afterLoss, data: afterData },
      updates,
      readout,
      values: {
        w1,
        x1,
        w2,
        x2,
        w3,
        x3,
        b: bias,
        t: target,
        p1,
        p2,
        p3,
        dot1,
        dot2,
        zb,
        y,
        diff,
        loss,
      },
    };
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    createScene4,
    SCENE4_METRICS,
    SCENE4_LEARNING_RATE: LEARNING_RATE,
  });
})(globalThis);
