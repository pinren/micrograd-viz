/*
 * SVG expression graph: a pure, testable left-to-right layout plus a keyed
 * renderer that grows the picture as scene keyframes reveal nodes.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const NODE_WIDTH = 132;
  const NODE_HEIGHT = 78;
  const GAP_X = 82;
  const GAP_Y = 30;
  const MARGIN = 44;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Lays a Value graph out from leaves (left) to root (right).
   *
   * Depth is the longest path from a leaf, so every edge always points to a
   * node strictly further right. Nodes inside a layer are vertically centered.
   * The result is plain data: no DOM is touched, so it is unit-testable.
   */
  function layoutGraph(root) {
    if (!root || typeof root !== 'object' || !(root._prev instanceof Set)) {
      throw new TypeError('layoutGraph expects a Value root node');
    }

    // Post-order topological traversal: children are visited before parents.
    const order = [];
    const seen = new Set();
    const visit = (node) => {
      if (seen.has(node)) return;
      seen.add(node);
      for (const child of node._prev) visit(child);
      order.push(node);
    };
    visit(root);

    const depthOf = new Map();
    for (const node of order) {
      let depth = 0;
      for (const child of node._prev) {
        depth = Math.max(depth, depthOf.get(child) + 1);
      }
      depthOf.set(node, depth);
    }
    const maxDepth = Math.max(...Array.from(depthOf.values()));

    // Stable, unique graph ids. Prefer a scene-provided name, then a label.
    const usedIds = new Set();
    const idOf = new Map();
    order.forEach((node, index) => {
      const preferred = node.name || node.label || 'v' + index;
      let id = preferred;
      let suffix = 2;
      while (usedIds.has(id)) id = preferred + '#' + suffix++;
      usedIds.add(id);
      idOf.set(node, id);
    });

    const layers = [];
    for (const node of order) {
      const depth = depthOf.get(node);
      if (!layers[depth]) layers[depth] = [];
      layers[depth].push(node);
    }

    // Vertical placement: center each layer around y = 0 first.
    const rawY = new Map();
    let minTop = Infinity;
    let maxBottom = -Infinity;
    layers.forEach((layer) => {
      const total = layer.length * NODE_HEIGHT + (layer.length - 1) * GAP_Y;
      const top = -total / 2;
      layer.forEach((node, index) => {
        const y = top + index * (NODE_HEIGHT + GAP_Y);
        rawY.set(node, y);
        minTop = Math.min(minTop, y);
        maxBottom = Math.max(maxBottom, y + NODE_HEIGHT);
      });
    });

    const nodes = order.map((node) => {
      const depth = depthOf.get(node);
      const isLeaf = node._prev.size === 0;
      return {
        id: idOf.get(node),
        value: node,
        depth,
        isLeaf,
        x: MARGIN + depth * (NODE_WIDTH + GAP_X),
        y: rawY.get(node) - minTop + MARGIN,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        label: node.label || (isLeaf ? 'value' : node._op || 'op'),
        op: node._op,
        data: node.data,
        grad: node.grad,
      };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));

    const edges = [];
    for (const node of nodes) {
      for (const child of node.value._prev) {
        const from = byId.get(idOf.get(child));
        if (!from) continue;
        edges.push({
          id: from.id + '->' + node.id,
          from: from.id,
          to: node.id,
          fromX: from.x + from.width,
          fromY: from.y + from.height / 2,
          toX: node.x,
          toY: node.y + node.height / 2,
        });
      }
    }

    return {
      nodes,
      edges,
      layers,
      rootId: idOf.get(root),
      width:
        MARGIN * 2 +
        (maxDepth + 1) * NODE_WIDTH +
        maxDepth * GAP_X,
      height: maxBottom - minTop + MARGIN * 2,
      nodeById: byId,
    };
  }

  /** Formats a number compactly for the small node labels. */
  function formatNumber(n) {
    if (!Number.isFinite(n)) return String(n);
    if (Number.isInteger(n)) return String(n);
    const abs = Math.abs(n);
    if (abs !== 0 && (abs < 0.001 || abs >= 10000)) {
      return n.toExponential(2);
    }
    return String(parseFloat(n.toFixed(2)));
  }

  const renderState = new WeakMap();

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    }
    return node;
  }

  function ensureStructure(svg) {
    let state = renderState.get(svg);
    if (state) return state;

    svg.setAttribute('role', 'img');
    if (!svg.querySelector('defs')) {
      const defs = el('defs');
      const marker = el('marker', {
        id: 'mg-arrow',
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto-start-reverse',
      });
      marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow-head' }));
      defs.appendChild(marker);
      svg.appendChild(defs);
    }

    let edgesGroup = svg.querySelector(':scope > .edges');
    if (!edgesGroup) {
      edgesGroup = el('g', { class: 'edges' });
      svg.appendChild(edgesGroup);
    }
    let nodesGroup = svg.querySelector(':scope > .nodes');
    if (!nodesGroup) {
      nodesGroup = el('g', { class: 'nodes' });
      svg.appendChild(nodesGroup);
    }

    state = { nodes: new Map(), edges: new Map(), edgesGroup, nodesGroup };
    renderState.set(svg, state);
    return state;
  }

  function createNode(state, node) {
    const outer = el('g', { class: 'node', 'data-key': node.id });
    const inner = el('g', { class: 'node-body node-enter' });
    const box = el('rect', {
      class: 'node-box',
      x: '0',
      y: '0',
      width: String(node.width),
      height: String(node.height),
      rx: '13',
    });
    const label = el('text', {
      class: 'node-label',
      x: String(node.width / 2),
      y: '23',
      'text-anchor': 'middle',
    });
    const data = el('text', {
      class: 'node-data',
      x: String(node.width / 2),
      y: '47',
      'text-anchor': 'middle',
    });
    const grad = el('text', {
      class: 'node-grad grad-text',
      x: String(node.width / 2),
      y: '66',
      'text-anchor': 'middle',
    });
    const title = el('title');
    inner.append(box, label, data, grad, title);
    outer.appendChild(inner);
    state.nodesGroup.appendChild(outer);

    const entry = { outer, inner, box, label, data, grad, title };
    state.nodes.set(node.id, entry);
    return entry;
  }

  function createEdge(state, edge) {
    const group = el('g', { class: 'edge edge-enter', 'data-key': edge.id });
    const path = el('path', {
      class: 'edge-line',
      'marker-end': 'url(#mg-arrow)',
      pathLength: '1',
    });
    group.appendChild(path);
    state.edgesGroup.appendChild(group);
    const entry = { group, path };
    state.edges.set(edge.id, entry);
    return entry;
  }

  function edgePath(edge) {
    const dx = Math.max(26, Math.abs(edge.toX - edge.fromX) / 2);
    return (
      'M ' + edge.fromX + ' ' + edge.fromY +
      ' C ' + (edge.fromX + dx) + ' ' + edge.fromY +
      ', ' + (edge.toX - dx) + ' ' + edge.toY +
      ', ' + edge.toX + ' ' + edge.toY
    );
  }

  /**
   * Renders (or incrementally updates) a layout into an existing <svg>.
   *
   * @param {SVGSVGElement} svg
   * @param {object} layout - result of layoutGraph()
   * @param {object} [options]
   * @param {Iterable<string>|null} [options.visible] - ids to show; null = all
   * @param {boolean} [options.showGrad] - reveal the grad line on each node
   * @param {string|null} [options.active] - id highlighted as the current focus
   */
  function renderGraph(svg, layout, options) {
    if (!svg || !layout) return;
    const opts = options || {};
    const state = ensureStructure(svg);
    const visible =
      opts.visible == null
        ? new Set(layout.nodes.map((node) => node.id))
        : new Set(opts.visible);
    const renderedEdgeIds = new Set();

    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    svg.classList.toggle('show-grads', Boolean(opts.showGrad));

    for (const node of layout.nodes) {
      let entry = state.nodes.get(node.id);
      if (!visible.has(node.id)) {
        if (entry) {
          entry.outer.remove();
          state.nodes.delete(node.id);
        }
        continue;
      }
      if (!entry) entry = createNode(state, node);

      entry.outer.setAttribute(
        'transform',
        'translate(' + node.x + ' ' + node.y + ')'
      );
      entry.outer.classList.toggle('node-leaf', node.isLeaf);
      entry.outer.classList.toggle('node-op', !node.isLeaf);
      entry.outer.classList.toggle('is-active', opts.active === node.id);

      const label = node.label;
      if (entry.label.textContent !== label) entry.label.textContent = label;
      const data = 'data ' + formatNumber(node.value.data);
      if (entry.data.textContent !== data) entry.data.textContent = data;
      const grad = 'grad ' + formatNumber(node.value.grad);
      if (entry.grad.textContent !== grad) entry.grad.textContent = grad;
      entry.title.textContent =
        label +
        ': data=' +
        formatNumber(node.value.data) +
        ', grad=' +
        formatNumber(node.value.grad);
    }

    for (const edge of layout.edges) {
      const show = visible.has(edge.from) && visible.has(edge.to);
      let entry = state.edges.get(edge.id);
      if (!show) {
        if (entry) {
          entry.group.remove();
          state.edges.delete(edge.id);
        }
        continue;
      }
      if (!entry) entry = createEdge(state, edge);
      const d = edgePath(edge);
      if (entry.path.getAttribute('d') !== d) entry.path.setAttribute('d', d);
      renderedEdgeIds.add(edge.id);
    }

    for (const [id, entry] of state.edges) {
      if (!renderedEdgeIds.has(id)) {
        entry.group.remove();
        state.edges.delete(id);
      }
    }

    const visibleNodes = layout.nodes.filter((node) => visible.has(node.id));
    const summary =
      visibleNodes.length +
      ' of ' +
      layout.nodes.length +
      ' nodes visible; ' +
      visibleNodes
        .map(
          (node) =>
            node.id +
            '=' +
            formatNumber(node.value.data) +
            (opts.showGrad ? ' (grad ' + formatNumber(node.value.grad) + ')' : '')
        )
        .join(', ');
    svg.setAttribute('aria-label', 'Expression graph. ' + summary);
    svg.dataset.visibleNodes = visibleNodes.map((node) => node.id).join(',');
    svg.dataset.showGrads = String(Boolean(opts.showGrad));
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    layoutGraph,
    renderGraph,
    formatNumber,
    GRAPH_METRICS: { NODE_WIDTH, NODE_HEIGHT, GAP_X, GAP_Y, MARGIN },
  });
})(globalThis);
