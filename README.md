# micrograd-viz

A zero-dependency, single-page visual explainer of **how a neural network
trains**, built on [karpathy/micrograd](https://github.com/karpathy/micrograd)-style
scalar autograd.

The final piece is a "video" made of HTML: scenes on a timeline with play,
pause, step and speed controls. It walks the Karpathy narrative — expression
graph → forward pass → loss → backprop through topological order → SGD update →
training loop.

## Status

Ticket 1 built the foundation: the scalar autograd core, the SVG expression
graph, the scenes/keyframes timeline, and **scene 1** — growing the graph for
`d = a × b + c` and revealing each node's gradient.

Ticket 2 adds the animated backward pass:

- **Scene 2** replays the backward pass on that same graph. Operations are
  numbered in reverse topological order; each step highlights the outgoing
  edges, labels them with their local derivatives (`∂`), and shows the gradient
  landing in the child nodes.
- **Scene 3** is a three-input neuron, `y = tanh(w · x + b)`: the forward pass
  lights up values, then the backward pass flows through `tanh`, the sums and
  the three products to reveal each weight's gradient.
- A reverse-topological-order hint layer (numbered operation badges) makes
  visible why `mul.grad` must be complete before it can be pushed to `a` and
  `b`.

MLPs and the training loop are later tickets. No SGD or training step runs
anywhere in this page.

## Run it

Open `index.html` by double-clicking it. No server, no install, no network.
Three scenes share one 58.5 s timeline.

- **Play / Pause** — run or hold the timeline (or press `Space`).
- **Step** — jump to the next keyframe and pause (or press `→`).
- **Speed** — 0.5× / 1× / 2×.
- **Scrub / keyframe rail** — jump to any moment; the rail follows the active
  scene.

## Test it

```sh
npm test
```

Node 22+ runs the suites with no dependencies (78 tests):

- `test/value.test.js` — forward values, chain rule, shared subexpressions,
  repeatable backward passes, activation edge cases.
- `test/gradients.test.js` — analytic gradients checked against central finite
  differences (tolerance `1e-4`) for `+ * ** tanh relu exp`, including a deep
  composite expression.
- `test/backward.test.js` — the stepwise `traceBackward`: per-step gradient
  snapshots, local derivatives, custom reverse-topological orders, invalid
  orders, repeated operands (`x.mul(x)`).
- `test/graph.test.js` — left-to-right DAG layout (including compact metrics),
  render-model resolution of partial gradients, active edges, edge labels and
  reverse-order badges, viewBox bounds.
- `test/timeline.test.js` — keyframe sampling, scene boundaries, play/pause,
  step, seek, speed multipliers, end-of-timeline behaviour.
- `test/scene1.test.js` — scene 1 values (`a=2, b=-3, c=10`, `d=4`), gradients,
  keyframe growth and final gradient reveal.
- `test/scene2.test.js` — scene 2 numeric assertions per animation frame:
  after `+`, `mul.grad = 1` and `c.grad = 1`; after `×`, `a.grad = -3` and
  `b.grad = 2`; edge labels, topo badges, and animation frames driven through
  the timeline.
- `test/scene3.test.js` — neuron forward values, the analytic weight gradients,
  per-product gradient reveal, compact layout, and timeline-driven frames.
- `test/series.test.js` — the three scenes form one strictly increasing
  timeline and `Step` walks across scene boundaries.

## How the backward animation works

`Value` operations record their local partial derivatives (`∂out/∂child`) at
forward time. `src/backward.js` replays `backward()` one operation at a time,
recording the gradient snapshot after each step (`gradsAfter`) and the local
derivatives on the traversed edges. Each scene turns one step into a keyframe:

```js
{
  at: 10.5,
  label: 'through ×',
  state: {
    visible: ['a', 'b', 'c', 'mul', 'add'],
    topo: ['add', 'mul'],            // reverse order badges
    grads: { a: -3, b: 2, ... },     // values, not just visibility
    activeEdges: ['a->mul', 'b->mul'],
    edgeLabels: { 'a->mul': '∂=-3', 'b->mul': '∂=2' },
    backward: true,
    caption: '…'
  }
}
```

Because the state is plain data, scrubbing and stepping backwards are free and
the whole animation is testable in Node. Presentation order is depth-descending
(a valid reverse topological order) so the story reads top-down; leaves only
receive gradients and are not animated as steps. The gradient numbers are
produced by the same `_backward` closures the tests check, so the labels cannot
drift from the engine.

## Browser evidence

```sh
node tools/capture-evidence.mjs
```

This drives the real `file://` page in headless Chrome over the DevTools
protocol, clicks the controls, and writes screenshots plus DOM state to
`docs/evidence/`. It needs only Node (built-in `WebSocket`/`fetch`); set
`CHROME_BIN` if Chrome is not in its usual place. Current capture:

- `docs/evidence/seed-panel.png` — the **v0 baseline** seed panel (kept from
  ticket 1, not overwritten by later captures)
- `docs/evidence/scene1-start.png` — scene 1 opening frame
- `docs/evidence/scene1-mid.png` — keyframe 4 (graph still growing)
- `docs/evidence/scene1-gradients.png` — scene 1 final keyframe with all
  gradients
- `docs/evidence/scene2-backprop.png` — scene 2 processing `×`: highlighted
  edges, local-derivative labels, all five gradients
- `docs/evidence/scene2-gradients.png` — scene 2 chain-rule summary
- `docs/evidence/scene3-forward.png` — the neuron's forward pass
- `docs/evidence/scene3-gradients.png` — all three weight gradients after
  backprop
- `docs/evidence/browser-check.json` — node/edge counts, gradient text per
  scene, active-edge and edge-label state, topo badges, control states,
  playback timing, and the no-network check
- `docs/evidence/npm-test.txt` — current `npm test` output (78 tests)

## Layout

```
index.html                  single-page entry point
styles.css                  presentation (dark, dependency-free)
src/value.js                Value autograd: + * ** tanh relu exp, local derivatives
src/backward.js             stepwise backward trace for the animation
src/graph.js                pure DAG layout + render model + keyed SVG renderer
src/timeline.js             scenes + keyframes engine, play/pause/step/speed/seek
src/scenes/scene1.js        scene 1: d = a*b + c, keyframes, final gradients
src/scenes/scene2.js        scene 2: animated backward pass, reverse topo badges
src/scenes/scene3.js        scene 3: y = tanh(w·x + b) neuron, forward + backward
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
