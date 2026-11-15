/*
 * Wires the timeline engine to the DOM: builds the five scenes, renders the
 * active scene's graph (or training plot) when a keyframe changes, and drives
 * play / pause / step / speed / seek / fast-forward.
 *
 * Narration is layered on top: each keyframe enters with its Chinese line in
 * the caption (the English originals live in narration/en.json), and when the
 * 🔊 switch is on the line is spoken (channel A) or played from a
 * pre-synthesised segment (channel B). A loaded manifest also stretches the
 * affected keyframe durations so audio always fits.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  const AUDIO_BASE = 'assets/narration/zh/';

  function formatSeconds(value) {
    return value.toFixed(1) + 's';
  }

  // <svg> has no HTMLElement.hidden property, so toggle the attribute.
  function setHidden(element, hidden) {
    if (hidden) element.setAttribute('hidden', '');
    else element.removeAttribute('hidden');
  }

  function init() {
    const {
      Timeline,
      createScene1,
      createScene2,
      createScene3,
      createScene4,
      createScene5,
      renderGraph,
      renderTrainingView,
      NarrationController,
      createSpeechEngine,
      createAudioEngine,
      loadNarrationManifest,
      parseManifest,
      scenesForNarration,
    } = global.MGViz;
    const baseScenes = [
      createScene1(),
      createScene2(),
      createScene3(),
      createScene4(),
      createScene5(),
    ];
    const narrationEntries = Array.isArray(global.MGViz.narrationZh)
      ? global.MGViz.narrationZh
      : [];
    const storage = (() => {
      try {
        return global.localStorage;
      } catch (error) {
        return null;
      }
    })();

    const svg = document.getElementById('graph');
    const plot = document.getElementById('plot');
    const readout = document.getElementById('readout');
    const playButton = document.getElementById('play');
    const playLabel = document.getElementById('play-label');
    const playIcon = document.getElementById('play-icon');
    const stepButton = document.getElementById('step');
    const speedSelect = document.getElementById('speed');
    const progress = document.getElementById('progress');
    const timeLabel = document.getElementById('time');
    const sceneTitle = document.getElementById('scene-title');
    const sceneEyebrow = document.getElementById('scene-eyebrow');
    const stepBadge = document.getElementById('step-badge');
    const caption = document.getElementById('caption');
    const stepsRail = document.getElementById('steps');
    const skipControls = document.getElementById('skip-controls');
    const skipSelect = document.getElementById('skip');
    const fastForwardButton = document.getElementById('fast-forward');
    const narrationButton = document.getElementById('narration');
    const narrationLabel = document.getElementById('narration-label');

    let manifest = null;
    let timeline = null;
    let scenes = baseScenes;
    let lastSceneIndex = -1;
    let lastKeyframeIndex = -1;
    let stepChips = [];
    const trainingSceneIndex = baseScenes.findIndex(
      (scene) => scene.kind === 'training'
    );

    const narrator = new NarrationController({
      narration: narrationEntries,
      speech: createSpeechEngine(global),
      audio: createAudioEngine(global, AUDIO_BASE),
      storage,
      onEnabledChange: () => {
        // Audio-driven durations depend on the toggle, so rebuild when it moves.
        rebuildTimeline();
        syncNarrationUi();
      },
    });

    function syncNarrationUi() {
      narrationButton.setAttribute('aria-pressed', String(narrator.enabled));
      narrationButton.classList.toggle('is-on', narrator.enabled);
      narrationLabel.textContent = narrator.enabled ? '配音 开' : '配音 关';
      document.body.dataset.narration = String(narrator.enabled);
    }

    function buildSteps(sceneData, offset) {
      stepsRail.textContent = '';
      stepChips = sceneData.keyframes.map((keyframe, index) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'step-chip';
        chip.dataset.index = String(index);
        chip.innerHTML =
          '<span class="step-number">' +
          (index + 1) +
          '</span><span class="step-label"></span>';
        chip.querySelector('.step-label').textContent =
          keyframe.label || 'step ' + (index + 1);
        chip.setAttribute(
          'aria-label',
          'Go to step ' + (index + 1) + ': ' + (keyframe.label || keyframe.at + 's')
        );
        chip.addEventListener('click', () => {
          timeline.pause();
          timeline.seek(offset + keyframe.at);
        });
        stepsRail.appendChild(chip);
        return chip;
      });
    }

    function renderReadout(model) {
      readout.textContent = '';
      if (!model) {
        setHidden(readout, true);
        return;
      }
      setHidden(readout, false);
      const title = document.createElement('h3');
      title.textContent = model.title || '';
      readout.appendChild(title);

      if (Array.isArray(model.stats) && model.stats.length > 0) {
        const stats = document.createElement('div');
        stats.className = 'readout-stats';
        for (const stat of model.stats) {
          const item = document.createElement('span');
          item.className = 'readout-stat';
          const label = document.createElement('span');
          label.className = 'readout-stat-label';
          label.textContent = stat.label;
          const value = document.createElement('span');
          value.className = 'readout-stat-value';
          value.textContent = stat.value;
          item.append(label, value);
          stats.appendChild(item);
        }
        readout.appendChild(stats);
      }

      if (model.table) {
        const table = document.createElement('table');
        table.className = 'readout-table';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const column of model.table.columns) {
          const th = document.createElement('th');
          th.textContent = column;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const row of model.table.rows) {
          const tr = document.createElement('tr');
          for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        readout.appendChild(table);
      }
    }

    function render(snapshot) {
      const sceneData = timeline.scenes[snapshot.sceneIndex];
      if (snapshot.sceneIndex !== lastSceneIndex) {
        buildSteps(sceneData, snapshot.offset);
        lastSceneIndex = snapshot.sceneIndex;
        lastKeyframeIndex = -1;
      }

      const isTraining = sceneData.kind === 'training';
      setHidden(svg, isTraining);
      setHidden(plot, !isTraining);
      setHidden(skipControls, snapshot.sceneIndex !== trainingSceneIndex);

      if (snapshot.keyframeIndex !== lastKeyframeIndex) {
        const state = snapshot.state;
        if (isTraining) {
          renderTrainingView(plot, sceneData, state);
        } else {
          renderGraph(svg, sceneData.graph, {
            visible: state.visible,
            showGrad: Boolean(state.showGrad),
            grads: state.grads,
            active: state.focus || null,
            activeEdges: state.activeEdges,
            edgeLabels: state.edgeLabels,
            topo: state.topo,
            backward: Boolean(state.backward),
            data: state.data,
            updates: state.updates,
          });
        }
        const sceneNumber = snapshot.sceneIndex + 1;
        const narrationText = narrator.textFor(
          sceneNumber,
          snapshot.keyframeIndex
        );
        caption.textContent = narrationText || state.caption || '';
        document.body.dataset.captionLang = narrationText ? 'zh' : 'en';
        renderReadout(state.readout || null);
        narrator.onKeyframe(sceneNumber, snapshot.keyframeIndex);
        stepChips.forEach((chip, index) => {
          chip.classList.toggle('is-active', index === snapshot.keyframeIndex);
          chip.classList.toggle('is-done', index < snapshot.keyframeIndex);
        });
        // Long rails (scene 5 has 61 epochs) should follow the active chip.
        const activeChip = stepChips[snapshot.keyframeIndex];
        if (activeChip) {
          stepsRail.scrollLeft = Math.max(
            0,
            activeChip.offsetLeft -
              stepsRail.clientWidth / 2 +
              activeChip.offsetWidth / 2
          );
        }
        lastKeyframeIndex = snapshot.keyframeIndex;
      }

      sceneTitle.textContent = snapshot.sceneTitle;
      if (sceneEyebrow) {
        sceneEyebrow.textContent = 'scene ' + (snapshot.sceneIndex + 1);
      }
      stepBadge.textContent =
        'KEYFRAME ' +
        (snapshot.keyframeIndex + 1) +
        ' / ' +
        snapshot.keyframeCount;
      playLabel.textContent = snapshot.playing ? 'Pause' : 'Play';
      playIcon.textContent = snapshot.playing ? '\u275a\u275a' : '\u25b6';
      playButton.setAttribute('aria-pressed', String(snapshot.playing));
      playButton.classList.toggle('is-playing', snapshot.playing);
      stepButton.disabled = !snapshot.canStep;
      speedSelect.value = String(snapshot.speed);
      progress.value = String(snapshot.time);
      progress.setAttribute(
        'aria-valuetext',
        formatSeconds(snapshot.time) + ' of ' + formatSeconds(snapshot.duration)
      );
      timeLabel.textContent =
        formatSeconds(snapshot.time) + ' / ' + formatSeconds(snapshot.duration);

      const trainingState = isTraining ? snapshot.state : null;
      if (trainingState) {
        fastForwardButton.disabled =
          snapshot.keyframeIndex >= snapshot.keyframeCount - 1;
        fastForwardButton.textContent =
          'Fast-forward ' + skipSelect.value + ' epochs';
      }

      document.body.dataset.scene = snapshot.sceneId;
      document.body.dataset.keyframe = String(snapshot.keyframeIndex);
      document.body.dataset.playing = String(snapshot.playing);
      document.body.dataset.speed = String(snapshot.speed);
      document.body.dataset.time = snapshot.time.toFixed(2);
      document.body.dataset.narrationChannel = narrator.last
        ? narrator.last.channel
        : '';
      if (trainingState) {
        document.body.dataset.epoch = String(trainingState.epoch);
        document.body.dataset.loss = String(trainingState.loss);
      } else {
        delete document.body.dataset.epoch;
        delete document.body.dataset.loss;
      }
    }

    /**
     * Swaps the timeline's scenes for audio-driven ones (or back), keeping the
     * viewer on the same keyframe and preserving play/speed.
     */
    function rebuildTimeline() {
      const snapshot = timeline.snapshot();
      const nextScenes = scenesForNarration(
        baseScenes,
        manifest,
        narrator.enabled
      );
      const next = new Timeline({ scenes: nextScenes });
      const targetScene = next.scenes[snapshot.sceneIndex];
      const frameIndex = Math.min(
        snapshot.keyframeIndex,
        targetScene.keyframes.length - 1
      );
      let offset = 0;
      for (let index = 0; index < snapshot.sceneIndex; index++) {
        offset += next.scenes[index].duration;
      }
      timeline.destroy();
      timeline = next;
      scenes = nextScenes;
      progress.max = String(timeline.duration);
      lastSceneIndex = -1;
      lastKeyframeIndex = -1;
      if (snapshot.ended) {
        timeline.seek(timeline.duration);
      } else {
        timeline.seek(offset + targetScene.keyframes[frameIndex].at);
      }
      timeline.setSpeed(snapshot.speed);
      if (!snapshot.ended && snapshot.playing) timeline.play();
      timeline.subscribe(render);
      if (global.MGViz.app) {
        global.MGViz.app.timeline = timeline;
        global.MGViz.app.scenes = scenes;
        global.MGViz.app.narration = narrator;
      }
      syncNarrationUi();
      render(timeline.snapshot());
    }

    /**
     * Evidence/test handle: point the page at a manifest without a reload.
     * The same path the async loader takes, so channel B + audio timing can be
     * exercised from the browser harness with the committed sample.
     */
    function setNarrationManifest(raw) {
      manifest = raw ? parseManifest(raw) : null;
      narrator.setManifest(manifest);
      if (narrator.enabled) rebuildTimeline();
      return Boolean(manifest);
    }

    function fastForward() {
      if (trainingSceneIndex < 0) return;
      const sceneData = scenes[trainingSceneIndex];
      const snapshot = timeline.snapshot();
      if (snapshot.sceneId !== sceneData.id) return;
      const count = Number(skipSelect.value) || 1;
      const target = Math.min(
        snapshot.keyframeIndex + count,
        sceneData.keyframes.length - 1
      );
      let offset = 0;
      for (let index = 0; index < trainingSceneIndex; index++) {
        offset += scenes[index].duration;
      }
      timeline.pause();
      timeline.seek(offset + sceneData.keyframes[target].at);
    }

    timeline = new Timeline({ scenes: baseScenes });
    progress.max = String(timeline.duration);

    playButton.addEventListener('click', () => timeline.toggle());
    stepButton.addEventListener('click', () => timeline.step());
    fastForwardButton.addEventListener('click', fastForward);
    narrationButton.addEventListener('click', () => narrator.toggle());
    skipSelect.addEventListener('change', () => {
      fastForwardButton.textContent =
        'Fast-forward ' + skipSelect.value + ' epochs';
    });
    speedSelect.addEventListener('change', () => {
      timeline.setSpeed(Number(speedSelect.value));
    });
    progress.addEventListener('input', () => {
      timeline.seek(Number(progress.value));
    });
    document.addEventListener('keydown', (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('button, input, select, textarea, a')
      ) {
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        timeline.toggle();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        timeline.step();
      }
    });

    syncNarrationUi();
    timeline.subscribe(render);
    render(timeline.snapshot());
    // Debug/evidence handle: the browser harness reads scene durations and
    // keyframe times from the live timeline instead of hard-coding them.
    global.MGViz.app = {
      timeline,
      scenes,
      narration: narrator,
      setNarrationManifest,
    };
    document.documentElement.dataset.ready = 'true';

    // Channel B is preferred when its manifest can be loaded. On file:// there
    // is no fetch, so a manifest classic script can inject MGViz.narrationManifest.
    loadNarrationManifest({ path: 'assets/narration/zh/manifest.json' })
      .then((loaded) => {
        if (!loaded) return;
        manifest = loaded;
        narrator.setManifest(loaded);
        if (narrator.enabled) rebuildTimeline();
      })
      .catch(() => {
        // No manifest is the normal channel-A path.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(globalThis);
