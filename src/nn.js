/*
 * A tiny scalar neural network, in the spirit of karpathy/micrograd:
 *
 *   Neuron → Layer → MLP
 *
 * Every weight is a Value, so `mlp.forward(x)` builds a differentiable graph
 * and `mlp.parameters()` is exactly what the training loop updates.
 *
 * `snapshot()` / `forwardNumbers()` compute the same network without building a
 * graph. The decision-boundary plot needs thousands of cheap predictions, so
 * it uses the numeric path while the training step uses the Value graph.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  /** Small deterministic PRNG (mulberry32), so scenes/tests are reproducible. */
  function createRng(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatIndex(prefix, index, suffix) {
    return prefix + String(index + 1) + suffix;
  }

  class Neuron {
    /**
     * @param {number} nin - number of inputs
     * @param {object} [options]
     * @param {() => number} [options.rng] - random source in [0, 1)
     * @param {string} [options.prefix] - node-name prefix, e.g. "h1."
     * @param {number} [options.scale=1] - weight init range is ±scale
     */
    constructor(nin, options) {
      if (!Number.isInteger(nin) || nin <= 0) {
        throw new TypeError('Neuron expects a positive input count');
      }
      const opts = options || {};
      const random = opts.rng || Math.random;
      const prefix = opts.prefix || '';
      const scale = opts.scale == null ? 1 : opts.scale;
      const activation = opts.activation || 'tanh';
      if (activation !== 'tanh' && activation !== 'linear') {
        throw new TypeError('Neuron activation must be "tanh" or "linear"');
      }
      this.activation = activation;
      const Value = global.MGViz.Value;

      this.weights = [];
      for (let index = 0; index < nin; index++) {
        this.weights.push(
          new Value((random() * 2 - 1) * scale, {
            label: '\u03c9' + String(index + 1),
            name: formatIndex(prefix + 'w', index, ''),
          })
        );
      }
      this.bias = new Value((random() * 2 - 1) * scale, {
        label: 'b',
        name: prefix + 'b',
      });
    }

    /** y = tanh(w · x + b); returns the output Value. */
    forward(inputs) {
      if (!Array.isArray(inputs) || inputs.length !== this.weights.length) {
        throw new TypeError(
          'Neuron.forward expects ' + this.weights.length + ' inputs'
        );
      }
      let sum = this.bias;
      for (let index = 0; index < this.weights.length; index++) {
        sum = sum.add(this.weights[index].mul(inputs[index]));
      }
      return this.activation === 'linear' ? sum : sum.tanh();
    }

    parameters() {
      return this.weights.concat([this.bias]);
    }
  }

  class Layer {
    constructor(nin, nout, options) {
      if (!Number.isInteger(nout) || nout <= 0) {
        throw new TypeError('Layer expects a positive neuron count');
      }
      const opts = options || {};
      this.neurons = [];
      for (let index = 0; index < nout; index++) {
        this.neurons.push(
          new Neuron(nin, {
            rng: opts.rng,
            scale: opts.scale,
            activation: opts.activation,
            prefix: (opts.prefix || '') + formatIndex('n', index, '.'),
          })
        );
      }
    }

    /** Returns one output Value per neuron. */
    forward(inputs) {
      return this.neurons.map((neuron) => neuron.forward(inputs));
    }

    parameters() {
      return this.neurons.flatMap((neuron) => neuron.parameters());
    }
  }

  class MLP {
    /**
     * @param {number} nin - input dimension
     * @param {number[]} nouts - neuron count per layer, output layer last
     * @param {object} [options] - forwarded to every Neuron
     */
    constructor(nin, nouts, options) {
      if (!Array.isArray(nouts) || nouts.length === 0) {
        throw new TypeError('MLP expects at least one layer size');
      }
      const opts = options || {};
      const sizes = [nin].concat(nouts);
      this.nin = nin;
      this.nouts = nouts.slice();
      this.layers = [];
      for (let index = 1; index < sizes.length; index++) {
        const activation = Array.isArray(opts.activation)
          ? opts.activation[index - 1]
          : opts.activation;
        this.layers.push(
          new Layer(sizes[index - 1], sizes[index], {
            rng: opts.rng,
            scale: opts.scale,
            activation,
            prefix: 'L' + index + '.',
          })
        );
      }
    }

    /** Returns the last layer's outputs (an array). */
    forward(inputs) {
      let values = inputs;
      for (const layer of this.layers) values = layer.forward(values);
      return values;
    }

    parameters() {
      return this.layers.flatMap((layer) => layer.parameters());
    }

    /** Plain-number copy of the weights, for fast boundary prediction. */
    snapshot() {
      return this.layers.map((layer) =>
        layer.neurons.map((neuron) => ({
          w: neuron.weights.map((weight) => weight.data),
          b: neuron.bias.data,
          activation: neuron.activation,
        }))
      );
    }
  }

  /** Runs a plain-number MLP snapshot on one input vector. */
  function forwardNumbers(snapshot, inputs) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      throw new TypeError('forwardNumbers expects a network snapshot');
    }
    let values = inputs.slice();
    for (const layer of snapshot) {
      values = layer.map((neuron) => {
        let sum = neuron.b;
        for (let index = 0; index < neuron.w.length; index++) {
          sum += neuron.w[index] * values[index];
        }
        return neuron.activation === 'linear' ? sum : Math.tanh(sum);
      });
    }
    return values;
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    createRng,
    Neuron,
    Layer,
    MLP,
    forwardNumbers,
  });
})(globalThis);
