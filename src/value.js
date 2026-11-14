/*
 * Scalar autograd core, in the spirit of karpathy/micrograd: every Value holds
 * a number, a gradient, and a small closure that knows how to push a gradient
 * to its children during the backward pass.
 *
 * The file is written as a browser classic script *and* is valid as an ES
 * module, because browsers refuse to load `type="module"` scripts from
 * `file://` (opaque origin + CORS). Opening index.html by double-click is a
 * hard requirement, so the page loads these files with plain `defer` script
 * tags and the API lives on `globalThis.MGViz`. Node's test runner imports the
 * same file for its side effect and reads the API from `globalThis.MGViz`.
 */
(function (global) {
  'use strict';

  /**
   * A scalar value in a differentiable expression graph.
   *
   * @param {number} data - numeric value
   * @param {object} [options]
   * @param {Value[]} [options.children] - operands that produced this value
   * @param {string} [options.op] - operator label shown in the graph
   * @param {string} [options.label] - human readable label (e.g. "a")
   * @param {string} [options.name] - stable graph identity (e.g. "mul")
   */
  class Value {
    constructor(data, options) {
      if (typeof data !== 'number') {
        throw new TypeError('Value data must be a number, got ' + typeof data);
      }
      const opts = options || {};
      this.data = data;
      this.grad = 0;
      this.label = opts.label || '';
      this.name = opts.name || '';
      this._op = opts.op || '';
      this._prev = new Set(opts.children || []);
      // Replaced by every operation; leaves keep the no-op.
      this._backward = function noop() {};
    }

    add(other) {
      const rhs = toValue(other);
      const out = new Value(this.data + rhs.data, {
        children: [this, rhs],
        op: '+',
      });
      out._backward = () => {
        this.grad += out.grad;
        rhs.grad += out.grad;
      };
      return out;
    }

    mul(other) {
      const rhs = toValue(other);
      const out = new Value(this.data * rhs.data, {
        children: [this, rhs],
        op: '*',
      });
      out._backward = () => {
        this.grad += rhs.data * out.grad;
        rhs.grad += this.data * out.grad;
      };
      return out;
    }

    /**
     * Raises this value to a constant or Value exponent.
     *
     * The derivative for a Value exponent uses ln(base); it is only defined
     * for a positive base, which is the usual contract for this operator.
     */
    pow(other) {
      if (other instanceof Value) {
        const out = new Value(Math.pow(this.data, other.data), {
          children: [this, other],
          op: '**',
        });
        out._backward = () => {
          this.grad +=
            other.data * Math.pow(this.data, other.data - 1) * out.grad;
          other.grad += out.data * Math.log(this.data) * out.grad;
        };
        return out;
      }
      if (typeof other !== 'number' || Number.isNaN(other)) {
        throw new TypeError('Value.pow expects a number or Value exponent');
      }
      const out = new Value(Math.pow(this.data, other), {
        children: [this],
        op: '**' + other,
      });
      out._backward = () => {
        this.grad += other * Math.pow(this.data, other - 1) * out.grad;
      };
      return out;
    }

    tanh() {
      const t = Math.tanh(this.data);
      const out = new Value(t, { children: [this], op: 'tanh' });
      out._backward = () => {
        this.grad += (1 - t * t) * out.grad;
      };
      return out;
    }

    relu() {
      const out = new Value(this.data > 0 ? this.data : 0, {
        children: [this],
        op: 'relu',
      });
      out._backward = () => {
        this.grad += (out.data > 0 ? 1 : 0) * out.grad;
      };
      return out;
    }

    exp() {
      const out = new Value(Math.exp(this.data), {
        children: [this],
        op: 'exp',
      });
      out._backward = () => {
        this.grad += out.data * out.grad;
      };
      return out;
    }

    /**
     * Runs reverse-mode autodiff from this node.
     *
     * Nodes are visited in reverse topological order, so a node's gradient is
     * complete before it is pushed further down. Gradients are zeroed first,
     * which makes repeated backward() calls deterministic.
     */
    backward() {
      const topo = [];
      const visited = new Set();
      const visit = (node) => {
        if (visited.has(node)) return;
        visited.add(node);
        for (const child of node._prev) visit(child);
        topo.push(node);
      };
      visit(this);

      for (const node of topo) node.grad = 0;
      this.grad = 1;
      for (let i = topo.length - 1; i >= 0; i--) topo[i]._backward();
      return this;
    }

    toString() {
      return 'Value(data=' + this.data + ', grad=' + this.grad + ')';
    }
  }

  /** Wraps a number as a Value, leaving existing Values untouched. */
  function toValue(value) {
    return value instanceof Value ? value : new Value(value);
  }

  global.MGViz = Object.assign(global.MGViz || {}, { Value, toValue });
})(globalThis);
