/*
 * Step-by-step reverse-mode autodiff, so the page can animate the backward
 * pass instead of only showing its final gradients.
 *
 * `traceBackward(root)` replays what `Value.backward()` does, one operation
 * node at a time, and records the gradient snapshot after every step. The
 * scenes turn each step into a keyframe: highlight the node's incoming edges,
 * label them with the local derivatives, then show the child grads grow.
 *
 * The default step order is the exact reverse of the depth-first topological
 * order used by `Value.backward()`. Scenes may pass a different reverse
 * topological order (for example one sorted by graph depth) to keep the story
 * readable; any valid order produces identical gradients.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  function topoSort(root) {
    if (!root || typeof root !== 'object' || !(root._prev instanceof Set)) {
      throw new TypeError('topoSort expects a Value root node');
    }
    const order = [];
    const seen = new Set();
    const visit = (node) => {
      if (seen.has(node)) return;
      seen.add(node);
      for (const child of node._prev) visit(child);
      order.push(node);
    };
    visit(root);
    return order;
  }

  function snapshotGrads(nodes) {
    const grads = new Map();
    for (const node of nodes) grads.set(node, node.grad);
    return grads;
  }

  /**
   * Runs the backward pass step by step and returns its whole trace.
   *
   * @param {object} root - Value node to differentiate
   * @param {object} [options]
   * @param {object[]} [options.order] - reverse topological order to follow;
   *   may omit leaves (their `_backward` is a no-op). Must include every
   *   operation node. Defaults to the reverse of `topoSort(root)`.
   * @returns {object} `{ root, topo, reverseTopo, order, ops, seedGrads,
   *   steps, grads }` where each step has `{ node, children, localDerivs,
   *   contributions, gradsBefore, gradsAfter }` and all gradient collections
   *   are Maps from Value to number.
   */
  function traceBackward(root, options) {
    const opts = options || {};
    const topo = topoSort(root);
    const reverseTopo = topo.slice().reverse();
    const order = opts.order ? opts.order.slice() : reverseTopo;

    const inGraph = new Set(topo);
    const position = new Map();
    order.forEach((node, index) => {
      if (!inGraph.has(node)) {
        throw new TypeError('traceBackward order contains a node outside the graph');
      }
      if (position.has(node)) {
        throw new TypeError('traceBackward order contains a duplicate node');
      }
      position.set(node, index);
    });
    for (const node of topo) {
      if (opts.order && node._prev.size > 0 && !position.has(node)) {
        throw new TypeError('traceBackward order must include every operation node');
      }
      for (const child of node._prev) {
        const parentIndex = position.get(node);
        const childIndex = position.get(child);
        if (
          parentIndex !== undefined &&
          childIndex !== undefined &&
          parentIndex > childIndex
        ) {
          throw new TypeError(
            'traceBackward order is not a reverse topological order'
          );
        }
      }
    }

    for (const node of topo) node.grad = 0;
    root.grad = 1;
    const seedGrads = snapshotGrads(topo);

    const steps = [];
    for (const node of order) {
      if (node._prev.size === 0) continue; // leaves only receive gradients
      const children = Array.from(node._prev);
      const localDerivs = children.map((child) => ({
        child,
        local: global.MGViz.localDerivative(node, child),
      }));
      const gradsBefore = snapshotGrads(topo);
      const contributions = localDerivs.map(({ child, local }) => ({
        child,
        local,
        contribution: node.grad * local,
      }));
      node._backward();
      steps.push({
        node,
        children,
        localDerivs,
        contributions,
        gradsBefore,
        gradsAfter: snapshotGrads(topo),
      });
    }

    return {
      root,
      topo,
      reverseTopo,
      order,
      ops: order.filter((node) => node._prev.size > 0),
      seedGrads,
      steps,
      grads: snapshotGrads(topo),
    };
  }

  /**
   * Converts a Value-keyed gradient map into a layout-id-keyed plain object,
   * which is what scene keyframes carry as their (serialisable) state.
   */
  function gradsById(layout, grads) {
    const byId = {};
    for (const node of layout.nodes) {
      if (grads.has(node.value)) byId[node.id] = grads.get(node.value);
    }
    return byId;
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    topoSort,
    traceBackward,
    gradsById,
  });
})(globalThis);
