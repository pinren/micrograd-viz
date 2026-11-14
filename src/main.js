/*
 * Wires the timeline engine to the DOM: builds the scene, renders the graph
 * when a keyframe changes, and drives play / pause / step / speed / seek.
 *
 * Browser classic script + importable ESM (see src/value.js for the reason).
 */
(function (global) {
  'use strict';

  function formatSeconds(value) {
    return value.toFixed(1) + 's';
  }

  function init() {
    const { Timeline, createScene1, renderGraph } = global.MGViz;
    const scene = createScene1();
    const timeline = new Timeline({ scenes: [scene] });

    const svg = document.getElementById('graph');
    const playButton = document.getElementById('play');
    const playLabel = document.getElementById('play-label');
    const playIcon = document.getElementById('play-icon');
    const stepButton = document.getElementById('step');
    const speedSelect = document.getElementById('speed');
    const progress = document.getElementById('progress');
    const timeLabel = document.getElementById('time');
    const sceneTitle = document.getElementById('scene-title');
    const stepBadge = document.getElementById('step-badge');
    const caption = document.getElementById('caption');
    const stepsRail = document.getElementById('steps');

    progress.max = String(timeline.duration);

    let lastSceneIndex = -1;
    let lastKeyframeIndex = -1;
    let stepChips = [];

    function buildSteps(sceneData) {
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
        chip.querySelector('.step-label').textContent = keyframe.label || 'step ' + (index + 1);
        chip.setAttribute(
          'aria-label',
          'Go to step ' + (index + 1) + ': ' + (keyframe.label || keyframe.at + 's')
        );
        chip.addEventListener('click', () => {
          timeline.pause();
          timeline.seek(keyframe.at);
        });
        stepsRail.appendChild(chip);
        return chip;
      });
    }

    function render(snapshot) {
      if (snapshot.sceneIndex !== lastSceneIndex) {
        buildSteps(timeline.scenes[snapshot.sceneIndex]);
        lastSceneIndex = snapshot.sceneIndex;
        lastKeyframeIndex = -1;
      }

      if (snapshot.keyframeIndex !== lastKeyframeIndex) {
        const state = snapshot.state;
        renderGraph(svg, scene.graph, {
          visible: state.visible,
          showGrad: Boolean(state.showGrad),
          active: state.focus || null,
        });
        caption.textContent = state.caption || '';
        stepChips.forEach((chip, index) => {
          chip.classList.toggle('is-active', index === snapshot.keyframeIndex);
          chip.classList.toggle('is-done', index < snapshot.keyframeIndex);
        });
        lastKeyframeIndex = snapshot.keyframeIndex;
      }

      sceneTitle.textContent = snapshot.sceneTitle;
      stepBadge.textContent =
        'KEYFRAME ' +
        (snapshot.keyframeIndex + 1) +
        ' / ' +
        snapshot.keyframeCount;
      playLabel.textContent = snapshot.playing ? 'Pause' : 'Play';
      playIcon.textContent = snapshot.playing ? '❚❚' : '▶';
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

      document.body.dataset.scene = snapshot.sceneId;
      document.body.dataset.keyframe = String(snapshot.keyframeIndex);
      document.body.dataset.playing = String(snapshot.playing);
      document.body.dataset.speed = String(snapshot.speed);
      document.body.dataset.time = snapshot.time.toFixed(2);
    }

    playButton.addEventListener('click', () => timeline.toggle());
    stepButton.addEventListener('click', () => timeline.step());
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

    timeline.subscribe(render);
    render(timeline.snapshot());
    document.documentElement.dataset.ready = 'true';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(globalThis);
