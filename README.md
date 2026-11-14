# micrograd-viz

An HTML-rendered visual explainer of **how a neural network trains**, built on
[karpathy/micrograd](https://github.com/karpathy/micrograd)-style scalar autograd.

Reference narrative: Karpathy, "The spelled-out intro to neural networks and
backpropagation" (https://www.youtube.com/watch?v=02nRHJ-DyY8).

## Goals

- A single-page, dependency-free HTML "video": scenes on a timeline with
  play / pause / step / speed controls.
- Scene-by-scene: expression graph → forward pass → loss → backprop
  (chain rule flowing through topological order) → SGD update → training loop.

## Status

Freshly created. Work is dispatched ticket by ticket; every change lands via PR.
