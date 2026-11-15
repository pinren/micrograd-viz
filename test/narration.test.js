import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import '../src/value.js';
import '../src/backward.js';
import '../src/graph.js';
import '../src/timeline.js';
import '../src/narration.js';
import '../src/train.js';
import '../src/nn.js';
import '../src/plot.js';
import '../src/scenes/scene1.js';
import '../src/scenes/scene2.js';
import '../src/scenes/scene3.js';
import '../src/scenes/scene4.js';
import '../src/scenes/scene5.js';
import '../narration/zh.js';

const {
  NarrationController,
  AUDIO_PADDING,
  Timeline,
  applyNarrationTiming,
  createAudioEngine,
  createSpeechEngine,
  createScene1,
  createScene2,
  createScene3,
  createScene4,
  createScene5,
  indexNarration,
  loadNarrationManifest,
  narrationFor,
  parseManifest,
  readNarrationEnabled,
  scenesForNarration,
  writeNarrationEnabled,
} = globalThis.MGViz;

function readJson(relativePath) {
  return JSON.parse(
    readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8')
  );
}

const zh = readJson('narration/zh.json');
const en = readJson('narration/en.json');
const manifestJson = readJson('test/fixtures/narration/zh/manifest.json');
const manifest = parseManifest(manifestJson);

function createSeries() {
  return [
    createScene1(),
    createScene2(),
    createScene3(),
    createScene4(),
    createScene5(),
  ];
}

function keyOf(scene, keyframe) {
  return scene + ':' + keyframe;
}

const byKey = new Map(zh.map((entry) => [keyOf(entry.scene, entry.keyframe), entry.text]));

function narrationText(scene, keyframe) {
  return byKey.get(keyOf(scene, keyframe)) || '';
}

function sentences(text) {
  return text
    .split(/(?<=[。！？])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function createStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createSpeechMock() {
  const calls = { spoke: [], stopped: 0 };
  return {
    calls,
    speak(text) {
      calls.spoke.push(text);
    },
    stop() {
      calls.stopped++;
    },
  };
}

function createAudioMock() {
  const calls = { played: [], stopped: 0 };
  return {
    calls,
    play(src) {
      calls.played.push(src);
    },
    stop() {
      calls.stopped++;
    },
  };
}

test('zh.json covers every keyframe of all five scenes exactly once', () => {
  const scenes = createSeries();
  const expected = [];
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    scenes[sceneIndex].keyframes.forEach((keyframe, keyframeIndex) => {
      expected.push(keyOf(sceneIndex + 1, keyframeIndex));
    });
  }
  const actual = zh.map((entry) => keyOf(entry.scene, entry.keyframe));

  assert.deepEqual(actual, expected);
  assert.equal(zh.length, 101);
  assert.doesNotThrow(() => indexNarration(zh));
  assert.equal(narrationFor(indexNarration(zh), 5, 60), narrationText(5, 60));
});

test('narration speaks in at most two sentences of at most 25 characters each', () => {
  for (const entry of zh) {
    const lines = sentences(entry.text);
    assert.ok(
      lines.length >= 1 && lines.length <= 2,
      'too many sentences at ' + keyOf(entry.scene, entry.keyframe)
    );
    for (const line of lines) {
      assert.ok(
        [...line].length <= 25,
        'sentence too long at ' +
          keyOf(entry.scene, entry.keyframe) +
          ': ' +
          line +
          ' (' +
          [...line].length +
          ')'
      );
    }
    assert.match(entry.text, /[。！？]$/);
    assert.doesNotMatch(entry.text, /\s{2,}/);
  }
});

test('jargon is introduced with a plain-language comparison', () => {
  assert.match(narrationText(1, 0), /梯度/);
  assert.match(narrationText(1, 0), /路标/);
  assert.match(narrationText(1, 5), /反向传播/);
  assert.match(narrationText(1, 5), /从结果倒着走/);
  assert.match(narrationText(1, 5), /链式法则/);
  assert.match(narrationText(1, 5), /接力/);
  assert.match(narrationText(3, 0), /神经元/);
  assert.match(narrationText(3, 0), /小算盘/);
  assert.match(narrationText(3, 2), /偏置/);
  assert.match(narrationText(3, 2), /像底数/);
  assert.match(narrationText(4, 0), /参数/);
  assert.match(narrationText(4, 0), /像旋钮/);
  assert.match(narrationText(4, 2), /损失/);
  assert.match(narrationText(4, 2), /误差打分/);
  assert.match(narrationText(4, 13), /学习率/);
  assert.match(narrationText(4, 13), /每步走多大/);
});

test('numbers are written the way they are spoken', () => {
  for (const entry of zh) {
    assert.doesNotMatch(
      entry.text,
      /[0-9]+\.[0-9]+/,
      'decimal digits at ' + keyOf(entry.scene, entry.keyframe)
    );
  }
  assert.match(narrationText(4, 2), /零点二九/);
  assert.match(narrationText(4, 14), /零点一二/);
  assert.match(narrationText(5, 0), /一点三二/);
  assert.match(narrationText(5, 60), /零点三/);
  assert.match(narrationText(5, 59), /零点三/);
});

test('en.json archives the original English caption of every keyframe', () => {
  const expected = [];
  createSeries().forEach((scene, sceneIndex) => {
    scene.keyframes.forEach((keyframe, keyframeIndex) => {
      expected.push({
        scene: sceneIndex + 1,
        keyframe: keyframeIndex,
        text: keyframe.state.caption,
      });
    });
  });
  assert.deepEqual(en, expected);
});

test('narration/zh.js is the browser twin of narration/zh.json', () => {
  assert.deepEqual(globalThis.MGViz.narrationZh, zh);
});

test('audio-driven timing stretches only the covered keyframes', () => {
  const scenes = createSeries();
  const timed = applyNarrationTiming(scenes, manifest);

  // The base scenes are untouched.
  assert.deepEqual(
    scenes.map((scene) => scene.duration),
    [13, 15.5, 30, 27, 25]
  );
  assert.deepEqual(
    scenes[0].keyframes.map((keyframe) => keyframe.at),
    [0, 2, 4, 6, 8, 10.5]
  );

  // Scene 1: frame 0 grows 2 -> 2.8 s, frame 1 keeps 2 s (short audio),
  // frame 5 grows 2.5 -> 3.8 s.
  assert.deepEqual(
    timed[0].keyframes.map((keyframe) => keyframe.at),
    [0, 2.8, 4.8, 6.8, 8.8, 11.3]
  );
  assert.ok(Math.abs(timed[0].duration - 15.1) < 1e-9);
  // Scene 2: frame 0 grows 2.5 -> 3.3 s.
  assert.deepEqual(
    timed[1].keyframes.map((keyframe) => keyframe.at),
    [0, 3.3, 5.8, 8.3, 11.3, 14.3]
  );
  assert.ok(Math.abs(timed[1].duration - 16.3) < 1e-9);
  // Frames without a segment keep their original scene duration.
  assert.deepEqual(
    timed.slice(2).map((scene) => scene.duration),
    [30, 27, 25]
  );
  const total = timed.reduce((sum, scene) => sum + scene.duration, 0);
  assert.ok(Math.abs(total - 113.4) < 1e-9, 'total=' + total);
});

test('the timeline, Step and speed honour audio-driven durations', () => {
  const timed = applyNarrationTiming(createSeries(), manifest);
  const timeline = new Timeline({ scenes: timed });

  assert.ok(Math.abs(timeline.duration - 113.4) < 1e-9);
  timeline.seek(11.3); // last scene-1 frame
  timeline.step();
  assert.equal(timeline.snapshot().sceneId, 'scene-2');
  assert.ok(Math.abs(timeline.snapshot().time - 15.1) < 1e-9);
  assert.equal(timeline.snapshot().keyframeIndex, 0);

  timeline.setSpeed(2);
  timeline.play();
  timeline.advance(1.65); // 3.3 s of scene 2 at 2x
  timeline.pause();
  assert.equal(timeline.snapshot().sceneId, 'scene-2');
  assert.equal(timeline.snapshot().keyframeIndex, 1);
});

test('narration off or no manifest keeps the original durations', () => {
  const scenes = createSeries();
  const durations = [13, 15.5, 30, 27, 25];

  assert.deepEqual(
    scenesForNarration(scenes, manifest, false).map((scene) => scene.duration),
    durations
  );
  assert.deepEqual(
    scenesForNarration(scenes, null, true).map((scene) => scene.duration),
    durations
  );
  assert.deepEqual(
    scenesForNarration(scenes, null, false).map((scene) => scene.duration),
    durations
  );
  // No manifest means no adaptation, so the shared timeline stays 110.5 s.
  assert.equal(new Timeline({ scenes }).duration, 110.5);
});

test('the fixture manifest matches the committed sample WAV durations', () => {
  for (const segment of manifestJson.segments) {
    const buffer = readFileSync(
      new URL('../test/fixtures/narration/zh/' + segment.src, import.meta.url)
    );
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
    let offset = 12;
    let byteRate = null;
    let dataSize = null;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
      if (id === 'data') {
        dataSize = size;
        break;
      }
      offset += 8 + size + (size % 2);
    }
    assert.ok(byteRate > 0 && dataSize > 0, segment.src + ' is a PCM WAV');
    assert.ok(
      Math.abs(dataSize / byteRate - segment.duration) < 0.01,
      segment.src + ' duration matches the manifest'
    );
  }
  assert.equal(AUDIO_PADDING, 0.8);
});

test('the toggle defaults off and remembers the choice in localStorage', () => {
  const storage = createStorage();
  const speech = createSpeechMock();
  const narrator = new NarrationController({ narration: zh, storage, speech });

  assert.equal(narrator.enabled, false);
  assert.equal(readNarrationEnabled(storage), false);
  assert.equal(narrator.onKeyframe(1, 0), null);
  assert.equal(speech.calls.spoke.length, 0);

  narrator.toggle();
  assert.equal(narrator.enabled, true);
  assert.equal(storage.getItem('mgviz.narration'), 'on');
  assert.equal(readNarrationEnabled(storage), true);

  const restored = new NarrationController({ narration: zh, storage });
  assert.equal(restored.enabled, true);

  restored.toggle();
  assert.equal(restored.enabled, false);
  assert.equal(storage.getItem('mgviz.narration'), 'off');
  assert.equal(readNarrationEnabled(storage), false);

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readNarrationEnabled(broken), false);
  assert.doesNotThrow(() => writeNarrationEnabled(broken, true));
  assert.equal(new NarrationController({ narration: zh, storage: broken }).enabled, false);
  assert.equal(new NarrationController({ narration: zh, storage: createStorage({ 'mgviz.narration': 'yes' }) }).enabled, false);
});

test('channel A speaks the Chinese line on every keyframe entry', () => {
  const speech = createSpeechMock();
  const narrator = new NarrationController({
    narration: zh,
    storage: createStorage(),
    speech,
    enabled: true,
  });

  const first = narrator.onKeyframe(1, 0);
  assert.equal(first.channel, 'speech');
  assert.equal(first.text, narrationText(1, 0));
  assert.deepEqual(speech.calls.spoke, [narrationText(1, 0)]);

  narrator.setEnabled(false);
  assert.equal(narrator.last, null);
  assert.ok(speech.calls.stopped >= 1);
  assert.equal(narrator.onKeyframe(1, 1), null);
  assert.equal(speech.calls.spoke.length, 1);
});

test('channel B is preferred, with channel A as the per-frame fallback', () => {
  const speech = createSpeechMock();
  const audio = createAudioMock();
  const onEnabledChange = [];
  const narrator = new NarrationController({
    narration: zh,
    manifest,
    storage: createStorage(),
    speech,
    audio,
    enabled: true,
    onEnabledChange: (enabled) => onEnabledChange.push(enabled),
  });

  const covered = narrator.onKeyframe(1, 0);
  assert.equal(covered.channel, 'audio');
  assert.deepEqual(audio.calls.played, ['scene-1-0.wav']);
  assert.equal(speech.calls.spoke.length, 0);

  const uncovered = narrator.onKeyframe(1, 2);
  assert.equal(uncovered.channel, 'speech');
  assert.equal(speech.calls.spoke[0], narrationText(1, 2));

  narrator.toggle();
  assert.deepEqual(onEnabledChange, [false]);
  assert.equal(narrator.onKeyframe(1, 0), null);
  assert.ok(audio.calls.stopped >= 2);
  assert.equal(audio.calls.played.length, 1);
});

test('a missing speech engine or missing line never throws', () => {
  const narrator = new NarrationController({
    narration: zh,
    storage: createStorage(),
    enabled: true,
  });
  const last = narrator.onKeyframe(1, 0);
  assert.equal(last.channel, 'none');
  assert.equal(last.text, narrationText(1, 0));
  narrator.stop();
  assert.equal(narrator.last, null);

  const missing = new NarrationController({
    narration: [],
    storage: createStorage(),
    enabled: true,
  });
  assert.equal(missing.onKeyframe(1, 0), null);
});

test('speech and audio engines adapt the browser APIs', () => {
  assert.equal(createSpeechEngine(null), null);
  assert.equal(createSpeechEngine({}), null);
  assert.equal(createAudioEngine(null), null);

  const spoken = [];
  let cancelled = 0;
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const win = {
    speechSynthesis: {
      speak(utterance) {
        spoken.push(utterance);
      },
      cancel() {
        cancelled++;
      },
    },
    SpeechSynthesisUtterance: Utterance,
    Audio: class {
      constructor(src) {
        this.src = src;
        this.paused = false;
      }
      play() {
        this.paused = false;
        return { catch() {} };
      }
      pause() {
        this.paused = true;
      }
    },
  };
  const speech = createSpeechEngine(win);
  speech.speak(narrationText(2, 0));
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].lang, 'zh-CN');
  assert.equal(cancelled, 1);

  const audio = createAudioEngine(win, 'assets/narration/zh/');
  const element = audio.play('scene-1-0.wav');
  assert.equal(element.src, 'assets/narration/zh/scene-1-0.wav');
  assert.equal(element.paused, false);
  audio.stop();
  assert.equal(element.paused, true);

  const dataUri = 'data:audio/wav;base64,AAAA';
  assert.equal(audio.play(dataUri).src, dataUri);
  audio.stop();
});

test('manifest loading prefers an injected script and skips fetch on file://', async () => {
  assert.equal(await loadNarrationManifest({ location: { protocol: 'file:' }, fetch: () => {
    throw new Error('fetch must not run on file://');
  } }), null);

  const injected = await loadNarrationManifest({
    window: { MGViz: { narrationManifest: manifestJson } },
  });
  assert.ok(injected);
  assert.equal(manifestSegmentSrc(injected, 1, 0), 'scene-1-0.wav');

  let requested = null;
  const fetched = await loadNarrationManifest({
    location: { protocol: 'https:' },
    fetch: async (url) => {
      requested = url;
      return { ok: true, json: async () => manifestJson };
    },
  });
  assert.ok(fetched);
  assert.match(requested, /manifest\.json$/);

  assert.equal(
    await loadNarrationManifest({
      location: { protocol: 'https:' },
      fetch: async () => ({ ok: false, json: async () => null }),
    }),
    null
  );
  assert.equal(
    await loadNarrationManifest({
      location: { protocol: 'https:' },
      fetch: async () => {
        throw new Error('network down');
      },
    }),
    null
  );
});

function manifestSegmentSrc(parsed, scene, keyframe) {
  const key = keyOf(scene, keyframe);
  return parsed.segments.get(key).src;
}
