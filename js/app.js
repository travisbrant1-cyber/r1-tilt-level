(function () {
  'use strict';

  var RING_MAX_PX = 57; // (140 - bubble 26) / 2
  var LEVEL_THRESHOLD = 0.05;
  var CAL_STEP = 0.02;

  var bubble = document.getElementById('bubble');
  var statusDot = document.getElementById('statusDot');
  var angleValue = document.getElementById('angleValue');
  var xValue = document.getElementById('xValue');
  var yValue = document.getElementById('yValue');
  var hint = document.getElementById('hint');

  var rawX = 0;
  var rawY = 0;
  var calX = 0;
  var calY = 0;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function render() {
    var adjX = clamp(rawX + calX, -1, 1);
    var adjY = clamp(rawY + calY, -1, 1);

    var px = adjX * RING_MAX_PX;
    var py = -adjY * RING_MAX_PX;

    bubble.style.transform = 'translate3d(calc(-50% + ' + px.toFixed(1) + 'px), calc(-50% + ' + py.toFixed(1) + 'px), 0)';

    var magnitude = Math.sqrt(adjX * adjX + adjY * adjY);
    var onLevel = magnitude < LEVEL_THRESHOLD;
    bubble.classList.toggle('on-level', onLevel);

    angleValue.innerHTML = (magnitude * 90).toFixed(1) + '&deg;';
    xValue.textContent = adjX.toFixed(2);
    yValue.textContent = adjY.toFixed(2);
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

  function resetCalibration() {
    calX = 0;
    calY = 0;
    render();
    flashStatus();
  }

  function flashStatus() {
    statusDot.style.transform = 'scale(1.4)';
    setTimeout(function () {
      statusDot.style.transform = 'scale(1)';
    }, 150);
  }

  function nudgeCalibration(delta) {
    calY = clamp(calY + delta, -1, 1);
    render();
  }

  window.addEventListener('scrollUp', function () {
    nudgeCalibration(CAL_STEP);
  });
  window.addEventListener('scrollDown', function () {
    nudgeCalibration(-CAL_STEP);
  });
  window.addEventListener('sideClick', autoZero);
  window.addEventListener('longPressStart', resetCalibration);

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

    // Bridge can exist without actually delivering data (older builds,
    // permission not granted, etc.) - confirm data actually arrives.
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
    hint.innerHTML = 'SIMULATED &middot; drag the ring to tilt &middot; wheel = scroll &middot; C = click, R = reset';

    var ring = document.querySelector('.level-ring');
    var dragging = false;

    function updateFromPointer(clientX, clientY) {
      var rect = ring.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var nx = (clientX - cx) / (rect.width / 2);
      var ny = (clientY - cy) / (rect.height / 2);
      rawX = clamp(nx, -1, 1);
      rawY = clamp(-ny, -1, 1);
      render();
    }

    ring.addEventListener('mousedown', function (e) {
      dragging = true;
      updateFromPointer(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', function (e) {
      if (dragging) updateFromPointer(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
    });

    window.addEventListener('wheel', function (e) {
      window.dispatchEvent(new Event(e.deltaY < 0 ? 'scrollUp' : 'scrollDown'));
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'c' || e.key === 'C') window.dispatchEvent(new Event('sideClick'));
      if (e.key === 'r' || e.key === 'R') window.dispatchEvent(new Event('longPressStart'));
    });
  }

  function init() {
    waitForSensors(2000, 100).then(function (found) {
      if (found) {
        tryStartReal();
      } else {
        startSimFallback();
      }
    });

    render();
  }

  init();
})();
