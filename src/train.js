/*
 * The training loop, extracted from the scenes so the page and the tests run
 * the same code:
 *
 *   forward → loss → backward → step
 *
 * `trainStep` performs exactly one update; `train` repeats it and records the
 * loss before every update. `meanSquaredError` is the loss scene 5 minimises.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  function requireParams(params) {
    if (!Array.isArray(params) || params.length === 0) {
      throw new TypeError('training needs a non-empty array of parameters');
    }
    for (const parameter of params) {
      if (!parameter || typeof parameter.step !== 'function') {
        throw new TypeError('every parameter must be a Value');
      }
    }
    return params;
  }

  function requireLr(lr) {
    if (typeof lr !== 'number' || !Number.isFinite(lr) || lr < 0) {
      throw new TypeError('lr must be a non-negative finite number');
    }
    return lr;
  }

  /**
   * Runs one forward → backward → step update.
   *
   * Gradients are zeroed on the parameters first, then `forward` rebuilds the
   * graph, `backward()` fills the gradients, and every parameter takes one
   * step. Returns the loss value *before* the update.
   *
   * @param {object[]} params - parameter Values to update
   * @param {() => object} forward - builds and returns the loss Value
   * @param {number} lr - learning rate
   * @returns {number} loss before the update
   */
  function trainStep(params, forward, lr) {
    requireParams(params);
    if (typeof forward !== 'function') {
      throw new TypeError('trainStep expects a forward function');
    }
    const rate = requireLr(lr);

    for (const parameter of params) parameter.zeroGrad();
    const loss = forward();
    if (!loss || typeof loss.backward !== 'function') {
      throw new TypeError('forward must return a Value loss');
    }
    loss.backward();
    for (const parameter of params) parameter.step(rate);
    return loss.data;
  }

  /**
   * Repeats `trainStep` and returns the loss before every update.
   *
   * The returned array has one entry per step: `losses[0]` is the loss after
   * zero steps, `losses[n]` the loss before step n+1 (i.e. after n updates).
   *
   * @param {object[]} params
   * @param {() => object} forward
   * @param {object} [options]
   * @param {number} [options.lr=0.1]
   * @param {number} [options.steps=100]
   * @param {(event: object) => void} [options.onStep] - called after each step
   *   with `{ step, loss, params }`
   * @returns {number[]} recorded losses
   */
  function train(params, forward, options) {
    requireParams(params);
    if (typeof forward !== 'function') {
      throw new TypeError('train expects a forward function');
    }
    const opts = options || {};
    const lr = requireLr(opts.lr == null ? 0.1 : opts.lr);
    const steps = opts.steps == null ? 100 : opts.steps;
    if (!Number.isInteger(steps) || steps < 0) {
      throw new TypeError('steps must be a non-negative integer');
    }
    const loss = forward();
    if (!loss || typeof loss.backward !== 'function') {
      throw new TypeError('forward must return a Value loss');
    }
    const losses = [loss.data];
    for (let step = 1; step <= steps; step++) {
      const before = trainStep(params, forward, lr);
      losses.push(forward().data);
      if (typeof opts.onStep === 'function') {
        opts.onStep({ step, loss: before, params });
      }
    }
    return losses;
  }

  /**
   * Mean squared error between a list of predicted Values and numeric targets.
   * The returned value is itself a Value, so it can be backpropagated.
   */
  function meanSquaredError(predictions, targets) {
    if (!Array.isArray(predictions) || predictions.length === 0) {
      throw new TypeError('meanSquaredError needs at least one prediction');
    }
    if (!Array.isArray(targets) || targets.length !== predictions.length) {
      throw new TypeError('meanSquaredError needs one target per prediction');
    }
    const Value = global.MGViz.Value;
    let total = new Value(0, { label: '0', name: 'mse-total' });
    for (let index = 0; index < predictions.length; index++) {
      const target = targets[index];
      if (typeof target !== 'number' || !Number.isFinite(target)) {
        throw new TypeError('meanSquaredError targets must be finite numbers');
      }
      total = total.add(predictions[index].sub(target).pow(2));
    }
    const mean = total.mul(1 / predictions.length);
    mean.label = 'MSE';
    mean.name = 'mse';
    return mean;
  }

  /**
   * Mean max-margin (hinge) loss: mean(max(0, 1 - target * prediction)).
   *
   * With targets ±1 the loss is zero once every point is on the right side of
   * the boundary by a margin of 1, which is what scene 5 animates descending.
   */
  function hingeLoss(predictions, targets) {
    if (!Array.isArray(predictions) || predictions.length === 0) {
      throw new TypeError('hingeLoss needs at least one prediction');
    }
    if (!Array.isArray(targets) || targets.length !== predictions.length) {
      throw new TypeError('hingeLoss needs one target per prediction');
    }
    const Value = global.MGViz.Value;
    let total = new Value(0, { label: '0', name: 'hinge-total' });
    for (let index = 0; index < predictions.length; index++) {
      const target = targets[index];
      if (typeof target !== 'number' || !Number.isFinite(target)) {
        throw new TypeError('hingeLoss targets must be finite numbers');
      }
      const margin = new Value(1).sub(predictions[index].mul(target));
      total = total.add(margin.relu());
    }
    const mean = total.mul(1 / predictions.length);
    mean.label = 'hinge';
    mean.name = 'hinge';
    return mean;
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    trainStep,
    train,
    meanSquaredError,
    hingeLoss,
  });
})(globalThis);
