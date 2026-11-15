/*
 * SVG expression graph: a pure, testable left-to-right layout plus a keyed
 * renderer that grows the picture as scene keyframes reveal nodes.
 *
 * A frame can also carry backward-pass decoration: per-node gradient values,
 * highlighted edges with local-derivative labels, and reverse-topological-order
 * badges. `buildRenderModel` decides what belongs on screen; `renderGraph`
 * applies that plan to the SVG, so the interesting logic stays testable without
 * a DOM.
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
  const DEFAULT_METRICS = { NODE_WIDTH, NODE_HEIGHT, GAP_X, GAP_Y, MARGIN };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function resolveMetrics(options) {
    const opts = options || {};
    const metrics = {
      nodeWidth: opts.nodeWidth == null ? NODE_WIDTH : opts.nodeWidth,
      nodeHeight: opts.nodeHeight == null ? NODE_HEIGHT : opts.nodeHeight,
      gapX: opts.gapX == null ? GAP_X : opts.gapX,
      gapY: opts.gapY == null ? GAP_Y : opts.gapY,
      margin: opts.margin == null ? MARGIN : opts.margin,
    };
    for (const [name, value] of Object.entries(metrics)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(
          'layoutGraph metric ' + name + ' must be a positive number'
        );
      }
    }
    return metrics;
  }

  /**
   * Lays a Value graph out from leaves (left) to root (right).
   *
   * Depth is the longest path from a leaf, so every edge always points to a
   * node strictly further right. Nodes inside a layer are vertically centered.
   * The result is plain data: no DOM is touched, so it is unit-testable.
   *
   * @param {object} root - Value node
   * @param {object} [options] - optional box metrics; defaults keep the classic
   *   size. Bigger graphs (the neuron in scene 3) use compact metrics.
   */
  function layoutGraph(root, options) {
    if (!root || typeof root !== 'object' || !(root._prev instanceof Set)) {
      throw new TypeError('layoutGraph expects a Value root node');
    }
    const metrics = resolveMetrics(options);
    const { nodeWidth, nodeHeight, gapX, gapY, margin } = metrics;

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
      const total = layer.length * nodeHeight + (layer.length - 1) * gapY;
      const top = -total / 2;
      layer.forEach((node, index) => {
        const y = top + index * (nodeHeight + gapY);
        rawY.set(node, y);
        minTop = Math.min(minTop, y);
        maxBottom = Math.max(maxBottom, y + nodeHeight);
      });
    });

    const nodes = order.map((node, index) => {
      const depth = depthOf.get(node);
      const isLeaf = node._prev.size === 0;
      return {
        id: idOf.get(node),
        value: node,
        index,
        depth,
        isLeaf,
        x: margin + depth * (nodeWidth + gapX),
        y: rawY.get(node) - minTop + margin,
        width: nodeWidth,
        height: nodeHeight,
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
      metrics,
      width:
        margin * 2 + (maxDepth + 1) * nodeWidth + maxDepth * gapX,
      height: maxBottom - minTop + margin * 2,
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

  function edgePath(edge) {
    const dx = Math.max(26, Math.abs(edge.toX - edge.fromX) / 2);
    return (
      'M ' + edge.fromX + ' ' + edge.fromY +
      ' C ' + (edge.fromX + dx) + ' ' + edge.fromY +
      ', ' + (edge.toX - dx) + ' ' + edge.toY +
      ', ' + edge.toX + ' ' + edge.toY
    );
  }

  /** Midpoint of an edge, where its local-derivative label is drawn. */
  function edgeMidpoint(edge) {
    return {
      x: (edge.fromX + edge.toX) / 2,
      y: (edge.fromY + edge.toY) / 2,
    };
  }

  function toMap(value) {
    if (!value) return new Map();
    if (value instanceof Map) return value;
    return new Map(Object.entries(value));
  }

  /**
   * Pure description of one rendered frame.
   *
   * @param {object} layout - result of layoutGraph()
   * @param {object} [options]
   * @param {Iterable<string>|null} [options.visible] - ids to show; null = all
   * @param {boolean} [options.showGrad] - reveal gradients on every node
   * @param {object|Map|null} [options.grads] - explicit id -> grad values;
   *   when present, exactly these nodes reveal their gradient
   *   (`gradValues` is accepted as an alias)
   * @param {string|null} [options.active] - id highlighted as the current focus
   * @param {Iterable<string>|null} [options.activeEdges] - edge ids to highlight
   * @param {object|Map|null} [options.edgeLabels] - edge id -> local derivative
   * @param {string[]|null} [options.topo] - operation ids in backward order;
   *   each gets a numbered badge
   * @param {boolean} [options.backward] - style active edges as backward flow
   * @param {object|Map|null} [options.data] - id -> number override, used to
   *   show a fresh forward pass after parameters change
   * @param {object|Map|null} [options.updates] - id -> annotation text, e.g.
   *   "−g 0.85 → 0.59"; shown under parameter nodes during an SGD step
   */
  function buildRenderModel(layout, options) {
    const opts = options || {};
    const visible =
      opts.visible == null
        ? new Set(layout.nodes.map((node) => node.id))
        : new Set(opts.visible);
    const gradValues =
      opts.gradValues != null
        ? toMap(opts.gradValues)
        : opts.grads != null
          ? toMap(opts.grads)
          : null;
    const edgeLabels = toMap(opts.edgeLabels);
    const dataOverrides = toMap(opts.data);
    const updates = toMap(opts.updates);
    const activeEdges = new Set(opts.activeEdges || []);
    const topoOrder = Array.isArray(opts.topo) ? opts.topo.slice() : [];
    const topoIndex = new Map(
      topoOrder.map((id, index) => [id, index + 1])
    );

    const nodes = [];
    for (const node of layout.nodes) {
      if (!visible.has(node.id)) continue;
      const hasGrad = gradValues
        ? gradValues.has(node.id)
        : Boolean(opts.showGrad);
      const gradValue =
        gradValues && gradValues.has(node.id)
          ? gradValues.get(node.id)
          : node.value.grad;
      const data = dataOverrides.has(node.id)
        ? dataOverrides.get(node.id)
        : node.value.data;
      nodes.push({
        id: node.id,
        node,
        label: node.label,
        data,
        dataText: 'data ' + formatNumber(data),
        gradText: 'grad ' + formatNumber(gradValue),
        updateText: updates.get(node.id) || '',
        hasUpdate: updates.has(node.id),
        gradValue,
        hasGrad,
        active: opts.active === node.id,
        topoIndex: topoIndex.get(node.id) || null,
        isLeaf: node.isLeaf,
      });
    }

    const edges = [];
    for (const edge of layout.edges) {
      if (!visible.has(edge.from) || !visible.has(edge.to)) continue;
      const midpoint = edgeMidpoint(edge);
      const label = edgeLabels.get(edge.id) || '';
      edges.push({
        id: edge.id,
        edge,
        label,
        hasLabel: Boolean(label),
        labelX: midpoint.x,
        labelY: midpoint.y - 9,
        active: activeEdges.has(edge.id),
      });
    }

    const summary =
      nodes.length +
      ' of ' +
      layout.nodes.length +
      ' nodes visible; ' +
      nodes
        .map(
          (item) =>
            item.id +
            '=' +
            formatNumber(item.data) +
            (item.hasGrad ? ' (grad ' + formatNumber(item.gradValue) + ')' : '')
        )
        .join(', ');

    return {
      nodes,
      edges,
      summary,
      backward: Boolean(opts.backward),
      topoOrder,
    };
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

      const activeMarker = el('marker', {
        id: 'mg-arrow-active',
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto-start-reverse',
      });
      activeMarker.appendChild(
        el('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow-head-active' })
      );
      defs.appendChild(activeMarker);
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
      'text-anchor': 'middle',
    });
    const data = el('text', {
      class: 'node-data',
      'text-anchor': 'middle',
    });
    const grad = el('text', {
      class: 'node-grad grad-text',
      'text-anchor': 'middle',
    });
    const update = el('text', {
      class: 'node-update update-text',
      'text-anchor': 'middle',
    });
    const badge = el('g', { class: 'topo-badge' });
    const badgeCircle = el('circle', { r: '9' });
    const badgeText = el('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    badge.append(badgeCircle, badgeText);
    const title = el('title');
    inner.append(box, label, data, grad, update, badge, title);
    outer.appendChild(inner);
    state.nodesGroup.appendChild(outer);

    const entry = {
      outer,
      inner,
      box,
      label,
      data,
      grad,
      update,
      badge,
      badgeCircle,
      badgeText,
      title,
    };
    updateNodeGeometry(entry, node);
    state.nodes.set(node.id, entry);
    return entry;
  }

  function updateNodeGeometry(entry, node) {
    entry.box.setAttribute('width', String(node.width));
    entry.box.setAttribute('height', String(node.height));
    const centerX = node.width / 2;
    entry.label.setAttribute('x', String(centerX));
    entry.label.setAttribute('y', String(node.height * 0.3));
    entry.data.setAttribute('x', String(centerX));
    entry.data.setAttribute('y', String(node.height * 0.6));
    entry.grad.setAttribute('x', String(centerX));
    entry.grad.setAttribute('y', String(node.height * 0.84));
    entry.update.setAttribute('x', String(centerX));
    entry.update.setAttribute('y', String(node.height + 14));
    const badgeX = node.width - 14;
    entry.badgeCircle.setAttribute('cx', String(badgeX));
    entry.badgeCircle.setAttribute('cy', '13');
    entry.badgeText.setAttribute('x', String(badgeX));
    entry.badgeText.setAttribute('y', '13.5');
  }

  function createEdge(state, edge) {
    const group = el('g', { class: 'edge edge-enter', 'data-key': edge.id });
    const path = el('path', {
      class: 'edge-line',
      'marker-end': 'url(#mg-arrow)',
      pathLength: '1',
    });
    const label = el('text', { class: 'edge-label' });
    group.append(path, label);
    state.edgesGroup.appendChild(group);
    const entry = { group, path, label };
    state.edges.set(edge.id, entry);
    return entry;
  }

  /**
   * Renders (or incrementally updates) a layout into an existing <svg>.
   *
   * @param {SVGSVGElement} svg
   * @param {object} layout - result of layoutGraph()
   * @param {object} [options] - see buildRenderModel()
   */
  function renderGraph(svg, layout, options) {
    if (!svg || !layout) return;
    const opts = options || {};
    const state = ensureStructure(svg);
    const model = buildRenderModel(layout, opts);

    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    svg.classList.toggle('show-grads', Boolean(opts.showGrad));
    svg.classList.toggle('backward', model.backward);

    const renderedNodeIds = new Set();
    for (const item of model.nodes) {
      let entry = state.nodes.get(item.id);
      if (!entry) entry = createNode(state, item.node);
      updateNodeGeometry(entry, item.node);

      entry.outer.setAttribute(
        'transform',
        'translate(' + item.node.x + ' ' + item.node.y + ')'
      );
      entry.outer.classList.toggle('node-leaf', item.isLeaf);
      entry.outer.classList.toggle('node-op', !item.isLeaf);
      entry.outer.classList.toggle('is-active', item.active);
      entry.outer.classList.toggle('has-grad', item.hasGrad);
      entry.outer.classList.toggle('has-topo', item.topoIndex !== null);
      entry.outer.classList.toggle('has-update', item.hasUpdate);

      if (entry.label.textContent !== item.label) {
        entry.label.textContent = item.label;
      }
      if (entry.data.textContent !== item.dataText) {
        entry.data.textContent = item.dataText;
      }
      if (entry.grad.textContent !== item.gradText) {
        entry.grad.textContent = item.gradText;
      }
      if (entry.update.textContent !== item.updateText) {
        entry.update.textContent = item.updateText;
      }
      const badgeText =
        item.topoIndex === null ? '' : String(item.topoIndex);
      if (entry.badgeText.textContent !== badgeText) {
        entry.badgeText.textContent = badgeText;
      }
      entry.title.textContent =
        item.label +
        ': data=' +
        formatNumber(item.data) +
        ', grad=' +
        formatNumber(item.gradValue);
      renderedNodeIds.add(item.id);
    }

    for (const [id, entry] of state.nodes) {
      if (!renderedNodeIds.has(id)) {
        entry.outer.remove();
        state.nodes.delete(id);
      }
    }

    const renderedEdgeIds = new Set();
    for (const item of model.edges) {
      let entry = state.edges.get(item.id);
      if (!entry) entry = createEdge(state, item.edge);
      const d = edgePath(item.edge);
      if (entry.path.getAttribute('d') !== d) entry.path.setAttribute('d', d);
      entry.path.setAttribute(
        'marker-end',
        item.active ? 'url(#mg-arrow-active)' : 'url(#mg-arrow)'
      );
      entry.group.classList.toggle('is-active', item.active);
      entry.group.classList.toggle('has-label', item.hasLabel);
      if (entry.label.textContent !== item.label) {
        entry.label.textContent = item.label;
      }
      entry.label.setAttribute('x', String(item.labelX));
      entry.label.setAttribute('y', String(item.labelY));
      renderedEdgeIds.add(item.id);
    }

    for (const [id, entry] of state.edges) {
      if (!renderedEdgeIds.has(id)) {
        entry.group.remove();
        state.edges.delete(id);
      }
    }

    svg.setAttribute('aria-label', 'Expression graph. ' + model.summary);
    svg.dataset.visibleNodes = model.nodes.map((item) => item.id).join(',');
    svg.dataset.showGrads = String(Boolean(opts.showGrad));
    svg.dataset.grads = model.nodes
      .filter((item) => item.hasGrad)
      .map((item) => item.id + '=' + formatNumber(item.gradValue))
      .join(',');
    svg.dataset.topo = model.topoOrder.join(',');
    svg.dataset.backward = String(model.backward);
    svg.dataset.updates = model.nodes
      .filter((item) => item.hasUpdate)
      .map((item) => item.id + '=' + item.updateText)
      .join(',');
    svg.dataset.data = model.nodes
      .map((item) => item.id + '=' + formatNumber(item.data))
      .join(',');
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    layoutGraph,
    renderGraph,
    buildRenderModel,
    edgeMidpoint,
    formatNumber,
    GRAPH_METRICS: DEFAULT_METRICS,
  });
})(globalThis);
