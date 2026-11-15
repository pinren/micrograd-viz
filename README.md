# micrograd-viz

A zero-dependency, single-page visual explainer of **how a neural network
trains**, built on [karpathy/micrograd](https://github.com/karpathy/micrograd)-style
scalar autograd.

The page is a "video" made of HTML: five scenes on one timeline with play,
pause, step, speed and scrub controls. It walks the whole Karpathy narrative —
expression graph → forward pass → loss → backprop through reverse topological
order → one SGD step → a training loop that keeps going until an MLP learns.

## The five scenes

1. **Build the expression graph** — grow `d = a × b + c` one node at a time,
   then reveal every gradient in the graph.
2. **Animate the backward pass** — replay the pass on that graph. Operations
   are numbered in reverse topological order; each step highlights the outgoing
   edges, labels them with their local derivatives (`∂`), and shows the gradient
   landing in the child nodes.
3. **One neuron** — `y = tanh(w · x + b)` with three inputs. The forward pass
   lights up values; the backward pass flows through `tanh`, the sums and the
   products to reveal each weight's gradient.
4. **One SGD step** — the same neuron now has a target `t = 1` and a loss
   `(y − t)²`. Backward fills every parameter gradient, then the page applies
   exactly one update, `p ← p − lr · g` with `lr = 0.1`. Each parameter node is
   annotated with its negative gradient and new value, and a table lists
   `data`, `grad`, `−lr · g` and the new data. The loss falls from 0.29 to 0.12.
5. **Loop until it learns** — a `2 → 3 → 1` MLP (tanh hidden layer, linear
   output) is trained with full-batch SGD on the four Karpathy-style 2-D points.
   Every epoch is a keyframe: the loss curve descends, the decision boundary
   moves, the points change colour as they become correctly classified, and the
   run ends at 4/4 with loss 1.32 → 0.30. A **Fast-forward N epochs** control
   jumps 5, 10, 25 or 50 rounds at a time.

## Run it

Open `index.html` by double-clicking it. No server, no install, no network.
Five scenes share one 110.5 s timeline.

- **Play / Pause** — run or hold the timeline (or press `Space`).
- **Step** — jump to the next keyframe and pause (or press `→`).
- **Speed** — 0.5× / 1× / 2×.
- **Scrub / keyframe rail** — jump to any moment; the rail follows the active
  scene.
- **Fast-forward N epochs** — scene 5 only; jumps N training rounds ahead and
  pauses.

## Test it

```sh
npm test
```

Node 22+ runs the suites with no dependencies (106 tests):

- `test/value.test.js` — forward values, chain rule, shared subexpressions,
  repeatable backward passes, activation edge cases.
- `test/gradients.test.js` — analytic gradients checked against central finite
  differences (tolerance `1e-4`) for `+ − * ** tanh relu exp`, including a deep
  composite expression.
- `test/backward.test.js` — the stepwise `traceBackward`: per-step gradient
  snapshots, local derivatives, custom reverse-topological orders, invalid
  orders, repeated operands (`x.mul(x)`).
- `test/graph.test.js` — left-to-right DAG layout, render-model resolution of
  gradients, active edges, edge labels, reverse-order badges, data overrides,
  update annotations, viewBox bounds.
- `test/timeline.test.js` — keyframe sampling, scene boundaries, play/pause,
  step, seek, speed multipliers, end-of-timeline behaviour.
- `test/scene1.test.js` — scene 1 values (`a=2, b=-3, c=10`, `d=4`), gradients,
  keyframe growth and final gradient reveal.
- `test/scene2.test.js` — scene 2 numeric assertions per animation frame:
  after `+`, `mul.grad = 1` and `c.grad = 1`; after `×`, `a.grad = -3` and
  `b.grad = 2`; edge labels, topo badges, and timeline-driven frames.
- `test/scene3.test.js` — neuron forward values, the analytic weight gradients,
  per-product gradient reveal, compact layout, and timeline-driven frames.
- `test/scene4.test.js` — the loss, the analytic gradients through square /
  subtraction / tanh, one exact `p ← p − lr · g` update per parameter, the
  update annotations and before/after table, and the post-step loss.
- `test/scene5.test.js` — the training run's monotone loss history (61 values,
  final below 40 % of the initial loss), 4/4 accuracy, boundary samples on
  `z = 0`, the linear-separator case of marching squares, plot coordinate
  mapping, and fast-forward indexing through the timeline.
- `test/train.test.js` — `Value.zeroGrad()` / `Value.step()`, `trainStep` /
  `train` (forward → backward → step), zeroed stale gradients, monotone
  convergence on a quadratic, MSE and hinge losses, and the MLP's Value graph
  agreeing with its plain-number snapshot.
- `test/series.test.js` — the five scenes form one strictly increasing
  110.5 s timeline and `Step` walks across every scene boundary.

## How the training loop works

`Value` holds one number and one gradient. The new training API is deliberately
small: `zeroGrad()` clears a parameter's gradient, and `step(lr)` performs
`data -= lr * grad` in place. `src/train.js` owns the loop, so the page and the
tests execute exactly the same code:

```js
// one update: forward → loss → backward → step
for (const p of params) p.zeroGrad();
const loss = forward();
loss.backward();
for (const p of params) p.step(lr);
```

`train(params, forward, { lr, steps, onStep })` repeats that loop and returns
the loss history; `meanSquaredError` and `hingeLoss` build differentiable loss
Values. `src/nn.js` provides `Neuron`, `Layer` and `MLP` (weights and biases are
Values), plus `snapshot()` / `forwardNumbers()` for cheap plain-number
predictions: scene 5 needs thousands of predictions to draw the decision
boundary, while the training step still runs on the Value graph.

Scene 5 uses a fixed seed, so the loss curve, boundary and screenshots are
reproducible:

| epoch | 0 | 5 | 10 | 20 | 30 | 40 | 50 | 60 |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- |
| loss | 1.3221 | 0.7809 | 0.6151 | 0.4892 | 0.4221 | 0.3729 | 0.3336 | 0.3002 |

The loss never increases and all four points are classified correctly at the
end.

## How the animation works

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
the whole animation is testable in Node. Scene 4 adds two optional pieces to the
same render model: `data` overrides (show a fresh forward pass after the update)
and `updates` annotations (`-g 0.85 → 0.58` under each parameter). Scene 5's
keyframes store a plain network snapshot, predictions, accuracy and the sampled
zero contour, so the plot is also pure data; `src/plot.js` only draws it.

The gradient numbers come from the same `_backward` closures the tests check, so
the labels cannot drift from the engine.

## Browser evidence

```sh
node tools/capture-evidence.mjs
```

This drives the real `file://` page in headless Chrome over the DevTools
protocol, clicks the real controls (including Fast-forward and the speed
select), and writes screenshots plus DOM state to `docs/evidence/`. It needs
only Node (built-in `WebSocket`/`fetch`); set `CHROME_BIN` if Chrome is not in
its usual place. Current capture:

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
- `docs/evidence/scene4-step.png` — the SGD-step keyframe: parameter update
  annotations and the `−lr · g` table
- `docs/evidence/scene4-after.png` — the same graph after the update: new
  parameter values, new loss, gradients cleared
- `docs/evidence/scene5-start.png` — epoch 0: random boundary, loss 1.322,
  2/4 correct
- `docs/evidence/scene5-learned.png` — epoch 60: loss 0.300, 4/4 correct,
  separated boundary and descending loss curve
- `docs/evidence/browser-check.json` — node/edge counts, gradient text per
  scene, update annotations, readout tables, plot epoch/loss/accuracy/prediction
  state, fast-forward behaviour, the 61-value loss history, playback timing, and
  the no-network check
- `docs/evidence/npm-test.txt` — current `npm test` output (106 tests)

## Layout

```
index.html                  single-page entry point
styles.css                  presentation (dark, dependency-free)
src/value.js                Value autograd: + − * ** tanh relu exp, zeroGrad, step
src/backward.js             stepwise backward trace for the animation
src/graph.js                pure DAG layout + render model + keyed SVG renderer
src/timeline.js             scenes + keyframes engine, play/pause/step/speed/seek
src/train.js                trainStep / train loop, MSE and hinge losses
src/nn.js                   Neuron / Layer / MLP, seeded init, numeric snapshot
src/plot.js                 decision-boundary sampling + scene 5 SVG plot
src/scenes/scene1.js        scene 1: d = a*b + c, keyframes, final gradients
src/scenes/scene2.js        scene 2: animated backward pass, reverse topo badges
src/scenes/scene3.js        scene 3: y = tanh(w·x + b) neuron, forward + backward
src/scenes/scene4.js        scene 4: loss, one SGD step, before/after comparison
src/scenes/scene5.js        scene 5: 2-3-1 MLP training loop, 60 epochs
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
