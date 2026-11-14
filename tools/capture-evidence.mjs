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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
      transform: group.getAttribute('transform'),
      active: group.classList.contains('is-active')
    }));
    const edges = [...svg.querySelectorAll('.edge')].map((group) => group.dataset.key);
    const play = document.getElementById('play');
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
      visibleNodes: svg.dataset.visibleNodes || '',
      showGradsDataset: svg.dataset.showGrads,
      ariaLabel: svg.getAttribute('aria-label'),
      viewBox: svg.getAttribute('viewBox'),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges
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
    await shot('seed-panel');

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
      /c = 10/.test(midState.caption),
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
      'Step is disabled after the last keyframe',
      finalState.stepDisabled === true
    );
    check(
      'final scene caption explains the chain rule',
      /a\.grad = b = -3/.test(finalState.caption) &&
        /b\.grad = a = 2/.test(finalState.caption),
      finalState.caption
    );
    await shot('scene1-gradients');

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
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
