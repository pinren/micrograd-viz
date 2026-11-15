#!/usr/bin/env node
/*
 * Regenerates the derived narration files from the canonical sources:
 *
 *   narration/zh.json  -> narration/zh.js   (browser classic script; file://
 *                                            cannot fetch a local JSON file)
 *   scene keyframes    -> narration/en.json (archive of the original English
 *                                            captions; the page now shows the
 *                                            Chinese script)
 *
 *   node tools/sync-narration.mjs
 *
 * Zero dependencies, and the page never runs this: it is a maintenance helper,
 * not a build step. `npm test` asserts the generated files stay in sync.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function createScenes() {
  for (const file of [
    'value.js',
    'backward.js',
    'graph.js',
    'timeline.js',
    'train.js',
    'nn.js',
    'plot.js',
    'scenes/scene1.js',
    'scenes/scene2.js',
    'scenes/scene3.js',
    'scenes/scene4.js',
    'scenes/scene5.js',
  ]) {
    await import(join(root, 'src', file));
  }
  const { createScene1, createScene2, createScene3, createScene4, createScene5 } =
    globalThis.MGViz;
  return [createScene1(), createScene2(), createScene3(), createScene4(), createScene5()];
}

const zh = JSON.parse(readFileSync(join(root, 'narration/zh.json'), 'utf8'));

const zhScript =
  '/*\n' +
  ' * Generated from narration/zh.json by tools/sync-narration.mjs.\n' +
  ' * Loaded as a classic script so the page still speaks from file://, where\n' +
  ' * fetch() of a local JSON file is blocked. Do not edit by hand.\n' +
  ' */\n' +
  '(function (global) {\n' +
  "  'use strict';\n" +
  '  global.MGViz = Object.assign(global.MGViz || {}, {\n' +
  '    narrationZh: ' +
  JSON.stringify(zh, null, 2).replace(/\n/g, '\n    ') +
  ',\n' +
  '  });\n' +
  '})(globalThis);\n';
writeFileSync(join(root, 'narration/zh.js'), zhScript);

const scenes = await createScenes();
const en = [];
scenes.forEach((scene, sceneIndex) => {
  scene.keyframes.forEach((keyframe, keyframeIndex) => {
    en.push({
      scene: sceneIndex + 1,
      keyframe: keyframeIndex,
      text: keyframe.state.caption,
    });
  });
});
writeFileSync(
  join(root, 'narration/en.json'),
  JSON.stringify(en, null, 2) + '\n'
);

console.log(
  'narration/zh.js: ' +
    zh.length +
    ' entries; narration/en.json: ' +
    en.length +
    ' English captions'
);
