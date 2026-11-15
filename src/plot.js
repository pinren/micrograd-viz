/*
 * Scene 5's view: the four labelled points, the decision boundary, and the
 * loss curve of the training loop.
 *
 * The interesting maths is pure: `buildBoundary` samples the network on a grid
 * and links the sign changes into polylines, so tests can check that the
 * boundary really separates the points. `renderTrainingView` only draws.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW = { width: 720, height: 420 };
  const PLOT = { x: 64, y: 46, width: 300, height: 300 };
  const CHART = { x: 456, y: 64, width: 224, height: 240 };

  const DEFAULT_DOMAIN = { xMin: 0.5, xMax: 4.5, yMin: 0.5, yMax: 5.5 };

  function el(name, attrs, text) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    }
    if (text != null) node.textContent = String(text);
    return node;
  }

  function toPlotX(x, domain, box) {
    return box.x + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * box.width;
  }

  function toPlotY(y, domain, box) {
    return box.y + box.height - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * box.height;
  }

  /** Network output at one point, using the plain-number path. */
  function decisionValue(snapshot, x, y) {
    return global.MGViz.forwardNumbers(snapshot, [x, y])[0];
  }

  /**
   * Traces the zero contour of the network over the plot domain with marching
   * squares. Returns small segments in data coordinates; the renderer joins
   * them into one path, so any boundary orientation is handled.
   *
   * @param {object[]} snapshot - plain-number network (see MLP.snapshot)
   * @param {object} [options]
   * @param {object} [options.domain] - data-space bounds
   * @param {number} [options.columns=48] - horizontal cell count
   * @param {number} [options.rows=80] - vertical cell count
   * @returns {number[][][]} segments, each `[[x1, y1], [x2, y2]]`
   */
  function buildBoundary(snapshot, options) {
    const opts = options || {};
    const domain = opts.domain || DEFAULT_DOMAIN;
    const columns = opts.columns == null ? 48 : opts.columns;
    const rows = opts.rows == null ? 80 : opts.rows;
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      throw new TypeError('buildBoundary expects a network snapshot');
    }
    if (!(columns > 0) || !(rows > 0)) {
      throw new TypeError('buildBoundary needs positive sample counts');
    }
    const stepX = (domain.xMax - domain.xMin) / columns;
    const stepY = (domain.yMax - domain.yMin) / rows;
    const values = [];
    for (let column = 0; column <= columns; column++) {
      const x = domain.xMin + column * stepX;
      const line = [];
      for (let row = 0; row <= rows; row++) {
        const y = domain.yMin + row * stepY;
        line.push(decisionValue(snapshot, x, y));
      }
      values.push(line);
    }

    const mix = (ax, ay, av, bx, by, bv) => {
      const span = av - bv;
      const t = span === 0 ? 0.5 : av / span;
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    };
    const segments = [];
    for (let column = 0; column < columns; column++) {
      const x0 = domain.xMin + column * stepX;
      const x1 = x0 + stepX;
      for (let row = 0; row < rows; row++) {
        const y0 = domain.yMin + row * stepY;
        const y1 = y0 + stepY;
        const v00 = values[column][row];
        const v10 = values[column + 1][row];
        const v11 = values[column + 1][row + 1];
        const v01 = values[column][row + 1];
        const crossings = [];
        if (v00 < 0 !== v10 < 0) crossings.push(mix(x0, y0, v00, x1, y0, v10));
        if (v10 < 0 !== v11 < 0) crossings.push(mix(x1, y0, v10, x1, y1, v11));
        if (v11 < 0 !== v01 < 0) crossings.push(mix(x1, y1, v11, x0, y1, v01));
        if (v01 < 0 !== v00 < 0) crossings.push(mix(x0, y1, v01, x0, y0, v00));
        if (crossings.length === 2) {
          segments.push([crossings[0], crossings[1]]);
        } else if (crossings.length === 4) {
          segments.push([crossings[0], crossings[1]]);
          segments.push([crossings[2], crossings[3]]);
        }
      }
    }
    return segments;
  }

  function pathFromPoints(points, domain) {
    return points
      .map(([x, y], index) => {
        const px = toPlotX(x, domain, PLOT);
        const py = toPlotY(y, domain, PLOT);
        return (index === 0 ? 'M ' : 'L ') + px + ' ' + py;
      })
      .join(' ');
  }

  function drawFrame(svg, domain) {
    svg.appendChild(
      el('rect', {
        class: 'plot-frame',
        x: PLOT.x,
        y: PLOT.y,
        width: PLOT.width,
        height: PLOT.height,
        rx: 10,
      })
    );
    for (let value = Math.ceil(domain.xMin); value <= domain.xMax; value++) {
      const x = toPlotX(value, domain, PLOT);
      svg.appendChild(
        el('line', {
          class: 'plot-grid',
          x1: x,
          y1: PLOT.y,
          x2: x,
          y2: PLOT.y + PLOT.height,
        })
      );
      svg.appendChild(
        el(
          'text',
          { class: 'plot-tick', x, y: PLOT.y + PLOT.height + 18, 'text-anchor': 'middle' },
          value
        )
      );
    }
    for (let value = Math.ceil(domain.yMin); value <= domain.yMax; value++) {
      const y = toPlotY(value, domain, PLOT);
      svg.appendChild(
        el('line', {
          class: 'plot-grid',
          x1: PLOT.x,
          y1: y,
          x2: PLOT.x + PLOT.width,
          y2: y,
        })
      );
      svg.appendChild(
        el(
          'text',
          { class: 'plot-tick', x: PLOT.x - 12, y: y + 4, 'text-anchor': 'end' },
          value
        )
      );
    }
    svg.appendChild(
      el(
        'text',
        { class: 'plot-axis-label', x: PLOT.x + PLOT.width / 2, y: PLOT.y + PLOT.height + 38 },
        'x\u2081'
      )
    );
    svg.appendChild(
      el(
        'text',
        {
          class: 'plot-axis-label',
          x: PLOT.x - 34,
          y: PLOT.y + PLOT.height / 2,
          transform: 'rotate(-90 ' + (PLOT.x - 34) + ' ' + (PLOT.y + PLOT.height / 2) + ')',
        },
        'x\u2082'
      )
    );
  }

  function drawPoints(svg, scene, state, domain) {
    scene.points.forEach((point, index) => {
      const label = point.label;
      const predicted = state.predictions[index] > 0 ? 1 : -1;
      const correct = predicted === label;
      const x = toPlotX(point.x[0], domain, PLOT);
      const y = toPlotY(point.x[1], domain, PLOT);
      svg.appendChild(
        el('circle', {
          class:
            'plot-point ' +
            (label > 0 ? 'plot-point-pos' : 'plot-point-neg') +
            (correct ? ' is-correct' : ' is-wrong'),
          cx: x,
          cy: y,
          r: 7.5,
        })
      );
      svg.appendChild(
        el(
          'text',
          { class: 'plot-point-label', x: x + 12, y: y + 4 },
          label > 0 ? '+1' : '\u22121'
        )
      );
    });
  }

  function drawBoundary(svg, state, domain, clipId) {
    const d = state.boundary
      .map((segment) => pathFromPoints(segment, domain))
      .filter(Boolean)
      .join(' ');
    if (!d) return;
    svg.appendChild(
      el('path', {
        class: 'plot-boundary',
        d,
        'clip-path': 'url(#' + clipId + ')',
      })
    );
  }

  function drawLossChart(svg, scene, state) {
    const initial = state.losses[0] || 1;
    const previous = state.losses[state.epoch] == null ? initial : state.losses[state.epoch];
    const maxLoss = Math.max(initial, previous, 1e-6);
    const toX = (epoch) =>
      CHART.x + (epoch / scene.epochs) * CHART.width;
    const toY = (loss) =>
      CHART.y + CHART.height - (loss / maxLoss) * CHART.height;

    svg.appendChild(
      el('rect', {
        class: 'chart-frame',
        x: CHART.x,
        y: CHART.y,
        width: CHART.width,
        height: CHART.height,
        rx: 10,
      })
    );
    for (const fraction of [0, 0.5, 1]) {
      const y = CHART.y + fraction * CHART.height;
      svg.appendChild(
        el('line', {
          class: 'chart-grid',
          x1: CHART.x,
          y1: y,
          x2: CHART.x + CHART.width,
          y2: y,
        })
      );
    }
    const points = state.losses
      .slice(0, state.epoch + 1)
      .map((loss, epoch) => [toX(epoch), toY(loss)]);
    if (points.length > 1) {
      svg.appendChild(
        el('path', {
          class: 'chart-line',
          d: points
            .map(([x, y], index) => (index === 0 ? 'M ' : 'L ') + x + ' ' + y)
            .join(' '),
        })
      );
    }
    const last = points[points.length - 1];
    if (last) {
      svg.appendChild(
        el('circle', { class: 'chart-dot', cx: last[0], cy: last[1], r: 4 })
      );
    }

    svg.appendChild(
      el(
        'text',
        { class: 'chart-title', x: CHART.x, y: CHART.y - 16 },
        'loss'
      )
    );
    svg.appendChild(
      el(
        'text',
        { class: 'chart-label', x: CHART.x, y: CHART.y + CHART.height + 18 },
        '0'
      )
    );
    svg.appendChild(
      el(
        'text',
        {
          class: 'chart-label',
          x: CHART.x + CHART.width,
          y: CHART.y + CHART.height + 18,
          'text-anchor': 'end',
        },
        scene.epochs + ' epochs'
      )
    );
    svg.appendChild(
      el(
        'text',
        { class: 'chart-value', x: CHART.x, y: CHART.y + CHART.height + 44 },
        'epoch ' + state.epoch + '  \u00b7  loss ' + state.loss.toFixed(3)
      )
    );
    svg.appendChild(
      el(
        'text',
        { class: 'chart-value', x: CHART.x, y: CHART.y + CHART.height + 64 },
        'accuracy ' + state.accuracy + ' / ' + scene.points.length
      )
    );
  }

  /**
   * Draws one scene-5 frame into an existing <svg>.
   *
   * @param {SVGSVGElement} svg
   * @param {object} scene - scene-5 descriptor (points, domain, epochs)
   * @param {object} state - keyframe state (epoch, loss, losses, points,
   *   predictions, boundary, accuracy)
   */
  function renderTrainingView(svg, scene, state) {
    if (!svg || !scene || !state) return;
    const domain = scene.domain || DEFAULT_DOMAIN;
    svg.textContent = '';
    svg.setAttribute('viewBox', '0 0 ' + VIEW.width + ' ' + VIEW.height);
    const clipId = 'plot-clip';
    const defs = el('defs');
    const clip = el('clipPath', { id: clipId });
    clip.appendChild(
      el('rect', {
        x: PLOT.x,
        y: PLOT.y,
        width: PLOT.width,
        height: PLOT.height,
      })
    );
    defs.appendChild(clip);
    svg.appendChild(defs);

    drawFrame(svg, domain);
    drawBoundary(svg, state, domain, clipId);
    drawPoints(svg, scene, state, domain);
    drawLossChart(svg, scene, state);

    svg.setAttribute(
      'aria-label',
      'Training plot. Epoch ' +
        state.epoch +
        ' of ' +
        scene.epochs +
        ', loss ' +
        state.loss.toFixed(3) +
        ', accuracy ' +
        state.accuracy +
        ' of ' +
        scene.points.length +
        '. Four labelled points, two per class, plus the decision boundary and the loss curve.'
    );
    svg.dataset.epoch = String(state.epoch);
    svg.dataset.loss = String(state.loss);
    svg.dataset.accuracy = String(state.accuracy);
    svg.dataset.predictions = state.predictions
      .map((value) => value.toFixed(3))
      .join(',');
    svg.dataset.boundary = state.boundary
      .map((line) =>
        line
          .map(([x, y]) => x.toFixed(2) + ':' + y.toFixed(2))
          .join(' ')
      )
      .join('|');
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    buildBoundary,
    renderTrainingView,
    toPlotX,
    toPlotY,
    PLOT_BOX: PLOT,
    PLOT_VIEW: VIEW,
  });
})(globalThis);
