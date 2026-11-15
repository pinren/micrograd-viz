/*
 * Narration: the Chinese script, the two playback channels, and the
 * audio-driven keyframe timing.
 *
 * The page is a "video" made of HTML. Each keyframe carries one caption; this
 * module maps it to a spoken line, decides whether to play a pre-synthesised
 * audio segment (channel B) or ask the browser to speak (channel A), and
 * stretches keyframe durations so a segment always fits inside its frame.
 *
 * Everything here is injectable (speech engine, audio engine, storage) so the
 * Node tests exercise the exact code the page runs without a browser.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'mgviz.narration';
  const AUDIO_PADDING = 0.8;
  const MANIFEST_PATH = 'assets/narration/zh/manifest.json';
  const AUDIO_BASE = 'assets/narration/zh/';

  function keyOf(scene, keyframe) {
    return scene + ':' + keyframe;
  }

  /**
   * Turns a `narration/zh.json`-shaped array into a lookup keyed by
   * `scene:keyframe`. Throws on malformed or duplicate entries so a broken
   * script fails loudly instead of silently muting a frame.
   */
  function indexNarration(entries) {
    const index = new Map();
    if (entries === null || entries === undefined) return index;
    if (!Array.isArray(entries)) {
      throw new TypeError('narration entries must be an array');
    }
    for (const entry of entries) {
      if (
        !entry ||
        !Number.isInteger(entry.scene) ||
        !Number.isInteger(entry.keyframe) ||
        typeof entry.text !== 'string' ||
        entry.text.length === 0
      ) {
        throw new TypeError('each narration entry needs scene, keyframe and text');
      }
      const key = keyOf(entry.scene, entry.keyframe);
      if (index.has(key)) {
        throw new TypeError('duplicate narration entry ' + key);
      }
      index.set(key, entry.text);
    }
    return index;
  }

  function narrationFor(index, scene, keyframe) {
    if (!index) return '';
    return index.get(keyOf(scene, keyframe)) || '';
  }

  /**
   * Normalises a manifest (`{ segments: [...] }` or a bare array). Each
   * segment is `{ scene, keyframe, src, duration }`, with scene numbers 1-based
   * and duration in seconds. Returns null for an empty manifest.
   */
  function parseManifest(raw) {
    if (raw === null || raw === undefined) return null;
    const segments = Array.isArray(raw) ? raw : raw.segments;
    if (!Array.isArray(segments)) {
      throw new TypeError('manifest needs a segments array');
    }
    const index = new Map();
    for (const segment of segments) {
      if (
        !segment ||
        !Number.isInteger(segment.scene) ||
        !Number.isInteger(segment.keyframe) ||
        typeof segment.src !== 'string' ||
        segment.src.length === 0
      ) {
        throw new TypeError(
          'each manifest segment needs scene, keyframe and src'
        );
      }
      const duration = Number(segment.duration);
      if (!Number.isFinite(duration) || duration < 0) {
        throw new TypeError('manifest segment duration must be >= 0');
      }
      const key = keyOf(segment.scene, segment.keyframe);
      if (index.has(key)) {
        throw new TypeError('duplicate manifest segment ' + key);
      }
      index.set(key, {
        scene: segment.scene,
        keyframe: segment.keyframe,
        src: segment.src,
        duration,
      });
    }
    return { segments: index };
  }

  function manifestSegment(manifest, scene, keyframe) {
    if (!manifest) return null;
    return manifest.segments.get(keyOf(scene, keyframe)) || null;
  }

  /**
   * Rebuilds the scenes with audio-driven keyframe durations:
   *
   *   keyframe duration = max(original duration, audio duration + 0.8 s)
   *
   * Frames without a segment keep their original duration, so a partial
   * manifest only stretches the frames it covers. The input scenes are never
   * mutated; the result is a fresh array usable by a new Timeline.
   */
  function applyNarrationTiming(scenes, manifest) {
    if (!Array.isArray(scenes)) {
      throw new TypeError('applyNarrationTiming needs scenes');
    }
    return scenes.map((scene, sceneIndex) => {
      const sceneNumber = sceneIndex + 1;
      const keyframes = [];
      let at = 0;
      scene.keyframes.forEach((frame, keyframeIndex) => {
        const next = scene.keyframes[keyframeIndex + 1] || null;
        const natural = (next ? next.at : scene.duration) - frame.at;
        const segment = manifestSegment(manifest, sceneNumber, keyframeIndex);
        const duration = segment
          ? Math.max(natural, segment.duration + AUDIO_PADDING)
          : natural;
        keyframes.push(Object.assign({}, frame, { at }));
        at += duration;
      });
      return Object.assign({}, scene, { duration: at, keyframes });
    });
  }

  /**
   * The scenes the page should run: adapted timing only when a manifest is
   * present *and* narration is on; otherwise the base scenes untouched.
   */
  function scenesForNarration(scenes, manifest, enabled) {
    if (!Array.isArray(scenes)) {
      throw new TypeError('scenesForNarration needs scenes');
    }
    return enabled && manifest ? applyNarrationTiming(scenes, manifest) : scenes;
  }

  function readNarrationEnabled(storage) {
    try {
      if (!storage) return false;
      return storage.getItem(STORAGE_KEY) === 'on';
    } catch (error) {
      return false;
    }
  }

  function writeNarrationEnabled(storage, enabled) {
    try {
      if (!storage) return;
      storage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch (error) {
      // file:// origins can refuse storage; the toggle still works per visit.
    }
  }

  /** Channel A: the Web Speech API, Chinese voice, one utterance at a time. */
  function createSpeechEngine(win) {
    const synth = win && win.speechSynthesis;
    const Utterance = win && win.SpeechSynthesisUtterance;
    if (
      !synth ||
      typeof synth.speak !== 'function' ||
      typeof Utterance !== 'function'
    ) {
      return null;
    }
    return {
      speak(text) {
        if (typeof synth.cancel === 'function') synth.cancel();
        const utterance = new Utterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1;
        synth.speak(utterance);
        return utterance;
      },
      stop() {
        if (typeof synth.cancel === 'function') synth.cancel();
      },
    };
  }

  /** Channel B: a plain <audio>-equivalent element per keyframe segment. */
  function createAudioEngine(win, basePath) {
    const AudioCtor = win && win.Audio;
    if (typeof AudioCtor !== 'function') return null;
    const base = typeof basePath === 'string' && basePath ? basePath : '';
    const resolve = (src) =>
      /^(?:[a-z]+:)?\/\//i.test(src) ||
      src.startsWith('data:') ||
      src.startsWith('blob:') ||
      src.startsWith('/') ||
      src.startsWith('./') ||
      src.startsWith('../')
        ? src
        : base + src;
    let element = null;
    function stop() {
      if (!element) return;
      try {
        element.pause();
      } catch (error) {
        // A detached element is already stopped.
      }
      element = null;
    }
    return {
      play(src) {
        stop();
        element = new AudioCtor(resolve(src));
        element.preload = 'auto';
        const started = element.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => {});
        }
        return element;
      },
      stop,
      get element() {
        return element;
      },
    };
  }

  class NarrationController {
    constructor(options) {
      const opts = options || {};
      this.index = indexNarration(opts.narration || []);
      this.manifest = opts.manifest || null;
      this.speech = opts.speech || null;
      this.audio = opts.audio || null;
      this.storage = opts.storage || null;
      this.onEnabledChange =
        typeof opts.onEnabledChange === 'function'
          ? opts.onEnabledChange
          : null;
      this.enabled =
        opts.enabled === undefined
          ? readNarrationEnabled(this.storage)
          : Boolean(opts.enabled);
      this.last = null;
    }

    textFor(scene, keyframe) {
      return narrationFor(this.index, scene, keyframe);
    }

    setManifest(manifest) {
      this.manifest = manifest || null;
    }

    setEnabled(enabled) {
      const next = Boolean(enabled);
      if (next === this.enabled) return this.enabled;
      this.enabled = next;
      writeNarrationEnabled(this.storage, next);
      if (!next) this.stop();
      if (this.onEnabledChange) this.onEnabledChange(next);
      return this.enabled;
    }

    toggle() {
      return this.setEnabled(!this.enabled);
    }

    /**
     * Called whenever the page enters a keyframe (play, Step, scrub or a
     * keyframe chip). Plays channel B when the frame has a segment, otherwise
     * falls back to channel A; stops everything when narration is off or the
     * frame has no script.
     */
    onKeyframe(scene, keyframe) {
      const text = this.textFor(scene, keyframe);
      if (!this.enabled || !text) {
        this.stop();
        return null;
      }
      const segment = manifestSegment(this.manifest, scene, keyframe);
      let channel = 'none';
      if (segment && this.audio) {
        if (this.speech) this.speech.stop();
        this.audio.play(segment.src);
        channel = 'audio';
      } else if (this.speech) {
        this.speech.speak(text);
        channel = 'speech';
      }
      this.last = { scene, keyframe, text, channel };
      return this.last;
    }

    stop() {
      if (this.speech) this.speech.stop();
      if (this.audio) this.audio.stop();
      this.last = null;
    }
  }

  /**
   * Channel B manifest loading. A browser classic script can expose
   * `MGViz.narrationManifest` (needed on file://, where fetch of a local JSON
   * file is blocked); otherwise the manifest is fetched over http(s).
   */
  async function loadNarrationManifest(options) {
    const opts = options || {};
    const win =
      opts.window || (typeof globalThis === 'object' ? globalThis : null);
    const injected = win && win.MGViz && win.MGViz.narrationManifest;
    if (injected) return parseManifest(injected);
    const location = opts.location || (win && win.location);
    if (location && location.protocol === 'file:') return null;
    const fetchImpl = opts.fetch || (win && win.fetch);
    if (typeof fetchImpl !== 'function') return null;
    try {
      const response = await fetchImpl(opts.path || MANIFEST_PATH);
      if (!response || !response.ok) return null;
      return parseManifest(await response.json());
    } catch (error) {
      return null;
    }
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    NarrationController,
    AUDIO_PADDING,
    AUDIO_BASE,
    MANIFEST_PATH,
    STORAGE_KEY,
    applyNarrationTiming,
    createAudioEngine,
    createSpeechEngine,
    indexNarration,
    loadNarrationManifest,
    manifestSegment,
    narrationFor,
    parseManifest,
    readNarrationEnabled,
    scenesForNarration,
    writeNarrationEnabled,
  });
})(globalThis);
