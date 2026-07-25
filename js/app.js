(function () {
  'use strict';

  var VIZ_MODES = ['bubble', 'crosshair', 'gauge', 'numeric'];

  var LEVEL_THRESHOLD = 0.05;
  var PROXIMITY_RANGE = 0.35;
  var FLAT_Z_THRESHOLD = 0.6;
  var STORAGE_KEY_PREFS = 'tilt_level_prefs';

  var app = document.getElementById('app');
  var modeToggle = document.getElementById('modeToggle');
  var vibToggle = document.getElementById('vibToggle');
  var soundToggle = document.getElementById('soundToggle');
  var vizArea = document.getElementById('vizArea');
  var modeFlash = document.getElementById('modeFlash');
  var bubble = document.getElementById('bubble');
  var gridDot = document.getElementById('gridDot');
  var gaugeNeedle = document.getElementById('gaugeNeedle');
  var numericHero = document.getElementById('numericHero');
  var numericSub = document.getElementById('numericSub');
  var levelStatus = document.getElementById('levelStatus');
  var angleValue = document.getElementById('angleValue');
  var xValue = document.getElementById('xValue');
  var yValue = document.getElementById('yValue');
  var hint = document.getElementById('hint');

  var rawX = 0;
  var rawY = 0;
  var rawZ = 1;
  var calX = 0;
  var calY = 0;
  var vizIndex = VIZ_MODES.indexOf('crosshair');
  var mode = 'dark';
  var soundOn = true;
  var vibOn = true;
  var levelMode = 'plumb';
  var lastProximity = -1;
  var currentProximity = 0;
  var currentOnLevel = false;
  var wasOnLevel = false;

  var usingRealStorage = typeof window.creationStorage !== 'undefined';

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---- Storage (real device storage, falls back to localStorage for dev preview) ----
  function storageGet(key) {
    if (usingRealStorage) return window.creationStorage.plain.getItem(key);
    return Promise.resolve(localStorage.getItem(key));
  }
  function storageSet(key, value) {
    if (usingRealStorage) return window.creationStorage.plain.setItem(key, value);
    localStorage.setItem(key, value);
    return Promise.resolve();
  }

  function savePrefs() {
    storageSet(STORAGE_KEY_PREFS, btoa(JSON.stringify({
      vizIndex: vizIndex, mode: mode, soundOn: soundOn, vibOn: vibOn
    })));
  }

  function loadPrefs() {
    return storageGet(STORAGE_KEY_PREFS).then(function (raw) {
      if (!raw) return;
      try {
        var prefs = JSON.parse(atob(raw));
        if (typeof prefs.vizIndex === 'number') vizIndex = clamp(prefs.vizIndex, 0, VIZ_MODES.length - 1);
        if (prefs.mode === 'light' || prefs.mode === 'dark') mode = prefs.mode;
        if (typeof prefs.soundOn === 'boolean') soundOn = prefs.soundOn;
        if (typeof prefs.vibOn === 'boolean') vibOn = prefs.vibOn;
      } catch (e) {}
    });
  }

  // ---- Viz mode / light-dark ----
  function applyMode() {
    app.setAttribute('data-mode', mode);
    modeToggle.innerHTML = mode === 'dark' ? '&#9789;' : '&#9788;';
  }

  function toggleMode() {
    mode = mode === 'dark' ? 'light' : 'dark';
    applyMode();
    savePrefs();
  }

  // ---- Level mode: plumb (flat) vs horizontal (standing on an edge) —
  // both fully auto-detected from tiltZ, no manual switching needed. ----
  var MODE_FLASH_LABELS = { plumb: 'Plumb', horizontal: 'Horizontal' };
  var MODE_FLASH_MS = 650;
  var modeFlashTimer = null;

  function applyLevelMode() {
    app.setAttribute('data-level-mode', levelMode);
  }

  // Brief green flash (text + reticle highlight) plus a sound/vibration cue,
  // so a mode change is unmistakable even with no persistent label on screen.
  // Sound/vibration respect their own toggles via beep()/vibrate() themselves.
  function flashModeSwitch() {
    modeFlash.textContent = MODE_FLASH_LABELS[levelMode];
    modeFlash.classList.remove('show');
    // Force a reflow so re-adding the class restarts the animation even if
    // a previous flash is still mid-fade.
    void modeFlash.offsetWidth;
    modeFlash.classList.add('show');
    app.classList.add('mode-switching');
    beep(560, 90, 0.14);
    vibrate(55);
    clearTimeout(modeFlashTimer);
    modeFlashTimer = setTimeout(function () {
      app.classList.remove('mode-switching');
    }, MODE_FLASH_MS);
  }

  function detectLevelMode() {
    var next = Math.abs(rawZ) >= FLAT_Z_THRESHOLD ? 'plumb' : 'horizontal';
    if (next !== levelMode) {
      levelMode = next;
      applyLevelMode();
      flashModeSwitch();
    }
  }

  function applySignalToggles() {
    vibToggle.classList.toggle('off', !vibOn);
    soundToggle.classList.toggle('off', !soundOn);
  }

  function toggleVib() {
    vibOn = !vibOn;
    applySignalToggles();
    savePrefs();
    if (vibOn) vibrate(30);
  }

  function toggleSound() {
    soundOn = !soundOn;
    applySignalToggles();
    savePrefs();
    if (soundOn) beep(700, 80, 0.12);
  }

  function applyViz() {
    var vizzes = vizArea.querySelectorAll('.viz');
    for (var i = 0; i < vizzes.length; i++) vizzes[i].classList.remove('active');
    vizArea.querySelectorAll('.viz')[vizIndex].classList.add('active');
    render();
  }

  // ---- Audio / haptics ----
  // AudioContext must be created/resumed from a real user gesture (browser autoplay
  // policy), so this is only called from actual click handlers, never from the
  // synthetic scrollUp/scrollDown/sideClick hardware events.
  var audioCtx = null;

  function ensureAudio() {
    if (audioCtx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioCtx = new AC(); } catch (e) {}
  }

  function beep(freq, durMs, vol) {
    if (!soundOn || !audioCtx) return;
    try {
      var t0 = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
      gain.gain.linearRampToValueAtTime(0, t0 + durMs / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + durMs / 1000 + 0.02);
    } catch (e) {}
  }

  // Same story as AudioContext: many WebViews only honor navigator.vibrate()
  // when it's called from a real user gesture. Our actual vibrate() calls
  // mostly happen from render(), which is driven by the accelerometer
  // callback — no gesture attached — so without this the API stays silently
  // blocked until something calls it from a real click. Fire one
  // imperceptible (1ms) vibration from every real gesture handler so it's
  // unlocked before it's ever needed for real.
  var vibrationUnlocked = false;

  function ensureVibration() {
    if (vibrationUnlocked) return;
    vibrationUnlocked = true;
    try { navigator.vibrate && navigator.vibrate(1); } catch (e) {}
  }

  function vibrate(pattern) {
    if (!vibOn) return;
    try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {}
  }

  // Self-scheduling beep loop: reads the latest proximity/onLevel each tick rather
  // than piggybacking on render(), so its cadence doesn't depend on how often the
  // accelerometer (or simulated drag) happens to fire.
  var BEEP_INTERVAL_MAX = 850;
  var BEEP_INTERVAL_MIN = 130;
  var BEEP_PROXIMITY_FLOOR = 0.04;

  function scheduleBeep() {
    setTimeout(function () {
      if (soundOn && !currentOnLevel && currentProximity > BEEP_PROXIMITY_FLOOR) {
        var freq = 320 + currentProximity * 620;
        beep(freq, 70, 0.1);
      }
      scheduleBeep();
    }, currentProximity > BEEP_PROXIMITY_FLOOR
      ? BEEP_INTERVAL_MAX - currentProximity * (BEEP_INTERVAL_MAX - BEEP_INTERVAL_MIN)
      : 250);
  }
  scheduleBeep();

  function cycleViz(delta) {
    vizIndex = (vizIndex + delta + VIZ_MODES.length) % VIZ_MODES.length;
    applyViz();
    savePrefs();
  }

  // ---- Render ----
  function render() {
    detectLevelMode();

    // Plumb (flat) reads both axes. Horizontal (standing on an edge) is a
    // single-axis reading — Y is pinned to 0 rather than picking up a stale
    // calibration offset from a different orientation.
    var adjX, adjY;
    if (levelMode === 'horizontal') {
      adjX = clamp(rawX + calX, -1, 1);
      adjY = 0;
    } else {
      adjX = clamp(rawX + calX, -1, 1);
      adjY = clamp(rawY + calY, -1, 1);
    }
    var magnitude = clamp(Math.sqrt(adjX * adjX + adjY * adjY), 0, 1);
    var onLevel = magnitude < LEVEL_THRESHOLD;
    // tiltX/tiltY approximate the sine of roll/pitch, so asin recovers the angle.
    var angleDeg = Math.asin(magnitude) * 180 / Math.PI;

    // Proximity glow: 0 outside PROXIMITY_RANGE, ramps to 1 as magnitude approaches level.
    var proximity = onLevel ? 1 : clamp(1 - magnitude / PROXIMITY_RANGE, 0, 1);
    if (Math.abs(proximity - lastProximity) >= 0.02) {
      app.style.setProperty('--proximity', proximity.toFixed(2));
      lastProximity = proximity;
    }
    currentProximity = proximity;
    currentOnLevel = onLevel;
    if (onLevel && !wasOnLevel) {
      beep(1300, 140, 0.15);
      vibrate(35);
    }
    wasOnLevel = onLevel;

    angleValue.innerHTML = angleDeg.toFixed(1) + '&deg;';
    xValue.textContent = adjX.toFixed(2);
    yValue.textContent = adjY.toFixed(2);
    levelStatus.textContent = onLevel ? 'LEVEL' : '';

    var activeViz = VIZ_MODES[vizIndex];

    if (activeViz === 'bubble') {
      var bpx = adjX * 44;
      var bpy = -adjY * 44;
      bubble.style.transform = 'translate3d(calc(-50% + ' + bpx.toFixed(1) + 'px), calc(-50% + ' + bpy.toFixed(1) + 'px), 0)';
      bubble.classList.toggle('on-level', onLevel);
    } else if (activeViz === 'crosshair') {
      var gpx = adjX * 46;
      var gpy = -adjY * 46;
      gridDot.style.transform = 'translate3d(calc(-50% + ' + gpx.toFixed(1) + 'px), calc(-50% + ' + gpy.toFixed(1) + 'px), 0)';
      gridDot.classList.toggle('on-level', onLevel);
    } else if (activeViz === 'gauge') {
      var needleAngle = Math.atan2(adjX, adjY) * 180 / Math.PI;
      var needleLen = 10 + magnitude * 32;
      gaugeNeedle.style.height = needleLen.toFixed(1) + 'px';
      gaugeNeedle.style.transform = 'translate(-50%, -100%) rotate(' + needleAngle.toFixed(1) + 'deg)';
      gaugeNeedle.classList.toggle('on-level', onLevel);
    } else if (activeViz === 'numeric') {
      numericHero.innerHTML = angleDeg.toFixed(1) + '&deg;';
      numericSub.textContent = 'X ' + adjX.toFixed(2) + ' · Y ' + adjY.toFixed(2);
      numericHero.classList.toggle('on-level', onLevel);
    }
  }

  function handleAccelData(data) {
    if (!data) return;
    rawX = (data.tiltX !== undefined) ? data.tiltX : (data.x !== undefined ? data.x : rawX);
    rawY = (data.tiltY !== undefined) ? data.tiltY : (data.y !== undefined ? data.y : rawY);
    rawZ = (data.tiltZ !== undefined) ? data.tiltZ : (data.z !== undefined ? data.z : rawZ);
    render();
  }

  function autoZero() {
    calX = -rawX;
    calY = -rawY;
    render();
  }

  // ---- Hardware event wiring ----
  window.addEventListener('scrollUp', function () { cycleViz(-1); });
  window.addEventListener('scrollDown', function () { cycleViz(1); });
  window.addEventListener('longPressStart', autoZero);

  var suppressNextClick = false;
  vizArea.addEventListener('click', function () {
    ensureAudio();
    ensureVibration();
    if (suppressNextClick) { suppressNextClick = false; return; }
    cycleViz(1);
  });
  modeToggle.addEventListener('click', function () { ensureAudio(); ensureVibration(); toggleMode(); });
  vibToggle.addEventListener('click', function () { ensureAudio(); ensureVibration(); toggleVib(); });
  soundToggle.addEventListener('click', function () { ensureAudio(); ensureVibration(); toggleSound(); });

  // ---- Sensor detection: wait for the bridge, then verify it actually delivers data ----
  function waitForSensors(maxWaitMs, intervalMs) {
    return new Promise(function (resolve) {
      var elapsed = 0;
      (function poll() {
        var ready = typeof window.creationSensors !== 'undefined' &&
          window.creationSensors.accelerometer &&
          typeof window.creationSensors.accelerometer.start === 'function';
        if (ready) { resolve(true); return; }
        elapsed += intervalMs;
        if (elapsed >= maxWaitMs) { resolve(false); return; }
        setTimeout(poll, intervalMs);
      })();
    });
  }

  function tryStartReal() {
    var accel = window.creationSensors.accelerometer;
    var gotData = false;

    function onData(data) {
      gotData = true;
      handleAccelData(data);
    }

    try {
      accel.start(onData, { frequency: 30 });
    } catch (e) {
      startSimFallback();
      return;
    }

    setTimeout(function () {
      if (!gotData) {
        try { accel.stop(); } catch (e) {}
        startSimFallback();
      }
    }, 1500);
  }

  function startSimFallback() {
    hint.innerHTML = 'SIMULATED &middot; drag=tilt &middot; F=flat/stand &middot; R=PTT hold';

    var dragging = false;

    function updateFromPointer(clientX, clientY) {
      var rect = vizArea.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var half = Math.min(rect.width, rect.height) / 2;
      var nx = (clientX - cx) / half;
      var ny = (clientY - cy) / half;
      rawX = clamp(nx, -1, 1);
      rawY = clamp(-ny, -1, 1);
      render();
    }

    vizArea.addEventListener('mousedown', function (e) {
      ensureAudio();
      ensureVibration();
      dragging = true;
      updateFromPointer(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', function (e) {
      if (dragging) {
        suppressNextClick = true;
        updateFromPointer(e.clientX, e.clientY);
      }
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
    });

    window.addEventListener('wheel', function (e) {
      window.dispatchEvent(new Event(e.deltaY < 0 ? 'scrollUp' : 'scrollDown'));
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      ensureAudio();
      ensureVibration();
      if (e.key === 'v' || e.key === 'V') cycleViz(1);
      if (e.key === 'm' || e.key === 'M') toggleMode();
      if (e.key === 's' || e.key === 'S') toggleSound();
      if (e.key === 'b' || e.key === 'B') toggleVib();
      if (e.key === 'r' || e.key === 'R') window.dispatchEvent(new Event('longPressStart'));
      if (e.key === 'f' || e.key === 'F') {
        rawZ = Math.abs(rawZ) >= FLAT_Z_THRESHOLD ? 0 : 1;
        render();
      }
    });
  }

  // ---- Init ----
  loadPrefs().then(function () {
    applyMode();
    applySignalToggles();
    applyLevelMode();
    applyViz();

    waitForSensors(2000, 100).then(function (found) {
      if (found) {
        tryStartReal();
      } else {
        startSimFallback();
      }
    });
  });
})();
