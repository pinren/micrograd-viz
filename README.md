# micrograd-viz

A zero-dependency, single-page visual explainer of **how a neural network
trains**, built on [karpathy/micrograd](https://github.com/karpathy/micrograd)-style
scalar autograd.

The final piece is a "video" made of HTML: scenes on a timeline with play,
pause, step and speed controls. It walks the Karpathy narrative — expression
graph → forward pass → loss → backprop through topological order → SGD update →
training loop.

## Status

Ticket 1 is the foundation: the scalar autograd core, the SVG expression graph,
the scenes/keyframes timeline, and **scene 1** — growing the graph for
`d = a × b + c` and revealing each node's gradient. Backprop animation, MLPs and
the training loop are later tickets.

## Run it

Open `index.html` by double-clicking it. No server, no install, no network.

- **Play / Pause** — run or hold the timeline (or press `Space`).
- **Step** — jump to the next keyframe and pause (or press `→`).
- **Speed** — 0.5× / 1× / 2×.
- **Scrub / keyframe rail** — jump to any moment.

## Test it

```sh
npm test
```

Node 22+ runs the suites with no dependencies:

- `test/value.test.js` — forward values, chain rule, shared subexpressions,
  repeatable backward passes, activation edge cases.
- `test/gradients.test.js` — analytic gradients checked against central finite
  differences (tolerance `1e-4`) for `+ * ** tanh relu exp`, including a deep
  composite expression.
- `test/graph.test.js` — left-to-right DAG layout: node/edge counts, depth
  ordering, non-overlap, unique ids, viewBox bounds.
- `test/timeline.test.js` — keyframe sampling, scene boundaries, play/pause,
  step, seek, speed multipliers, end-of-timeline behaviour.
- `test/scene1.test.js` — scene 1 values (`a=2, b=-3, c=10`, `d=4`), gradients,
  keyframe growth and final gradient reveal.

## Browser evidence

```sh
node tools/capture-evidence.mjs
```

This drives the real `file://` page in headless Chrome over the DevTools
protocol, clicks the controls, and writes screenshots plus DOM state to
`docs/evidence/`. It needs only Node (built-in `WebSocket`/`fetch`); set
`CHROME_BIN` if Chrome is not in its usual place. Current capture:

- `docs/evidence/seed-panel.png` — initial panel, keyframe 1 (`a` only)
- `docs/evidence/scene1-mid.png` — keyframe 4 (graph still growing)
- `docs/evidence/scene1-gradients.png` — final keyframe with all gradients
- `docs/evidence/browser-check.json` — node/edge counts, gradient text, control
  states, playback timing, and the no-network check
- `docs/evidence/npm-test.txt` — current `npm test` output (44 tests)

## Layout

```
index.html                  single-page entry point
styles.css                  presentation (dark, dependency-free)
src/value.js                Value autograd: + * ** tanh relu exp, topological backward
src/graph.js                pure left-to-right DAG layout + keyed SVG renderer
src/timeline.js             scenes + keyframes engine, play/pause/step/speed/seek
src/scenes/scene1.js        scene 1: d = a*b + c, keyframes, final gradients
src/main.js                 wires the engine to the DOM controls
test/                       node:test suites (zero dependencies)
tools/capture-evidence.mjs  headless-Chrome UI evidence capture
```

## Zero build, and `file://`

The requirement is a page that works when `index.html` is opened directly from
disk. Browsers block `type="module"` fetches from `file://` (the document has an
opaque origin, so the import fails CORS) — so shipping true ES-module entry
points would break double-click. To keep the `file://` guarantee with **no
bundler and no build step**, each file in `src/` is a dual-mode module:

- in the browser it is loaded with a plain `defer` script and publishes its API
  on `globalThis.MGViz`;
- in Node it is imported directly and the same API is read from
  `globalThis.MGViz`, so tests exercise exactly the code the page runs.

Files still have no dependencies and no transpilation; the only trade-off is
that browser files use the namespace object instead of `import`/`export`.
Serving the directory over HTTP would allow real ES modules, but that would
violate "double-click `index.html`".

The page makes no network requests at all: no CDN, no fonts, no analytics.
