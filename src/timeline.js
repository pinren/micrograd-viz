/*
 * Tiny scenes + keyframes "video" engine.
 *
 * A scene is `{ id, title, duration, keyframes }`. A keyframe is
 * `{ at, label?, state }`; `state` is plain data (visible node ids, caption,
 * showGrad) so the picture is fully determined by the current time — stepping
 * backward is free, and the whole engine is testable without a browser.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /** Returns the last keyframe at or before `time` (clamped to the ends). */
  function sampleKeyframes(keyframes, time) {
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
      throw new TypeError('sampleKeyframes needs at least one keyframe');
    }
    let lo = 0;
    let hi = keyframes.length - 1;
    let index = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (keyframes[mid].at <= time) {
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const keyframe = keyframes[index];
    const next = keyframes[index + 1] || null;
    const segmentProgress = next
      ? clamp((time - keyframe.at) / (next.at - keyframe.at), 0, 1)
      : 1;
    return { index, keyframe, next, segmentProgress };
  }

  /** Locates the scene containing `time`; the total duration maps to the end. */
  function sceneAt(scenes, time) {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new TypeError('sceneAt needs at least one scene');
    }
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const t = clamp(time, 0, total);
    let offset = 0;
    for (let index = 0; index < scenes.length; index++) {
      const scene = scenes[index];
      const end = offset + scene.duration;
      const isLast = index === scenes.length - 1;
      if (t < end || isLast) {
        return {
          sceneIndex: index,
          scene,
          offset,
          localTime: isLast ? Math.min(t - offset, scene.duration) : t - offset,
        };
      }
      offset = end;
    }
    // Unreachable, but keeps the function total.
    return { sceneIndex: scenes.length - 1, scene: scenes[scenes.length - 1], offset: 0, localTime: 0 };
  }

  /** Absolute time of the next keyframe after `time`, across all scenes. */
  function nextKeyframeTime(scenes, time) {
    let best = null;
    let offset = 0;
    for (const scene of scenes) {
      for (const keyframe of scene.keyframes) {
        const absolute = offset + keyframe.at;
        if (absolute > time + 1e-6 && (best === null || absolute < best)) {
          best = absolute;
        }
      }
      offset += scene.duration;
    }
    return best;
  }

  class Timeline {
    /**
     * @param {object} options
     * @param {object[]} options.scenes
     * @param {(snapshot: object) => void} [options.onUpdate]
     */
    constructor(options) {
      const opts = options || {};
      if (!Array.isArray(opts.scenes) || opts.scenes.length === 0) {
        throw new TypeError('Timeline needs at least one scene');
      }
      for (const scene of opts.scenes) {
        if (!scene.id || !(scene.duration > 0) || !Array.isArray(scene.keyframes)) {
          throw new TypeError('Each scene needs an id, a positive duration and keyframes');
        }
      }
      this.scenes = opts.scenes.slice();
      this.duration = this.scenes.reduce((sum, scene) => sum + scene.duration, 0);
      this.time = 0;
      this.speed = 1;
      this.playing = false;
      this._listeners = new Set();
      this._rafId = null;
      this._lastTimestamp = null;
      this._loop = this._loop.bind(this);
      if (typeof opts.onUpdate === 'function') this.subscribe(opts.onUpdate);
    }

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('subscribe expects a function');
      }
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }

    snapshot() {
      const at = sceneAt(this.scenes, this.time);
      const sample = sampleKeyframes(at.scene.keyframes, at.localTime);
      const next = nextKeyframeTime(this.scenes, this.time);
      return {
        time: this.time,
        duration: this.duration,
        playing: this.playing,
        speed: this.speed,
        ended: this.time >= this.duration,
        canStep: next !== null,
        nextKeyframe: next,
        sceneIndex: at.sceneIndex,
        sceneId: at.scene.id,
        sceneTitle: at.scene.title,
        sceneDuration: at.scene.duration,
        offset: at.offset,
        localTime: at.localTime,
        keyframeIndex: sample.index,
        keyframeCount: at.scene.keyframes.length,
        keyframeAt: sample.keyframe.at,
        keyframeLabel: sample.keyframe.label || '',
        segmentProgress: sample.segmentProgress,
        state: sample.keyframe.state || {},
      };
    }

    _notify() {
      if (this._listeners.size === 0) return;
      const snapshot = this.snapshot();
      for (const listener of this._listeners) listener(snapshot);
    }

    play() {
      if (this.playing) return;
      if (this.time >= this.duration) this.time = 0;
      this.playing = true;
      this._lastTimestamp = null;
      this._notify();
      this._startClock();
    }

    pause() {
      if (!this.playing) return;
      this.playing = false;
      this._stopClock();
      this._notify();
    }

    toggle() {
      if (this.playing) this.pause();
      else this.play();
    }

    /** Jumps to the next keyframe boundary and pauses. */
    step() {
      this.playing = false;
      this._stopClock();
      const next = nextKeyframeTime(this.scenes, this.time);
      if (next !== null) this.time = clamp(next, 0, this.duration);
      this._notify();
    }

    setSpeed(speed) {
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
        throw new TypeError('speed must be a positive number');
      }
      this.speed = speed;
      this._notify();
    }

    seek(time) {
      this.time = clamp(time, 0, this.duration);
      if (this.time >= this.duration) {
        this.playing = false;
        this._stopClock();
      }
      this._notify();
    }

    /**
     * Advances the timeline by real seconds, scaled by the current speed.
     * Public so tests (and any future external clock) can drive it directly.
     */
    advance(dt) {
      if (!this.playing || !(dt > 0)) return this.snapshot();
      this.time = clamp(this.time + dt * this.speed, 0, this.duration);
      if (this.time >= this.duration) {
        this.playing = false;
        this._stopClock();
      }
      this._notify();
      return this.snapshot();
    }

    _startClock() {
      // Node has no rAF; tests drive advance() themselves.
      if (typeof global.requestAnimationFrame !== 'function') return;
      if (this._rafId !== null) return;
      this._rafId = global.requestAnimationFrame(this._loop);
    }

    _stopClock() {
      if (this._rafId === null) return;
      if (typeof global.cancelAnimationFrame === 'function') {
        global.cancelAnimationFrame(this._rafId);
      }
      this._rafId = null;
    }

    _loop(timestamp) {
      this._rafId = null;
      if (!this.playing) return;
      if (this._lastTimestamp === null) this._lastTimestamp = timestamp;
      const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
      this._lastTimestamp = timestamp;
      this.advance(dt);
      if (this.playing) this._startClock();
    }

    destroy() {
      this.playing = false;
      this._stopClock();
      this._listeners.clear();
    }
  }

  global.MGViz = Object.assign(global.MGViz || {}, {
    Timeline,
    sampleKeyframes,
    sceneAt,
    nextKeyframeTime,
    clamp,
  });
})(globalThis);
