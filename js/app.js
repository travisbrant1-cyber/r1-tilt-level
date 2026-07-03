(function () {
  'use strict';

  var THEMES = ['terminal', 'toy', 'analog', 'mission'];
  var THEME_NAMES = { terminal: 'Terminal', toy: 'Toy', analog: 'Analog', mission: 'Mission' };
  var VIZ_MODES = ['bubble', 'crosshair', 'gauge', 'numeric'];

  var LEVEL_THRESHOLD = 0.05;
  var STORAGE_KEY_PREFS = 'tilt_level_prefs';
  var STORAGE_KEY_LOG = 'tilt_level_measurements';

  var app = document.getElementById('app');
  var themeName = document.getElementById('themeName');
  var modeToggle = document.getElementById('modeToggle');
  var statusDot = document.getElementById('statusDot');
  var vizArea = document.getElementById('vizArea');
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
  var calX = 0;
  var calY = 0;
  var themeIndex = 0;
  var vizIndex = 0;
  var mode = 'dark';

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
    storageSet(STORAGE_KEY_PREFS, btoa(JSON.stringify({ themeIndex: themeIndex, vizIndex: vizIndex, mode: mode })));
  }

  function loadPrefs() {
    return storageGet(STORAGE_KEY_PREFS).then(function (raw) {
      if (!raw) return;
      try {
        var prefs = JSON.parse(atob(raw));
        if (typeof prefs.themeIndex === 'number') themeIndex = clamp(prefs.themeIndex, 0, THEMES.length - 1);
        if (typeof prefs.vizIndex === 'number') vizIndex = clamp(prefs.vizIndex, 0, VIZ_MODES.length - 1);
        if (prefs.mode === 'light' || prefs.mode === 'dark') mode = prefs.mode;
      } catch (e) {}
    });
  }

  // ---- Theme / viz mode / light-dark ----
  function applyTheme() {
    var id = THEMES[themeIndex];
    app.setAttribute('data-theme', id);
    app.setAttribute('data-mode', mode);
    themeName.textContent = THEME_NAMES[id];
    modeToggle.innerHTML = mode === 'dark' ? '&#9789;' : '&#9788;';
  }

  function cycleTheme(delta) {
    themeIndex = (themeIndex + delta + THEMES.length) % THEMES.length;
    applyTheme();
    savePrefs();
  }

  function toggleMode() {
    mode = mode === 'dark' ? 'light' : 'dark';
    applyTheme();
    savePrefs();
  }

  function applyViz() {
    var vizzes = vizArea.querySelectorAll('.viz');
    for (var i = 0; i < vizzes.length; i++) vizzes[i].classList.remove('active');
    vizArea.querySelectorAll('.viz')[vizIndex].classList.add('active');
    render();
  }

  function cycleViz() {
    vizIndex = (vizIndex + 1) % VIZ_MODES.length;
    applyViz();
    savePrefs();
  }

  // ---- Render ----
  function render() {
    var adjX = clamp(rawX + calX, -1, 1);
    var adjY = clamp(rawY + calY, -1, 1);
    var magnitude = clamp(Math.sqrt(adjX * adjX + adjY * adjY), 0, 1);
    var onLevel = magnitude < LEVEL_THRESHOLD;
    // tiltX/tiltY approximate the sine of roll/pitch, so asin recovers the angle.
    var angleDeg = Math.asin(magnitude) * 180 / Math.PI;

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
    render();
  }

  function autoZero() {
    calX = -rawX;
    calY = -rawY;
    render();
    flashStatus();
  }

  function flashStatus() {
    statusDot.style.transform = 'scale(1.4)';
    setTimeout(function () {
      statusDot.style.transform = 'scale(1)';
    }, 150);
  }

  function saveMeasurement() {
    var adjX = clamp(rawX + calX, -1, 1);
    var adjY = clamp(rawY + calY, -1, 1);
    var magnitude = clamp(Math.sqrt(adjX * adjX + adjY * adjY), 0, 1);
    var angleDeg = Math.asin(magnitude) * 180 / Math.PI;
    var entry = { x: Number(adjX.toFixed(3)), y: Number(adjY.toFixed(3)), angle: Number(angleDeg.toFixed(1)), ts: Date.now() };

    storageGet(STORAGE_KEY_LOG).then(function (raw) {
      var log = [];
      if (raw) {
        try { log = JSON.parse(atob(raw)); } catch (e) { log = []; }
      }
      log.unshift(entry);
      if (log.length > 50) log.length = 50;
      storageSet(STORAGE_KEY_LOG, btoa(JSON.stringify(log)));
    });

    var prevText = levelStatus.textContent;
    levelStatus.textContent = 'SAVED';
    setTimeout(function () {
      levelStatus.textContent = prevText;
    }, 700);
  }

  // ---- Hardware event wiring ----
  window.addEventListener('scrollUp', function () { cycleTheme(-1); });
  window.addEventListener('scrollDown', function () { cycleTheme(1); });
  window.addEventListener('sideClick', saveMeasurement);
  window.addEventListener('longPressStart', autoZero);

  var suppressNextClick = false;
  vizArea.addEventListener('click', function () {
    if (suppressNextClick) { suppressNextClick = false; return; }
    cycleViz();
  });
  modeToggle.addEventListener('click', toggleMode);

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

    statusDot.classList.add('live');

    setTimeout(function () {
      if (!gotData) {
        statusDot.classList.remove('live');
        try { accel.stop(); } catch (e) {}
        startSimFallback();
      }
    }, 1500);
  }

  function startSimFallback() {
    statusDot.classList.add('sim');
    hint.innerHTML = 'SIMULATED &middot; drag to tilt &middot; wheel/T = theme &middot; V = viz &middot; M = mode &middot; C/R = PTT';

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
      if (e.key === 't' || e.key === 'T') cycleTheme(1);
      if (e.key === 'v' || e.key === 'V') cycleViz();
      if (e.key === 'm' || e.key === 'M') toggleMode();
      if (e.key === 'c' || e.key === 'C') window.dispatchEvent(new Event('sideClick'));
      if (e.key === 'r' || e.key === 'R') window.dispatchEvent(new Event('longPressStart'));
    });
  }

  // ---- Init ----
  loadPrefs().then(function () {
    applyTheme();
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
