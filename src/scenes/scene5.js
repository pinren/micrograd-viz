/*
 * Scene 5: the training loop, repeated until the network learns.
 *
 * A 2 → 3 → 1 MLP (tanh hidden layer, linear output) is trained with
 * full-batch SGD on the four Karpathy-style 2-D points:
 *
 *   forward → loss → backward → step,  60 times
 *
 * Each keyframe is one epoch: it stores the loss, a plain-number snapshot of
 * the network, every point's prediction and the sampled decision boundary.
 * The plot is therefore fully determined by plain data and scrubbing is free.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const SCENE5_EPOCHS = 60;
  const SCENE5_LR = 0.1;
  const SCENE5_SEED = 4;
  const SCENE5_ARCH = [3, 1];
  const FRAME_SECONDS = 0.4;

  const SCENE5_POINTS = [
    { x: [2, 3], label: 1 },
    { x: [3, 1], label: -1 },
    { x: [1.5, 2.5], label: -1 },
    { x: [4, 5], label: 1 },
  ];

  const SCENE5_DOMAIN = { xMin: 0.5, xMax: 4.5, yMin: 0.5, yMax: 5.5 };

  function createScene5() {
    const {
      Value,
      MLP,
      createRng,
      train,
      meanSquaredError,
      forwardNumbers,
      buildBoundary,
      formatNumber,
    } = global.MGViz;

    const points = SCENE5_POINTS.map((point) => ({
      x: point.x.slice(),
      label: point.label,
    }));
    const domain = { ...SCENE5_DOMAIN };
    const labels = points.map((point) => point.label);

    const mlp = new MLP(2, SCENE5_ARCH, {
      rng: createRng(SCENE5_SEED),
      scale: 1,
      activation: ['tanh', 'linear'],
    });
    const params = mlp.parameters();
    const inputValues = points.map((point) =>
      point.x.map(
        (value, index) =>
          new Value(value, {
            label: 'x' + String(index + 1),
            name: 'input' + index,
          })
      )
    );

    // The exact loss the page reports, computed from a plain snapshot.
    const snapshotLoss = (snapshot) => {
      let total = 0;
      for (let index = 0; index < points.length; index++) {
        const output = forwardNumbers(snapshot, points[index].x)[0];
        total += (output - labels[index]) * (output - labels[index]);
      }
      return total / points.length;
    };
    const snapshotPredictions = (snapshot) =>
      points.map((point) => forwardNumbers(snapshot, point.x)[0]);
    const snapshotAccuracy = (predictions) =>
      predictions.filter(
        (value, index) => (value > 0 ? 1 : -1) === labels[index]
      ).length;

    const forward = () =>
      meanSquaredError(
        points.map((point, index) => mlp.forward(inputValues[index])[0]),
        labels
      );

    const lossHistory = [];
    const keyframes = [];

    function makeFrame(epoch, loss, snapshot) {
      const predictions = snapshotPredictions(snapshot);
      const accuracy = snapshotAccuracy(predictions);
      const boundary = buildBoundary(snapshot, {
        domain,
        columns: 48,
        rows: 80,
      });
      const caption =
        epoch === 0
          ? 'Before training: the weights are random, so the loss is ' +
            formatNumber(loss) +
            ' and the dashed boundary misclassifies points. The loop will now run forward \u2192 loss \u2192 backward \u2192 step.'
          : epoch === SCENE5_EPOCHS
            ? 'Epoch ' +
              epoch +
              ': the loss fell from ' +
              formatNumber(lossHistory[0]) +
              ' to ' +
              formatNumber(loss) +
              ' and all four points are on the correct side of the boundary. The loop has learned the pattern: forward \u2192 loss \u2192 backward \u2192 step.'
            : 'Epoch ' +
              epoch +
              ': loss ' +
              formatNumber(loss) +
              ', ' +
              accuracy +
              ' / ' +
              points.length +
              ' points correct. The boundary moves a little each round as the weights follow their negative gradients.';
      return {
        at: epoch * FRAME_SECONDS,
        label: 'epoch ' + epoch,
        state: {
          epoch,
          loss,
          losses: lossHistory,
          snapshot,
          predictions,
          accuracy,
          boundary,
          caption,
          readout: {
            title:
              'Training loop \u00b7 3 hidden units \u00b7 full-batch SGD \u00b7 lr = ' +
              SCENE5_LR,
            stats: [
              { label: 'epoch', value: epoch + ' / ' + SCENE5_EPOCHS },
              { label: 'loss', value: formatNumber(loss) },
              { label: 'accuracy', value: accuracy + ' / ' + points.length },
              { label: 'parameters', value: String(params.length) },
            ],
          },
        },
      };
    }

    const initialSnapshot = mlp.snapshot();
    const initialLoss = snapshotLoss(initialSnapshot);
    lossHistory.push(initialLoss);
    keyframes.push(makeFrame(0, initialLoss, initialSnapshot));

    // The reusable loop from src/train.js, one frame per epoch.
    train(params, forward, {
      lr: SCENE5_LR,
      steps: SCENE5_EPOCHS,
      onStep: ({ step }) => {
        const snapshot = mlp.snapshot();
        const loss = snapshotLoss(snapshot);
        lossHistory.push(loss);
        keyframes.push(makeFrame(step, loss, snapshot));
      },
    });

    // Every keyframe carries the full loss history; the chart slices it at the
    // current epoch. Attach a copy so frames stay plain, independent data.
    const losses = lossHistory.slice();
    const snapshots = keyframes.map((frame) => frame.state.snapshot);
    const lastSnapshot = snapshots[snapshots.length - 1];
    const finalLoss = lossHistory[lossHistory.length - 1];
    const finalPredictions = snapshotPredictions(lastSnapshot);
    for (const frame of keyframes) frame.state.losses = losses.slice();

    return {
      id: 'scene-5',
      title: 'Scene 5 \u00b7 Loop until it learns: MLP + SGD',
      kind: 'training',
      duration: 25,
      keyframes,
      points,
      domain,
      epochs: SCENE5_EPOCHS,
      learningRate: SCENE5_LR,
      seed: SCENE5_SEED,
      arch: SCENE5_ARCH,
      mlp,
      params,
      losses,
      initialLoss,
      finalLoss,
      finalAccuracy: snapshotAccuracy(finalPredictions),
      finalPredictions,
      finalSnapshot: lastSnapshot,
      finalBoundary: keyframes[keyframes.length - 1].state.boundary,
    };
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    createScene5,
    SCENE5_POINTS,
    SCENE5_DOMAIN,
    SCENE5_EPOCHS,
    SCENE5_LEARNING_RATE: SCENE5_LR,
  });
})(globalThis);
