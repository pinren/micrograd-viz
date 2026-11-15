#!/usr/bin/env node
/*
 * Reproducible browser evidence for ticket 1.
 *
 * Uses headless Chrome over the DevTools protocol (Node's built-in WebSocket,
 * no dependencies) to open index.html from file://, click the real controls,
 * and capture screenshots plus the resulting DOM state.
 *
 *   node tools/capture-evidence.mjs
 *
 * Set CHROME_BIN to override the Chrome executable.
 */
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = join(root, 'docs', 'evidence');
const pageUrl = pathToFileURL(join(root, 'index.html')).href;
const chromeBin =
  process.env.CHROME_BIN ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');
const port = 9300 + Math.floor(Math.random() * 400);
const userDataDir = mkdtempSync(join(tmpdir(), 'mgv-evidence-'));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const evidence = {
  generatedAt: new Date().toISOString(),
  url: pageUrl,
  command: 'node tools/capture-evidence.mjs',
  viewport: { width: 1280, height: 1000 },
  screenshots: [],
  states: {},
  checks: {},
  consoleErrors: [],
  externalRequests: [],
};
const failures = [];

function check(name, condition, detail) {
  evidence.checks[name] = { pass: Boolean(condition), detail };
  if (!condition) failures.push(name + (detail ? ': ' + detail : ''));
  console.log((condition ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

function saveEvidence() {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, 'browser-check.json'),
    JSON.stringify(evidence, null, 2) + '\n'
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  return response.json();
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await fetchJson('http://127.0.0.1:' + port + '/json/version');
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Chrome did not expose the DevTools endpoint');
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const handlers = this.handlers.get(message.method) || [];
      for (const handler of handlers) handler(message.params);
    });
  }

  open() {
    return new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', () => resolvePromise(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('WebSocket error')), {
        once: true,
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          'evaluation failed'
      );
    }
    return response.result.value;
  }

  close() {
    this.ws.close();
  }
}

function readStateExpression() {
  return `(() => {
    const svg = document.getElementById('graph');
    const nodeEls = [...svg.querySelectorAll('.node')];
    const nodes = nodeEls.map((group) => ({
      key: group.dataset.key,
      label: group.querySelector('.node-label')?.textContent || '',
      data: group.querySelector('.node-data')?.textContent || '',
      grad: group.querySelector('.node-grad')?.textContent || '',
      hasGrad: group.classList.contains('has-grad'),
      topo: group.querySelector('.topo-badge text')?.textContent || '',
      transform: group.getAttribute('transform'),
      active: group.classList.contains('is-active')
    }));
    const edges = [...svg.querySelectorAll('.edge')].map((group) => ({
      key: group.dataset.key,
      active: group.classList.contains('is-active'),
      label: group.querySelector('.edge-label')?.textContent || '',
      hasLabel: group.classList.contains('has-label')
    }));
    const play = document.getElementById('play');
    const plot = document.getElementById('plot');
    const readout = document.getElementById('readout');
    return {
      ready: document.documentElement.dataset.ready === 'true',
      scene: document.body.dataset.scene,
      keyframe: Number(document.body.dataset.keyframe),
      playing: document.body.dataset.playing === 'true',
      speed: Number(document.body.dataset.speed),
      time: Number(document.body.dataset.time),
      timeLabel: document.getElementById('time').textContent,
      playLabel: document.getElementById('play-label').textContent,
      playPressed: play.getAttribute('aria-pressed'),
      stepDisabled: document.getElementById('step').disabled,
      speedOptions: [...document.querySelectorAll('#speed option')].map((option) => option.value),
      speedValue: document.getElementById('speed').value,
      caption: document.getElementById('caption').textContent,
      badge: document.getElementById('step-badge').textContent,
      sceneTitle: document.getElementById('scene-title').textContent,
      chips: [...document.querySelectorAll('.step-chip')].map((chip) => ({
        index: Number(chip.dataset.index),
        label: chip.querySelector('.step-label').textContent,
        active: chip.classList.contains('is-active'),
        done: chip.classList.contains('is-done')
      })),
      showGrads: svg.classList.contains('show-grads'),
      backward: svg.classList.contains('backward'),
      visibleNodes: svg.dataset.visibleNodes || '',
      showGradsDataset: svg.dataset.showGrads,
      gradsDataset: svg.dataset.grads || '',
      topoDataset: svg.dataset.topo || '',
      updatesDataset: svg.dataset.updates || '',
      dataDataset: svg.dataset.data || '',
      ariaLabel: svg.getAttribute('aria-label'),
      viewBox: svg.getAttribute('viewBox'),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
      graphHidden: svg.hasAttribute('hidden'),
      plot: {
        hidden: plot.hasAttribute('hidden'),
        epoch: plot.dataset.epoch == null ? null : Number(plot.dataset.epoch),
        loss: plot.dataset.loss == null ? null : Number(plot.dataset.loss),
        accuracy: plot.dataset.accuracy == null ? null : Number(plot.dataset.accuracy),
        predictions: (plot.dataset.predictions || '').split(',').filter(Boolean).map(Number),
        boundarySegments: (plot.dataset.boundary || '').split('|').filter(Boolean).length
      },
      readout: {
        hidden: readout.hasAttribute('hidden'),
        title: readout.querySelector('h3')?.textContent || '',
        stats: [...readout.querySelectorAll('.readout-stat')].map((stat) => ({
          label: stat.querySelector('.readout-stat-label')?.textContent || '',
          value: stat.querySelector('.readout-stat-value')?.textContent || ''
        })),
        headers: [...readout.querySelectorAll('th')].map((th) => th.textContent),
        rows: [...readout.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent)
        )
      },
      skip: {
        hidden: document.getElementById('skip-controls').hasAttribute('hidden'),
        value: document.getElementById('skip').value,
        label: document.getElementById('fast-forward').textContent.trim(),
        disabled: document.getElementById('fast-forward').disabled
      },
      narration: {
        enabled:
          document.getElementById('narration').getAttribute('aria-pressed') ===
          'true',
        label: document.getElementById('narration-label').textContent,
        channel: document.body.dataset.narrationChannel || '',
        captionLang: document.body.dataset.captionLang || '',
        stored: (() => {
          try {
            return globalThis.localStorage.getItem('mgviz.narration');
          } catch {
            return null;
          }
        })(),
        last: (() => {
          const narration = globalThis.MGViz.app.narration;
          return narration && narration.last
            ? { text: narration.last.text, channel: narration.last.channel }
            : null;
        })()
      }
    };
  })()`;
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  const chrome = spawn(
    chromeBin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=' + port,
      '--window-size=1280,1000',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  let cdp;
  try {
    const version = await waitForChrome();
    evidence.chrome = version.Browser;
    const targets = await fetchJson('http://127.0.0.1:' + port + '/json/list');
    const target = targets.find((candidate) => candidate.type === 'page');
    if (!target) throw new Error('No page target from Chrome');

    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      evidence.consoleErrors.push({
        type: 'exception',
        text: params.exceptionDetails.exception?.description || params.exceptionDetails.text,
      });
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error' || params.type === 'warning') {
        evidence.consoleErrors.push({
          type: 'console.' + params.type,
          text: params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
        });
      }
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry.level === 'error') {
        evidence.consoleErrors.push({ type: 'log', text: params.entry.text });
      }
    });
    cdp.on('Network.requestWillBeSent', (params) => {
      const url = params.request.url;
      if (!url.startsWith('file:') && !url.startsWith('data:')) {
        evidence.externalRequests.push(url);
      }
    });

    const errorsBeforeLoad = evidence.consoleErrors.length;
    await cdp.send('Page.navigate', { url: pageUrl });

    async function waitForReady(timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          if (await cdp.evaluate('document.documentElement.dataset.ready === "true"')) {
            return;
          }
        } catch {
          // The execution context does not exist during navigation yet.
        }
        await sleep(100);
      }
      throw new Error('Timed out waiting for the page to become ready');
    }

    const readState = () => cdp.evaluate(readStateExpression());
    const click = async (selector) => {
      await cdp.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ' + ${JSON.stringify(selector)}); el.click(); })()`
      );
    };
    const setSpeed = async (value) => {
      await cdp.evaluate(
        `(() => { const select = document.getElementById('speed'); select.value = ${JSON.stringify(String(value))}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`
      );
    };
    const seek = async (value) => {
      await cdp.evaluate(
        `(() => { const range = document.getElementById('progress'); range.value = ${JSON.stringify(String(value))}; range.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
    };
    const shot = async (name) => {
      await sleep(500);
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const fileName = name + '.png';
      writeFileSync(join(evidenceDir, fileName), Buffer.from(data, 'base64'));
      evidence.screenshots.push('docs/evidence/' + fileName);
      console.log('screenshot docs/evidence/' + fileName);
    };

    await waitForReady();
    await sleep(400);
    const sceneInfo = await cdp.evaluate(
      `globalThis.MGViz.app.timeline.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        duration: scene.duration,
        keyframes: scene.keyframes.map((keyframe) => ({
          at: keyframe.at,
          label: keyframe.label
        }))
      }))`
    );
    const sceneOffsets = [];
    let elapsed = 0;
    for (const scene of sceneInfo) {
      sceneOffsets.push(elapsed);
      elapsed += scene.duration;
    }
    evidence.scenes = { scenes: sceneInfo, offsets: sceneOffsets, total: elapsed };
    const seekSceneKeyframe = async (sceneIndex, keyframeIndex) => {
      const info = sceneInfo[sceneIndex];
      const keyframe = info.keyframes[keyframeIndex];
      await seek(sceneOffsets[sceneIndex] + keyframe.at);
      await sleep(450);
      return readState();
    };
    const seekScene = async (sceneIndex, label) => {
      const index = sceneInfo[sceneIndex].keyframes.findIndex(
        (keyframe) => keyframe.label === label
      );
      if (index < 0) throw new Error('missing scene keyframe ' + label);
      return seekSceneKeyframe(sceneIndex, index);
    };
    const nodesByKey = (state) =>
      Object.fromEntries(state.nodes.map((node) => [node.key, node]));
    const gradsOf = (state) =>
      Object.fromEntries(
        state.nodes
          .filter((node) => node.hasGrad)
          .map((node) => [node.key, node.grad])
      );
    const activeEdgeKeys = (state) =>
      state.edges.filter((edge) => edge.active).map((edge) => edge.key);
    const edgeLabelsOf = (state) =>
      Object.fromEntries(
        state.edges
          .filter((edge) => edge.hasLabel)
          .map((edge) => [edge.key, edge.label])
      );

    evidence.states.initial = await readState();
    check('page loads from file://', evidence.states.initial.ready);
    check(
      'initial state is keyframe 0 with only node a',
      evidence.states.initial.keyframe === 0 &&
        evidence.states.initial.nodeCount === 1 &&
        evidence.states.initial.visibleNodes === 'a',
      'keyframe=' +
        evidence.states.initial.keyframe +
        ' nodes=' +
        evidence.states.initial.nodeCount
    );
    check(
      'six keyframe chips are rendered',
      evidence.states.initial.chips.length === 6,
      'chips=' + evidence.states.initial.chips.length
    );
    check(
      'all three speeds are offered',
      ['0.5', '1', '2'].every((value) =>
        evidence.states.initial.speedOptions.includes(value)
      ),
      evidence.states.initial.speedOptions.join(',')
    );
    await shot('scene1-start');

    // Narration: Chinese caption by default, toggle, Step, localStorage.
    const zhFrame = async (scene, keyframe) =>
      cdp.evaluate(
        `globalThis.MGViz.narrationZh.find((entry) => entry.scene === ${scene} && entry.keyframe === ${keyframe}).text`
      );
    const initialNarration = evidence.states.initial.narration;
    check(
      'narration defaults off while the caption is the Chinese script',
      initialNarration.enabled === false &&
        initialNarration.label === '配音 关' &&
        initialNarration.channel === '' &&
        initialNarration.captionLang === 'zh' &&
        /先看一个数/.test(evidence.states.initial.caption),
      JSON.stringify({
        narration: initialNarration,
        caption: evidence.states.initial.caption,
      })
    );

    const frame0Text = await zhFrame(1, 0);
    await click('#narration');
    await sleep(250);
    const narrationOn = await readState();
    evidence.states.narrationOn = narrationOn;
    check(
      'the 🔊 switch turns narration on, speaks the current frame and persists',
      narrationOn.narration.enabled === true &&
        narrationOn.narration.label === '配音 开' &&
        narrationOn.narration.stored === 'on' &&
        narrationOn.caption === frame0Text &&
        ['speech', 'none'].includes(narrationOn.narration.channel) &&
        narrationOn.narration.last &&
        narrationOn.narration.last.text === frame0Text,
      JSON.stringify(narrationOn.narration)
    );
    await shot('narration-on');

    await click('#step');
    const narrationStep = await readState();
    const frame1Text = await zhFrame(1, 1);
    evidence.states.narrationStep = narrationStep;
    check(
      'Step triggers the new keyframe narration',
      narrationStep.keyframe === 1 &&
        narrationStep.caption === frame1Text &&
        narrationStep.narration.last &&
        narrationStep.narration.last.text === frame1Text &&
        ['speech', 'none'].includes(narrationStep.narration.channel),
      JSON.stringify({
        keyframe: narrationStep.keyframe,
        caption: narrationStep.caption,
        narration: narrationStep.narration,
      })
    );

    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForReady();
    await sleep(500);
    const restored = await readState();
    evidence.states.narrationRestored = restored;
    check(
      'the narration choice survives a reload',
      restored.narration.enabled === true &&
        restored.narration.label === '配音 开' &&
        restored.narration.stored === 'on' &&
        restored.keyframe === 0,
      JSON.stringify({
        keyframe: restored.keyframe,
        narration: restored.narration,
      })
    );

    await click('#narration');
    const narrationOff = await readState();
    evidence.states.narrationOff = narrationOff;
    check(
      'the 🔊 switch turns narration off again',
      narrationOff.narration.enabled === false &&
        narrationOff.narration.label === '配音 关' &&
        narrationOff.narration.stored === 'off' &&
        narrationOff.narration.channel === '',
      JSON.stringify(narrationOff.narration)
    );

    // Play at 2x for ~1s, then pause: the timeline must advance by ~2s.
    await setSpeed(2);
    const startedAt = (await readState()).time;
    await click('#play');
    const whilePlaying = await readState();
    check(
      'play button enters playing state',
      whilePlaying.playing === true && whilePlaying.playLabel === 'Pause',
      'label=' + whilePlaying.playLabel
    );
    await sleep(1050);
    const afterPlay = await readState();
    await click('#play');
    const afterPause = await readState();
    evidence.states.after2xPlay = { whilePlaying, afterPlay, afterPause };
    check(
      '2x speed advances roughly twice as fast',
      afterPlay.time - startedAt >= 1.3 && afterPlay.time - startedAt <= 3,
      'delta=' + (afterPlay.time - startedAt).toFixed(2) + 's'
    );
    check(
      'pause stops playback and updates the button',
      afterPause.playing === false && afterPause.playLabel === 'Play',
      'label=' + afterPause.playLabel
    );

    // Step through the keyframes with the real Step button.
    await setSpeed(1);
    await seek(0);
    await cdp.evaluate('new Promise((resolve) => setTimeout(resolve, 100))');
    await click('#step');
    await click('#step');
    await click('#step');
    const midState = await readState();
    evidence.states.mid = midState;
    check(
      'Step advances to the third keyframe and grows the graph',
      midState.keyframe === 3 && midState.nodeCount === 4,
      'keyframe=' + midState.keyframe + ' nodes=' + midState.nodeCount
    );
    check(
      'mid scene caption describes c',
      /第三个输入 c 等于十/.test(midState.caption),
      midState.caption
    );
    await shot('scene1-mid');

    await click('#step');
    await click('#step');
    await sleep(800);
    const finalState = await readState();
    evidence.states.final = finalState;
    check(
      'final keyframe shows all five nodes and four edges',
      finalState.keyframe === 5 &&
        finalState.nodeCount === 5 &&
        finalState.edgeCount === 4,
      'keyframe=' +
        finalState.keyframe +
        ' nodes=' +
        finalState.nodeCount +
        ' edges=' +
        finalState.edgeCount
    );
    check('final state reveals gradients', finalState.showGrads === true);
    const grads = Object.fromEntries(
      finalState.nodes.map((node) => [node.key, node.grad])
    );
    evidence.gradients = grads;
    check(
      'gradients match d = a*b + c',
      grads.add === 'grad 1' &&
        grads.mul === 'grad 1' &&
        grads.c === 'grad 1' &&
        grads.a === 'grad -3' &&
        grads.b === 'grad 2',
      JSON.stringify(grads)
    );
    check(
      'final scene caption explains the chain rule',
      /链式法则/.test(finalState.caption) &&
        /接力/.test(finalState.caption),
      finalState.caption
    );
    await shot('scene1-gradients');

    check(
      'five scenes with five keyframe rails are loaded',
      sceneInfo.length === 5 &&
        sceneInfo.map((scene) => scene.id).join(',') ===
          'scene-1,scene-2,scene-3,scene-4,scene-5' &&
        evidence.scenes.total === 110.5,
      JSON.stringify({
        ids: sceneInfo.map((scene) => scene.id),
        total: evidence.scenes.total,
      })
    );

    // Stepping off scene 1's last keyframe must land on scene 2's first one.
    await click('#step');
    const scene2Entry = await readState();
    check(
      'Step crosses from scene 1 into scene 2',
      scene2Entry.scene === 'scene-2' &&
        scene2Entry.keyframe === 0 &&
        scene2Entry.time === 13 &&
        scene2Entry.chips.length === 6,
      'scene=' +
        scene2Entry.scene +
        ' keyframe=' +
        scene2Entry.keyframe +
        ' time=' +
        scene2Entry.time
    );
    check(
      'scene 2 opens on the full graph with no gradients',
      scene2Entry.nodeCount === 5 &&
        scene2Entry.edgeCount === 4 &&
        Object.keys(gradsOf(scene2Entry)).length === 0,
      'nodes=' +
        scene2Entry.nodeCount +
        ' grads=' +
        JSON.stringify(gradsOf(scene2Entry))
    );

    await setSpeed(2);
    await click('#play');
    await sleep(700);
    const scene2Playing = await readState();
    await click('#play');
    await setSpeed(1);
    check(
      'scene 2 plays inside its own timeline segment',
      scene2Playing.scene === 'scene-2' &&
        scene2Playing.playing === true &&
        scene2Playing.time > 13.4 &&
        scene2Playing.time < 16,
      'scene=' +
        scene2Playing.scene +
        ' time=' +
        scene2Playing.time +
        ' playing=' +
        scene2Playing.playing
    );

    const s2topo = await seekScene(1, 'reverse topo');
    const topoBadges = s2topo.nodes
      .filter((node) => node.topo)
      .map((node) => node.key + ':' + node.topo)
      .sort()
      .join(',');
    check(
      'scene 2 badges operations in reverse topological order',
      s2topo.topoDataset === 'add,mul' && topoBadges === 'add:1,mul:2',
      'topo=' + s2topo.topoDataset + ' badges=' + topoBadges
    );

    const s2seed = await seekScene(1, 'seed');
    check(
      'scene 2 seeds d.grad = 1 and nothing else',
      JSON.stringify(gradsOf(s2seed)) === '{"add":"grad 1"}',
      JSON.stringify(gradsOf(s2seed))
    );

    const s2add = await seekScene(1, 'through +');
    const addGrads = gradsOf(s2add);
    check(
      'scene 2 + step moves gradients into mul and c',
      addGrads.add === 'grad 1' &&
        addGrads.mul === 'grad 1' &&
        addGrads.c === 'grad 1' &&
        addGrads.a === undefined &&
        addGrads.b === undefined,
      JSON.stringify(addGrads)
    );
    check(
      'scene 2 + step highlights and labels both edges',
      activeEdgeKeys(s2add).sort().join(',') === 'c->add,mul->add' &&
        JSON.stringify(edgeLabelsOf(s2add)) ===
          '{"mul->add":"∂=1","c->add":"∂=1"}' &&
        s2add.backward === true,
      JSON.stringify({
        edges: activeEdgeKeys(s2add),
        labels: edgeLabelsOf(s2add),
        backward: s2add.backward,
      })
    );

    const s2mul = await seekScene(1, 'through ×');
    const mulGrads = gradsOf(s2mul);
    check(
      'scene 2 × step reaches a = -3 and b = 2',
      mulGrads.a === 'grad -3' &&
        mulGrads.b === 'grad 2' &&
        mulGrads.mul === 'grad 1',
      JSON.stringify(mulGrads)
    );
    check(
      'scene 2 × step labels local derivatives ∂mul/∂a and ∂mul/∂b',
      JSON.stringify(edgeLabelsOf(s2mul)) ===
        '{"a->mul":"∂=-3","b->mul":"∂=2"}',
      JSON.stringify(edgeLabelsOf(s2mul))
    );
    await shot('scene2-backprop');

    const s2final = await seekScene(1, 'chain rule');
    check(
      'scene 2 ends with all five gradients',
      Object.keys(gradsOf(s2final)).length === 5 &&
        gradsOf(s2final).a === 'grad -3' &&
        gradsOf(s2final).b === 'grad 2' &&
        gradsOf(s2final).c === 'grad 1',
      JSON.stringify(gradsOf(s2final))
    );
    check(
      'scene 2 final caption states the chain rule',
      /链式法则/.test(s2final.caption) && /一路相乘/.test(s2final.caption),
      s2final.caption
    );
    evidence.states.scene2 = {
      entry: scene2Entry,
      playing: scene2Playing,
      topo: s2topo,
      seed: s2seed,
      throughAdd: s2add,
      throughMul: s2mul,
      final: s2final,
    };
    await shot('scene2-gradients');

    const s3inputs = await seekScene(2, 'inputs');
    check(
      'scene 3 starts with the seven input nodes',
      s3inputs.scene === 'scene-3' &&
        s3inputs.nodeCount === 7 &&
        s3inputs.edgeCount === 0 &&
        Object.keys(gradsOf(s3inputs)).length === 0,
      'nodes=' +
        s3inputs.nodeCount +
        ' edges=' +
        s3inputs.edgeCount
    );

    await setSpeed(2);
    await click('#play');
    await sleep(700);
    const scene3Playing = await readState();
    await click('#play');
    await setSpeed(1);
    check(
      'scene 3 plays inside its own timeline segment',
      scene3Playing.scene === 'scene-3' &&
        scene3Playing.playing === true &&
        scene3Playing.time > 28.9 &&
        scene3Playing.time < 31,
      'scene=' +
        scene3Playing.scene +
        ' time=' +
        scene3Playing.time +
        ' playing=' +
        scene3Playing.playing
    );

    const s3forward = await seekScene(2, 'tanh');
    const forwardNodes = nodesByKey(s3forward);
    check(
      'scene 3 forward pass renders the whole neuron',
      s3forward.nodeCount === 14 &&
        s3forward.edgeCount === 13 &&
        forwardNodes.y.data === 'data 0.46' &&
        forwardNodes.zb.data === 'data 0.5' &&
        forwardNodes.p3.data === 'data -2',
      'nodes=' +
        s3forward.nodeCount +
        ' edges=' +
        s3forward.edgeCount +
        ' y=' +
        (forwardNodes.y && forwardNodes.y.data)
    );
    check(
      'scene 3 forward pass has no gradients yet',
      Object.keys(gradsOf(s3forward)).length === 0,
      JSON.stringify(gradsOf(s3forward))
    );
    await shot('scene3-forward');

    const s3seed = await seekScene(2, 'seed');
    check(
      'scene 3 seeds y.grad = 1',
      JSON.stringify(gradsOf(s3seed)) === '{"y":"grad 1"}',
      JSON.stringify(gradsOf(s3seed))
    );

    const s3w1 = await seekScene(2, 'through × w1');
    const w1Grads = gradsOf(s3w1);
    check(
      'scene 3 reveals weight gradients one product at a time',
      w1Grads.w1 === 'grad 0.79' &&
        w1Grads.x1 === 'grad 0.39' &&
        w1Grads.w2 === undefined &&
        w1Grads.w3 === undefined,
      JSON.stringify(w1Grads)
    );
    check(
      'scene 3 w1 step labels ∂p1/∂w1 = x1 and ∂p1/∂x1 = w1',
      JSON.stringify(edgeLabelsOf(s3w1)) ===
        '{"w1->p1":"∂=1","x1->p1":"∂=0.5"}',
      JSON.stringify(edgeLabelsOf(s3w1))
    );

    const s3final = await seekScene(2, 'weight grads');
    const weightGrads = gradsOf(s3final);
    check(
      'scene 3 ends with all 14 gradients',
      Object.keys(weightGrads).length === 14,
      'grads=' + Object.keys(weightGrads).length
    );
    check(
      'scene 3 weight grads are x_i × upstream',
      weightGrads.w1 === 'grad 0.79' &&
        weightGrads.w2 === 'grad 0.39' &&
        weightGrads.w3 === 'grad -0.79' &&
        weightGrads.x3 === 'grad 1.57',
      JSON.stringify({
        w1: weightGrads.w1,
        w2: weightGrads.w2,
        w3: weightGrads.w3,
        x3: weightGrads.x3,
      })
    );
    check(
      'scene 3 final caption lists the weight gradients',
      /零点七九/.test(s3final.caption) &&
        /更新参数/.test(s3final.caption),
      s3final.caption
    );
    check(
      'Step stays enabled after scene 3 because scenes 4 and 5 follow',
      s3final.stepDisabled === false,
      'scene=' + s3final.scene
    );
    evidence.states.scene3 = {
      inputs: s3inputs,
      playing: scene3Playing,
      forward: s3forward,
      seed: s3seed,
      throughW1: s3w1,
      final: s3final,
    };
    await shot('scene3-gradients');

    const s4inputs = await seekScene(3, 'inputs');
    check(
      'scene 4 starts on the same neuron inputs, without a readout',
      s4inputs.scene === 'scene-4' &&
        s4inputs.nodeCount === 7 &&
        s4inputs.edgeCount === 0 &&
        s4inputs.readout.hidden === true &&
        s4inputs.plot.hidden === true,
      'scene=' +
        s4inputs.scene +
        ' nodes=' +
        s4inputs.nodeCount +
        ' readoutHidden=' +
        s4inputs.readout.hidden
    );

    const s4loss = await seekScene(3, 'loss');
    check(
      'scene 4 adds the target and the loss node',
      s4loss.nodeCount === 17 &&
        s4loss.edgeCount === 16 &&
        s4loss.nodes.some((node) => node.key === 'loss') &&
        /零点二九/.test(s4loss.caption),
      'nodes=' + s4loss.nodeCount + ' edges=' + s4loss.edgeCount
    );

    const s4step = await seekScene(3, 'SGD step');
    const s4stepNodes = nodesByKey(s4step);
    check(
      'scene 4 shows each parameter update annotation',
      ['w1', 'w2', 'w3', 'b'].every((id) =>
        s4step.updatesDataset.includes(id + '=-g ')
      ),
      s4step.updatesDataset
    );
    check(
      'scene 4 parameter table has one row per weight and bias',
      s4step.readout.headers.join(',') === 'param,data,grad,−lr·g,new data' &&
        s4step.readout.rows.length === 4 &&
        s4step.readout.rows[0][0] === 'w₁' &&
        s4step.readout.rows[0][3] === '+0.08',
      JSON.stringify(s4step.readout.rows)
    );
    check(
      'scene 4 keeps the before-values on the update frame',
      s4stepNodes.w1.data === 'data 0.5' &&
        s4stepNodes.w3.data === 'data 2' &&
        /grad -0\.85/.test(s4stepNodes.w1.grad) &&
        /grad 0\.85/.test(s4stepNodes.w3.grad),
      JSON.stringify({
        w1: s4stepNodes.w1,
        w3: s4stepNodes.w3,
      })
    );
    await shot('scene4-step');

    const s4after = await seekScene(3, 'after step');
    const s4afterNodes = nodesByKey(s4after);
    check(
      'scene 4 applies the step and clears the gradients',
      s4afterNodes.w1.data === 'data 0.58' &&
        s4afterNodes.w2.data === 'data -0.96' &&
        s4afterNodes.w3.data === 'data 1.92' &&
        s4afterNodes.b.data === 'data 2.58' &&
        s4afterNodes.loss.data === 'data 0.12' &&
        s4after.gradsDataset === '',
      JSON.stringify({
        w1: s4afterNodes.w1.data,
        w2: s4afterNodes.w2.data,
        w3: s4afterNodes.w3.data,
        b: s4afterNodes.b.data,
        loss: s4afterNodes.loss.data,
        grads: s4after.gradsDataset,
      })
    );
    check(
      'scene 4 readout reports the loss before and after the step',
      s4after.readout.stats.some(
        (stat) => stat.label === 'loss before' && stat.value === '0.29'
      ) &&
        s4after.readout.stats.some(
          (stat) => stat.label === 'loss after' && stat.value === '0.12'
        ),
      JSON.stringify(s4after.readout.stats)
    );
    evidence.states.scene4 = {
      inputs: s4inputs,
      loss: s4loss,
      step: s4step,
      after: s4after,
    };
    await shot('scene4-after');

    const s5start = await seekScene(4, 'epoch 0');
    check(
      'scene 5 opens on the plot with the untrained loss',
      s5start.scene === 'scene-5' &&
        s5start.plot.hidden === false &&
        s5start.plot.epoch === 0 &&
        s5start.plot.loss > 1.3 &&
        s5start.plot.loss < 1.35 &&
        s5start.plot.boundarySegments > 10 &&
        s5start.skip.hidden === false,
      JSON.stringify({
        scene: s5start.scene,
        plot: s5start.plot,
        skip: s5start.skip,
      })
    );
    check(
      'scene 5 exposes the fast-forward control',
      /Fast-forward 10 epochs/.test(s5start.skip.label) &&
        s5start.skip.value === '10' &&
        s5start.skip.disabled === false,
      JSON.stringify(s5start.skip)
    );
    await shot('scene5-start');

    await click('#fast-forward');
    await sleep(350);
    const s5ff10 = await readState();
    check(
      'fast-forward advances exactly N epochs',
      s5ff10.plot.epoch === 10,
      'epoch=' + s5ff10.plot.epoch
    );

    await cdp.evaluate(
      `(() => { const select = document.getElementById('skip'); select.value = '50'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`
    );
    await click('#fast-forward');
    await sleep(350);
    const s5finalState = await readState();
    check(
      'fast-forward clamps at the final epoch',
      s5finalState.plot.epoch === 60,
      'epoch=' + s5finalState.plot.epoch
    );
    check(
      'scene 5 ends with the loss down and every point correct',
      s5finalState.plot.loss < 0.4 &&
        s5finalState.plot.accuracy === 4 &&
        s5finalState.plot.predictions.length === 4 &&
        s5finalState.plot.boundarySegments > 20,
      JSON.stringify(s5finalState.plot)
    );
    check(
      'scene 5 readout shows the trained epoch and loss',
      s5finalState.readout.stats.some(
        (stat) => stat.label === 'epoch' && stat.value === '60 / 60'
      ) &&
        s5finalState.readout.stats.some(
          (stat) => stat.label === 'accuracy' && stat.value === '4 / 4'
        ),
      JSON.stringify(s5finalState.readout.stats)
    );
    check(
      'scene 5 final frame is the end of the timeline',
      s5finalState.stepDisabled === true &&
        s5finalState.skip.disabled === true &&
        s5finalState.plot.loss > 0.29 &&
        s5finalState.plot.loss < 0.31,
      'stepDisabled=' +
        s5finalState.stepDisabled +
        ' skipDisabled=' +
        s5finalState.skip.disabled +
        ' loss=' +
        s5finalState.plot.loss
    );
    await shot('scene5-learned');

    check(
      'scene 5 final caption is the Chinese narration',
      /训练结束/.test(s5finalState.caption) && /四个点全对/.test(s5finalState.caption),
      s5finalState.caption
    );

    const lossHistory = await cdp.evaluate(
      'globalThis.MGViz.app.scenes[4].losses'
    );
    evidence.scene5Losses = lossHistory.map((loss) => Number(loss.toFixed(6)));
    check(
      'scene 5 loss history is monotonic and ends below 40% of its start',
      lossHistory.length === 61 &&
        lossHistory.every(
          (loss, index) => index === 0 || loss <= lossHistory[index - 1] + 1e-12
        ) &&
        lossHistory[60] < lossHistory[0] * 0.4,
      'first=' +
        lossHistory[0].toFixed(4) +
        ' last=' +
        lossHistory[60].toFixed(4)
    );
    evidence.states.scene5 = {
      start: s5start,
      fastForward10: s5ff10,
      final: s5finalState,
    };

    // Channel B + audio-driven durations: load the committed sample manifest
    // through the page's own handle, then turn narration on.
    const sampleManifest = JSON.parse(
      readFileSync(
        join(root, 'test/fixtures/narration/zh/manifest.json'),
        'utf8'
      )
    );
    const browserManifest = {
      segments: sampleManifest.segments.map((segment) => ({
        ...segment,
        src: pathToFileURL(
          join(root, 'test/fixtures/narration/zh', segment.src)
        ).href,
      })),
    };
    const manifestAccepted = await cdp.evaluate(
      'globalThis.MGViz.app.setNarrationManifest(' +
        JSON.stringify(browserManifest) +
        ')'
    );
    await click('#narration');
    await sleep(500);
    const timed = await readState();
    const timedInfo = await cdp.evaluate(
      `({
        duration: globalThis.MGViz.app.timeline.duration,
        sceneDurations: globalThis.MGViz.app.timeline.scenes.map((scene) => scene.duration),
        firstKeyframeTimes: globalThis.MGViz.app.timeline.scenes[0].keyframes.map((keyframe) => keyframe.at),
        progressMax: document.getElementById('progress').max
      })`
    );
    evidence.states.narrationTimed = { state: timed, info: timedInfo };
    check(
      'the channel B manifest stretches the audio-driven timeline',
      manifestAccepted === true &&
        Math.abs(timedInfo.duration - 113.4) < 1e-6 &&
        Math.abs(timedInfo.sceneDurations[0] - 15.1) < 1e-6 &&
        Math.abs(timedInfo.sceneDurations[1] - 16.3) < 1e-6 &&
        Math.abs(Number(timedInfo.progressMax) - 113.4) < 1e-6 &&
        /113\.4s/.test(timed.timeLabel),
      JSON.stringify({ manifestAccepted, info: timedInfo, timeLabel: timed.timeLabel })
    );

    await seek(0);
    await sleep(400);
    const timedFrame0 = await readState();
    evidence.states.narrationTimedFrame0 = timedFrame0;
    const sampleText = await zhFrame(1, 0);
    check(
      'loaded audio segments play as channel B on keyframe entry',
      timedFrame0.narration.channel === 'audio' &&
        timedFrame0.narration.last &&
        timedFrame0.narration.last.text === sampleText &&
        timedFrame0.caption === sampleText,
      JSON.stringify(timedFrame0.narration)
    );

    await click('#step');
    const timedStep = await readState();
    check(
      'Step follows the audio-driven keyframe times',
      timedStep.keyframe === 1 && Math.abs(timedStep.time - 2.8) < 1e-6,
      'keyframe=' + timedStep.keyframe + ' time=' + timedStep.time
    );

    await seek(20);
    const timedSeek = await readState();
    check(
      'the scrubber and time label use the recomputed total',
      Math.abs(timedSeek.time - 20) < 1e-6 &&
        /20\.0s \/ 113\.4s/.test(timedSeek.timeLabel),
      timedSeek.timeLabel
    );
    await shot('narration-timed');

    await click('#narration');
    await sleep(300);
    const timedOff = await readState();
    const restoredDuration = await cdp.evaluate(
      'globalThis.MGViz.app.timeline.duration'
    );
    check(
      'turning narration off restores the original timing',
      timedOff.narration.enabled === false &&
        Math.abs(restoredDuration - 110.5) < 1e-6 &&
        /110\.5s$/.test(timedOff.timeLabel),
      JSON.stringify({
        duration: restoredDuration,
        timeLabel: timedOff.timeLabel,
      })
    );

    check(
      'no page exceptions or console errors',
      evidence.consoleErrors.length === errorsBeforeLoad,
      JSON.stringify(evidence.consoleErrors)
    );
    check(
      'no external network requests (no CDN)',
      evidence.externalRequests.length === 0,
      evidence.externalRequests.join(', ')
    );
  } catch (error) {
    failures.push('harness: ' + (error instanceof Error ? error.stack : String(error)));
    console.error(error);
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        // ignore
      }
    }
    chrome.kill('SIGTERM');
    await sleep(400);
    if (!chrome.killed) chrome.kill('SIGKILL');
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Chrome may still hold a lock; /tmp cleans this up eventually.
    }
    evidence.failures = failures;
    saveEvidence();
  }

  console.log(
    '\n' +
      (failures.length === 0
        ? 'All browser checks passed.'
        : failures.length + ' browser check(s) failed.')
  );
  console.log('Evidence: docs/evidence/browser-check.json');
  if (stderr.includes('DevTools listening')) {
    console.log('Chrome DevTools endpoint was ready.');
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
